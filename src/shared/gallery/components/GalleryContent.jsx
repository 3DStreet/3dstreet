/**
 * GalleryContent - Grid + Modal wiring shared by the generator sidebar and
 * the editor Gallery tab. Wrappers own useGallery() and their own chrome.
 *
 * variant="paginated": renders GalleryGrid with Prev/Next + "Load more" that
 *   triggers cursor-based fetching once client-side pages are exhausted.
 * variant="unbounded": renders a flat grid of every loaded item plus a
 *   sentinel div (infinite scroll). Callers pass a ref in `sentinelRef` and
 *   hook up their own IntersectionObserver against the enclosing scroll area.
 */

import { useState } from 'react';
import GalleryItem from './GalleryItem.jsx';
import GalleryGrid from './GalleryGrid.jsx';
import GalleryModal from './GalleryModal.jsx';
import MeshDetailsModal from './MeshDetailsModal.jsx';
import styles from './Gallery.module.scss';

const GalleryContent = ({
  gallery,
  variant = 'paginated',
  gridClassName,
  sentinelRef,
  loadingState,
  emptyState,
  onCopyParams,
  onUseForGenerator,
  onUseForVideo,
  onNotification
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

  const defaultEmpty = (
    <div className={styles.emptyState}>Gallery is empty</div>
  );

  return (
    <>
      {isLoading ? (
        (loadingState ?? defaultLoading)
      ) : variant === 'paginated' ? (
        <GalleryGrid
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
        />
      ) : items.length === 0 ? (
        (emptyState ?? defaultEmpty)
      ) : (
        <>
          <div className={gridClassName}>
            {items.map((item) => (
              <GalleryItem
                key={item.id}
                item={item}
                onItemClick={setSelectedItem}
                onDelete={handleDelete}
                onDownload={handleDownload}
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
          />
        ) : (
          <GalleryModal
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

export default GalleryContent;
