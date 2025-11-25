/**
 * GallerySidebar Component - Sidebar variant for generator
 */

import { useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import GalleryGrid from './GalleryGrid.jsx';
import GalleryModal from './GalleryModal.jsx';
import useGallery from '../hooks/useGallery.js';
import styles from './Gallery.module.scss';

const GallerySidebar = ({
  onCopyParams,
  onCopyImage,
  onUseForInpaint,
  onUseForOutpaint,
  onUseForGenerator,
  onUseForVideo,
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
    downloadItem,
    // Migration
    needsMigration,
    isMigrating,
    migrationProgress,
    runMigration,
    // V1 data management
    downloadV1AsZip,
    discardV1Data,
    isDownloadingZip,
    zipProgress,
    // Reload
    reloadItems
  } = useGallery();

  const [isCollapsed, setIsCollapsed] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);

  const handleToggle = () => {
    setIsCollapsed(!isCollapsed);
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

  const handleNavigate = (direction) => {
    if (!selectedItem) return;

    const currentIndex = items.findIndex((item) => item.id === selectedItem.id);
    if (currentIndex === -1) return;

    let newIndex;
    if (direction === 'next') {
      newIndex = currentIndex + 1;
      if (newIndex >= items.length) return; // At last item
    } else if (direction === 'prev') {
      newIndex = currentIndex - 1;
      if (newIndex < 0) return; // At first item
    }

    setSelectedItem(items[newIndex]);
  };

  return (
    <>
      {/* Gallery Toggle Button */}
      <Tooltip.Provider>
        <Tooltip.Root delayDuration={0}>
          <Tooltip.Trigger asChild>
            <button
              id="gallery-toggle"
              className={styles.toggle}
              onClick={handleToggle}
              aria-label="Toggle Gallery"
            >
              {isCollapsed ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 31 31"
                  stroke="currentColor"
                >
                  <path
                    d="M2.16666 23.6667L8.09024 17.7431C8.57469 17.2588 9.23165 16.9867 9.91666 16.9867C10.6017 16.9867 11.2586 17.2588 11.7431 17.7431L17.6667 23.6667M15.0833 21.0834L17.1319 19.0348C17.6164 18.5505 18.2733 18.2784 18.9583 18.2784C19.6433 18.2784 20.3003 18.5505 20.7847 19.0348L22.8333 21.0834M15.0833 13.3334H15.0962M4.74999 28.8334H20.25C20.9351 28.8334 21.5922 28.5612 22.0767 28.0767C22.5612 27.5922 22.8333 26.9352 22.8333 26.25V10.75C22.8333 10.0649 22.5612 9.4078 22.0767 8.92333C21.5922 8.43886 20.9351 8.16669 20.25 8.16669H4.74999C4.06485 8.16669 3.40777 8.43886 2.9233 8.92333C2.43883 9.4078 2.16666 10.0649 2.16666 10.75V26.25C2.16666 26.9352 2.43883 27.5922 2.9233 28.0767C3.40777 28.5612 4.06485 28.8334 4.74999 28.8334Z"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M23.5833 25.6667C24.2685 25.6667 24.9256 25.3945 25.41 24.91C25.8945 24.4256 26.1667 23.7685 26.1667 23.0833V7.58333C26.1667 6.89819 25.8945 6.24111 25.41 5.75664C24.9256 5.27217 24.2685 5 23.5833 5H8.08333C7.39819 5 6.74111 5.27217 6.25664 5.75664C5.77217 6.24111 5.5 6.89819 5.5 7.58333"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M26.5833 22.6667C27.2685 22.6667 27.9256 22.3945 28.41 21.91C28.8945 21.4256 29.1667 20.7685 29.1667 20.0833V4.58333C29.1667 3.89819 28.8945 3.24111 28.41 2.75664C27.9256 2.27217 27.2685 2 26.5833 2H11.0833C10.3982 2 9.74111 2.27217 9.25664 2.75664C8.77217 3.24111 8.5 3.89819 8.5 4.58333"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  />
                </svg>
              )}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="left"
              sideOffset={5}
              style={{
                backgroundColor: '#2d2d2d',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '500',
                zIndex: 10000,
                maxWidth: '200px'
              }}
            >
              Show Gallery
              <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      {/* Gallery Sidebar */}
      <div
        id="gallery-container"
        className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}
      >
        <div className={styles.header}>
          <div className={styles.title}>
            Gallery{' '}
            <Tooltip.Provider>
              <Tooltip.Root delayDuration={0}>
                <Tooltip.Trigger asChild>
                  <span id="gallery-counter" className={styles.counter}>
                    {items.length}
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="bottom"
                    sideOffset={5}
                    style={{
                      backgroundColor: '#2d2d2d',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                      zIndex: 10000,
                      maxWidth: '200px'
                    }}
                  >
                    Gallery synced to cloud. Available on all your devices.
                    <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
            <Tooltip.Provider>
              <Tooltip.Root delayDuration={0}>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => reloadItems()}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#9ca3af',
                      transition: 'color 0.2s',
                      marginLeft: '8px'
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.color = '#ffffff')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = '#9ca3af')
                    }
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                    </svg>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="bottom"
                    sideOffset={5}
                    style={{
                      backgroundColor: '#2d2d2d',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                      zIndex: 10000
                    }}
                  >
                    Refresh gallery
                    <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
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
        ) : needsMigration ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#6b7280'
            }}
          >
            <div style={{ marginBottom: '1rem', fontSize: '14px' }}>
              <p style={{ marginBottom: '0.5rem', fontWeight: '500' }}>
                Gallery Migration Required
              </p>
              <p style={{ fontSize: '12px', lineHeight: '1.5' }}>
                Your gallery needs to be migrated to the new cloud-based system.
                This is a one-time process that will upload your images to
                secure cloud storage.
              </p>
            </div>
            {isMigrating ? (
              <div>
                <div
                  style={{
                    marginBottom: '0.5rem',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                  Migrating... {migrationProgress.toFixed(0)}%
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${migrationProgress}%`,
                      height: '100%',
                      backgroundColor: '#3b82f6',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>
            ) : isDownloadingZip ? (
              <div>
                <div
                  style={{
                    marginBottom: '0.5rem',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                  Downloading... {zipProgress.toFixed(0)}%
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${zipProgress}%`,
                      height: '100%',
                      backgroundColor: '#10b981',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  alignItems: 'center'
                }}
              >
                <button
                  onClick={() => {
                    runMigration()
                      .then((status) => {
                        if (onNotification) {
                          if (status.failed > 0) {
                            if (status.migrated === 0) {
                              onNotification(
                                `Migration failed: All ${status.total} images could not be uploaded. Please check your permissions and try again.`,
                                'error'
                              );
                            } else {
                              onNotification(
                                `Migration partially complete: ${status.migrated} of ${status.total} images uploaded. ${status.failed} failed.`,
                                'warning'
                              );
                            }
                          } else {
                            onNotification(
                              `Migration complete! ${status.migrated} images uploaded to cloud.`,
                              'success'
                            );
                          }
                        }
                      })
                      .catch((error) => {
                        console.error('Migration failed:', error);
                        if (onNotification) {
                          onNotification(
                            'Migration failed. Please try again.',
                            'error'
                          );
                        }
                      });
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    width: '100%'
                  }}
                >
                  Migrate to Cloud
                </button>
                <button
                  onClick={() => {
                    downloadV1AsZip()
                      .then(() => {
                        if (onNotification) {
                          onNotification(
                            'Gallery downloaded as ZIP file.',
                            'success'
                          );
                        }
                      })
                      .catch((error) => {
                        console.error('Download failed:', error);
                        if (onNotification) {
                          onNotification(
                            'Failed to download gallery.',
                            'error'
                          );
                        }
                      });
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    width: '100%'
                  }}
                >
                  Download as ZIP
                </button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        'Are you sure you want to discard your local images? This cannot be undone. Consider downloading a ZIP backup first.'
                      )
                    ) {
                      discardV1Data()
                        .then(() => {
                          if (onNotification) {
                            onNotification(
                              'Local images discarded.',
                              'success'
                            );
                          }
                        })
                        .catch((error) => {
                          console.error('Discard failed:', error);
                          if (onNotification) {
                            onNotification(
                              'Failed to discard local images.',
                              'error'
                            );
                          }
                        });
                    }
                  }}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: 'transparent',
                    color: '#9ca3af',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textDecoration: 'underline'
                  }}
                >
                  Discard local images
                </button>
              </div>
            )}
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
      </div>

      {/* Modal */}
      {selectedItem && (
        <GalleryModal
          item={selectedItem}
          currentIndex={items.findIndex((item) => item.id === selectedItem.id)}
          totalItems={items.length}
          onClose={handleCloseModal}
          onNavigate={handleNavigate}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onCopyParams={onCopyParams}
          onCopyImage={onCopyImage}
          onUseForInpaint={onUseForInpaint}
          onUseForOutpaint={onUseForOutpaint}
          onUseForGenerator={onUseForGenerator}
          onUseForVideo={onUseForVideo}
        />
      )}
    </>
  );
};

export default GallerySidebar;
