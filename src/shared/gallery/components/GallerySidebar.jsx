/**
 * GallerySidebar Component - Sidebar variant for image-generator
 */

import { useState } from 'react';
import GalleryGrid from './GalleryGrid.jsx';
import GalleryModal from './GalleryModal.jsx';
import useGallery from '../hooks/useGallery.js';

const GallerySidebar = ({
  onCopyParams,
  onCopyImage,
  onUseForInpaint,
  onUseForOutpaint,
  onUseForGenerator,
  onNotification
}) => {
  const {
    items,
    isLoading,
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize,
    removeItem,
    clearGallery,
    downloadItem
  } = useGallery();

  const [isCollapsed, setIsCollapsed] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);

  const handleToggle = () => {
    setIsCollapsed(!isCollapsed);

    // Sync the Gallery tab button state
    const galleryTabButton = document.getElementById('gallery-tab-button');
    if (galleryTabButton) {
      if (!isCollapsed) {
        galleryTabButton.classList.remove('active');
      } else {
        galleryTabButton.classList.add('active');
      }
    }
  };

  const handleClearGallery = async () => {
    if (
      window.confirm(
        'Are you sure you want to clear all saved images? This cannot be undone.'
      )
    ) {
      try {
        await clearGallery();
        if (onNotification) {
          onNotification('Gallery cleared.', 'success');
        }
      } catch (error) {
        console.error('Failed to clear gallery:', error);
        if (onNotification) {
          onNotification('Error clearing gallery.', 'error');
        }
      }
    }
  };

  const handleDelete = async (id) => {
    try {
      await removeItem(id);
      if (onNotification) {
        onNotification('Image deleted.', 'success');
      }
    } catch (error) {
      console.error('Failed to remove image:', error);
      if (onNotification) {
        onNotification('Error deleting image.', 'error');
      }
    }
  };

  const handleDownload = (item) => {
    downloadItem(item);
    if (onNotification) {
      onNotification('Image download started!', 'success');
    }
  };

  const handleItemClick = (item) => {
    setSelectedItem(item);
  };

  const handleCloseModal = () => {
    setSelectedItem(null);
  };

  return (
    <>
      {/* Gallery Toggle Button */}
      <button
        id="gallery-toggle"
        className="gallery-toggle"
        onClick={handleToggle}
        aria-label="Toggle Gallery"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          {isCollapsed ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M13 5l7 7-7 7M5 5l7 7-7 7"
            />
          )}
        </svg>
      </button>

      {/* Gallery Sidebar */}
      <div
        id="gallery-container"
        className={`gallery-sidebar ${isCollapsed ? 'gallery-collapsed' : ''}`}
      >
        <div className="gallery-header">
          <div className="gallery-title">
            Gallery{' '}
            <span id="gallery-counter" className="gallery-counter">
              {items.length}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#6b7280'
            }}
          >
            Loading gallery...
          </div>
        ) : (
          <GalleryGrid
            items={items}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            onItemClick={handleItemClick}
            onDelete={handleDelete}
            onDownload={handleDownload}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}

        <div className="gallery-footer">
          <button
            id="clear-gallery-btn"
            className="clear-gallery-btn"
            onClick={handleClearGallery}
          >
            Clear Gallery
          </button>
        </div>
      </div>

      {/* Modal */}
      {selectedItem && (
        <GalleryModal
          item={selectedItem}
          onClose={handleCloseModal}
          onDownload={handleDownload}
          onCopyParams={onCopyParams}
          onCopyImage={onCopyImage}
          onUseForInpaint={onUseForInpaint}
          onUseForOutpaint={onUseForOutpaint}
          onUseForGenerator={onUseForGenerator}
        />
      )}
    </>
  );
};

export default GallerySidebar;
