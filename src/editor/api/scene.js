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
import { db } from '../services/firebase';

const generateSceneId = async (authorId) => {
  const userScenesRef = collection(db, 'scenes');

  // Generate a new UUID
  const newSceneId = uuidv4();

  const newSceneDocRef = doc(userScenesRef, newSceneId);

  // Use setDoc to set data on the specified document
  await setDoc(newSceneDocRef, {
    createTimestamp: serverTimestamp(),
    updateTimestamp: serverTimestamp(),
    author: authorId
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

const updateScene = async (sceneId, userUID, sceneData, title, version) => {
  try {
    const userScenesRef = collection(db, 'scenes');
    const sceneDocRef = doc(userScenesRef, sceneId);

    const sceneSnapshot = await getDoc(sceneDocRef);
    if (sceneSnapshot.exists()) {
      await updateDoc(sceneDocRef, {
        data: sceneData,
        updateTimestamp: serverTimestamp(),
        title: title,
        version: version,
        author: userUID
      });
      console.log('Firebase updateDoc fired');
    } else {
      throw new Error('No existing sceneSnapshot exists.');
    }
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

const isSceneAuthor = async ({ sceneId, authorId }) => {
  if (!sceneId || !authorId) {
    console.log('sceneId or authorId is not provided in isSceneAuthor');
    return false;
  }
  try {
    // Get a reference to the scene document
    const sceneRef = doc(db, 'scenes', sceneId);
    const sceneSnapshot = await getDoc(sceneRef);

    if (sceneSnapshot.exists()) {
      return sceneSnapshot.data().author === authorId;
    } else {
      console.error('Scene not found while running isSceneAuthor');
      return false;
    }
  } catch (error) {
    console.error('Error fetching scene while running isSceneAuthor:', error);
    return false;
  }
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

export {
  checkIfImagePathIsEmpty,
  deleteScene,
  generateSceneId,
  getCommunityScenes,
  getUserScenes,
  isSceneAuthor,
  updateScene,
  updateSceneIdAndTitle
};
