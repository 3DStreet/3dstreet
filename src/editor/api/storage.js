import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { db, storage } from '../services/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import posthog from 'posthog-js';

/**
 * Upload a file to a scene's asset folder
 * @param {string} sceneId - The scene ID
 * @param {File} file - The file to upload
 * @returns {Promise<string>} The download URL of the uploaded file
 */
export async function uploadAsset(sceneId, file) {
  try {
    const assetId = uuidv4();
    const filename = `${assetId}-${file.name}`;
    const storageRef = ref(storage, `scenes/${sceneId}/files/${filename}`);

    const uploadedFile = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(uploadedFile.ref);

    posthog.capture('asset_uploaded', {
      scene_id: sceneId,
      asset_id: assetId,
      file_name: file.name,
      file_type: file.type
    });

    return downloadURL;
  } catch (error) {
    console.error('Error uploading asset:', error);
    throw error;
  }
}

/**
 * Add an asset to the scene's memory
 * @param {string} sceneId - The scene ID
 * @param {Object} asset - The asset object to add
 */
export async function addAssetToScene(sceneId, asset) {
  try {
    const sceneDocRef = doc(db, 'scenes', sceneId);
    const sceneSnapshot = await getDoc(sceneDocRef);

    if (!sceneSnapshot.exists()) {
      throw new Error('Scene not found');
    }

    const sceneData = sceneSnapshot.data();
    const memory = sceneData.memory || {};
    const assets = memory.assets || [];

    assets.push(asset);

    const updatedMemory = {
      ...memory,
      assets: assets
    };

    await updateDoc(sceneDocRef, {
      memory: updatedMemory,
      updateTimestamp: serverTimestamp()
    });
  } catch (error) {
    console.error('Error adding asset to scene:', error);
    throw error;
  }
}
