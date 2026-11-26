import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { auth, db, storage } from '@shared/services/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { httpsCallable, getFunctions } from 'firebase/functions';
import posthog from 'posthog-js';
import { isUserPro } from '@shared/auth/api/user';

const sceneRef = collection(db, 'scenes');

const generateSceneId = async (authorId, isFirstScene = false) => {
  // Generate a new UUID
  const newSceneId = uuidv4();

  const newSceneDocRef = doc(sceneRef, newSceneId);

  // Use setDoc to set data on the specified document
  await setDoc(newSceneDocRef, {
    createTimestamp: serverTimestamp(),
    updateTimestamp: serverTimestamp(),
    author: authorId,
    visibility: 'public',
    orgId: null
  });

  posthog.capture('scene_created', {
    scene_id: newSceneId,
    author_id: authorId,
    is_first: isFirstScene
  });

  return newSceneId;
};

const captureSceneCreated = (sceneId, authorId, title, isFirstScene) =>
  posthog.capture('scene_created', {
    scene_id: sceneId,
    author_id: authorId,
    scene_title: title,
    is_first: isFirstScene
  });

const createScene = async (
  authorId,
  sceneData,
  title,
  version,
  memory,
  isFirstScene = false,
  // Personal scene: the rules let clients create only public ones; an
  // unlisted or private one (Pro) goes through the createRestrictedScene
  // callable, which refuses with details.reason 'pro-required'. Team scene:
  // any visibility.
  visibility = 'public',
  // A team scene (#1267 Phase 2): { orgId, projectId, lockName }. The
  // creator holds its edit lock (src/editor/lib/editLock.js).
  team = null
) => {
  const content = { data: sceneData, title, version, memory };
  if (!team && visibility !== 'public') {
    const callable = httpsCallable(getFunctions(), 'createRestrictedScene');
    const { sceneId } = (await callable({ visibility })).data;
    const restrictedRef = doc(sceneRef, sceneId);
    try {
      await updateDoc(restrictedRef, {
        ...content,
        updateTimestamp: serverTimestamp()
      });
    } catch (error) {
      // Don't leave an empty scene behind.
      await deleteDoc(restrictedRef).catch(() => {});
      throw error;
    }
    captureSceneCreated(sceneId, authorId, title, isFirstScene);
    return sceneId;
  }

  // Generate a new UUID
  const newSceneId = uuidv4();
  const newSceneDocRef = doc(sceneRef, newSceneId);

  await setDoc(newSceneDocRef, {
    createTimestamp: serverTimestamp(),
    updateTimestamp: serverTimestamp(),
    author: authorId,
    visibility,
    orgId: team ? team.orgId : null,
    ...(team && {
      projectId: team.projectId || null,
      revision: 0,
      editLock: {
        uid: authorId,
        name: team.lockName || null,
        expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000)
      }
    }),
    ...content
  });

  captureSceneCreated(newSceneId, authorId, title, isFirstScene);

  return newSceneId;
};

const deleteScene = async (sceneId) => {
  try {
    const sceneDocRef = doc(db, 'scenes', sceneId);

    await deleteDoc(sceneDocRef);
  } catch (error) {
    throw new Error('Error deleting scene');
  }
};

const updateScene = async (
  sceneId,
  sceneData,
  title,
  version,
  memory,
  // A team scene's saves count revisions (#1267, see editLock.js).
  { bumpRevision = false } = {}
) => {
  try {
    const sceneDocRef = doc(sceneRef, sceneId);
    await updateDoc(sceneDocRef, {
      data: sceneData,
      updateTimestamp: serverTimestamp(),
      title: title,
      version: version,
      memory: memory,
      ...(bumpRevision && { revision: increment(1) })
    });
  } catch (error) {
    throw new Error(error);
  }
};

const updateSceneIdAndTitle = async (sceneId, title) => {
  try {
    const sceneDocRef = doc(sceneRef, sceneId);

    const sceneSnapshot = await getDoc(sceneDocRef);
    if (sceneSnapshot.exists()) {
      await updateDoc(sceneDocRef, {
        title: title,
        updateTimestamp: serverTimestamp()
      });

      console.log('Firebase updateDoc (sceneId and title) fired');
    } else {
      throw new Error('No existing sceneSnapshot exists.');
    }
  } catch (error) {
    throw new Error(error);
  }
};

let scenesSnapshot;
const getUserScenes = async (currentUserUID, isInitialFetch) => {
  try {
    if (isInitialFetch) {
      const userScenesQuery = query(
        collection(db, 'scenes'),
        where('author', '==', currentUserUID),
        // Personal scenes only: team scenes are listed per team (#1267).
        where('orgId', '==', null),
        orderBy('updateTimestamp', 'desc'),
        limit(20)
      );

      scenesSnapshot = await getDocs(userScenesQuery);
      //  const scenesData = scenesSnapshot.docs.map((doc) => doc.data());
      return scenesSnapshot.docs;
    } else {
      const lastVisible = scenesSnapshot.docs[scenesSnapshot.docs.length - 1];
      const userScenesQuery = query(
        collection(db, 'scenes'),
        where('author', '==', currentUserUID),
        // Personal scenes only: team scenes are listed per team (#1267).
        where('orgId', '==', null),
        orderBy('updateTimestamp', 'desc'),
        startAfter(lastVisible),
        limit(20)
      );

      scenesSnapshot = await getDocs(userScenesQuery);
      //  const scenesData = scenesSnapshot.docs.map((doc) => doc.data());
      return scenesSnapshot.docs;
    }
  } catch (error) {
    console.error(error);
  }
};

// A team's scenes (#1267 Phase 2), newest first; projectId narrows to one
// project. Pass the previous page's last doc to continue.
const getTeamScenes = async (orgId, { projectId, after } = {}) => {
  const constraints = [where('orgId', '==', orgId)];
  if (projectId !== undefined) {
    constraints.push(where('projectId', '==', projectId));
  }
  constraints.push(orderBy('updateTimestamp', 'desc'));
  if (after) constraints.push(startAfter(after));
  constraints.push(limit(20));
  return (await getDocs(query(collection(db, 'scenes'), ...constraints))).docs;
};

let communityScenesSnapshot;
const getCommunityScenes = async (isInitialFetch) => {
  try {
    if (isInitialFetch) {
      const communityScenesQuery = query(
        collection(db, 'scenes'),
        // Only public scenes are listed (#1267); the rules refuse a query
        // that isn't limited to them.
        where('visibility', '==', 'public'),
        orderBy('updateTimestamp', 'desc'),
        limit(20)
      );

      communityScenesSnapshot = await getDocs(communityScenesQuery);
      return communityScenesSnapshot.docs;
    } else {
      const lastVisible =
        communityScenesSnapshot.docs[communityScenesSnapshot.docs.length - 1];

      const communityScenesQuery = query(
        collection(db, 'scenes'),
        // Only public scenes are listed (#1267); the rules refuse a query
        // that isn't limited to them.
        where('visibility', '==', 'public'),
        orderBy('updateTimestamp', 'desc'),
        startAfter(lastVisible),
        limit(20)
      );

      communityScenesSnapshot = await getDocs(communityScenesQuery);
      return communityScenesSnapshot.docs;
    }
  } catch (error) {
    console.error('Error fetching community scenes:', error);
    return [];
  }
};

const checkIfImagePathIsEmpty = async (sceneId) => {
  const userScenesRef = collection(db, 'scenes');
  const sceneDocRef = doc(userScenesRef, sceneId);

  const sceneSnapshot = await getDoc(sceneDocRef);
  if (sceneSnapshot.exists()) {
    const sceneData = sceneSnapshot.data();
    return !sceneData.imagePath;
  } else {
    console.error('Scene document not found');
    return true;
  }
};

// Enhanced screenshot function with explicit overlay control
const takeScreenshotWithOptions = async (options = {}) => {
  const {
    type = 'jpg',
    filename = 'screenshot',
    showLogo = false,
    showWatermark = false,
    imgElementSelector = null
  } = options;

  const screenshotEl = document.getElementById('screenshot');
  screenshotEl.play();

  // Set all screentock attributes explicitly
  screenshotEl.setAttribute('screentock', 'showLogo', showLogo);
  screenshotEl.setAttribute(
    'screentock',
    'showCommunityWatermark',
    showWatermark
  );
  screenshotEl.setAttribute('screentock', 'filename', filename);
  screenshotEl.setAttribute('screentock', 'type', type);

  if (imgElementSelector) {
    screenshotEl.setAttribute(
      'screentock',
      'imgElementSelector',
      imgElementSelector
    );
  }

  posthog.capture('export_initiated', {
    export_type: type,
    scene_id: STREET.utils.getCurrentSceneId()
  });

  posthog.capture('screenshot_taken', {
    type: type,
    scene_id: STREET.utils.getCurrentSceneId()
  });

  screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
};

// Legacy function for backward compatibility - auto-detects user plan
const saveScreenshot = async (value) => {
  // Check if user is Pro to determine overlay settings
  const currentUser = auth.currentUser;
  const isPro = currentUser ? await isUserPro(currentUser) : false;

  const options = {
    type: value,
    showLogo: !isPro,
    showWatermark: !isPro
  };

  if (value === 'img') {
    options.imgElementSelector = '#screentock-destination';
  }

  await takeScreenshotWithOptions(options);
};

const uploadThumbnailImage = async (sceneDocId) => {
  try {
    // Take a fresh screenshot without watermarks for thumbnail
    await takeScreenshotWithOptions({
      type: 'img',
      showLogo: false,
      showWatermark: false,
      imgElementSelector: '#screentock-destination'
    });

    const screentockImgElement = document.getElementById(
      'screentock-destination'
    );

    // Get the original image dimensions
    const originalWidth = screentockImgElement.naturalWidth;
    const originalHeight = screentockImgElement.naturalHeight;

    // Define the target dimensions
    const targetWidth = 320;
    const targetHeight = 240;

    // Calculate the scale factors
    const scaleX = targetWidth / originalWidth;
    const scaleY = targetHeight / originalHeight;

    // Use the larger scale factor to fill the entire space
    const scale = Math.max(scaleX, scaleY);

    // Calculate the new dimensions
    const newWidth = originalWidth * scale;
    const newHeight = originalHeight * scale;

    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = targetWidth;
    resizedCanvas.height = targetHeight;
    const context = resizedCanvas.getContext('2d');

    // Calculate the position to center the image
    const posX = (targetWidth - newWidth) / 2;
    const posY = (targetHeight - newHeight) / 2;

    // Draw the image on the canvas with the new dimensions and position
    context.drawImage(screentockImgElement, posX, posY, newWidth, newHeight);
    // Rest of the code...
    const thumbnailDataUrl = resizedCanvas.toDataURL('image/jpeg', 0.5);
    const res = await fetch(thumbnailDataUrl);
    const blobFile = await res.blob();

    const thumbnailRef = ref(storage, `scenes/${sceneDocId}/files/preview.jpg`);

    const uploadedImg = await uploadBytes(thumbnailRef, blobFile);

    const downloadURL = await getDownloadURL(uploadedImg.ref);
    const userScenesRef = collection(db, 'scenes');
    const sceneDocRef = doc(userScenesRef, sceneDocId);
    const sceneSnapshot = await getDoc(sceneDocRef);
    if (sceneSnapshot.exists()) {
      await updateDoc(sceneDocRef, {
        imagePath: downloadURL,
        updateTimestamp: serverTimestamp()
      });
      console.log('Firebase updateDoc fired');
    } else {
      throw new Error('No existing sceneSnapshot exists.');
    }

    console.log('Thumbnail uploaded and Firestore updated successfully.');
  } catch (error) {
    console.error('Error capturing screenshot and updating Firestore:', error);
    let errorMessage = `Error updating scene thumbnail: ${error}`;
    if (error.code === 'storage/unauthorized') {
      errorMessage =
        'Error updating scene thumbnail: only the scene author may change the scene thumbnail. Save this scene as your own to change the thumbnail.';
      STREET.notify.errorMessage(errorMessage);
    }
  }
};

// Change a scene's visibility (#1267). Goes through the setSceneVisibility
// callable: the only path allowed to make a scene unlisted or private (Pro
// features checked server-side). Throws the callable's error, whose
// details.reason is 'pro-required' | 'not-author' | 'not-found' |
// 'invalid-visibility'.
const setSceneVisibility = async (sceneId, visibility) => {
  const callable = httpsCallable(getFunctions(), 'setSceneVisibility');
  const result = await callable({ sceneId, visibility });
  return result.data.visibility;
};

export {
  checkIfImagePathIsEmpty,
  createScene,
  deleteScene,
  generateSceneId,
  getCommunityScenes,
  getUserScenes,
  getTeamScenes,
  setSceneVisibility,
  updateScene,
  updateSceneIdAndTitle,
  uploadThumbnailImage,
  saveScreenshot,
  takeScreenshotWithOptions
};
