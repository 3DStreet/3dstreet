/**
 * GalleryItem Component - Individual thumbnail card
 * Uses Firebase Storage URLs with browser HTTP caching
 */

import styles from './Gallery.module.scss';

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

const GalleryItem = ({ item, onItemClick, onDelete, onDownload }) => {
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

  const typeLabel =
    item.type === 'video' ? 'Video' : item.type === 'mesh' ? 'Model' : 'Image';
  const sourceLabel = item.metadata?.model || 'Unknown';

  return (
    <div
      className={styles.item}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
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
          title={item.type === 'video' ? 'Delete Video' : 'Delete Image'}
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

        <button
          className={`${styles.itemButton} ${styles.downloadBtn}`}
          onClick={handleDownload}
          title={item.type === 'video' ? 'Download Video' : 'Download Image'}
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
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default GalleryItem;
