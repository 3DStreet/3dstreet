/**
 * Gallery Storybook Stories
 */

import React from 'react';
import GalleryItem from './GalleryItem';
import GalleryGrid from './GalleryGrid';
import GalleryModal from './GalleryModal';

// Mock gallery item data
const createMockItem = (id, overrides = {}) => ({
  id: `item-${id}`,
  type: 'ai-render',
  objectURL: `https://picsum.photos/seed/${id}/512/512`,
  imageDataBlob: new Blob(),
  metadata: {
    model: 'flux-pro-1.1',
    prompt: `A beautiful landscape with mountains and lakes, seed ${id}`,
    width: 1024,
    height: 1024,
    seed: 12345 + id,
    timestamp: new Date(Date.now() - id * 86400000).toISOString(),
    output_format: 'png',
    steps: 40,
    guidance: 3.5,
    ...overrides
  }
});

// Generate array of mock items
const mockItems = Array.from({ length: 48 }, (_, i) => createMockItem(i));

export default {
  title: 'Shared/Gallery',
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1a1a' },
        { name: 'light', value: '#f9fafb' }
      ]
    }
  },
  tags: ['autodocs']
};

// GalleryItem Stories
export const SingleItem = {
  render: (args) => (
    <div style={{ width: '300px', padding: '20px' }}>
      <GalleryItem {...args} />
    </div>
  ),
  args: {
    item: createMockItem(1),
    onItemClick: (item) => console.log('Item clicked:', item),
    onDelete: (id) => console.log('Delete clicked:', id),
    onDownload: (item) => console.log('Download clicked:', item)
  },
  parameters: {
    docs: {
      description: {
        story:
          'A single gallery item card with hover overlay and action buttons.'
      }
    }
  }
};

// GalleryGrid Stories
export const GridView = {
  render: (args) => (
    <div style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
      <GalleryGrid {...args} />
    </div>
  ),
  args: {
    items: mockItems,
    page: 1,
    pageSize: 24,
    totalPages: Math.ceil(mockItems.length / 24),
    onItemClick: (item) => console.log('Item clicked:', item),
    onDelete: (id) => console.log('Delete clicked:', id),
    onDownload: (item) => console.log('Download clicked:', item),
    onPageChange: (page) => console.log('Page changed to:', page),
    onPageSizeChange: (size) => console.log('Page size changed to:', size)
  },
  parameters: {
    docs: {
      description: {
        story: 'Grid layout with pagination controls showing 24 items per page.'
      }
    }
  }
};

export const GridWithFewItems = {
  render: (args) => (
    <div style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
      <GalleryGrid {...args} />
    </div>
  ),
  args: {
    items: mockItems.slice(0, 6),
    page: 1,
    pageSize: 24,
    totalPages: 1,
    onItemClick: (item) => console.log('Item clicked:', item),
    onDelete: (id) => console.log('Delete clicked:', id),
    onDownload: (item) => console.log('Download clicked:', item),
    onPageChange: (page) => console.log('Page changed to:', page),
    onPageSizeChange: (size) => console.log('Page size changed to:', size)
  },
  parameters: {
    docs: {
      description: {
        story: 'Grid with only a few items (no pagination needed).'
      }
    }
  }
};

export const EmptyGrid = {
  render: (args) => (
    <div style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
      <GalleryGrid {...args} />
    </div>
  ),
  args: {
    items: [],
    page: 1,
    pageSize: 24,
    totalPages: 1,
    onItemClick: (item) => console.log('Item clicked:', item),
    onDelete: (id) => console.log('Delete clicked:', id),
    onDownload: (item) => console.log('Download clicked:', item),
    onPageChange: (page) => console.log('Page changed to:', page),
    onPageSizeChange: (size) => console.log('Page size changed to:', size)
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state when no gallery items exist.'
      }
    }
  }
};

export const GridPage2 = {
  render: (args) => (
    <div style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
      <GalleryGrid {...args} />
    </div>
  ),
  args: {
    items: mockItems,
    page: 2,
    pageSize: 24,
    totalPages: Math.ceil(mockItems.length / 24),
    onItemClick: (item) => console.log('Item clicked:', item),
    onDelete: (id) => console.log('Delete clicked:', id),
    onDownload: (item) => console.log('Download clicked:', item),
    onPageChange: (page) => console.log('Page changed to:', page),
    onPageSizeChange: (size) => console.log('Page size changed to:', size)
  },
  parameters: {
    docs: {
      description: {
        story: 'Grid showing page 2 with remaining items.'
      }
    }
  }
};

export const GridSmallPageSize = {
  render: (args) => (
    <div style={{ height: '600px', display: 'flex', flexDirection: 'column' }}>
      <GalleryGrid {...args} />
    </div>
  ),
  args: {
    items: mockItems,
    page: 1,
    pageSize: 12,
    totalPages: Math.ceil(mockItems.length / 12),
    onItemClick: (item) => console.log('Item clicked:', item),
    onDelete: (id) => console.log('Delete clicked:', id),
    onDownload: (item) => console.log('Download clicked:', item),
    onPageChange: (page) => console.log('Page changed to:', page),
    onPageSizeChange: (size) => console.log('Page size changed to:', size)
  },
  parameters: {
    docs: {
      description: {
        story: 'Grid with smaller page size (12 items per page).'
      }
    }
  }
};

// GalleryModal Stories
export const ModalWithFullMetadata = {
  render: (args) => (
    <div style={{ position: 'relative', height: '100vh' }}>
      <GalleryModal {...args} />
    </div>
  ),
  args: {
    item: createMockItem(1, {
      prompt:
        'A stunning mountain landscape at sunset, with snow-capped peaks reflecting golden light, pristine alpine lake in the foreground, vibrant wildflowers, dramatic clouds, photorealistic, 8k resolution, professional photography',
      steps: 50,
      guidance: 4.0,
      interval: 2
    }),
    onClose: () => console.log('Modal closed'),
    onDownload: (item) => console.log('Download:', item),
    onCopyParams: (item) => console.log('Copy params:', item),
    onUseForInpaint: (item) => console.log('Use for inpaint:', item),
    onUseForOutpaint: (item) => console.log('Use for outpaint:', item),
    onUseForGenerator: (item) => console.log('Use for generator:', item)
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal showing full image with all metadata and action buttons.'
      }
    }
  }
};

export const ModalMinimalMetadata = {
  render: (args) => (
    <div style={{ position: 'relative', height: '100vh' }}>
      <GalleryModal {...args} />
    </div>
  ),
  args: {
    item: createMockItem(2, {
      prompt: 'Simple test image',
      model: 'flux-schnell'
    }),
    onClose: () => console.log('Modal closed'),
    onDownload: (item) => console.log('Download:', item),
    onCopyParams: (item) => console.log('Copy params:', item)
  },
  parameters: {
    docs: {
      description: {
        story:
          'Modal with minimal metadata (only essential fields). Optional callbacks can be omitted.'
      }
    }
  }
};

export const ModalScreenshotType = {
  render: (args) => (
    <div style={{ position: 'relative', height: '100vh' }}>
      <GalleryModal {...args} />
    </div>
  ),
  args: {
    item: {
      id: 'screenshot-1',
      type: 'screenshot',
      objectURL: 'https://picsum.photos/seed/screenshot/1920/1080',
      imageDataBlob: new Blob(),
      metadata: {
        model: '3dstreet',
        width: 1920,
        height: 1080,
        timestamp: new Date().toISOString(),
        output_format: 'png',
        sceneId: 'abc123',
        label: 'Downtown Street View'
      }
    },
    onClose: () => console.log('Modal closed'),
    onDownload: (item) => console.log('Download:', item)
  },
  parameters: {
    docs: {
      description: {
        story:
          'Modal showing a screenshot (future feature). AI-specific buttons are hidden for screenshots.'
      }
    }
  }
};

export const ModalJPEGFormat = {
  render: (args) => (
    <div style={{ position: 'relative', height: '100vh' }}>
      <GalleryModal {...args} />
    </div>
  ),
  args: {
    item: createMockItem(3, {
      output_format: 'jpeg',
      model: 'flux-dev'
    }),
    onClose: () => console.log('Modal closed'),
    onDownload: (item) => console.log('Download:', item),
    onCopyParams: (item) => console.log('Copy params:', item),
    onUseForInpaint: (item) => console.log('Use for inpaint:', item),
    onUseForOutpaint: (item) => console.log('Use for outpaint:', item),
    onUseForGenerator: (item) => console.log('Use for generator:', item)
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal showing JPEG format image (downloads as .jpg).'
      }
    }
  }
};

// Interactive Demo
const InteractiveDemoComponent = () => {
  const [items, setItems] = React.useState(mockItems.slice(0, 24));
  const [selectedItem, setSelectedItem] = React.useState(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);

  const totalPages = Math.ceil(items.length / pageSize);

  const handleDelete = (id) => {
    if (window.confirm('Delete this item?')) {
      setItems(items.filter((item) => item.id !== id));
      console.log('Deleted:', id);
    }
  };

  const handleDownload = (item) => {
    console.log('Download:', item);
    alert(`Downloaded: ${item.metadata.model}`);
  };

  const handleCopyParams = (item) => {
    console.log('Copy params:', item.metadata);
    alert('Parameters copied to clipboard!');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '20px',
          background: '#f9fafb',
          borderBottom: '1px solid #e5e7eb'
        }}
      >
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
          Interactive Gallery Demo
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#6b7280' }}>
          {items.length} items total
        </p>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <GalleryGrid
          items={items}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          onItemClick={setSelectedItem}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {selectedItem && (
        <GalleryModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onDownload={handleDownload}
          onCopyParams={handleCopyParams}
          onUseForInpaint={(item) => {
            console.log('Use for inpaint:', item);
            alert('Sent to Inpaint tab!');
            setSelectedItem(null);
          }}
          onUseForOutpaint={(item) => {
            console.log('Use for outpaint:', item);
            alert('Sent to Outpaint tab!');
            setSelectedItem(null);
          }}
          onUseForGenerator={(item) => {
            console.log('Use for generator:', item);
            alert('Sent to Generator tab!');
            setSelectedItem(null);
          }}
        />
      )}
    </div>
  );
};

export const InteractiveDemo = {
  render: () => <InteractiveDemoComponent />,
  parameters: {
    docs: {
      description: {
        story:
          'Fully interactive gallery demo. Try clicking items, pagination, delete, and all modal actions.'
      }
    }
  }
};
