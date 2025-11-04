import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { db, storage } from '@shared/services/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getCurrentCameraState } from '../lib/cameraUtils';
import posthog from 'posthog-js';

/**
 * Create and upload a snapshot with camera state
 * @param {string} sceneId - The scene ID
 * @param {boolean} setAsDefault - Whether to set this as the default snapshot
 * @param {string} label - Optional label for the snapshot
 * @returns {Object} The created snapshot object
 */
export async function createSceneSnapshot(
  sceneId,
  setAsDefault = false,
  label = null
) {
  try {
    const snapshotId = uuidv4();
    const cameraState = getCurrentCameraState();

    if (!cameraState) {
      throw new Error('Failed to capture camera state');
    }

    // Get the screenshot element
    const screentockImgElement = document.getElementById(
      'screentock-destination'
    );
    if (!screentockImgElement || !screentockImgElement.src) {
      throw new Error(
        'No screenshot available. Please generate a preview first.'
      );
    }

    // Upload low-res thumbnail (320x240)
    const lowResUrl = await uploadSnapshotImage(
      sceneId,
      snapshotId,
      screentockImgElement,
      320,
      240,
      'low'
    );

    // Upload high-res version (1280x960)
    const highResUrl = await uploadSnapshotImage(
      sceneId,
      snapshotId,
      screentockImgElement,
      1280,
      960,
      'high'
    );

    // Create snapshot object
    const snapshot = {
      id: snapshotId,
      imagePath: lowResUrl,
      imagePathHD: highResUrl,
      cameraState: cameraState,
      isDefault: setAsDefault,
      timestamp: new Date().toISOString(),
      label: label || `Snapshot ${new Date().toLocaleString()}`
    };

    // Update the scene document
    await updateSceneSnapshots(sceneId, snapshot, setAsDefault);

    posthog.capture('snapshot_created', {
      scene_id: sceneId,
      snapshot_id: snapshotId,
      is_default: setAsDefault
    });

    return snapshot;
  } catch (error) {
    console.error('Error creating scene snapshot:', error);
    throw error;
  }
}

/**
 * Upload a snapshot image at specific resolution
 * @param {string} sceneId - Scene ID
 * @param {string} snapshotId - Snapshot ID
 * @param {HTMLImageElement} imgElement - Source image element
 * @param {number} targetWidth - Target width
 * @param {number} targetHeight - Target height
 * @param {string} quality - Quality level ('low' or 'high')
 * @returns {string} Download URL
 */
async function uploadSnapshotImage(
  sceneId,
  snapshotId,
  imgElement,
  targetWidth,
  targetHeight,
  quality
) {
  // Get the original image dimensions
  const originalWidth = imgElement.naturalWidth;
  const originalHeight = imgElement.naturalHeight;

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

  // Draw the image on the canvas
  context.drawImage(imgElement, posX, posY, newWidth, newHeight);

  // Convert to blob with appropriate quality
  const jpegQuality = quality === 'high' ? 0.9 : 0.5;
  const dataUrl = resizedCanvas.toDataURL('image/jpeg', jpegQuality);
  const res = await fetch(dataUrl);
  const blobFile = await res.blob();

  // Upload to Firebase Storage - using files/ path for compatibility with existing security rules
  const filename =
    quality === 'high'
      ? `snapshot-${snapshotId}-hd.jpg`
      : `snapshot-${snapshotId}.jpg`;
  const storageRef = ref(storage, `scenes/${sceneId}/files/${filename}`);

  const uploadedImg = await uploadBytes(storageRef, blobFile);
  return await getDownloadURL(uploadedImg.ref);
}

/**
 * Update scene document with new snapshot
 * @param {string} sceneId - Scene ID
 * @param {Object} newSnapshot - New snapshot object
 * @param {boolean} setAsDefault - Whether to set as default
 */
async function updateSceneSnapshots(sceneId, newSnapshot, setAsDefault) {
  const sceneDocRef = doc(db, 'scenes', sceneId);
  const sceneSnapshot = await getDoc(sceneDocRef);

  if (!sceneSnapshot.exists()) {
    throw new Error('Scene not found');
  }

  const sceneData = sceneSnapshot.data();

  // Get existing memory object or create new one
  const memory = sceneData.memory || {};
  let snapshots = memory.snapshots || [];

  // If setting as default, update all other snapshots
  if (setAsDefault) {
    snapshots = snapshots.map((s) => ({ ...s, isDefault: false }));
  }

  // Add the new snapshot
  snapshots.push(newSnapshot);

  // Update memory with new snapshots
  const updatedMemory = {
    ...memory,
    snapshots: snapshots
  };

  // Update the scene document
  const updateData = {
    memory: updatedMemory,
    updateTimestamp: serverTimestamp()
  };

  // If this is the default snapshot, also update the main imagePath
  if (setAsDefault) {
    updateData.imagePath = newSnapshot.imagePath;
    updateData.thumbnailLocked = true; // Indicates manual thumbnail set
  }

  await updateDoc(sceneDocRef, updateData);
}

/**
 * Get the default snapshot for a scene
 * @param {string} sceneId - Scene ID
 * @returns {Object|null} Default snapshot or null
 */
export async function getDefaultSnapshot(sceneId) {
  try {
    const sceneDocRef = doc(db, 'scenes', sceneId);
    const sceneSnapshot = await getDoc(sceneDocRef);

    if (!sceneSnapshot.exists()) {
      return null;
    }

    const sceneData = sceneSnapshot.data();
    if (
      !sceneData.memory?.snapshots ||
      sceneData.memory.snapshots.length === 0
    ) {
      return null;
    }

    return sceneData.memory.snapshots.find((s) => s.isDefault) || null;
  } catch (error) {
    console.error('Error getting default snapshot:', error);
    return null;
  }
}

/**
 * Create a snapshot from a generated image URL
 * @param {string} sceneId - The scene ID
 * @param {string} imageUrl - The URL of the generated image
 * @param {string} label - Label for the snapshot
 * @returns {Object} The created snapshot object
 */
export async function createSnapshotFromImageUrl(sceneId, imageUrl, label) {
  try {
    const snapshotId = uuidv4();
    const cameraState = getCurrentCameraState();

    if (!cameraState) {
      throw new Error('Failed to capture camera state');
    }

    // Create an image element from the URL
    const img = new Image();
    img.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageUrl;
    });

    // Upload low-res thumbnail (320x240)
    const lowResUrl = await uploadSnapshotImage(
      sceneId,
      snapshotId,
      img,
      320,
      240,
      'low'
    );

    // Upload high-res version (1280x960)
    const highResUrl = await uploadSnapshotImage(
      sceneId,
      snapshotId,
      img,
      1280,
      960,
      'high'
    );

    // Create snapshot object
    const snapshot = {
      id: snapshotId,
      imagePath: lowResUrl,
      imagePathHD: highResUrl,
      cameraState: cameraState,
      isDefault: false,
      timestamp: new Date().toISOString(),
      label: label || `AI Generated ${new Date().toLocaleString()}`
    };

    // Update the scene document
    await updateSceneSnapshots(sceneId, snapshot, false);

    posthog.capture('ai_snapshot_created', {
      scene_id: sceneId,
      snapshot_id: snapshotId,
      is_generated: true
    });

    return snapshot;
  } catch (error) {
    console.error('Error creating snapshot from image URL:', error);
    throw error;
  }
}

/**
 * Set an existing snapshot as the scene thumbnail
 * @param {string} sceneId - Scene ID
 * @param {string} snapshotId - Snapshot ID to set as thumbnail
 */
export async function setSnapshotAsSceneThumbnail(sceneId, snapshotId) {
  try {
    const sceneDocRef = doc(db, 'scenes', sceneId);
    const sceneSnapshot = await getDoc(sceneDocRef);

    if (!sceneSnapshot.exists()) {
      throw new Error('Scene not found');
    }

    const sceneData = sceneSnapshot.data();
    const memory = sceneData.memory || {};
    const snapshots = memory.snapshots || [];

    // Find the snapshot
    const targetSnapshot = snapshots.find((s) => s.id === snapshotId);
    if (!targetSnapshot) {
      throw new Error('Snapshot not found');
    }

    // Update all snapshots - set the target as default, others as not default
    const updatedSnapshots = snapshots.map((s) => ({
      ...s,
      isDefault: s.id === snapshotId
    }));

    // Update memory with updated snapshots
    const updatedMemory = {
      ...memory,
      snapshots: updatedSnapshots
    };

    // Update the scene document with the new default thumbnail
    await updateDoc(sceneDocRef, {
      memory: updatedMemory,
      imagePath: targetSnapshot.imagePath,
      thumbnailLocked: true,
      updateTimestamp: serverTimestamp()
    });

    posthog.capture('snapshot_set_as_thumbnail', {
      scene_id: sceneId,
      snapshot_id: snapshotId
    });

    return targetSnapshot;
  } catch (error) {
    console.error('Error setting snapshot as scene thumbnail:', error);
    throw error;
  }
}

/**
 * Remove a snapshot from a scene
 * @param {string} sceneId - Scene ID
 * @param {string} snapshotId - Snapshot ID to remove
 */
export async function removeSnapshot(sceneId, snapshotId) {
  try {
    const sceneDocRef = doc(db, 'scenes', sceneId);
    const sceneSnapshot = await getDoc(sceneDocRef);

    if (!sceneSnapshot.exists()) {
      throw new Error('Scene not found');
    }

    const sceneData = sceneSnapshot.data();
    const memory = sceneData.memory || {};
    const snapshots = memory.snapshots || [];

    // Filter out the snapshot to remove
    const updatedSnapshots = snapshots.filter((s) => s.id !== snapshotId);

    // Update memory with filtered snapshots
    const updatedMemory = {
      ...memory,
      snapshots: updatedSnapshots
    };

    await updateDoc(sceneDocRef, {
      memory: updatedMemory,
      updateTimestamp: serverTimestamp()
    });

    posthog.capture('snapshot_removed', {
      scene_id: sceneId,
      snapshot_id: snapshotId
    });
  } catch (error) {
    console.error('Error removing snapshot:', error);
    throw error;
  }
}
