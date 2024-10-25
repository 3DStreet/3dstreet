import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { db, storage } from '../services/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import posthog from 'posthog-js';

const sceneRef = collection(db, 'scenes');

const generateSceneId = async (authorId) => {
  // Generate a new UUID
  const newSceneId = uuidv4();

  const newSceneDocRef = doc(sceneRef, newSceneId);

  // Use setDoc to set data on the specified document
  await setDoc(newSceneDocRef, {
    createTimestamp: serverTimestamp(),
    updateTimestamp: serverTimestamp(),
    author: authorId
  });

  return newSceneId;
};

const createScene = async (authorId, sceneData, title, version) => {
  // Generate a new UUID
  const newSceneId = uuidv4();
  const newSceneDocRef = doc(sceneRef, newSceneId);

  await setDoc(newSceneDocRef, {
    createTimestamp: serverTimestamp(),
    updateTimestamp: serverTimestamp(),
    author: authorId,
    data: sceneData,
    title: title,
    version: version
  });
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

const updateScene = async (sceneId, sceneData, title, version) => {
  try {
    const userScenesRef = collection(db, 'scenes');
    const sceneDocRef = doc(userScenesRef, sceneId);
    await updateDoc(sceneDocRef, {
      data: sceneData,
      updateTimestamp: serverTimestamp(),
      title: title,
      version: version
    });
  } catch (error) {
    throw new Error(error);
  }
};

const updateSceneIdAndTitle = async (sceneId, title) => {
  try {
    const userScenesRef = collection(db, 'scenes');
    const sceneDocRef = doc(userScenesRef, sceneId);

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

const getScene = async ({ sceneId }) => {
  if (!sceneId) return null;
  const sceneRef = doc(db, 'scenes', sceneId);
  const sceneSnapshot = await getDoc(sceneRef);
  return sceneSnapshot;
};

let scenesSnapshot;
const getUserScenes = async (currentUserUID, isInitialFetch) => {
  try {
    if (isInitialFetch) {
      const userScenesQuery = query(
        collection(db, 'scenes'),
        where('author', '==', currentUserUID),
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

let communityScenesSnapshot;
const getCommunityScenes = async (isInitialFetch) => {
  try {
    if (isInitialFetch) {
      const communityScenesQuery = query(
        collection(db, 'scenes'),
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

const saveScreenshot = async (value) => {
  const screenshotEl = document.getElementById('screenshot');
  screenshotEl.play();

  if (value === 'img') {
    screenshotEl.setAttribute(
      'screentock',
      'imgElementSelector',
      '#screentock-destination'
    );
  }

  posthog.capture('screenshot_taken', {
    type: value,
    scene_id: STREET.utils.getCurrentSceneId()
  });

  screenshotEl.setAttribute('screentock', 'type', value);
  screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
};

const uploadThumbnailImage = async () => {
  try {
    // saveScreenshot('img');

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
    const blobFile = await fetch(thumbnailDataUrl).then((res) => res.blob());

    const sceneDocId = STREET.utils.getCurrentSceneId();

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

export {
  checkIfImagePathIsEmpty,
  createScene,
  deleteScene,
  generateSceneId,
  getCommunityScenes,
  getUserScenes,
  getScene,
  updateScene,
  updateSceneIdAndTitle,
  uploadThumbnailImage,
  saveScreenshot
};
