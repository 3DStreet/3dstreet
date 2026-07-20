/**
 * AssetsItem Component - Individual thumbnail card
 * Uses Firebase Storage URLs with browser HTTP caching
 */

import { DownloadIcon, TrashIcon } from '@shared/icons';
import styles from './Assets.module.scss';
import {
  getAssetSourceLabel,
  getAssetTypeLabel,
  is3dViewerType
} from '../utils.js';
import { getEmptyDragImage } from '@shared/utils/dragImage.js';

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

// Splats have no cheap client-side preview, so they show a point-cloud icon
// placeholder (reusing the mesh placeholder styling) until/unless a thumbnail
// is ever attached.
const SplatPlaceholder = () => (
  <div className={styles.meshPlaceholder} aria-label="Gaussian splat">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <circle cx="7" cy="8" r="1.6" />
      <circle cx="13" cy="6" r="1.2" />
      <circle cx="17" cy="10" r="1.8" />
      <circle cx="9" cy="13" r="1.3" />
      <circle cx="15" cy="15" r="1.5" />
      <circle cx="6" cy="17" r="1.2" />
      <circle cx="12" cy="18" r="1.7" />
      <circle cx="18" cy="17" r="1.1" />
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
  placeable = false,
  // True while this asset has an in-flight RAD/LOD optimization (a status of
  // the asset, not a separate generation) — shows a subtle "Optimizing…" badge.
  isOptimizing = false
}) => {
  const isMesh = item.type === 'mesh';
  const isSplat = item.type === 'splat';
  // Mesh and splat items get a placeholder until a thumbnail exists (their
  // storageUrl points at a binary model, not a renderable image). For images
  // and videos, fall back through thumbnailUrl → objectURL as before.
  const usesPlaceholder = is3dViewerType(item.type);
  const imageUrl =
    item.thumbnailUrl || (usesPlaceholder ? null : item.objectURL);

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
    (item.type === 'mesh' || item.type === 'image' || item.type === 'splat') &&
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
    // DOM-attached transparent image so Safari suppresses the default
    // card ghost too (a detached Image is ignored by WebKit) — see #1527.
    e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
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
        <video src={imageUrl} muted playsInline draggable={false} />
      ) : usesPlaceholder && !imageUrl ? (
        isSplat ? (
          <SplatPlaceholder />
        ) : (
          <MeshPlaceholder />
        )
      ) : (
        // draggable={false} so the card's drag always originates from the
        // wrapper div with a clean ASSET_CARD_MIME payload. Otherwise the
        // natively-draggable thumbnail image gets fetched into
        // dataTransfer.files and the viewport drop is misread as an image
        // upload (models/splats with a thumbnail dropped as images).
        <img
          src={imageUrl}
          alt={
            isMesh ? '3D model' : isSplat ? 'Gaussian splat' : 'Generated image'
          }
          loading="lazy"
          draggable={false}
        />
      )}

      {/* Subtle "Optimizing…" badge while a RAD/LOD transcode runs for this
          asset. It's a status of the asset (the file already works); the badge
          clears when the streaming variant is ready. */}
      {isOptimizing && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.62)',
            color: '#e5e7eb',
            fontSize: 10,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            pointerEvents: 'none'
          }}
          title="Building a streaming-optimized (RAD/LOD) version of this asset"
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#fbbf24',
              display: 'inline-block'
            }}
          />
          Optimizing…
        </div>
      )}

      {/* Type / source label on top */}
      <div className={styles.itemDetails}>
        <p>
          {typeLabel} · {isSplat && item.name ? item.name : sourceLabel}
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
