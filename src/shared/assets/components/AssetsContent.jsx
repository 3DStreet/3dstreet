/**
 * AssetsContent - Grid + Modal wiring shared by the generator sidebar and
 * the editor Assets tab. Wrappers own useAssets() and their own chrome.
 *
 * variant="paginated": renders AssetsGrid with Prev/Next + "Load more" that
 *   triggers cursor-based fetching once client-side pages are exhausted.
 * variant="unbounded": renders a flat grid of every loaded item plus a
 *   sentinel div (infinite scroll). Callers pass a ref in `sentinelRef` and
 *   hook up their own IntersectionObserver against the enclosing scroll area.
 */

import { useEffect, useState } from 'react';
import AssetsItem from './AssetsItem.jsx';
import AssetsGrid from './AssetsGrid.jsx';
import AssetsModal from './AssetsModal.jsx';
import MeshDetailsModal from './MeshDetailsModal.jsx';
import PendingUploadCard from './PendingUploadCard.jsx';
import useCurrentUploadStore from '../state/currentUploadStore.js';
import styles from './Assets.module.scss';

const AssetsContent = ({
  gallery,
  variant = 'paginated',
  gridClassName,
  sentinelRef,
  loadingState,
  emptyState,
  onCopyParams,
  onUseForGenerator,
  onUseForVideo,
  onNotification,
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
    isLoading,
    isLoadingMore,
    hasMore,
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize,
    removeItem,
    downloadItem,
    loadMore
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
    if (onNotification) onNotification('Image download started!', 'success');
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
  const awaitingAssetId = useCurrentUploadStore(
    (s) => s.upload?.awaitingAssetId || null
  );

  // Round-trip: clear the pending card once the new asset actually shows up
  // in the items list. The upload pipeline arms a timeout that surfaces an
  // error if it never lands. Either way, the card stops looking stuck.
  useEffect(() => {
    if (!awaitingAssetId) return;
    if (items.some((i) => i.id === awaitingAssetId)) {
      useCurrentUploadStore.getState().clear();
    }
  }, [items, awaitingAssetId]);

  return (
    <>
      {isLoading ? (
        (loadingState ?? defaultLoading)
      ) : variant === 'paginated' ? (
        <AssetsGrid
          items={items}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
          onItemClick={setSelectedItem}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          placeable={placeable}
        />
      ) : items.length === 0 && !hasPendingUpload ? (
        (emptyState ?? defaultEmpty)
      ) : (
        <>
          <div className={gridClassName}>
            {hasPendingUpload && <PendingUploadCard />}
            {items.map((item) => (
              <AssetsItem
                key={item.id}
                item={item}
                onItemClick={setSelectedItem}
                onDelete={handleDelete}
                onDownload={handleDownload}
                placeable={placeable}
              />
            ))}
          </div>
          <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
        </>
      )}

      {selectedItem &&
        (selectedItem.type === 'mesh' ? (
          <MeshDetailsModal
            assetId={selectedItem.id}
            ownerUid={selectedItem.userId}
            onClose={() => setSelectedItem(null)}
            onPlace={onPlaceAsset}
            currentIndex={items.findIndex((i) => i.id === selectedItem.id)}
            totalItems={items.length}
            onNavigate={handleNavigate}
          />
        ) : (
          <AssetsModal
            item={selectedItem}
            currentIndex={items.findIndex((i) => i.id === selectedItem.id)}
            totalItems={items.length}
            onClose={() => setSelectedItem(null)}
            onNavigate={handleNavigate}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onCopyParams={onCopyParams}
            onUseForGenerator={onUseForGenerator}
            onUseForVideo={onUseForVideo}
          />
        ))}
    </>
  );
};

export default AssetsContent;
