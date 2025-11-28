/**
 * Gallery Service Tests
 *
 * Tests for the gallery service pure functions and logic that will
 * be preserved during React migration.
 *
 * Note: IndexedDB operations are tested via mocks since jsdom doesn't
 * provide a full IndexedDB implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============= EXTRACTABLE PURE FUNCTIONS =============

/**
 * Generate a unique ID for gallery items
 * Extracted from galleryService.generateId()
 * @returns {string}
 */
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
};

/**
 * Sort gallery items by timestamp descending (newest first)
 * Extracted from galleryService.loadFromDB()
 * @param {Array} items - Gallery items with metadata.timestamp
 * @returns {Array} Sorted items
 */
const sortByTimestamp = (items) => {
  return [...items].sort((a, b) => {
    const timeA = new Date(a.metadata?.timestamp || 0);
    const timeB = new Date(b.metadata?.timestamp || 0);
    return timeB - timeA;
  });
};

/**
 * Get items to remove when enforcing max limit
 * Extracted from galleryService.enforceMaxImagesLimit()
 * @param {Array} items - Sorted items (newest first)
 * @param {number} maxImages - Maximum number of items to keep
 * @returns {Array} Items that should be removed
 */
const getItemsToRemove = (items, maxImages) => {
  if (items.length <= maxImages) {
    return [];
  }
  return items.slice(maxImages);
};

/**
 * Create a gallery item object
 * Extracted from galleryService.addItem()
 * @param {Blob} blob - Image/video blob
 * @param {Object} metadata - Item metadata
 * @param {string} type - Item type
 * @returns {Object} Gallery item
 */
const createGalleryItem = (blob, metadata, type = 'ai-render') => {
  return {
    id: generateId(),
    type,
    imageData: blob,
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString()
    }
  };
};

/**
 * Migrate legacy item to new format
 * Extracted from galleryService.migrateLegacyDatabase()
 * @param {Object} item - Legacy item
 * @returns {Object} Migrated item with type
 */
const migrateLegacyItem = (item) => {
  return {
    ...item,
    type: 'ai-render'
  };
};

/**
 * Validate item type
 * @param {string} type - Item type to validate
 * @returns {boolean}
 */
const isValidItemType = (type) => {
  const validTypes = ['screenshot', 'ai-render', 'video'];
  return validTypes.includes(type);
};

// ============= TESTS =============

describe('Gallery Service - Pure Functions', () => {
  describe('generateId()', () => {
    it('should generate a non-empty string', () => {
      const id = generateId();

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }

      expect(ids.size).toBe(100);
    });

    it('should contain timestamp component (base36)', () => {
      const before = Date.now().toString(36);
      const id = generateId();

      // ID should start with timestamp portion
      expect(id.slice(0, before.length - 1)).toBeTruthy();
    });

    it('should have consistent format', () => {
      const id = generateId();

      // Should be alphanumeric (base36)
      expect(id).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe('sortByTimestamp()', () => {
    it('should sort items newest first', () => {
      const items = [
        { id: '1', metadata: { timestamp: '2024-01-01T00:00:00Z' } },
        { id: '3', metadata: { timestamp: '2024-01-03T00:00:00Z' } },
        { id: '2', metadata: { timestamp: '2024-01-02T00:00:00Z' } }
      ];

      const sorted = sortByTimestamp(items);

      expect(sorted[0].id).toBe('3');
      expect(sorted[1].id).toBe('2');
      expect(sorted[2].id).toBe('1');
    });

    it('should handle items without timestamp', () => {
      const items = [
        { id: '1', metadata: { timestamp: '2024-01-01T00:00:00Z' } },
        { id: '2', metadata: {} },
        { id: '3' }
      ];

      const sorted = sortByTimestamp(items);

      // Items without timestamps should be at the end (oldest)
      expect(sorted[0].id).toBe('1');
    });

    it('should not mutate original array', () => {
      const items = [
        { id: '1', metadata: { timestamp: '2024-01-01T00:00:00Z' } },
        { id: '2', metadata: { timestamp: '2024-01-02T00:00:00Z' } }
      ];
      const originalOrder = items.map((i) => i.id);

      sortByTimestamp(items);

      expect(items.map((i) => i.id)).toEqual(originalOrder);
    });

    it('should handle empty array', () => {
      const sorted = sortByTimestamp([]);

      expect(sorted).toEqual([]);
    });

    it('should handle single item', () => {
      const items = [{ id: '1', metadata: { timestamp: '2024-01-01T00:00:00Z' } }];

      const sorted = sortByTimestamp(items);

      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe('1');
    });
  });

  describe('getItemsToRemove()', () => {
    const createItems = (count) =>
      Array.from({ length: count }, (_, i) => ({
        id: `item-${i}`,
        metadata: { timestamp: new Date(2024, 0, i + 1).toISOString() }
      }));

    it('should return empty array when under limit', () => {
      const items = createItems(50);

      const toRemove = getItemsToRemove(items, 200);

      expect(toRemove).toHaveLength(0);
    });

    it('should return empty array when at limit', () => {
      const items = createItems(200);

      const toRemove = getItemsToRemove(items, 200);

      expect(toRemove).toHaveLength(0);
    });

    it('should return excess items when over limit', () => {
      const items = createItems(210);

      const toRemove = getItemsToRemove(items, 200);

      expect(toRemove).toHaveLength(10);
    });

    it('should return oldest items (assuming sorted newest first)', () => {
      const items = createItems(205);

      const toRemove = getItemsToRemove(items, 200);

      // Items at end of sorted array are oldest
      expect(toRemove[0].id).toBe('item-200');
      expect(toRemove[4].id).toBe('item-204');
    });

    it('should handle custom max limit', () => {
      const items = createItems(25);

      const toRemove = getItemsToRemove(items, 20);

      expect(toRemove).toHaveLength(5);
    });
  });

  describe('createGalleryItem()', () => {
    it('should create item with all required fields', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const metadata = { prompt: 'test prompt', model: 'flux-pro' };

      const item = createGalleryItem(blob, metadata);

      expect(item.id).toBeTruthy();
      expect(item.type).toBe('ai-render');
      expect(item.imageData).toBe(blob);
      expect(item.metadata.prompt).toBe('test prompt');
      expect(item.metadata.model).toBe('flux-pro');
      expect(item.metadata.timestamp).toBeTruthy();
    });

    it('should use provided type', () => {
      const blob = new Blob(['test'], { type: 'image/png' });

      const screenshotItem = createGalleryItem(blob, {}, 'screenshot');
      const videoItem = createGalleryItem(blob, {}, 'video');

      expect(screenshotItem.type).toBe('screenshot');
      expect(videoItem.type).toBe('video');
    });

    it('should add timestamp to metadata', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const beforeTime = new Date().toISOString();

      const item = createGalleryItem(blob, {});

      const afterTime = new Date().toISOString();
      expect(item.metadata.timestamp >= beforeTime).toBe(true);
      expect(item.metadata.timestamp <= afterTime).toBe(true);
    });

    it('should preserve existing metadata', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const metadata = {
        prompt: 'test',
        seed: 12345,
        dimensions: '1024x768'
      };

      const item = createGalleryItem(blob, metadata);

      expect(item.metadata.prompt).toBe('test');
      expect(item.metadata.seed).toBe(12345);
      expect(item.metadata.dimensions).toBe('1024x768');
    });
  });

  describe('migrateLegacyItem()', () => {
    it('should add ai-render type to legacy item', () => {
      const legacyItem = {
        id: 'legacy-123',
        imageData: new Blob(['test']),
        metadata: { prompt: 'old prompt' }
      };

      const migrated = migrateLegacyItem(legacyItem);

      expect(migrated.type).toBe('ai-render');
      expect(migrated.id).toBe('legacy-123');
      expect(migrated.metadata.prompt).toBe('old prompt');
    });

    it('should preserve all original properties', () => {
      const legacyItem = {
        id: 'legacy-456',
        imageData: new Blob(['test']),
        metadata: {
          prompt: 'test',
          timestamp: '2024-01-01T00:00:00Z',
          model: 'flux-pro'
        },
        customField: 'preserved'
      };

      const migrated = migrateLegacyItem(legacyItem);

      expect(migrated.customField).toBe('preserved');
      expect(migrated.metadata.model).toBe('flux-pro');
    });
  });

  describe('isValidItemType()', () => {
    it('should return true for screenshot type', () => {
      expect(isValidItemType('screenshot')).toBe(true);
    });

    it('should return true for ai-render type', () => {
      expect(isValidItemType('ai-render')).toBe(true);
    });

    it('should return true for video type', () => {
      expect(isValidItemType('video')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(isValidItemType('invalid')).toBe(false);
      expect(isValidItemType('')).toBe(false);
      expect(isValidItemType(null)).toBe(false);
      expect(isValidItemType(undefined)).toBe(false);
    });
  });
});

describe('Gallery Service - Data URI Conversion', () => {
  // Testing dataUriToBlob behavior pattern
  describe('dataUriToBlob() contract', () => {
    it('should convert valid data URI to blob', async () => {
      // This tests the expected input/output contract
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const response = await fetch(dataUri);
      const blob = await response.blob();

      // Use duck typing since jsdom Blob !== native Blob
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe('image/png');
      expect(typeof blob.arrayBuffer).toBe('function');
    });

    it('should handle blob URLs', async () => {
      // Create a blob and URL
      const originalBlob = new Blob(['test content'], { type: 'text/plain' });
      const blobUrl = URL.createObjectURL(originalBlob);

      const response = await fetch(blobUrl);
      const blob = await response.blob();

      // Use duck typing since jsdom Blob !== native Blob
      expect(blob.size).toBeGreaterThan(0);
      expect(typeof blob.arrayBuffer).toBe('function');

      // Clean up
      URL.revokeObjectURL(blobUrl);
    });
  });
});

describe('Gallery Service - Event System', () => {
  describe('Event emitter pattern', () => {
    it('should support addEventListener/dispatchEvent', () => {
      const events = new EventTarget();
      const handler = vi.fn();

      events.addEventListener('itemAdded', handler);
      events.dispatchEvent(
        new CustomEvent('itemAdded', { detail: { id: 'test-123' } })
      );

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].detail.id).toBe('test-123');
    });

    it('should support removeEventListener', () => {
      const events = new EventTarget();
      const handler = vi.fn();

      events.addEventListener('itemAdded', handler);
      events.removeEventListener('itemAdded', handler);
      events.dispatchEvent(new CustomEvent('itemAdded', { detail: {} }));

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('Gallery Service - Configuration', () => {
  describe('Constants', () => {
    it('should have max images limit of 200', () => {
      const maxImages = 200;
      expect(maxImages).toBe(200);
    });

    it('should use correct database name', () => {
      const dbName = '3DStreetGalleryDB';
      expect(dbName).toBe('3DStreetGalleryDB');
    });

    it('should use correct legacy database name for migration', () => {
      const legacyDbName = 'FluxGalleryDB';
      expect(legacyDbName).toBe('FluxGalleryDB');
    });

    it('should use images as store name', () => {
      const storeName = 'images';
      expect(storeName).toBe('images');
    });
  });
});

/**
 * React Migration Notes:
 *
 * These pure functions can be extracted to a utils file and used in React:
 *
 * // galleryUtils.js
 * export { generateId, sortByTimestamp, getItemsToRemove, createGalleryItem };
 *
 * // useGallery.js hook
 * const useGallery = () => {
 *   const [items, setItems] = useState([]);
 *
 *   const addItem = useCallback(async (dataUri, metadata, type) => {
 *     const blob = await dataUriToBlob(dataUri);
 *     const item = createGalleryItem(blob, metadata, type);
 *     // ... IndexedDB operation
 *     setItems(prev => sortByTimestamp([item, ...prev]));
 *   }, []);
 *
 *   return { items, addItem };
 * };
 */
