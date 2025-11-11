/**
 * GalleryModal Component - Detail view modal
 */

import { useState, useEffect } from 'react';
import styles from './Gallery.module.scss';

const METADATA_VISIBILITY_KEY = 'galleryModalMetadataVisible';

const GalleryModal = ({
  item,
  onClose,
  onDownload,
  onDelete,
  onCopyParams,
  onCopyImage,
  onUseForInpaint,
  onUseForOutpaint,
  onUseForGenerator
}) => {
  // Initialize metadata visibility from sessionStorage
  const [isMetadataVisible, setIsMetadataVisible] = useState(() => {
    const stored = sessionStorage.getItem(METADATA_VISIBILITY_KEY);
    return stored !== null ? stored === 'true' : true;
  });

  // Save metadata visibility to sessionStorage when it changes
  useEffect(() => {
    sessionStorage.setItem(METADATA_VISIBILITY_KEY, String(isMetadataVisible));
  }, [isMetadataVisible]);

  if (!item) return null;

  const handleBackgroundClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const toggleMetadataVisibility = () => {
    setIsMetadataVisible(!isMetadataVisible);
  };

  // Format metadata
  const { model, prompt, width, height, seed } = item.metadata || {};
  const durationSeconds = item.metadata?.duration_seconds;
  const aspectRatio = item.metadata?.aspect_ratio;
  const date = item.metadata?.timestamp
    ? new Date(item.metadata.timestamp).toLocaleString()
    : 'Unknown';
  const isVideo = item.type === 'video';
  const mediaType = isVideo ? 'Video' : 'Image';
  const modalTitle = `${mediaType} - ${model || 'Unknown Model'}`;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this item?')) {
      onDelete(item.id);
      onClose();
    }
  };

  return (
    <div className={styles.modal} onClick={handleBackgroundClick}>
      <div className={styles.modalContent}>
        {/* Header with Title */}
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{modalTitle}</h2>
          <button
            className={styles.modalCloseBtn}
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Media Body Section with Overlay */}
        <div className={styles.modalMediaContainer}>
          {/* Media */}
          <div className={styles.modalBody}>
            {isVideo ? (
              <video src={item.objectURL} controls playsInline />
            ) : (
              <img src={item.objectURL} alt="Generated image" />
            )}
          </div>

          {/* Metadata Overlay - Toggleable */}
          {isMetadataVisible && (
            <div className={styles.metadataOverlay}>
              {/* Prompt Section */}
              {prompt && (
                <div className={styles.overlayPromptSection}>
                  <h3 className={styles.overlayPromptTitle}>Prompt</h3>
                  <div className={styles.overlayPromptText}>{prompt}</div>
                </div>
              )}

              {/* Metadata Row - Horizontal scrolling */}
              <div className={styles.overlayMetadataRow}>
                <div className={styles.metadataItem}>
                  <span className={styles.metadataLabel}>Model</span>
                  <span className={styles.metadataValue}>
                    {model || 'Unknown'}
                  </span>
                </div>
                {isVideo ? (
                  <>
                    {aspectRatio && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>
                          Aspect Ratio
                        </span>
                        <span className={styles.metadataValue}>
                          {aspectRatio}
                        </span>
                      </div>
                    )}
                    {durationSeconds && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Duration</span>
                        <span className={styles.metadataValue}>
                          {durationSeconds}s
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Size</span>
                    <span className={styles.metadataValue}>
                      {width || '?'} × {height || '?'}
                    </span>
                  </div>
                )}
                <div className={styles.metadataItem}>
                  <span className={styles.metadataLabel}>Seed</span>
                  <span className={styles.metadataValue}>
                    {seed || 'Unknown'}
                  </span>
                </div>
                <div className={styles.metadataItem}>
                  <span className={styles.metadataLabel}>Date</span>
                  <span className={styles.metadataValue}>{date}</span>
                </div>
              </div>
            </div>
          )}

          {/* Toggle Button for Metadata */}
          <button
            className={styles.metadataToggleBtn}
            onClick={toggleMetadataVisibility}
            title={isMetadataVisible ? 'Hide metadata' : 'Show metadata'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              {isMetadataVisible ? (
                // Eye-off icon (metadata visible, click to hide)
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              ) : (
                // Eye icon (metadata hidden, click to show)
                <>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </>
              )}
            </svg>
            <span>Toggle Metadata</span>
          </button>
        </div>

        {/* Action Buttons - Right justified with most important on right */}
        <div className={styles.modalActions}>
          {/* Less important buttons on the left */}
          {onDelete && (
            <button
              className={`${styles.actionButton} ${styles.deleteButton}`}
              onClick={handleDelete}
              title="Delete"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}

          <div className={styles.actionButtonGroup}>
            {/* Optional action buttons */}
            {!isVideo && onUseForOutpaint && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => {
                  onUseForOutpaint(item);
                  onClose();
                }}
              >
                Use for Outpaint
              </button>
            )}
            {!isVideo && onUseForInpaint && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => {
                  onUseForInpaint(item);
                  onClose();
                }}
              >
                Use for Inpaint
              </button>
            )}
            {!isVideo && onUseForGenerator && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => {
                  onUseForGenerator(item);
                  onClose();
                }}
              >
                Use for Generator
              </button>
            )}
            {!isVideo && onCopyImage && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => onCopyImage(item)}
              >
                Copy to Clipboard
              </button>
            )}
            {onCopyParams && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => onCopyParams(item)}
              >
                Copy Parameters
              </button>
            )}
            {/* Most important button on the right */}
            <button
              className={`${styles.actionButton} ${styles.primaryButton}`}
              onClick={() => onDownload(item)}
            >
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GalleryModal;
