/**
 * Mount the shared AssetPickerModal as a one-shot React island (#2142).
 *
 * The generator's source-image slots are vanilla DOM; this lets them ask for
 * an image from the user's library the same way they ask for a file:
 *
 *   const picked = await pickImageFromAssets({ title: t('image.pickToEdit') });
 *   if (picked) tab.setImagePrompt(picked.dataUrl, picked.name);
 *
 * Each call mounts a fresh root on <body> and unmounts it when the user
 * confirms or cancels, so no picker state outlives the dialog.
 */

import { createRoot } from 'react-dom/client';
import { AssetPickerModal, ASSET_TYPES } from '@shared/assets';
import { signInWithGoogle } from '@shared/auth/api/auth';
import { formatSharedMessage } from '@shared/i18n/sharedMessages';

/**
 * Open the picker and resolve with the chosen display item, or null on
 * cancel.
 * @param {object} options
 * @param {string} options.type - One of ASSET_TYPES.
 * @param {string} options.title - The request, e.g. "Choose an image to edit".
 * @param {string} [options.confirmLabel]
 * @returns {Promise<object|null>}
 */
export function openAssetPicker({ type, title, confirmLabel }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (result) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(
      <AssetPickerModal
        type={type}
        title={title}
        confirmLabel={confirmLabel}
        onConfirm={(item) => close(item)}
        onCancel={() => close(null)}
        onSignIn={() => signInWithGoogle()}
      />
    );
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Pick an image from the user's library and load it as a data URL, the form
 * the generator tabs' source-image slots take.
 * @param {{ title: string, confirmLabel?: string }} options
 * @returns {Promise<{ dataUrl: string, name: string, item: object } | null>}
 *   null when the user cancels. Rejects if the image can't be downloaded.
 */
export async function pickImageFromAssets({ title, confirmLabel }) {
  const item = await openAssetPicker({
    type: ASSET_TYPES.IMAGE,
    title,
    // Filling a slot, not replacing: "Choose" reads better than "Replace".
    confirmLabel: confirmLabel || formatSharedMessage('choose')
  });
  if (!item) return null;
  const response = await fetch(item.storageUrl || item.objectURL);
  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status}`);
  }
  const dataUrl = await blobToDataUrl(await response.blob());
  return { dataUrl, name: item.name || item.originalFilename || item.id, item };
}
