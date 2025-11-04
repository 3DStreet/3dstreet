/**
 * GalleryModal Component - Detail view modal
 */

const GalleryModal = ({
  item,
  onClose,
  onDownload,
  onCopyParams,
  onCopyImage,
  onUseForInpaint,
  onUseForOutpaint,
  onUseForGenerator
}) => {
  if (!item) return null;

  const handleBackgroundClick = (e) => {
    if (e.target.className && e.target.className.includes('gallery-modal')) {
      onClose();
    }
  };

  // Format metadata
  const { model, prompt, width, height, seed } = item.metadata || {};
  const date = item.metadata?.timestamp
    ? new Date(item.metadata.timestamp).toLocaleString()
    : 'Unknown';

  return (
    <div className="gallery-modal" onClick={handleBackgroundClick}>
      <div className="gallery-modal-content">
        <div className="gallery-modal-header">
          <button
            className="gallery-modal-close-btn"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Info and Buttons Section */}
        <div className="gallery-modal-info">
          <div
            className="metadata-container mt-4 rounded-md p-4 text-sm"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.05)',
              border: '1px solid rgba(0, 0, 0, 0.1)'
            }}
          >
            <div className="mb-2">
              <span className="metadata-label font-semibold">Model:</span>{' '}
              <span className="metadata-value">{model || 'Unknown'}</span>
            </div>
            <div className="mb-2">
              <span className="metadata-label font-semibold">Size:</span>{' '}
              <span className="metadata-value">
                {width || '?'} × {height || '?'}
              </span>
            </div>
            <div className="mb-2">
              <span className="metadata-label font-semibold">Seed:</span>{' '}
              <span className="metadata-value">{seed || 'Unknown'}</span>
            </div>
            <div className="mb-2">
              <span className="metadata-label font-semibold">Date:</span>{' '}
              <span className="metadata-value">{date}</span>
            </div>
            {prompt && (
              <div className="mb-1">
                <span className="metadata-label font-semibold">Prompt:</span>
                <div
                  className="metadata-prompt mt-1 max-h-32 overflow-y-auto rounded p-2 text-xs"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.05)',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {prompt}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="download-btn rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-indigo-700"
              onClick={() => onDownload(item)}
            >
              Download
            </button>
            {onCopyParams && (
              <button
                className="copy-params-btn rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700"
                onClick={() => onCopyParams(item)}
              >
                Copy Parameters
              </button>
            )}
            {onCopyImage && (
              <button
                className="copy-image-btn rounded-md bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-700"
                onClick={() => onCopyImage(item)}
              >
                Copy to Clipboard
              </button>
            )}
            {onUseForGenerator && (
              <button
                className="use-for-generator-btn rounded-md bg-gray-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-gray-400"
                onClick={() => {
                  onUseForGenerator(item);
                  onClose();
                }}
              >
                Use for Generator
              </button>
            )}
            {onUseForInpaint && (
              <button
                className="use-for-inpaint-btn rounded-md bg-gray-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-gray-500"
                onClick={() => {
                  onUseForInpaint(item);
                  onClose();
                }}
              >
                Use for Inpaint
              </button>
            )}
            {onUseForOutpaint && (
              <button
                className="use-for-outpaint-btn rounded-md bg-gray-700 px-3 py-1.5 text-sm text-white transition-colors hover:bg-gray-600"
                onClick={() => {
                  onUseForOutpaint(item);
                  onClose();
                }}
              >
                Use for Outpaint
              </button>
            )}
          </div>
        </div>

        {/* Image Body Section */}
        <div className="gallery-modal-body">
          <img src={item.objectURL} alt="Generated image" />
        </div>
      </div>
    </div>
  );
};

export default GalleryModal;
