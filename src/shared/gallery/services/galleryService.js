/**
 * Gallery Service - IndexedDB operations for 3DStreet Gallery
 * Stores images from both AI generation and screenshots
 */

// Event emitter for gallery updates
const galleryEvents = new EventTarget();

const galleryService = {
  // Event emitter
  events: galleryEvents,
  // Max number of images to store
  maxImages: 200,

  // IndexedDB database instance
  db: null,
  dbName: '3DStreetGalleryDB',
  dbVersion: 1,
  storeName: 'images',

  // Legacy database name for migration
  legacyDbName: 'FluxGalleryDB',

  /**
   * Initialize the gallery database
   * @returns {Promise<IDBDatabase>}
   */
  init: async function () {
    try {
      // Check for legacy database and migrate if exists
      await this.migrateLegacyDatabase();

      // Open the new database
      this.db = await this.openDB();
      return this.db;
    } catch (error) {
      console.error('Failed to initialize gallery database:', error);
      throw error;
    }
  },

  /**
   * Open IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  openDB: function () {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(new Error(`IndexedDB error: ${event.target.error}`));
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          // Create object store with 'id' as keyPath
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          // Create indexes for sorting and filtering
          store.createIndex('timestamp', 'metadata.timestamp', {
            unique: false
          });
          store.createIndex('type', 'type', { unique: false });
        }
      };
    });
  },

  /**
   * Migrate data from legacy FluxGalleryDB to new 3DStreetGalleryDB
   * @returns {Promise<void>}
   */
  migrateLegacyDatabase: async function () {
    return new Promise((resolve, reject) => {
      // Check if legacy database exists
      const request = indexedDB.open(this.legacyDbName);

      request.onerror = () => {
        // No legacy database exists, nothing to migrate
        resolve();
      };

      request.onsuccess = async (event) => {
        const legacyDb = event.target.result;

        // Check if legacy DB has any data
        if (!legacyDb.objectStoreNames.contains('images')) {
          legacyDb.close();
          resolve();
          return;
        }

        try {
          // Read all items from legacy database
          const transaction = legacyDb.transaction('images', 'readonly');
          const store = transaction.objectStore('images');
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = async () => {
            const legacyItems = getAllRequest.result;
            legacyDb.close();

            if (legacyItems.length === 0) {
              resolve();
              return;
            }

            console.log(
              `Migrating ${legacyItems.length} images from FluxGalleryDB to 3DStreetGalleryDB...`
            );

            // Open new database
            const newDb = await this.openDB();

            // Migrate items with type: 'ai-render'
            const migrateTransaction = newDb.transaction(
              this.storeName,
              'readwrite'
            );
            const migrateStore = migrateTransaction.objectStore(this.storeName);

            legacyItems.forEach((item) => {
              const migratedItem = {
                ...item,
                type: 'ai-render' // Mark legacy items as AI renders
              };
              migrateStore.add(migratedItem);
            });

            migrateTransaction.oncomplete = () => {
              console.log('Migration completed successfully!');
              newDb.close();

              // Delete legacy database
              const deleteRequest = indexedDB.deleteDatabase(this.legacyDbName);
              deleteRequest.onsuccess = () => {
                console.log('Legacy database deleted.');
                resolve();
              };
              deleteRequest.onerror = () => {
                console.warn(
                  'Could not delete legacy database, but migration was successful.'
                );
                resolve();
              };
            };

            migrateTransaction.onerror = (event) => {
              console.error('Migration transaction error:', event.target.error);
              newDb.close();
              reject(event.target.error);
            };
          };

          getAllRequest.onerror = () => {
            legacyDb.close();
            reject(new Error('Failed to read legacy database'));
          };
        } catch (error) {
          console.error('Migration error:', error);
          legacyDb.close();
          reject(error);
        }
      };
    });
  },

  /**
   * Load all images from database
   * @returns {Promise<Array>}
   */
  loadFromDB: function () {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not open'));

      const transaction = this.db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = (event) => {
        console.error('Error loading from DB:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        const results = event.target.result;
        // Sort by timestamp descending (newest first)
        results.sort((a, b) => {
          const timeA = new Date(a.metadata?.timestamp || 0);
          const timeB = new Date(b.metadata?.timestamp || 0);
          return timeB - timeA;
        });

        // Convert Blobs to Object URLs for display
        const items = results.map((item) => ({
          ...item,
          imageDataBlob: item.imageData,
          objectURL: URL.createObjectURL(item.imageData)
        }));

        resolve(items);
      };
    });
  },

  /**
   * Add a new image to the gallery
   * @param {string} imageDataUri - Data URI or blob URL of the image
   * @param {object} metadata - Image metadata
   * @param {string} type - Image type ('screenshot' | 'ai-render')
   * @returns {Promise<string>} - Returns the new item ID
   */
  addImage: async function (imageDataUri, metadata, type = 'ai-render') {
    if (!this.db) {
      throw new Error('Database not open, cannot add image.');
    }

    try {
      // Convert data URI to Blob
      const blob = await this.dataUriToBlob(imageDataUri);
      if (!blob) {
        throw new Error('Failed to convert image data to Blob.');
      }

      // Create a gallery item
      const item = {
        id: this.generateId(),
        type,
        imageData: blob,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString()
        }
      };

      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.add(item);

      return new Promise((resolve, reject) => {
        request.onerror = (event) => {
          console.error('Error adding item to DB:', event.target.error);
          reject(event.target.error);
        };

        request.onsuccess = () => {
          // Emit event for listeners (e.g., React components)
          this.events.dispatchEvent(
            new CustomEvent('itemAdded', { detail: { id: item.id } })
          );
          resolve(item.id);
        };

        transaction.onerror = (event) => {
          console.error('Add transaction error:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Error in addImage:', error);
      throw error;
    }
  },

  /**
   * Remove an image from the gallery
   * @param {string} id - Image ID to remove
   * @returns {Promise<boolean>}
   */
  removeImage: function (id) {
    if (!this.db) {
      throw new Error('Database not open, cannot remove image.');
    }

    const transaction = this.db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const request = store.delete(id);

    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        console.error('Error deleting item from DB:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = () => {
        resolve(true);
      };

      transaction.onerror = (event) => {
        console.error('Delete transaction error:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Clear all images from the gallery
   * @returns {Promise<void>}
   */
  clearGallery: function () {
    if (!this.db) {
      throw new Error('Database not open, cannot clear gallery.');
    }

    const transaction = this.db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const request = store.clear();

    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        console.error('Error clearing DB:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = () => {
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Clear transaction error:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Enforce the maximum number of images stored
   * @param {Array} items - Current items array
   * @returns {Promise<void>}
   */
  enforceMaxImagesLimit: async function (items) {
    if (!this.db || items.length <= this.maxImages) {
      return;
    }

    // Get IDs of items to remove (oldest ones)
    const itemsToRemove = items.slice(this.maxImages);

    if (itemsToRemove.length === 0) return;

    const transaction = this.db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);

    itemsToRemove.forEach((item) => {
      store.delete(item.id);
    });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Error during trim transaction:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Generate a unique ID for gallery items
   * @returns {string}
   */
  generateId: function () {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  },

  /**
   * Convert Data URI to Blob
   * @param {string} dataURI - Data URI string
   * @returns {Promise<Blob>}
   */
  dataUriToBlob: async function (dataURI) {
    if (!dataURI) return null;
    try {
      const response = await fetch(dataURI);
      return await response.blob();
    } catch (error) {
      console.error('Error converting data URI to Blob:', error);
      return null;
    }
  }
};

export default galleryService;
