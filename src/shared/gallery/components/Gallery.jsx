/**
 * Gallery Component - Main container component
 */

import GallerySidebar from './GallerySidebar.jsx';

const Gallery = ({
  mode = 'sidebar',
  isOpen = true,
  onCopyParams,
  onUseForInpaint,
  onUseForOutpaint,
  onUseForGenerator,
  onUseForVideo,
  onNotification,
  onClose,
  onItemClick,
  filterType
}) => {
  // Sidebar mode - used in generator
  if (mode === 'sidebar') {
    return (
      <GallerySidebar
        onCopyParams={onCopyParams}
        onUseForInpaint={onUseForInpaint}
        onUseForOutpaint={onUseForOutpaint}
        onUseForGenerator={onUseForGenerator}
        onUseForVideo={onUseForVideo}
        onNotification={onNotification}
      />
    );
  }

  // Modal mode - used in Placemark
  if (mode === 'modal') {
    if (!isOpen) return null;

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) {
            onClose();
          }
        }}
      >
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '800px',
            maxHeight: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px',
              borderBottom: '1px solid #e5e7eb'
            }}
          >
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Open from Gallery
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '4px 8px',
                color: '#6b7280'
              }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            <GallerySidebar
              onCopyParams={null}
              onUseForInpaint={null}
              onUseForOutpaint={null}
              onUseForGenerator={null}
              onUseForVideo={null}
              onNotification={onNotification}
              onItemClick={onItemClick}
              filterType={filterType}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default Gallery;
