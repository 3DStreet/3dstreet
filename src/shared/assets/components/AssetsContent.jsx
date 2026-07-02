/**
 * AssetsContent - Grid + Modal wiring shared by the generator sidebar and
 * the editor Assets tab. Wrappers own useAssets() and their own chrome.
 *
 * Renders a flat grid of every loaded item plus a sentinel div (infinite
 * scroll). Callers pass a ref in `sentinelRef` and hook up their own
 * IntersectionObserver against the enclosing scroll area.
 */

import { useMemo, useState } from 'react';
import AssetsItem from './AssetsItem.jsx';
import AssetDetailModal from './AssetDetailModal.jsx';
import PendingUploadCard from './PendingUploadCard.jsx';
import PendingJobCard from './PendingJobCard.jsx';
import useCurrentUploadStore from '../state/currentUploadStore.js';
import { ASSET_TYPES } from '../constants.js';
import styles from './Assets.module.scss';

// Stable empty fallback so a gallery without optimizingAssetIds doesn't allocate
// a new Set each render.
const EMPTY_OPTIMIZING = new Set();

const AssetsContent = ({
  gallery,
  gridClassName,
  sentinelRef,
  loadingState,
  emptyState,
  onUseForGenerator,
  onUseForVideo,
  onNotification,
  // Editor's Assets panel opts in to an open-scene-and-focus-camera action on
  // snapshots that carry a captured pose (#1605). Generator omits it (no
  // viewport) and keeps the plain scene link.
  onFocusScene,
  // Editor's Assets panel opts in to drag-mesh/image-into-viewport.
  // Generator (standalone page) doesn't have a viewport so it stays off.
  placeable = false,
  // When provided, the mesh details modal opened from a card click shows
  // a "Place in scene" CTA. The callback receives the same payload shape
  // as the drag-from-card flow:
  //   { assetId, ownerUid, storageUrl, name, type }
  onPlaceAsset
}) => {
  const {
    items,
    pendingJobs = [],
    optimizingAssetIds = EMPTY_OPTIMIZING,
    isLoading,
    removeItem,
    downloadItem
  } = gallery;

  const [selectedItem, setSelectedItem] = useState(null);

  const handleDelete = async (id) => {
    try {
      await removeItem(id);
      if (onNotification) onNotification('Image deleted.', 'success');
    } catch (error) {
      console.error('Failed to remove image:', error);
      if (onNotification) onNotification('Error deleting image.', 'error');
    }
  };

  const handleDownload = (item) => {
    downloadItem(item);
    const noun =
      item?.type === ASSET_TYPES.SPLAT
        ? 'Splat'
        : item?.type === ASSET_TYPES.MESH
          ? 'Model'
          : item?.type === ASSET_TYPES.VIDEO
            ? 'Video'
            : 'Image';
    if (onNotification) onNotification(`${noun} download started!`, 'success');
  };

  const handleNavigate = (direction) => {
    if (!selectedItem) return;
    const currentIndex = items.findIndex((i) => i.id === selectedItem.id);
    if (currentIndex === -1) return;
    const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    setSelectedItem(items[newIndex]);
  };

  const defaultLoading = (
    <div
      style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#6b7280'
      }}
    >
      Loading gallery...
    </div>
  );

  const defaultEmpty = <div className={styles.emptyState}>No assets yet</div>;

  const hasPendingUpload = useCurrentUploadStore((s) => !!s.upload);
  const hasPendingJob = pendingJobs.length > 0;
  const awaitingAssetId = useCurrentUploadStore(
    (s) => s.upload?.awaitingAssetId || null
  );

  // Hide the new asset from the grid while the upload pipeline is still
  // finalizing it (preload, entity swap, thumbnail). The pipeline calls
  // clear() when truly done — pending card vanishes and the real card
  // appears in the same render. Atomic swap, no overlap.
  const visibleItems = useMemo(() => {
    if (!awaitingAssetId) return items;
    return items.filter((i) => i.id !== awaitingAssetId);
  }, [items, awaitingAssetId]);

  return (
    <>
      {isLoading ? (
        (loadingState ?? defaultLoading)
      ) : visibleItems.length === 0 && !hasPendingUpload && !hasPendingJob ? (
        (emptyState ?? defaultEmpty)
      ) : (
        <>
          <div className={gridClassName}>
            {/* A fresh upload is the most-recent action, so it takes the
                upper-left slot; in-flight generation jobs sit just after it,
                ahead of finished assets. Both clear into a real asset card. */}
            {hasPendingUpload && <PendingUploadCard />}
            {pendingJobs.map((job) => (
              <PendingJobCard key={job.id} job={job} />
            ))}
            {visibleItems.map((item) => (
              <AssetsItem
                key={item.id}
                item={item}
                onItemClick={setSelectedItem}
                onDelete={handleDelete}
                onDownload={handleDownload}
                placeable={placeable}
                isOptimizing={optimizingAssetIds.has(item.id)}
              />
            ))}
          </div>
          <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
        </>
      )}

      {selectedItem && (
        <AssetDetailModal
          item={selectedItem}
          currentIndex={items.findIndex((i) => i.id === selectedItem.id)}
          totalItems={items.length}
          onClose={() => setSelectedItem(null)}
          onNavigate={handleNavigate}
          onPlace={onPlaceAsset}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onUseForGenerator={onUseForGenerator}
          onUseForVideo={onUseForVideo}
          onFocusScene={onFocusScene}
        />
      )}
    </>
  );
};

export default AssetsContent;
