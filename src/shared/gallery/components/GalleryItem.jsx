/**
 * GalleryItem Component - Individual thumbnail card
 */

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
      className="gallery-item group relative aspect-square overflow-hidden rounded-md bg-gray-800 shadow-md"
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      <img
        src={item.objectURL}
        alt="Generated image"
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
      />

      {/* Overlay for buttons */}
      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 opacity-0 transition-opacity duration-200 group-hover:bg-opacity-40 group-hover:opacity-100">
        {/* Download Button */}
        <button
          className="download-btn mx-1 rounded-full bg-blue-600 p-2 text-white shadow-lg transition-colors hover:bg-blue-700"
          onClick={handleDownload}
          title="Download Image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
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
          className="gallery-delete-btn mx-1 rounded-full bg-red-600 p-2 text-white shadow-lg transition-colors hover:bg-red-700"
          onClick={handleDelete}
          title="Delete Image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
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
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 p-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <p className="truncate text-center">
          {item.metadata?.model || 'Unknown'}
        </p>
      </div>
    </div>
  );
};

export default GalleryItem;
