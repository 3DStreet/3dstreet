/**
 * AssetsModal Component - Detail view modal
 * Uses Firebase Storage URLs with browser HTTP caching
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TrashIcon } from '@shared/icons';
import styles from './Assets.module.scss';
import { REPLICATE_MODELS } from '@shared/constants/replicateModels.js';
import { getAssetTitle } from '../utils.js';

const METADATA_VISIBILITY_KEY = 'galleryModalMetadataVisible';

const AssetsModal = ({
  item,
  currentIndex,
  totalItems,
  onClose,
  onNavigate,
  onDownload,
  onDelete,
  onCopyParams,
  onUseForGenerator,
  onUseForVideo
}) => {
  // Initialize metadata visibility from sessionStorage
  const [isMetadataVisible, setIsMetadataVisible] = useState(() => {
    const stored = sessionStorage.getItem(METADATA_VISIBILITY_KEY);
    return stored !== null ? stored === 'true' : true;
  });

  // Use full image URL directly - browser HTTP cache handles caching
  const fullImageUrl =
    item?.fullImageURL || item?.storageUrl || item?.objectURL;
  const videoRef = useRef(null);

  // Image load state — reset when navigating to a new item so we don't show
  // the previous image inside the new (correctly-sized) frame.
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => {
    setImageLoaded(false);
  }, [item?.id]);

  // Save metadata visibility to sessionStorage when it changes
  useEffect(() => {
    sessionStorage.setItem(METADATA_VISIBILITY_KEY, String(isMetadataVisible));
  }, [isMetadataVisible]);

  // Autoplay video when item changes
  useEffect(() => {
    if (videoRef.current && item.type === 'video') {
      videoRef.current.play().catch((error) => {
        console.warn('Autoplay prevented:', error);
      });
    }
  }, [item]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && onNavigate) {
        onNavigate('prev');
      } else if (e.key === 'ArrowRight' && onNavigate) {
        onNavigate('next');
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    // Capture phase: the editor's SceneGraph panel has an onKeyDown that
    // stopPropagation()s arrow keys to block native scroll. If we listen in
    // bubble phase, the modal never sees arrows until the user clicks inside
    // it (which moves focus out of the scenegraph subtree).
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onNavigate, onClose]);

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
  const { model, prompt, width, height, seed, sceneId, sceneTitle } =
    item.metadata || {};
  const durationSeconds = item.metadata?.duration_seconds;
  const aspectRatio = item.metadata?.aspect_ratio;
  const date = item.metadata?.timestamp
    ? new Date(item.metadata.timestamp).toLocaleString()
    : 'Unknown';
  const isVideo = item.type === 'video';
  const modalTitle = getAssetTitle(item);

  // Pre-size the media frame to the asset's known dimensions so the modal
  // doesn't pop from "small placeholder" to "full image" on every load.
  // Falls back to a minimum frame when dimensions are missing.
  const frameStyle =
    width && height
      ? { aspectRatio: `${width} / ${height}`, width: `${width}px` }
      : undefined;

  // Generate scene URL for linking back to the editor
  const sceneUrl = sceneId
    ? `${window.location.origin}/#/scenes/${sceneId}`
    : null;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this item?')) {
      onDelete(item.id);
      onClose();
    }
  };

  return createPortal(
    <div className={styles.modal} onClick={handleBackgroundClick}>
      {/* Navigation Buttons - Outside Modal */}
      {onNavigate && totalItems > 1 && (
        <>
          {/* Previous Button */}
          {currentIndex > 0 && (
            <button
              className={`${styles.navButton} ${styles.navButtonPrev}`}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('prev');
              }}
              title="Previous (←)"
              aria-label="Previous item"
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
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
          {/* Next Button */}
          {currentIndex < totalItems - 1 && (
            <button
              className={`${styles.navButton} ${styles.navButtonNext}`}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('next');
              }}
              title="Next (→)"
              aria-label="Next item"
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
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          )}
        </>
      )}

      <div className={styles.modalContent}>
        {/* Header with Title */}
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{modalTitle}</h2>
          <div className={styles.modalHeaderActions}>
            <button
              className={styles.infoToggleBtn}
              onClick={toggleMetadataVisibility}
              title={isMetadataVisible ? 'Hide info' : 'Show info'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
                <polyline points="11 12 12 12 12 16 13 16" />
                {isMetadataVisible && <line x1="4" y1="4" x2="20" y2="20" />}
              </svg>
              <span>{isMetadataVisible ? 'Hide Info' : 'Show Info'}</span>
            </button>
            <button
              className={styles.modalCloseBtn}
              onClick={onClose}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Media Body Section with Overlay */}
        <div className={styles.modalMediaContainer}>
          {/* Media */}
          <div className={styles.modalBody}>
            <div className={styles.imageFrame} style={frameStyle}>
              {/* Blur-up: the gallery card just rendered this thumbnail, so
                  it's HTTP-cached and shows instantly while the full image
                  downloads. Hidden for videos (no thumbnail) and once the
                  real media is loaded. */}
              {!imageLoaded && !isVideo && item.thumbnailUrl && (
                <img
                  className={styles.thumbBlur}
                  src={item.thumbnailUrl}
                  alt=""
                  aria-hidden="true"
                />
              )}
              {!imageLoaded && (
                <div
                  className={styles.imageLoader}
                  aria-label={isVideo ? 'Loading video' : 'Loading image'}
                >
                  <div className={styles.spinner} />
                </div>
              )}
              {isVideo ? (
                <video
                  key={item.id}
                  ref={videoRef}
                  src={fullImageUrl}
                  controls
                  autoPlay
                  playsInline
                  onLoadedData={() => setImageLoaded(true)}
                  style={{
                    opacity: imageLoaded ? 1 : 0,
                    transition: 'opacity 0.15s ease-out'
                  }}
                />
              ) : (
                <img
                  // key forces a remount per item so the previous (loaded)
                  // media isn't visible inside the new frame while paging.
                  key={item.id}
                  src={fullImageUrl}
                  alt="Generated image"
                  onLoad={() => setImageLoaded(true)}
                  style={{
                    opacity: imageLoaded ? 1 : 0,
                    transition: 'opacity 0.15s ease-out'
                  }}
                />
              )}
            </div>
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
                {model && (
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Model</span>
                    <span className={styles.metadataValue}>
                      {REPLICATE_MODELS[model]?.logo && (
                        <img
                          src={REPLICATE_MODELS[model].logo}
                          alt=""
                          className={styles.modelLogo}
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      )}
                      {REPLICATE_MODELS[model]?.name || model}
                    </span>
                  </div>
                )}
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
                  width &&
                  height && (
                    <div className={styles.metadataItem}>
                      <span className={styles.metadataLabel}>Size</span>
                      <span className={styles.metadataValue}>
                        {width} × {height}
                      </span>
                    </div>
                  )
                )}
                {seed && (
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Seed</span>
                    <span className={styles.metadataValue}>{seed}</span>
                  </div>
                )}
                {item.metadata?.timestamp && (
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Date</span>
                    <span className={styles.metadataValue}>{date}</span>
                  </div>
                )}
                {sceneUrl && (
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Scene</span>
                    <a
                      href={sceneUrl}
                      className={styles.metadataLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open scene in editor"
                    >
                      {sceneTitle || 'Untitled'}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
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
              <TrashIcon />
            </button>
          )}

          <div className={styles.actionButtonGroup}>
            {/* Optional action buttons */}
            {!isVideo && onUseForGenerator && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => {
                  onUseForGenerator(item);
                  onClose();
                }}
              >
                Modify
              </button>
            )}
            {!isVideo && onUseForVideo && (
              <button
                className={`${styles.actionButton} ${styles.secondaryButton}`}
                onClick={() => {
                  onUseForVideo(item);
                  onClose();
                }}
              >
                Create Video
              </button>
            )}
            {isVideo && onCopyParams && (
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
    </div>,
    document.body
  );
};

export default AssetsModal;
