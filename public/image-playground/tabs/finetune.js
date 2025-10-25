/**
 * Flux Image Generator - Finetune Tab
 * Functionality for managing and creating finetunes using /v1/finetune, /v1/my_finetunes, etc.
 */

// Finetune tab module
const FinetuneTab = {
    // Tab state
    finetuneFileData: null, // Base64 data for the finetune zip file
    finetunesList: [], // Array to store user's finetune IDs (kept for potential compatibility)
    detailedFinetunesList: [], // Array to store { id: '...', comment: '...', details: {...} }
    selectedFinetuneDetails: null, // Details of the currently viewed finetune
    currentParams: {}, // Parameters used for the last finetune submission

    // DOM Elements
    elements: {},

    // Initialize the tab
    init: function() {
        console.log('Initializing Finetune Tab');

        // Get tab container
        const tabContainer = document.getElementById('finetune-tab');
        if (!tabContainer) {
            console.error('Finetune Tab: Container element not found!');
            return;
        }

        // Create the HTML content
        this.createTabContent(tabContainer);

        // Get all the necessary elements
        this.getElements();

        // Setup event listeners
        this.setupEventListeners();

        // Fetch initial list of finetunes
        this.fetchMyFinetunes();

        console.log('Finetune Tab: Initialization complete');
    },

    // Get all DOM elements after content is created
    getElements: function() {
        const container = document.getElementById('finetune-tab'); // Use the main container

        // --- Create Finetune Section ---
        this.elements.fileInput = container.querySelector('#finetune-file-input');
        this.elements.fileNameLabel = container.querySelector('#finetune-file-name');
        this.elements.commentInput = container.querySelector('#finetune-comment');
        this.elements.triggerWordInput = container.querySelector('#finetune-trigger-word');
        this.elements.modeSelect = container.querySelector('#finetune-mode');
        this.elements.iterationsSlider = container.querySelector('#finetune-iterations-slider');
        this.elements.iterationsValue = container.querySelector('#finetune-iterations-value');
        this.elements.learningRateInput = container.querySelector('#finetune-learning-rate');
        this.elements.captioningCheckbox = container.querySelector('#finetune-captioning');
        this.elements.prioritySelect = container.querySelector('#finetune-priority');
        this.elements.typeSelect = container.querySelector('#finetune-type');
        this.elements.rankSelect = container.querySelector('#finetune-rank');
        this.elements.webhookUrlInput = container.querySelector('#finetune-webhook-url'); // Added
        this.elements.webhookSecretInput = container.querySelector('#finetune-webhook-secret'); // Added
        this.elements.startFinetuneBtn = container.querySelector('#finetune-start-btn');
        this.elements.finetuneStatus = container.querySelector('#finetune-status'); // Added for feedback

        // --- My Finetunes Section ---
        this.elements.myFinetunesList = container.querySelector('#my-finetunes-list');
        this.elements.refreshFinetunesBtn = container.querySelector('#refresh-finetunes-btn');
        this.elements.finetuneDetailsContainer = container.querySelector('#finetune-details-container');
        this.elements.finetuneDetailsContent = container.querySelector('#finetune-details-content');
        this.elements.finetuneDetailsPlaceholder = container.querySelector('#finetune-details-placeholder'); // Added

        // Verify critical elements
        let missingElements = [];
        ['fileInput', 'commentInput', 'modeSelect', 'startFinetuneBtn', 'myFinetunesList', 'refreshFinetunesBtn', 'finetuneDetailsContainer'].forEach(elem => {
            if (!this.elements[elem]) {
                missingElements.push(elem);
            }
        });

        if (missingElements.length > 0) {
            console.error('Finetune Tab: Critical elements not found:', missingElements);
        }
    },

    // Create the tab content HTML
    createTabContent: function(container) {
        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left Column: Create New Finetune -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6 space-y-4">
                    <h2 class="text-lg font-medium mb-2">Create New Finetune</h2>

                    <!-- File Input -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Training Data (.zip)</label>
                        <label class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                            <div class="flex flex-col items-center">
                                <p class="text-sm text-gray-500">Click to upload ZIP</p>
                                <p id="finetune-file-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                            </div>
                            <input id="finetune-file-input" type="file" class="hidden" accept=".zip" />
                        </label>
                    </div>

                    <!-- Finetune Comment -->
                    <div>
                        <label for="finetune-comment" class="block text-sm font-medium text-gray-700 mb-1">Comment / Name</label>
                        <input type="text" id="finetune-comment" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., my-character-model-v1">
                    </div>

                    <!-- Trigger Word -->
                    <div>
                        <label for="finetune-trigger-word" class="block text-sm font-medium text-gray-700 mb-1">Trigger Word</label>
                        <input type="text" id="finetune-trigger-word" value="TOK" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <p class="text-xs text-gray-500 mt-1">Word to invoke the finetune (default: TOK).</p>
                    </div>

                    <!-- Mode -->
                    <div>
                        <label for="finetune-mode" class="block text-sm font-medium text-gray-700 mb-1">Mode</label>
                        <select id="finetune-mode" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="general">General</option>
                            <option value="character">Character</option>
                            <option value="style">Style</option>
                            <option value="product">Product</option>
                        </select>
                         <p class="text-xs text-gray-500 mt-1">Affects captioning behavior.</p>
                    </div>

                    <!-- Iterations -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Iterations: <span id="finetune-iterations-value">300</span></label>
                        <input type="range" id="finetune-iterations-slider" min="100" max="1000" step="10" value="300" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <!-- Learning Rate -->
                    <div>
                        <label for="finetune-learning-rate" class="block text-sm font-medium text-gray-700 mb-1">Learning Rate (Optional)</label>
                        <input type="number" id="finetune-learning-rate" step="0.000001" min="0.000001" max="0.005" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 0.0001">
                         <p class="text-xs text-gray-500 mt-1">Default: 1e-5 (full), 1e-4 (lora).</p>
                    </div>

                    <!-- Captioning -->
                    <div class="flex items-center">
                        <input type="checkbox" id="finetune-captioning" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                        <label for="finetune-captioning" class="ml-2 block text-sm text-gray-700">Enable Captioning</label>
                    </div>

                    <!-- Priority -->
                     <div>
                        <label for="finetune-priority" class="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                        <select id="finetune-priority" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="quality">Quality</option>
                            <option value="speed">Speed</option>
                            <option value="high_res_only">High Res Only</option>
                        </select>
                    </div>

                    <!-- Finetune Type -->
                     <div>
                        <label for="finetune-type" class="block text-sm font-medium text-gray-700 mb-1">Finetune Type</label>
                        <select id="finetune-type" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="full">Full</option>
                            <option value="lora">LoRA</option>
                        </select>
                    </div>

                    <!-- LoRA Rank -->
                     <div>
                        <label for="finetune-rank" class="block text-sm font-medium text-gray-700 mb-1">LoRA Rank</label>
                        <select id="finetune-rank" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="32">32</option>
                            <option value="16">16</option>
                        </select>
                         <p class="text-xs text-gray-500 mt-1">Rank if type is LoRA, or for extracted LoRA if type is Full.</p>
                    </div>

                     <!-- Webhook URL (Optional) -->
                    <div>
                        <label for="finetune-webhook-url" class="block text-sm font-medium text-gray-700 mb-1">Webhook URL (Optional)</label>
                        <input type="url" id="finetune-webhook-url" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="https://your-server.com/webhook">
                    </div>

                    <!-- Webhook Secret (Optional) -->
                    <div>
                        <form>
                            <label for="finetune-webhook-secret" class="block text-sm font-medium text-gray-700 mb-1">Webhook Secret (Optional)</label>
                            <input type="password" id="finetune-webhook-secret" autocomplete="new-password" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Optional secret for verification">
                        </form>
                    </div>

                    <!-- Start Button -->
                    <button id="finetune-start-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                        Start Finetuning
                    </button>
                    <div id="finetune-status" class="text-sm text-gray-600 mt-2"></div> <!-- Status Area -->

                </div>

                <!-- Right Column: My Finetunes & Details -->
                <div class="lg:col-span-2 bg-white rounded-lg shadow p-6 space-y-4">
                    <div class="flex justify-between items-center">
                         <h2 class="text-lg font-medium">My Finetunes</h2>
                         <button id="refresh-finetunes-btn" title="Refresh List" class="p-1 hover:bg-gray-100 rounded">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357-2m0 0H15" />
                            </svg>
                         </button>
                    </div>

                    <!-- List of Finetunes -->
                    <div id="my-finetunes-list" class="max-h-60 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1">
                        <!-- Finetunes will be listed here -->
                        <p class="text-sm text-gray-500">Loading finetunes...</p>
                    </div>

                    <!-- Finetune Details -->
                     <h2 class="text-lg font-medium pt-4 border-t border-gray-200">Details</h2>
                     <div id="finetune-details-container" class="min-h-[200px] border border-gray-200 rounded-md p-4 bg-gray-50">
                         <div id="finetune-details-placeholder" class="text-sm text-gray-500">Select a finetune from the list above to see its details.</div>
                         <pre id="finetune-details-content" class="text-xs whitespace-pre-wrap break-words hidden"></pre>
                     </div>
                </div>
            </div>
        `;
    },

    // Setup event listeners
    setupEventListeners: function() {
        // File input
        this.elements.fileInput.addEventListener('change', this.handleFinetuneFileSelect.bind(this));

        // Iterations slider
        this.setupSlider(this.elements.iterationsSlider, this.elements.iterationsValue);

        // Start finetune button
        this.elements.startFinetuneBtn.addEventListener('click', this.startFinetuningProcess.bind(this));

        // Refresh finetunes button
        this.elements.refreshFinetunesBtn.addEventListener('click', this.fetchMyFinetunes.bind(this));

        // Delegate clicks for finetune list items (view details / delete)
        this.elements.myFinetunesList.addEventListener('click', this.handleFinetuneListClick.bind(this));

        // Add listener for finetune type change to potentially adjust learning rate placeholder/default
        this.elements.typeSelect.addEventListener('change', this.updateLearningRatePlaceholder.bind(this));
        this.updateLearningRatePlaceholder(); // Initial call
    },

    // Setup a range slider to update its value display
    setupSlider: function(slider, valueDisplay) {
        if (slider && valueDisplay) {
            slider.addEventListener('input', () => {
                valueDisplay.textContent = slider.value;
            });
            // Initialize display
            valueDisplay.textContent = slider.value;
        }
    },

    // Update learning rate placeholder based on finetune type
    updateLearningRatePlaceholder: function() {
        const type = this.elements.typeSelect.value;
        if (type === 'lora') {
            this.elements.learningRateInput.placeholder = "Default: 0.0001";
        } else { // full
            this.elements.learningRateInput.placeholder = "Default: 0.00001";
        }
    },

    // Handle finetune zip file selection
    handleFinetuneFileSelect: function(event) {
        const file = event.target.files[0];
        if (!file) {
            this.finetuneFileData = null;
            this.elements.fileNameLabel.textContent = 'No file selected';
            return;
        }

        if (!file.name.toLowerCase().endsWith('.zip')) {
            FluxUI.showNotification('Please select a .zip file containing your training data.', 'error');
            this.finetuneFileData = null;
            this.elements.fileNameLabel.textContent = 'Invalid file type';
            this.elements.fileInput.value = ''; // Reset file input
            return;
        }

        this.elements.fileNameLabel.textContent = file.name;
        this.elements.finetuneStatus.textContent = 'Reading file...'; // Feedback

        const reader = new FileReader();
        reader.onload = (e) => {
            this.finetuneFileData = e.target.result.split(',')[1]; // Store base64 part
            console.log("Finetune ZIP file loaded successfully.");
            this.elements.finetuneStatus.textContent = 'File ready.';
        };
        reader.onerror = (error) => {
            console.error("Error reading finetune file:", error);
            FluxUI.showNotification('Error reading the selected file.', 'error');
            this.finetuneFileData = null;
            this.elements.fileNameLabel.textContent = 'Error reading file';
            this.elements.finetuneStatus.textContent = 'Error reading file.';
        };
        reader.readAsDataURL(file);
    },

    // Fetch the list of user's finetunes and their details
    fetchMyFinetunes: async function() {
        console.log("Fetching user's finetunes...");
        this.elements.myFinetunesList.innerHTML = '<p class="text-sm text-gray-500">Loading finetunes...</p>';
        this.elements.finetuneDetailsContainer.classList.add('hidden'); // Hide details while loading list
        this.detailedFinetunesList = []; // Clear previous detailed list

        if (!window.FluxUI.getApiKey()) {
            this.elements.myFinetunesList.innerHTML = '<p class="text-sm text-red-500">API Key not set.</p>';
            return;
        }

        try {
            // 1. Fetch the list of IDs
            const listResponse = await FluxAPI.makeRequest('my_finetunes', null, 'GET');
            console.log("Finetunes list response:", listResponse);

            if (!listResponse || !listResponse.finetunes || !Array.isArray(listResponse.finetunes)) {
                this.finetunesList = [];
                this.detailedFinetunesList = [];
                this.elements.myFinetunesList.innerHTML = '<p class="text-sm text-gray-500">No finetunes found or invalid response format.</p>';
                document.dispatchEvent(new CustomEvent('finetunesListUpdated', { detail: [] })); // Notify empty list
                return;
            }

            this.finetunesList = listResponse.finetunes; // Keep the raw ID list

            if (this.finetunesList.length === 0) {
                 this.elements.myFinetunesList.innerHTML = '<p class="text-sm text-gray-500">No finetunes found.</p>';
                 document.dispatchEvent(new CustomEvent('finetunesListUpdated', { detail: [] })); // Notify empty list
                 return;
            }

            // 2. Fetch details for each finetune ID concurrently
            this.elements.myFinetunesList.innerHTML = '<p class="text-sm text-gray-500">Loading finetune details (0/' + this.finetunesList.length + ')...</p>';
            let fetchedCount = 0;

            const detailPromises = this.finetunesList.map(id =>
                this.fetchFinetuneDetails(id, false) // Pass false to prevent UI update inside the loop
                    .then(details => {
                        fetchedCount++;
                        this.elements.myFinetunesList.innerHTML = `<p class="text-sm text-gray-500">Loading finetune details (${fetchedCount}/${this.finetunesList.length})...</p>`;
                        return { id: id, details: details };
                    })
                    .catch(error => {
                        fetchedCount++;
                        this.elements.myFinetunesList.innerHTML = `<p class="text-sm text-gray-500">Loading finetune details (${fetchedCount}/${this.finetunesList.length})...</p>`;
                        console.warn(`Could not fetch details for ${id}:`, error);
                        return { id: id, details: null }; // Handle fetch error for individual finetune
                    })
            );

            const results = await Promise.all(detailPromises);

            // 3. Process results and store in detailedFinetunesList
            this.detailedFinetunesList = results.map(result => {
                // Extract comment from details, fallback to ID
                // Look inside the nested 'finetune_details' object if the API returns it that way
                const commentSource = result.details?.finetune_details || result.details;
                const comment = commentSource?.finetune_comment || result.id;
                return {
                    id: result.id,
                    comment: comment,
                    details: result.details // Store full details object
                };
            });

            // 4. Sort by comment (case-insensitive)
            this.detailedFinetunesList.sort((a, b) => a.comment.toLowerCase().localeCompare(b.comment.toLowerCase()));

            // 5. Render the final list
            this.renderFinetunesList();

            // 6. Notify other components that the list is ready
            console.log("Dispatching finetunesListUpdated event with:", this.detailedFinetunesList);
            document.dispatchEvent(new CustomEvent('finetunesListUpdated', { detail: this.detailedFinetunesList }));


        } catch (error) {
            console.error('Error fetching finetunes list or details:', error);
            this.elements.myFinetunesList.innerHTML = `<p class="text-sm text-red-500">Error loading finetunes: ${error.message}</p>`;
            FluxUI.showNotification(`Failed to fetch finetunes: ${error.message}`, 'error');
            this.finetunesList = [];
            this.detailedFinetunesList = [];
            document.dispatchEvent(new CustomEvent('finetunesListUpdated', { detail: [] })); // Notify empty list on error
        }
    },

    // Render the list of finetunes using the detailed list
    renderFinetunesList: function() {
        if (this.detailedFinetunesList.length === 0) {
            // Keep the message set by fetchMyFinetunes (e.g., "No finetunes found.")
            // this.elements.myFinetunesList.innerHTML = '<p class="text-sm text-gray-500">No finetunes found.</p>';
            return;
        }

        this.elements.myFinetunesList.innerHTML = this.detailedFinetunesList.map(ft => `
            <div class="flex justify-between items-center p-1.5 hover:bg-gray-100 rounded cursor-pointer group" data-finetune-id="${ft.id}">
                <span class="text-sm truncate" title="${ft.comment} (ID: ${ft.id})">${ft.comment}</span>
                <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button class="view-details-btn p-0.5 text-blue-500 hover:text-blue-700" title="View Details">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </button>
                    <button class="delete-finetune-btn p-0.5 text-red-500 hover:text-red-700" title="Delete Finetune">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    // Handle clicks within the finetunes list (view details or delete)
    handleFinetuneListClick: async function(event) {
        const viewButton = event.target.closest('.view-details-btn');
        const deleteButton = event.target.closest('.delete-finetune-btn');
        const listItem = event.target.closest('[data-finetune-id]');

        if (!listItem) return; // Clicked outside an item

        const finetuneId = listItem.dataset.finetuneId;

        if (viewButton) {
            event.stopPropagation(); // Prevent triggering delete if icons overlap
            await this.fetchFinetuneDetails(finetuneId);
        } else if (deleteButton) {
            event.stopPropagation(); // Prevent triggering view details
            await this.deleteFinetune(finetuneId);
        } else {
            // If clicking the item itself (not buttons), view details
            await this.fetchFinetuneDetails(finetuneId);
        }
    },

    // Fetch details for a specific finetune
    // updateUI flag controls whether this call directly updates the detail view elements
    fetchFinetuneDetails: async function(finetuneId, updateUI = true) {
        if (updateUI) {
            console.log(`Fetching and displaying details for finetune: ${finetuneId}`);
            this.elements.finetuneDetailsPlaceholder.textContent = 'Loading details...';
            this.elements.finetuneDetailsPlaceholder.classList.remove('hidden');
            this.elements.finetuneDetailsContent.classList.add('hidden');
            this.elements.finetuneDetailsContainer.classList.remove('hidden'); // Ensure container is visible
        } else {
            // console.log(`Fetching details for finetune (no UI update): ${finetuneId}`); // Less verbose logging
        }

        if (!finetuneId) {
             console.error("fetchFinetuneDetails called with undefined finetuneId");
             if (updateUI) this.elements.finetuneDetailsPlaceholder.textContent = 'Invalid Finetune ID provided.';
             throw new Error("Invalid Finetune ID provided.");
        }


        if (!window.FluxUI.getApiKey()) {
             if (updateUI) this.elements.finetuneDetailsPlaceholder.textContent = 'API Key not set.';
            throw new Error('API Key not set.'); // Throw error for Promise.all
        }

        try {
            const response = await FluxAPI.makeRequest(`finetune_details?finetune_id=${finetuneId}`, null, 'GET');
            // console.log(`Finetune details response for ${finetuneId}:`, response); // Less verbose

            if (response && response.finetune_details) {
                 if (updateUI) {
                    this.selectedFinetuneDetails = response.finetune_details;
                    this.elements.finetuneDetailsContent.textContent = JSON.stringify(this.selectedFinetuneDetails, null, 2);
                    this.elements.finetuneDetailsPlaceholder.classList.add('hidden');
                    this.elements.finetuneDetailsContent.classList.remove('hidden');
                }
                // Return the inner finetune_details object directly for consistency
                return response.finetune_details;
            } else {
                 if (updateUI) {
                    this.elements.finetuneDetailsPlaceholder.textContent = 'Could not load details (empty response).';
                    FluxUI.showNotification(`Could not load details for ${finetuneId}.`, 'warning');
                 }
                return null; // Indicate failure but don't throw error unless network issue
            }
        } catch (error) {
            console.error(`Error fetching details for ${finetuneId}:`, error);
             if (updateUI) {
                this.elements.finetuneDetailsPlaceholder.textContent = `Error loading details: ${error.message}`;
                FluxUI.showNotification(`Failed to fetch details: ${error.message}`, 'error');
             }
            throw error; // Re-throw error so Promise.all catches it and fetchMyFinetunes handles it
        }
    },

    // Delete a finetune
    deleteFinetune: async function(finetuneId) {
        if (!confirm(`Are you sure you want to delete the finetune "${finetuneId}"? This cannot be undone.`)) {
            return;
        }

        console.log(`Attempting to delete finetune: ${finetuneId}`);
        this.elements.finetuneStatus.textContent = `Deleting ${finetuneId}...`; // Feedback

        if (!window.FluxUI.getApiKey()) {
            FluxUI.showNotification('API Key not set.', 'error');
            this.elements.finetuneStatus.textContent = 'API Key not set.';
            return;
        }

        try {
            const params = { finetune_id: finetuneId };
            const response = await FluxAPI.makeRequest('delete_finetune', params, 'POST'); // API uses POST
            console.log("Delete finetune response:", response);

            if (response && response.status === 'success') {
                FluxUI.showNotification(`Finetune "${finetuneId}" deleted successfully.`, 'success');
                this.elements.finetuneStatus.textContent = `Deleted ${finetuneId}.`;
                // Refresh the list
                await this.fetchMyFinetunes();
                // Clear details if the deleted one was selected
                if (this.selectedFinetuneDetails && this.selectedFinetuneDetails.finetune_id === finetuneId) { // Assuming details contain id
                    this.elements.finetuneDetailsPlaceholder.textContent = 'Select a finetune from the list above to see its details.';
                    this.elements.finetuneDetailsPlaceholder.classList.remove('hidden');
                    this.elements.finetuneDetailsContent.classList.add('hidden');
                    this.selectedFinetuneDetails = null;
                }
            } else {
                throw new Error(response?.message || 'Unknown error during deletion.');
            }
        } catch (error) {
            console.error(`Error deleting finetune ${finetuneId}:`, error);
            this.elements.finetuneStatus.textContent = `Error deleting ${finetuneId}.`;
            FluxUI.showNotification(`Failed to delete finetune: ${error.message}`, 'error');
        }
    },

    // Start the finetuning process
    startFinetuningProcess: async function() {
        console.log("Starting finetuning process...");
        this.elements.finetuneStatus.textContent = 'Preparing request...';

        if (!window.FluxUI.getApiKey()) {
            FluxUI.showNotification('Please enter your API key first', 'error');
            this.elements.finetuneStatus.textContent = 'API Key not set.';
            return;
        }

        if (!this.finetuneFileData) {
            FluxUI.showNotification('Please select a training data (.zip) file', 'error');
            this.elements.finetuneStatus.textContent = 'Training data missing.';
            return;
        }

        const comment = this.elements.commentInput.value.trim();
        if (!comment) {
            FluxUI.showNotification('Please enter a comment/name for the finetune', 'error');
            this.elements.finetuneStatus.textContent = 'Comment/Name missing.';
            return;
        }

        const mode = this.elements.modeSelect.value;
        if (!mode) {
             FluxUI.showNotification('Please select a finetuning mode', 'error');
             this.elements.finetuneStatus.textContent = 'Mode not selected.';
             return;
        }

        // Build parameters according to API spec (FinetuneInputs)
        const params = {
            file_data: this.finetuneFileData,
            finetune_comment: comment,
            mode: mode,
            trigger_word: this.elements.triggerWordInput.value.trim() || "TOK",
            iterations: parseInt(this.elements.iterationsSlider.value),
            captioning: this.elements.captioningCheckbox.checked,
            priority: this.elements.prioritySelect.value,
            finetune_type: this.elements.typeSelect.value,
            lora_rank: parseInt(this.elements.rankSelect.value)
        };

        // Add optional parameters if they have values
        const learningRate = this.elements.learningRateInput.value;
        if (learningRate) {
            params.learning_rate = parseFloat(learningRate);
        }
        const webhookUrl = this.elements.webhookUrlInput.value.trim();
         if (webhookUrl) {
            params.webhook_url = webhookUrl;
        }
        const webhookSecret = this.elements.webhookSecretInput.value; // Don't trim secret
         if (webhookSecret) {
            params.webhook_secret = webhookSecret;
        }


        this.currentParams = { ...params }; // Store for potential debugging (remove file_data later if needed)
        console.log("Submitting finetune request with params:", params); // Log before sending

        this.elements.startFinetuneBtn.disabled = true;
        this.elements.startFinetuneBtn.classList.add('opacity-50');
        this.elements.finetuneStatus.textContent = 'Submitting finetune task...';

        try {
            // API uses POST for /v1/finetune
            const response = await FluxAPI.makeRequest('finetune', params, 'POST');
            console.log("Finetune submission response:", response);

            // The API spec shows an empty {} on success for /v1/finetune
            // We can't poll, so just give user feedback.
            FluxUI.showNotification(`Finetune task "${comment}" submitted successfully! Check 'My Finetunes' later or your webhook.`, 'success');
            this.elements.finetuneStatus.textContent = `Task "${comment}" submitted. Refresh list later.`;

            // Optionally clear the form after successful submission
            this.resetFinetuneForm();

        } catch (error) {
            console.error('Finetune submission error:', error);
            let errorMessage = error.message || 'Unknown error during submission.';
             // Attempt to parse API error details if available
            if (error.response && error.response.detail) {
                try {
                    const details = JSON.parse(error.response.detail); // Assuming detail might be JSON string
                    errorMessage = details.msg || errorMessage;
                } catch (e) {
                     if (typeof error.response.detail === 'string') {
                         errorMessage = error.response.detail;
                     } else if (Array.isArray(error.response.detail) && error.response.detail[0]?.msg) {
                         errorMessage = error.response.detail[0].msg; // Handle validation error format
                     }
                }
            }
            FluxUI.showNotification(`Finetune submission failed: ${errorMessage}`, 'error');
            this.elements.finetuneStatus.textContent = `Submission failed: ${errorMessage}`;
        } finally {
            this.elements.startFinetuneBtn.disabled = false;
            this.elements.startFinetuneBtn.classList.remove('opacity-50');
        }
    },

    // Reset the create finetune form
    resetFinetuneForm: function() {
        this.elements.fileInput.value = ''; // Clear file input
        this.elements.fileNameLabel.textContent = 'No file selected';
        this.finetuneFileData = null;
        this.elements.commentInput.value = '';
        this.elements.triggerWordInput.value = 'TOK';
        this.elements.modeSelect.value = 'general';
        this.elements.iterationsSlider.value = 300;
        this.elements.iterationsValue.textContent = '300';
        this.elements.learningRateInput.value = '';
        this.elements.captioningCheckbox.checked = true;
        this.elements.prioritySelect.value = 'quality';
        this.elements.typeSelect.value = 'full';
        this.elements.rankSelect.value = '32';
        this.elements.webhookUrlInput.value = '';
        this.elements.webhookSecretInput.value = '';
        this.updateLearningRatePlaceholder(); // Reset placeholder
        // Keep status message as is (e.g., "Task submitted...")
    }
};

// Initialize the Finetune tab when the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    window.FinetuneTab = FinetuneTab; // Make globally available for debugging/integration
    // Defer initialization until the tab is actually shown? Or init immediately?
    // For now, init immediately like other tabs.
    // If performance becomes an issue, we can change main.js to init tabs on demand.
    FinetuneTab.init();
});