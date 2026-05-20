/**
 * AssetsItem Component - Individual thumbnail card
 * Uses Firebase Storage URLs with browser HTTP caching
 */

import { DownloadIcon, TrashIcon } from '@shared/icons';
import styles from './Assets.module.scss';
import { getAssetSourceLabel, getAssetTypeLabel } from '../utils.js';

// 1×1 transparent gif used to suppress the default browser drag ghost so the
// 3D preview at the cursor isn't fighting with a card thumbnail floating along.
const emptyDragImage = new Image();
emptyDragImage.src =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

const MeshPlaceholder = () => (
  <div className={styles.meshPlaceholder} aria-label="3D model">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  </div>
);

const AssetsItem = ({
  item,
  onItemClick,
  onDelete,
  onDownload,
  // When true (editor's Assets panel), mesh/image cards become draggable
  // into the viewport. Off in the generator app where there's no viewport.
  placeable = false
}) => {
  const isMesh = item.type === 'mesh';
  // Mesh items get a placeholder until a thumbnail exists. For images and
  // videos, fall back through thumbnailUrl → objectURL as before.
  const imageUrl = item.thumbnailUrl || (isMesh ? null : item.objectURL);

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete(item.id);
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    onDownload(item);
  };

  const handleClick = (e) => {
    // Prevent modal opening if a button inside was clicked
    if (e.target.closest('button')) return;
    onItemClick(item);
  };

  // Mesh/image cards are draggable into the viewport — same pattern as the
  // Add Layer cards. Videos are skipped (no in-scene placement makes sense).
  // Only enabled when the host opts in via the `placeable` prop.
  const isPlaceable =
    placeable &&
    (item.type === 'mesh' || item.type === 'image') &&
    !!item.storageUrl;

  const handleDragStart = (e) => {
    if (!isPlaceable) return;
    // Receiver: src/editor/components/elements/AddLayerPanel/AddLayerPanel.component.jsx
    // (drop handler reads ASSET_CARD_MIME and calls placeCloudAsset).
    e.dataTransfer.setData(
      'application/x-3dstreet-asset',
      JSON.stringify({
        assetId: item.id,
        ownerUid: item.userId,
        storageUrl: item.storageUrl,
        optimizedSourceUrl: item.optimizedSourceUrl,
        name: item.name || item.originalFilename || '',
        type: item.type,
        width: item.width ?? item.metadata?.width,
        height: item.height ?? item.metadata?.height
      })
    );
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setDragImage(emptyDragImage, 0, 0);
  };

  const typeLabel = getAssetTypeLabel(item);
  const sourceLabel = getAssetSourceLabel(item);

  return (
    <div
      className={styles.item}
      onClick={handleClick}
      draggable={isPlaceable}
      onDragStart={handleDragStart}
      style={{ cursor: isPlaceable ? 'grab' : 'pointer' }}
      title={
        isPlaceable
          ? 'Drag and drop to viewport to add it to your scene'
          : undefined
      }
    >
      {item.type === 'video' ? (
        <video src={imageUrl} muted playsInline />
      ) : isMesh && !imageUrl ? (
        <MeshPlaceholder />
      ) : (
        <img
          src={imageUrl}
          alt={isMesh ? '3D model' : 'Generated image'}
          loading="lazy"
        />
      )}

      {/* Type / source label on top */}
      <div className={styles.itemDetails}>
        <p>
          {typeLabel} · {sourceLabel}
        </p>
      </div>

      {/* Action buttons: delete on bottom-left, download on bottom-right */}
      <div className={styles.itemOverlay}>
        <button
          className={`${styles.itemButton} ${styles.deleteBtn}`}
          onClick={handleDelete}
          title={`Delete ${typeLabel}`}
        >
          <TrashIcon />
        </button>

        <button
          className={`${styles.itemButton} ${styles.downloadBtn}`}
          onClick={handleDownload}
          title={`Download ${typeLabel}`}
        >
          <DownloadIcon />
        </button>
      </div>
    </div>
  );
};

export default AssetsItem;
