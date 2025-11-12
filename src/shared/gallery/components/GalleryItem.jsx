/**
 * GalleryItem Component - Individual thumbnail card
 */

import styles from './Gallery.module.scss';

const GalleryItem = ({ item, onItemClick, onDelete, onDownload }) => {
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

  return (
    <div
      className={styles.item}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      {item.type === 'video' ? (
        <video src={item.objectURL} muted playsInline />
      ) : (
        <img src={item.objectURL} alt="Generated image" />
      )}

      {/* Overlay for buttons */}
      <div className={styles.itemOverlay}>
        {/* Download Button */}
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

        {/* Delete Button */}
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
      </div>

      {/* Details on hover */}
      <div className={styles.itemDetails}>
        <p>{item.metadata?.model || 'Unknown'}</p>
      </div>
    </div>
  );
};

export default GalleryItem;
