/**
 * Flux Image Generator - Gallery
 * Manages the storage and display of generated images using IndexedDB
 */

// Gallery module
const FluxGallery = {
  // Max number of images to store (can be much higher with IndexedDB)
  maxImages: 200, // Increased default limit

  // IndexedDB database instance
  db: null,
  dbName: 'FluxGalleryDB',
  dbVersion: 1,
  storeName: 'images',

  // Current gallery items (loaded from DB)
  items: [], // Will hold { id, objectURL, metadata }

  // Pagination state
  page: 1,
  pageSize: 24, // default visible thumbnails per page
  get totalPages() {
    return Math.max(1, Math.ceil(this.items.length / this.pageSize));
  },

  // Initialize the gallery
  init: async function () {
    console.log('Initializing Gallery with IndexedDB');
    try {
      this.db = await this.openDB();
      await this.loadFromDB(); // Load images from IndexedDB
      this.setupGalleryUI(); // Set up gallery UI
      console.log(`Gallery loaded with ${this.items.length} images`);
      // Ensure page within bounds after load
      this.page = 1;
      this.updateGalleryUI();
    } catch (error) {
      console.error('Failed to initialize gallery:', error);
      // Fallback or error display? For now, just log.
      this.setupGalleryUI(); // Still setup UI, might show empty
    }
  },

  // Open IndexedDB database
  openDB: function () {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(new Error(`IndexedDB error: ${event.target.error}`));
      };

      request.onsuccess = (event) => {
        console.log('IndexedDB opened successfully');
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        console.log('Upgrading IndexedDB');
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          // Use 'id' as the keyPath
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          // Create an index on timestamp for sorting and cleanup
          store.createIndex('timestamp', 'metadata.timestamp', {
            unique: false
          });
          console.log(`Object store "${this.storeName}" created.`);
        }
      };
    });
  },

  // Load images from IndexedDB
  loadFromDB: function () {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not open'));

      const transaction = this.db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp'); // Use timestamp index for sorting
      const request = index.getAll(); // Get all items, sorted by timestamp implicitly? No, need to sort after.

      request.onerror = (event) => {
        console.error('Error loading from DB:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        const results = event.target.result;
        // Sort by timestamp descending (newest first)
        results.sort(
          (a, b) =>
            new Date(b.metadata.timestamp) - new Date(a.metadata.timestamp)
        );

        // Revoke previous Object URLs to prevent memory leaks
        this.items.forEach((item) => {
          if (item.objectURL) URL.revokeObjectURL(item.objectURL);
        });

        // Convert Blobs to Object URLs for display
        this.items = results.map((item) => ({
          ...item,
          imageDataBlob: item.imageData, // Keep the blob reference
          objectURL: URL.createObjectURL(item.imageData) // Create URL for img src
        }));

        console.log(`Loaded ${this.items.length} items from DB`);
        resolve();
      };
    });
  },

  // Add a new image to the gallery
  addImage: async function (imageDataUri, metadata) {
    if (!this.db) {
      console.error('Database not open, cannot add image.');
      window.FluxUI.showNotification('Gallery database not ready.', 'error');
      return null;
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
        imageData: blob, // Store the Blob directly
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
          window.FluxUI.showNotification(
            'Failed to save image to gallery.',
            'error'
          );
          reject(event.target.error);
        };

        request.onsuccess = async () => {
          console.log('Item added to DB:', item.id);
          // Prepend to local array and create Object URL
          const newItemForUI = {
            ...item,
            imageDataBlob: item.imageData,
            objectURL: URL.createObjectURL(item.imageData)
          };
          this.items.unshift(newItemForUI); // Add to beginning

          // Enforce maxImages limit AFTER adding
          await this.enforceMaxImagesLimit();

          // Jump to first page to surface most recent on add
          this.page = 1;
          this.updateGalleryUI(); // Update UI
          window.FluxUI.showNotification('Image saved to gallery!', 'success');
          resolve(item.id);
        };

        transaction.oncomplete = () => {
          console.log('Add transaction complete.');
        };
        transaction.onerror = (event) => {
          console.error('Add transaction error:', event.target.error);
          reject(event.target.error); // Reject the outer promise on transaction error
        };
      });
    } catch (error) {
      console.error('Error in addImage:', error);
      window.FluxUI.showNotification(
        `Error saving image: ${error.message}`,
        'error'
      );
      return null;
    }
  },

  // Enforce the maximum number of images stored
  enforceMaxImagesLimit: async function () {
    return new Promise((resolve, reject) => {
      if (!this.db || this.items.length <= this.maxImages) {
        return resolve(); // No need to trim
      }

      console.log(
        `Gallery size (${this.items.length}) exceeds limit (${this.maxImages}). Trimming...`
      );

      // Get IDs of items to remove (oldest ones)
      const itemsToRemove = this.items.slice(this.maxImages); // Get the oldest items from the end of the sorted array

      if (itemsToRemove.length === 0) return resolve();

      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      let deleteCount = 0;

      itemsToRemove.forEach((item) => {
        store.delete(item.id).onsuccess = () => {
          deleteCount++;
          // Revoke Object URL of removed item
          if (item.objectURL) {
            URL.revokeObjectURL(item.objectURL);
          }
        };
        store.delete(item.id).onerror = (event) => {
          console.error(`Error deleting item ${item.id}:`, event.target.error);
        };
      });

      transaction.oncomplete = () => {
        console.log(`Trimmed ${deleteCount} oldest items from DB.`);
        // Update the local items array
        this.items = this.items.slice(0, this.maxImages);
        // No UI update needed here, as it's called after add/load
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Error during trim transaction:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  // Remove an image from the gallery
  removeImage: function (id) {
    if (!this.db) {
      console.error('Database not open, cannot remove image.');
      window.FluxUI.showNotification('Gallery database not ready.', 'error');
      return Promise.resolve(false);
    }

    const transaction = this.db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const request = store.delete(id);

    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        console.error('Error deleting item from DB:', event.target.error);
        window.FluxUI.showNotification('Failed to delete image.', 'error');
        reject(event.target.error);
      };

      request.onsuccess = () => {
        console.log('Item deleted from DB:', id);
        // Find and remove from local array, revoke URL
        const index = this.items.findIndex((item) => item.id === id);
        if (index > -1) {
          const removedItem = this.items.splice(index, 1)[0];
          if (removedItem.objectURL) {
            URL.revokeObjectURL(removedItem.objectURL);
          }
          // After delete, ensure pagination still valid
          if ((this.page - 1) * this.pageSize >= this.items.length) {
            this.page = Math.max(1, this.totalPages);
          }
          this.updateGalleryUI(); // Update UI
          window.FluxUI.showNotification('Image deleted.', 'success');
          resolve(true);
        } else {
          console.warn(`Item ${id} not found in local cache after deletion.`);
          this.updateGalleryUI(); // Still update UI in case
          resolve(false); // Indicate item wasn't in the local list
        }
      };

      transaction.onerror = (event) => {
        console.error('Delete transaction error:', event.target.error);
        reject(event.target.error); // Reject the outer promise on transaction error
      };
    });
  },

  // Clear all images from the gallery
  clearGallery: function () {
    if (!this.db) {
      console.error('Database not open, cannot clear gallery.');
      window.FluxUI.showNotification('Gallery database not ready.', 'error');
      return Promise.resolve();
    }

    const transaction = this.db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const request = store.clear();

    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        console.error('Error clearing DB:', event.target.error);
        window.FluxUI.showNotification('Failed to clear gallery.', 'error');
        reject(event.target.error);
      };

      request.onsuccess = () => {
        console.log('Gallery DB cleared.');
        // Revoke all existing object URLs
        this.items.forEach((item) => {
          if (item.objectURL) URL.revokeObjectURL(item.objectURL);
        });
        this.items = []; // Clear local array
        this.updateGalleryUI(); // Update UI
        window.FluxUI.showNotification('Gallery cleared.', 'success');
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Clear transaction error:', event.target.error);
        reject(event.target.error); // Reject the outer promise on transaction error
      };
    });
  },

  // Generate a unique ID for gallery items
  generateId: function () {
    // Simple unique ID generator
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  },

  // Helper: Convert Data URI to Blob
  dataUriToBlob: async function (dataURI) {
    if (!dataURI) return null;
    try {
      const response = await fetch(dataURI);
      return await response.blob();
    } catch (error) {
      console.error('Error converting data URI to Blob:', error);
      return null;
    }
  },

  // --- UI Methods (Largely unchanged, but use item.objectURL) ---

  setupGalleryUI: function () {
    // Get gallery elements
    const galleryContainer = document.getElementById('gallery-container');
    const galleryToggle = document.getElementById('gallery-toggle');
    const galleryContent = document.getElementById('gallery-content');
    const clearGalleryBtn = document.getElementById('clear-gallery-btn');

    // Inject pagination footer controls (non-desktop intrusive)
    const footer = document.querySelector('.gallery-footer');
    if (footer && !footer.querySelector('.gallery-pagination')) {
      footer.insertAdjacentHTML(
        'beforeend',
        `
                <div class="gallery-pagination" style="display:flex;align-items:center;gap:8px;margin-top:8px;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="gallery-prev btn" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;">Prev</button>
                        <span class="gallery-page-label" style="font-size:12px;color:#6b7280;">Page <span class="gp-current">1</span> / <span class="gp-total">1</span></span>
                        <button class="gallery-next btn" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;">Next</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <label for="gallery-page-size" style="font-size:12px;color:#6b7280;">Per page</label>
                        <select id="gallery-page-size" style="padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;">
                            <option value="12">12</option>
                            <option value="24" selected>24</option>
                            <option value="48">48</option>
                            <option value="96">96</option>
                        </select>
                    </div>
                </div>
            `
      );
    }

    if (!galleryContainer || !galleryToggle || !galleryContent) {
      console.error('Gallery UI elements not found');
      return;
    }

    // Inline Mobile Gallery: create a container that will be displayed under the active tab on small screens
    if (!document.getElementById('mobile-inline-gallery')) {
      const inline = document.createElement('section');
      inline.id = 'mobile-inline-gallery';
      inline.innerHTML = `
                <div class="flex items-center justify-between">
                    <h2 class="text-base font-semibold text-gray-700">Gallery</h2>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                        <span>Page <span class="gp-current">1</span>/<span class="gp-total">1</span></span>
                    </div>
                </div>
                <div id="mobile-gallery-grid" class="grid grid-cols-3 gap-2 mt-2"></div>
                <div class="flex items-center justify-between mt-2">
                    <div class="flex items-center gap-2">
                        <button class="mobile-gallery-prev px-2 py-1 border border-gray-300 rounded">Prev</button>
                        <button class="mobile-gallery-next px-2 py-1 border border-gray-300 rounded">Next</button>
                    </div>
                    <div class="flex items-center gap-2">
                        <label for="mobile-gallery-page-size" class="text-xs text-gray-500">Per page</label>
                        <select id="mobile-gallery-page-size" class="px-2 py-1 border border-gray-300 rounded text-sm">
                            <option value="9" selected>9</option>
                            <option value="12">12</option>
                            <option value="24">24</option>
                        </select>
                    </div>
                </div>
            `;
      // Hide by default in desktop; shown only in mobile CSS via utility classes would be ideal, but we toggle in JS based on width and active tab.
      inline.style.display = 'none';
      document.body.appendChild(inline);
    }

    // Handle tab switches to place inline gallery under active .tab-content on mobile
    const placeInlineUnderActiveTab = () => {
      const inline = document.getElementById('mobile-inline-gallery');
      if (!inline) return;

      const isMobile = window.matchMedia('(max-width: 640px)').matches;
      if (!isMobile) {
        inline.style.display = 'none';
        return;
      }

      // Hide the right sidebar on mobile entirely
      if (galleryContainer) galleryContainer.style.display = 'none';

      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        inline.style.display = '';
        if (inline.parentElement !== activeTab) {
          activeTab.appendChild(inline);
        }
      } else {
        inline.style.display = 'none';
      }
      // render mobile gallery items
      this.renderMobileInlineGallery();
    };

    // Observe tab button clicks
    document.querySelectorAll('.tab-button').forEach((btn) => {
      btn.addEventListener('click', () => {
        // slight delay to allow active class switch by existing code
        setTimeout(placeInlineUnderActiveTab, 0);
      });
    });

    // React on resize
    window.addEventListener('resize', placeInlineUnderActiveTab);
    // Initial placement
    setTimeout(placeInlineUnderActiveTab, 0);

    // Toggle gallery visibility
    galleryToggle.addEventListener('click', () => {
      galleryContainer.classList.toggle('gallery-collapsed');
      const isCollapsed =
        galleryContainer.classList.contains('gallery-collapsed');
      galleryToggle.innerHTML = isCollapsed
        ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>';
    });

    // Pagination events
    const prevBtn = document.querySelector('.gallery-prev');
    const nextBtn = document.querySelector('.gallery-next');
    const pageSizeSelect = document.getElementById('gallery-page-size');

    // Mobile inline pagination events
    const mPrev = () => {
      if (this.page > 1) {
        this.page--;
        this.updateGalleryUI();
        this.renderMobileInlineGallery();
      }
    };
    const mNext = () => {
      if (this.page < this.totalPages) {
        this.page++;
        this.updateGalleryUI();
        this.renderMobileInlineGallery();
      }
    };
    const mSize = (val) => {
      const firstIndex = (this.page - 1) * this.pageSize;
      this.pageSize = val;
      this.page = Math.floor(firstIndex / this.pageSize) + 1;
      if (this.page > this.totalPages) this.page = this.totalPages;
      if (this.page < 1) this.page = 1;
      this.updateGalleryUI();
      this.renderMobileInlineGallery();
    };

    const mobilePrevBtn = () =>
      document.querySelector('#mobile-inline-gallery .mobile-gallery-prev');
    const mobileNextBtn = () =>
      document.querySelector('#mobile-inline-gallery .mobile-gallery-next');
    const mobileSizeSel = () =>
      document.getElementById('mobile-gallery-page-size');

    setTimeout(() => {
      const mp = mobilePrevBtn();
      const mn = mobileNextBtn();
      const ms = mobileSizeSel();
      if (mp && !mp._bound) {
        mp.addEventListener('click', mPrev);
        mp._bound = true;
      }
      if (mn && !mn._bound) {
        mn.addEventListener('click', mNext);
        mn._bound = true;
      }
      if (ms && !ms._bound) {
        ms.addEventListener('change', (e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v > 0) mSize(v);
        });
        ms._bound = true;
      }
    }, 0);
    if (prevBtn && nextBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.page > 1) {
          this.page -= 1;
          this.updateGalleryUI();
        }
      });
      nextBtn.addEventListener('click', () => {
        if (this.page < this.totalPages) {
          this.page += 1;
          this.updateGalleryUI();
        }
      });
    }
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        const newSize = parseInt(e.target.value, 10);
        if (!isNaN(newSize) && newSize > 0) {
          // Recompute page to keep first item visible when possible
          const firstIndex = (this.page - 1) * this.pageSize;
          this.pageSize = newSize;
          this.page = Math.floor(firstIndex / this.pageSize) + 1;
          if (this.page > this.totalPages) this.page = this.totalPages;
          if (this.page < 1) this.page = 1;
          this.updateGalleryUI();
        }
      });
    }

    // Mobile: allow dragging the bottom sheet handle to open/close
    // Minimal implementation using click toggle; advanced drag can be added later.
    if (galleryToggle) {
      galleryToggle.setAttribute('aria-label', 'Toggle Gallery');
    }

    // Clear gallery button
    if (clearGalleryBtn) {
      clearGalleryBtn.addEventListener('click', async () => {
        // Made async
        if (
          confirm(
            'Are you sure you want to clear all saved images? This cannot be undone.'
          )
        ) {
          try {
            await this.clearGallery();
          } catch (error) {
            console.error('Failed to clear gallery:', error);
            window.FluxUI.showNotification('Error clearing gallery.', 'error');
          }
        }
      });
    }

    // Initial UI update
    this.updateGalleryUI();
  },

  updateGalleryUI: function () {
    const galleryContent = document.getElementById('gallery-content');
    const galleryCounter = document.getElementById('gallery-counter');

    if (!galleryContent) return;

    // Clear current content
    galleryContent.innerHTML = '';
    // Clamp page bounds
    if (this.page < 1) this.page = 1;
    const totalPages = this.totalPages;
    if (this.page > totalPages) this.page = totalPages;

    // Update counter if it exists
    if (galleryCounter) {
      galleryCounter.textContent = this.items.length;
    }
    // Update pagination label
    const curEl = document.querySelector('.gp-current');
    const totEl = document.querySelector('.gp-total');
    if (curEl) curEl.textContent = String(this.page);
    if (totEl) totEl.textContent = String(totalPages);

    // Show empty state if no items
    if (this.items.length === 0) {
      // Optional: Add a message like galleryContent.innerHTML = '<p class="p-4 text-center text-gray-500">Gallery is empty.</p>';
      // Also clear mobile grid if present
      const mg = document.getElementById('mobile-gallery-grid');
      if (mg) mg.innerHTML = '';
      const curEl = document.querySelector('.gp-current');
      const totEl = document.querySelector('.gp-total');
      if (curEl) curEl.textContent = '1';
      if (totEl) totEl.textContent = '1';
      return;
    }

    // Create gallery items (using item.objectURL)
    const start = (this.page - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageItems = this.items.slice(start, end);
    pageItems.forEach((item) => {
      const itemElement = document.createElement('div');
      itemElement.className =
        'gallery-item group relative aspect-square bg-gray-800 overflow-hidden rounded-md shadow-md'; // Added group and styling
      itemElement.innerHTML = `
                <img src="${item.objectURL}" alt="Generated image" class="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105">

                <!-- Overlay for buttons -->
                 <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                     <!-- Download Button -->
                     <button class="download-btn p-2 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors mx-1" data-id="${item.id}" title="Download Image">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                             <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                         </svg>
                     </button>
                     <!-- Delete Button -->
                     <button class="gallery-delete-btn p-2 bg-red-600 text-white rounded-full shadow-lg hover:bg-red-700 transition-colors mx-1" data-id="${item.id}" title="Delete Image">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                             <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                         </svg>
                     </button>
                 </div>

                <!-- Details on hover (optional, kept simple) -->
                <div class="absolute bottom-0 left-0 right-0 p-1 text-xs bg-black bg-opacity-60 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                    <p class="truncate text-center">${item.metadata.model || 'Unknown'}</p>
                </div>
            `;

      galleryContent.appendChild(itemElement);

      // Add event listener for item click (open modal)
      // Use the container div for the click to open modal
      itemElement.addEventListener('click', (e) => {
        // Prevent modal opening if a button inside was clicked
        if (e.target.closest('button')) return;
        this.handleGalleryItemClick(item);
      });

      // Add event listener for delete button
      itemElement
        .querySelector('.gallery-delete-btn')
        .addEventListener('click', async (e) => {
          // Made async
          e.stopPropagation(); // Prevent modal opening
          try {
            await this.removeImage(item.id);
          } catch (error) {
            console.error('Failed to remove image:', error);
            window.FluxUI.showNotification('Error deleting image.', 'error');
          }
        });

      // Add event listener for download button
      itemElement
        .querySelector('.download-btn')
        .addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent modal opening
          this.downloadGalleryImage(item);
        });
    });
  },

  // Render simplified inline gallery for mobile (tap to open modal with full desktop actions)
  renderMobileInlineGallery: function () {
    const inline = document.getElementById('mobile-inline-gallery');
    const grid = document.getElementById('mobile-gallery-grid');
    if (!inline || !grid) return;

    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    if (!isMobile) {
      return;
    }

    // Update page label inside inline header
    const curEl = inline.querySelector('.gp-current');
    const totEl = inline.querySelector('.gp-total');
    const totalPages = this.totalPages;
    if (curEl) curEl.textContent = String(this.page);
    if (totEl) totEl.textContent = String(totalPages);

    // Rebuild grid for current page
    grid.innerHTML = '';
    const start = (this.page - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageItems = this.items.slice(start, end);
    pageItems.forEach((item) => {
      const wrap = document.createElement('div');
      wrap.className =
        'relative overflow-hidden rounded border border-gray-200';
      wrap.innerHTML = `
                <img src="${item.objectURL}" alt="Generated image" class="w-full h-full object-cover aspect-square">
                <div class="absolute top-1 right-1 flex gap-1">
                    <button class="mobile-download p-1 bg-indigo-600 text-white rounded text-xs" title="Download">⬇</button>
                    <button class="mobile-delete p-1 bg-red-600 text-white rounded text-xs" title="Delete">✕</button>
                </div>
            `;
      grid.appendChild(wrap);

      // Tap anywhere on the tile (besides the small buttons) opens the full modal to access imports, metadata, etc.
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.handleGalleryItemClick(item); // reuse desktop modal
      });

      wrap.querySelector('.mobile-download').addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadGalleryImage(item);
      });
      wrap
        .querySelector('.mobile-delete')
        .addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await this.removeImage(item.id);
            this.renderMobileInlineGallery();
          } catch (err) {
            window.FluxUI.showNotification('Error deleting image.', 'error');
          }
        });
    });
  },

  // Handle gallery item click (Modal) - Use item.objectURL
  handleGalleryItemClick: function (item) {
    // Create the main modal container using the new CSS class
    const modal = document.createElement('div');
    modal.className = 'gallery-modal'; // Uses the CSS defined class

    // Format metadata (light theme adjustments)
    let metadataHtml = '';
    if (item.metadata) {
      const { model, prompt, width, height, seed } = item.metadata;
      const date = new Date(item.metadata.timestamp).toLocaleString();
      // Use lighter background and appropriate text colors
      metadataHtml = `
                <div class="mt-4 bg-gray-100 p-4 rounded-md text-sm border border-gray-200">
                    <div class="mb-2"><span class="font-semibold text-indigo-600">Model:</span> ${model || 'Unknown'}</div>
                    <div class="mb-2"><span class="font-semibold text-indigo-600">Size:</span> ${width || '?'} × ${height || '?'}</div>
                    <div class="mb-2"><span class="font-semibold text-indigo-600">Seed:</span> ${seed || 'Unknown'}</div>
                    <div class="mb-2"><span class="font-semibold text-indigo-600">Date:</span> ${date}</div>
                    ${prompt ? `<div class="mb-1"><span class="font-semibold text-indigo-600">Prompt:</span> <div class="text-xs mt-1 text-gray-700 max-h-32 overflow-y-auto bg-gray-50 p-2 rounded border border-gray-200">${prompt}</div></div>` : ''}
                </div>
            `;
    }

    // Build modal content using new structure and classes, with info/buttons at the top
    modal.innerHTML = `
            <div class="gallery-modal-content">
                <div class="gallery-modal-header">
                     <button class="gallery-modal-close-btn" title="Close">×</button>
                </div>
                <!-- Info and Buttons Section -->
                <div class="p-4 border-b border-gray-200 overflow-y-auto flex-shrink-0">
                    ${metadataHtml}
                    <div class="flex flex-wrap gap-2 mt-4">
                        <button class="download-btn px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 transition-colors">Download</button>
                        <button class="copy-params-btn px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors">Copy Parameters</button>
                        <button class="copy-image-btn px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors">Copy to Clipboard</button>
                        <button class="use-for-generator-btn px-3 py-1.5 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-400 transition-colors">Use for Generator</button>
                        <button class="use-for-inpaint-btn px-3 py-1.5 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-500 transition-colors">Use for Inpaint</button>
                        <button class="use-for-outpaint-btn px-3 py-1.5 bg-gray-700 text-white rounded-md text-sm hover:bg-gray-600 transition-colors">Use for Outpaint</button>
                        <button class="use-for-control-btn px-3 py-1.5 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-700 transition-colors">Use for Control</button>
                    </div>
                </div>
                <!-- Image Body Section -->
                <div class="gallery-modal-body">
                    <img src="${item.objectURL}" alt="Generated image">
                </div>
            </div>
        `;

    document.body.appendChild(modal);

    // Add event listeners for buttons using the new structure
    modal
      .querySelector('.gallery-modal-close-btn')
      .addEventListener('click', () => document.body.removeChild(modal));
    modal
      .querySelector('.download-btn')
      .addEventListener('click', () => this.downloadGalleryImage(item));
    modal
      .querySelector('.copy-params-btn')
      .addEventListener('click', () => this.copyGalleryItemParams(item));
    modal
      .querySelector('.copy-image-btn')
      .addEventListener('click', () => this.copyGalleryImageToClipboard(item));
    modal
      .querySelector('.use-for-generator-btn')
      .addEventListener('click', () => {
        this.useForGenerator(item);
        document.body.removeChild(modal);
      });
    modal
      .querySelector('.use-for-inpaint-btn')
      .addEventListener('click', () => {
        this.useForInpaint(item);
        document.body.removeChild(modal);
      });
    modal
      .querySelector('.use-for-outpaint-btn')
      .addEventListener('click', () => {
        this.useForOutpaint(item);
        document.body.removeChild(modal);
      });
    modal
      .querySelector('.use-for-control-btn')
      .addEventListener('click', () => {
        this.useForControl(item);
        document.body.removeChild(modal);
      });

    // Close on background click (clicking the modal container but not the content)
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  },

  // Download a gallery image (uses objectURL)
  downloadGalleryImage: function (item) {
    const link = document.createElement('a');
    link.href = item.objectURL; // Use the object URL

    // Create filename (unchanged logic)
    const model = item.metadata.model || 'flux';
    const timestamp = item.metadata.timestamp
      ? new Date(item.metadata.timestamp)
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19)
      : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // Determine file extension based on stored metadata
    const format = item.metadata?.output_format || 'png'; // Default to png if not specified
    const extension = format === 'jpeg' ? 'jpg' : 'png';
    link.download = `${model}-${timestamp}.${extension}`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.FluxUI.showNotification('Image download started!', 'success');
  },

  // Copy gallery item parameters to clipboard (unchanged logic)
  copyGalleryItemParams: function (item) {
    if (!item.metadata) {
      window.FluxUI.showNotification(
        'No parameters available for this image',
        'error'
      );
      return;
    }
    const params = JSON.stringify(item.metadata, null, 2);
    navigator.clipboard
      .writeText(params)
      .then(() =>
        window.FluxUI.showNotification(
          'Parameters copied to clipboard!',
          'success'
        )
      )
      .catch((err) =>
        window.FluxUI.showNotification(
          'Failed to copy parameters: ' + err.message,
          'error'
        )
      );
  },

  // Copy gallery image to clipboard (uses Blob directly)
  copyGalleryImageToClipboard: function (item) {
    if (!item.imageDataBlob || !(item.imageDataBlob instanceof Blob)) {
      window.FluxUI.showNotification(
        'Image data is not available for copying.',
        'error'
      );
      return;
    }

    try {
      // Use the Blob directly with the Clipboard API
      const clipboardItem = new ClipboardItem({
        [item.imageDataBlob.type || 'image/png']: item.imageDataBlob
      });
      navigator.clipboard
        .write([clipboardItem])
        .then(() => {
          window.FluxUI.showNotification(
            'Image copied to clipboard!',
            'success'
          );
        })
        .catch((err) => {
          console.error('Clipboard API error:', err);
          // Fallback attempt: Convert Blob back to data URI and try copying that (less likely to work for images)
          this.copyBlobAsDataUriFallback(item.imageDataBlob);
        });
    } catch (error) {
      console.error('Error using ClipboardItem:', error);
      window.FluxUI.showNotification(
        'Failed to copy image. Your browser might not support this feature or requires secure context (HTTPS).',
        'error'
      );
    }
  },

  // Fallback for copying image (less reliable)
  copyBlobAsDataUriFallback: function (blob) {
    const reader = new FileReader();
    reader.onloadend = function () {
      const base64data = reader.result;
      // This is unlikely to work for images in most modern browsers via execCommand
      // but it's a last resort attempt. A better fallback might be to just notify the user.
      try {
        // Attempt to copy the data URI as text (won't paste as image)
        navigator.clipboard
          .writeText(base64data)
          .then(() =>
            window.FluxUI.showNotification(
              'Image copied as data URL (fallback).',
              'warning'
            )
          )
          .catch((err) =>
            window.FluxUI.showNotification(
              'Fallback copy failed: ' + err.message,
              'error'
            )
          );
      } catch (e) {
        window.FluxUI.showNotification(
          'Failed to copy image using fallback.',
          'error'
        );
      }
    };
    reader.onerror = function () {
      window.FluxUI.showNotification(
        'Failed to read image data for fallback copy.',
        'error'
      );
    };
    reader.readAsDataURL(blob);
  },

  // --- Methods to send image to other tabs (Need Blob conversion) ---

  // Helper to get Data URI from Blob if needed by other tabs
  getBlobDataUri: function (blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  // Use image for inpainting
  useForInpaint: async function (item) {
    if (
      window.InpaintTab &&
      typeof window.InpaintTab.setInputImage === 'function'
    ) {
      try {
        const dataUri = await this.getBlobDataUri(item.imageDataBlob);
        const inpaintTabButton = document.querySelector(
          '.tab-button[data-tab="inpaint-tab"]'
        );
        if (inpaintTabButton) inpaintTabButton.click();
        window.InpaintTab.setInputImage(dataUri); // Assuming InpaintTab expects data URI
        window.FluxUI.showNotification('Image sent to Inpaint tab!', 'success');
      } catch (error) {
        console.error('Error sending to Inpaint:', error);
        window.FluxUI.showNotification(
          'Failed to prepare image for Inpaint.',
          'error'
        );
      }
    } else {
      window.FluxUI.showNotification('Inpaint tab is not ready yet', 'warning');
    }
  },

  // Use image for outpainting
  useForOutpaint: async function (item) {
    if (
      window.OutpaintTab &&
      typeof window.OutpaintTab.setInputImage === 'function'
    ) {
      try {
        const dataUri = await this.getBlobDataUri(item.imageDataBlob);
        const outpaintTabButton = document.querySelector(
          '.tab-button[data-tab="outpaint-tab"]'
        );
        if (outpaintTabButton) outpaintTabButton.click();
        window.OutpaintTab.setInputImage(dataUri); // Assuming OutpaintTab expects data URI
        window.FluxUI.showNotification(
          'Image sent to Outpaint tab!',
          'success'
        );
      } catch (error) {
        console.error('Error sending to Outpaint:', error);
        window.FluxUI.showNotification(
          'Failed to prepare image for Outpaint.',
          'error'
        );
      }
    } else {
      window.FluxUI.showNotification(
        'Outpaint tab is not ready yet',
        'warning'
      );
    }
  },

  // Use image for Control tab
  useForControl: async function (item) {
    if (
      window.ControlTab &&
      typeof window.ControlTab.setInputImage === 'function'
    ) {
      try {
        const dataUri = await this.getBlobDataUri(item.imageDataBlob);
        const controlTabButton = document.querySelector(
          '.tab-button[data-tab="control-tab"]'
        );
        if (controlTabButton) controlTabButton.click();
        window.ControlTab.setInputImage(dataUri); // Assuming ControlTab expects data URI
        window.FluxUI.showNotification('Image sent to Control tab!', 'success');
      } catch (error) {
        console.error('Error sending to Control:', error);
        window.FluxUI.showNotification(
          'Failed to prepare image for Control.',
          'error'
        );
      }
    } else {
      window.FluxUI.showNotification('Control tab is not ready yet', 'warning');
    }
  },

  // Use image for Generator tab
  useForGenerator: async function (item) {
    if (
      window.GeneratorTab &&
      typeof window.GeneratorTab.setImagePrompt === 'function'
    ) {
      try {
        const dataUri = await this.getBlobDataUri(item.imageDataBlob);
        const genTabButton = document.querySelector(
          '.tab-button[data-tab="generator-tab"]'
        );
        if (genTabButton) genTabButton.click();
        window.GeneratorTab.setImagePrompt(dataUri, `Gallery Image ${item.id}`);
        window.FluxUI.showNotification(
          'Image sent to Generator tab!',
          'success'
        );
      } catch (error) {
        console.error('Error sending to Generator:', error);
        window.FluxUI.showNotification(
          'Failed to prepare image for Generator.',
          'error'
        );
      }
    } else {
      window.FluxUI.showNotification(
        'Generator tab is not ready yet',
        'warning'
      );
    }
  }
};

export default FluxGallery;
