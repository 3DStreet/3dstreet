/**
 * GalleryGrid Component - Grid display with pagination
 */

import GalleryItem from './GalleryItem.jsx';

const GalleryGrid = ({
  items,
  page,
  pageSize,
  totalPages,
  onItemClick,
  onDelete,
  onDownload,
  onPageChange,
  onPageSizeChange
}) => {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = items.slice(start, end);

  const handlePrevPage = () => {
    if (page > 1) {
      onPageChange(page - 1);
    }
  };

  const handleNextPage = () => {
    if (page < totalPages) {
      onPageChange(page + 1);
    }
  };

  const handlePageSizeChange = (e) => {
    const newSize = parseInt(e.target.value, 10);
    if (!isNaN(newSize) && newSize > 0) {
      onPageSizeChange(newSize);
    }
  };

  return (
    <>
      {/* Grid */}
      <div
        className="gallery-content"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '12px',
          padding: '12px',
          overflowY: 'auto',
          flex: '1'
        }}
      >
        {pageItems.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '2rem',
              color: '#6b7280'
            }}
          >
            Gallery is empty
          </div>
        )}
        {pageItems.map((item) => (
          <GalleryItem
            key={item.id}
            item={item}
            onItemClick={onItemClick}
            onDelete={onDelete}
            onDownload={onDownload}
          />
        ))}
      </div>

      {/* Pagination */}
      {items.length > 0 && (
        <div
          className="gallery-pagination"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '8px',
            justifyContent: 'space-between',
            padding: '0 12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="gallery-prev btn"
              onClick={handlePrevPage}
              disabled={page === 1}
              style={{
                padding: '6px 10px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#fff',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.5 : 1
              }}
            >
              Prev
            </button>
            <span
              className="gallery-page-label"
              style={{ fontSize: '12px', color: '#6b7280' }}
            >
              Page <span className="gp-current">{page}</span> /{' '}
              <span className="gp-total">{totalPages}</span>
            </span>
            <button
              className="gallery-next btn"
              onClick={handleNextPage}
              disabled={page === totalPages}
              style={{
                padding: '6px 10px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#fff',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
                opacity: page === totalPages ? 0.5 : 1
              }}
            >
              Next
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label
              htmlFor="gallery-page-size"
              style={{ fontSize: '12px', color: '#6b7280' }}
            >
              Per page
            </label>
            <select
              id="gallery-page-size"
              value={pageSize}
              onChange={handlePageSizeChange}
              style={{
                padding: '6px 8px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px'
              }}
            >
              <option value="12">12</option>
              <option value="24">24</option>
              <option value="48">48</option>
              <option value="96">96</option>
            </select>
          </div>
        </div>
      )}
    </>
  );
};

export default GalleryGrid;
