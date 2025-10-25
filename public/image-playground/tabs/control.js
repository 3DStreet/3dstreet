/**
 * Flux Image Generator - Control Tab
 * Functionality for control-based image generation (Canny and Depth)
 */

// Control tab module
const ControlTab = {
    // Tab state
    controlImageData: null, // Base64 data for the control image
    controlImageType: 'canny', // 'canny' or 'depth'
    selectedFinetune: null, // Store selected finetune ID
    currentParams: {},
    currentImageUrl: '',

    // DOM Elements
    elements: {},

    // Initialize the tab
    init: function() {
        console.log('Initializing Control Tab');

        // Get tab container
        const tabContainer = document.getElementById('control-tab');
        if (!tabContainer) {
            console.error('Control Tab: Container element not found!');
            return;
        }

        // Create the HTML content
        this.createTabContent(tabContainer);

        // Now that content is created, get all the necessary elements
        this.getElements();

        // Initialize model parameters (sets defaults and UI visibility)
        this.updateControlTypeUI();
        this.handleFinetuneSelection(); // Initialize finetune UI state

        // Setup event listeners
        this.setupEventListeners();

        // Listen for finetune list updates from the FinetuneTab
        document.addEventListener('finetunesListUpdated', (event) => {
            console.log("Control Tab received finetunesListUpdated event:", event.detail);
            this.updateFinetuneOptions(event.detail);
        });

        // Register this module with the main UI for updates
        if (window.FluxUI) {
            window.FluxUI.tabModules.control = this;
        }
        
        console.log('Control Tab: Initialization complete');
    },

    // Get all DOM elements after content is created
    getElements: function() {
        // Control Type Selection
        this.elements.controlTypeCanny = document.getElementById('control-type-canny');
        this.elements.controlTypeDepth = document.getElementById('control-type-depth');

        // Finetune elements
        this.elements.finetuneSelector = document.getElementById('control-finetune-selector');
        this.elements.finetuneStrengthContainer = document.getElementById('control-finetune-strength-container');
        this.elements.finetuneStrengthSlider = document.getElementById('control-finetune-strength-slider');
        this.elements.finetuneStrengthValue = document.getElementById('control-finetune-strength-value');

        // Prompt
        this.elements.promptInput = document.getElementById('control-prompt-input');

        // Control Image
        this.elements.controlImageInput = document.getElementById('control-image-input');
        this.elements.controlImageName = document.getElementById('control-image-name');
        this.elements.controlImagePreview = document.getElementById('control-image-preview'); // Added preview element
        this.elements.controlImagePlaceholder = document.getElementById('control-image-placeholder'); // Added placeholder
        // this.elements.selectFromGalleryBtn = document.getElementById('control-select-gallery-btn'); // Removed

        // Canny Parameters
        this.elements.cannyParamsGroup = document.getElementById('canny-params-group');
        this.elements.cannyLowThresholdSlider = document.getElementById('canny-low-threshold-slider');
        this.elements.cannyLowThresholdValue = document.getElementById('canny-low-threshold-value');
        this.elements.cannyHighThresholdSlider = document.getElementById('canny-high-threshold-slider');
        this.elements.cannyHighThresholdValue = document.getElementById('canny-high-threshold-value');

        // Common Parameters
        this.elements.stepsSlider = document.getElementById('control-steps-slider');
        this.elements.stepsValue = document.getElementById('control-steps-value');
        this.elements.guidanceSlider = document.getElementById('control-guidance-slider');
        this.elements.guidanceValue = document.getElementById('control-guidance-value');
        this.elements.safetySlider = document.getElementById('control-safety-slider');
        this.elements.safetyValue = document.getElementById('control-safety-value');
        this.elements.seedInput = document.getElementById('control-seed-input');
        this.elements.randomSeedBtn = document.getElementById('control-random-seed-btn');

        // Advanced options
        this.elements.advancedToggle = document.getElementById('control-advanced-toggle');
        this.elements.advancedOptions = document.getElementById('control-advanced-options');
        this.elements.advancedIcon = document.getElementById('control-advanced-icon');
        this.elements.promptUpsampling = document.getElementById('control-prompt-upsampling');
        this.elements.formatJpeg = document.getElementById('control-format-jpeg');
        this.elements.formatPng = document.getElementById('control-format-png');

        // Preview
        this.elements.previewContainer = document.getElementById('control-preview-container');
        this.elements.previewImage = document.getElementById('control-preview-image');
        this.elements.generationPlaceholder = document.getElementById('control-generation-placeholder');
        this.elements.loadingIndicator = document.getElementById('control-loading-indicator');
        this.elements.loadingText = document.getElementById('control-loading-text');

        // Action buttons
        this.elements.actionButtons = document.getElementById('control-action-buttons');
        this.elements.copyParamsBtn = document.getElementById('control-copy-params-btn');
        this.elements.openImageBtn = document.getElementById('control-open-image-btn'); // Renamed ID
        this.elements.downloadImageBtn = document.getElementById('control-download-image-btn'); // Renamed ID
        this.elements.copyImageUrlBtn = document.getElementById('control-copy-image-url-btn'); // Renamed ID

        // Generate button
        this.elements.generateBtn = document.getElementById('control-generate-btn');

        // Verify critical elements
        let missingElements = [];
        ['controlTypeCanny', 'controlTypeDepth', 'promptInput', 'controlImageInput', 'generateBtn'].forEach(elem => {
            if (!this.elements[elem]) {
                missingElements.push(elem);
            }
        });

        if (missingElements.length > 0) {
            console.error('Control Tab: Critical elements not found:', missingElements);
        }
    },

    // Create the tab content HTML
    createTabContent: function(container) {
        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Parameters Column -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-medium mb-4">Control Generation Settings</h2>

                    <!-- Control Type -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Control Type</label>
                        <div class="flex space-x-4">
                            <div class="flex items-center">
                                <input type="radio" id="control-type-canny" name="control-type" value="canny" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                <label for="control-type-canny" class="ml-2 block text-sm text-gray-700">Canny Edge</label>
                            </div>
                            <div class="flex items-center">
                                <input type="radio" id="control-type-depth" name="control-type" value="depth" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                <label for="control-type-depth" class="ml-2 block text-sm text-gray-700">Depth Map</label>
                            </div>
                        </div>
                    </div>

                    <!-- Finetune Selection -->
                    <div class="mb-4">
                        <label for="control-finetune-selector" class="block text-sm font-medium text-gray-700 mb-1">Finetune Model (Optional)</label>
                        <select id="control-finetune-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="">None</option>
                            <!-- Options populated by JS -->
                        </select>
                    </div>

                    <!-- Finetune Strength (Hidden by default) -->
                    <div id="control-finetune-strength-container" class="mb-4 hidden">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Finetune Strength: <span id="control-finetune-strength-value">1.1</span></label>
                        <input type="range" id="control-finetune-strength-slider" min="0" max="2" step="0.05" value="1.1" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                        <p class="text-xs text-gray-500 mt-1">Controls the influence of the finetuned model (0 = none, 1 = full, >1 = amplified)</p>
                    </div>

                    <!-- Prompt -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                        <textarea id="control-prompt-input" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Describe what you want to generate..."></textarea>
                    </div>

                    <!-- Control Image -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Control Image</label>
                        <div class="flex flex-col space-y-2">
                            <label class="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50 relative">
                                <div id="control-image-placeholder" class="text-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <p class="text-sm text-gray-500 mt-1">Click to upload or drop image</p>
                                    <p id="control-image-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                                </div>
                                <img id="control-image-preview" class="absolute inset-0 w-full h-full object-contain rounded-lg hidden bg-gray-100" alt="Control image preview">
                                <input id="control-image-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
                            </label>
                        </div>
                        <!-- Gallery selection button removed, now done FROM the gallery modal -->
                    </div>

                    <!-- Canny Parameters -->
                    <div id="canny-params-group" class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Canny Edge Detection</label>
                        <div class="mb-3">
                            <label class="block text-xs font-medium text-gray-700 mb-1">Low Threshold: <span id="canny-low-threshold-value">50</span></label>
                            <input type="range" id="canny-low-threshold-slider" min="0" max="500" step="1" value="50" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700 mb-1">High Threshold: <span id="canny-high-threshold-value">200</span></label>
                            <input type="range" id="canny-high-threshold-slider" min="0" max="500" step="1" value="200" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                        </div>
                    </div>

                    <!-- Steps -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Steps: <span id="control-steps-value">50</span></label>
                        <input type="range" id="control-steps-slider" min="15" max="50" value="50" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <!-- Guidance Scale -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Guidance Scale: <span id="control-guidance-value">30</span></label> <!-- Default for Canny -->
                        <input type="range" id="control-guidance-slider" min="1" max="100" step="0.5" value="30" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <!-- Safety Tolerance -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Safety Tolerance: <span id="control-safety-value">2</span></label>
                        <input type="range" id="control-safety-slider" min="0" max="6" step="1" value="2" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                        <p class="text-xs text-gray-500 mt-1">Higher values are less strict (0 = most strict, 6 = least strict)</p>
                    </div>

                    <!-- Seed -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                        <div class="flex">
                            <input type="number" id="control-seed-input" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <button id="control-random-seed-btn" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                🎲
                            </button>
                        </div>
                    </div>

                    <!-- Advanced Options -->
                    <div class="mb-4">
                        <div class="flex justify-between items-center cursor-pointer" id="control-advanced-toggle">
                            <span class="text-sm font-medium text-gray-700">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="control-advanced-icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>

                        <div class="mt-2 hidden" id="control-advanced-options">
                            <!-- Prompt Upsampling -->
                            <div class="mb-3">
                                <div class="flex items-center">
                                    <input type="checkbox" id="control-prompt-upsampling" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="control-prompt-upsampling" class="ml-2 block text-sm text-gray-700">Prompt Upsampling</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Automatically enhances prompt with additional details</p>
                            </div>

                            <!-- Output Format -->
                            <div class="mb-3">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                                <div class="flex space-x-4">
                                    <div class="flex items-center">
                                        <input type="radio" id="control-format-jpeg" name="control-output-format" value="jpeg" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="control-format-jpeg" class="ml-2 block text-sm text-gray-700">JPEG</label>
                                    </div>
                                    <div class="flex items-center">
                                        <input type="radio" id="control-format-png" name="control-output-format" value="png" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="control-format-png" class="ml-2 block text-sm text-gray-700">PNG</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Generate Button -->
                    <button id="control-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        Generate Image
                    </button>
                </div>

                <!-- Preview Column -->
                <div class="lg:col-span-2 bg-white rounded-lg shadow">
                    <div class="p-6 border-b border-gray-200">
                        <h2 class="text-lg font-medium">Preview</h2>
                    </div>
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="control-preview-container">
                        <div id="control-generation-placeholder" class="text-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p>Your generated image will appear here</p>
                        </div>
                        <img id="control-preview-image" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" alt="Generated image">
                        <div id="control-loading-indicator" class="hidden flex flex-col items-center">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <p class="text-gray-600" id="control-loading-text">Generating your image...</p>
                        </div>
                    </div>
                    <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="control-action-buttons">
                            <button id="control-copy-params-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="control-open-image-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Open Image
                            </button>
                            <button id="control-download-image-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Download Image
                            </button>
                            <button id="control-copy-image-url-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Image URL
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // Setup event listeners
    setupEventListeners: function() {
        if (!this.elements.controlTypeCanny) {
            console.error('Control Tab: Cannot set up event listeners, elements not found');
            return;
        }

        // Control type switch
        this.elements.controlTypeCanny.addEventListener('change', () => this.switchControlType('canny'));
        this.elements.controlTypeDepth.addEventListener('change', () => this.switchControlType('depth'));

        // Finetune selector listener
        this.elements.finetuneSelector.addEventListener('change', this.handleFinetuneSelection.bind(this));

        // Advanced toggle
        this.elements.advancedToggle.addEventListener('click', this.toggleAdvancedOptions.bind(this));

        // Random seed button
        this.elements.randomSeedBtn.addEventListener('click', this.generateRandomSeed.bind(this));

        // Generate button
        this.elements.generateBtn.addEventListener('click', this.generateImage.bind(this));

        // Setup sliders
        this.setupSlider(this.elements.stepsSlider, this.elements.stepsValue);
        this.setupSlider(this.elements.guidanceSlider, this.elements.guidanceValue);
        this.setupSlider(this.elements.safetySlider, this.elements.safetyValue);
        this.setupSlider(this.elements.finetuneStrengthSlider, this.elements.finetuneStrengthValue); // Setup finetune slider
        this.setupSlider(this.elements.cannyLowThresholdSlider, this.elements.cannyLowThresholdValue);
        this.setupSlider(this.elements.cannyHighThresholdSlider, this.elements.cannyHighThresholdValue);

        // Setup control image input
        this.elements.controlImageInput.addEventListener('change', this.handleControlImageUpload.bind(this));
        // this.elements.selectFromGalleryBtn.addEventListener('click', this.selectControlImageFromGallery.bind(this)); // Removed listener

        // Setup action buttons
        if (this.elements.openImageBtn) this.elements.openImageBtn.addEventListener('click', this.openImage.bind(this)); // Use renamed ID
        if (this.elements.downloadImageBtn) this.elements.downloadImageBtn.addEventListener('click', this.downloadImage.bind(this)); // Use renamed ID
        if (this.elements.copyImageUrlBtn) this.elements.copyImageUrlBtn.addEventListener('click', this.copyImageUrl.bind(this)); // Use renamed ID
        if (this.elements.copyParamsBtn) this.elements.copyParamsBtn.addEventListener('click', this.copyParams.bind(this));

        console.log('Control Tab: Event listeners set up');
    },

    // Update finetune options in the dropdown using the detailed list
    updateFinetuneOptions: function(detailedFinetunesList) {
        if (!this.elements.finetuneSelector) {
            console.warn("Control Tab: Finetune selector element not found.");
            return;
        }

        // Remember the currently selected value
        const currentSelection = this.elements.finetuneSelector.value;

        // Clear existing options (keep "None")
        while (this.elements.finetuneSelector.options.length > 1) {
            this.elements.finetuneSelector.remove(1);
        }

        // Add new options from the detailed list
        if (detailedFinetunesList && detailedFinetunesList.length > 0) {
            // The list should already be sorted by comment in FinetuneTab
            detailedFinetunesList.forEach(ft => {
                const option = document.createElement('option');
                option.value = ft.id; // Use the ID as the value
                option.textContent = ft.comment; // Display the comment (or ID fallback)
                option.title = `ID: ${ft.id}`; // Add title attribute for full ID tooltip
                // Optionally add type info if available in ft.details
                // const type = ft.details?.finetune_details?.finetune_type;
                // if (type) {
                //     option.textContent += ` (${type.charAt(0).toUpperCase() + type.slice(1)})`;
                // }
                this.elements.finetuneSelector.appendChild(option);
            });
        }

        // Try to restore previous selection
        this.elements.finetuneSelector.value = currentSelection;

        // If the previous selection is no longer valid (e.g., finetune deleted), reset to "None"
        if (this.elements.finetuneSelector.value !== currentSelection) {
            this.elements.finetuneSelector.value = "";
        }

        // Trigger change handler to update UI (e.g., hide/show strength slider)
        this.handleFinetuneSelection();

        console.log("Finetune options updated in Control tab based on detailed list.");
    },
    
    // Handle finetune selection change
    handleFinetuneSelection: function() {
        const selectedValue = this.elements.finetuneSelector.value;
        this.selectedFinetune = selectedValue || null; // Store null if "None" is selected
        
        // Show/hide strength slider
        this.elements.finetuneStrengthContainer.classList.toggle('hidden', !this.selectedFinetune);
        
        // Set default strength when a finetune is selected (Canny/Depth use 1.1 default)
        if (this.selectedFinetune) {
             const defaultStrength = 1.1;
             this.elements.finetuneStrengthSlider.value = defaultStrength;
             this.elements.finetuneStrengthValue.textContent = defaultStrength;
        }
        
        console.log("Control Finetune selected:", this.selectedFinetune);
    },

    // Switch between Canny and Depth control
    switchControlType: function(type) {
        if (this.controlImageType === type) return; // No change

        this.controlImageType = type;
        console.log(`Switched control type to: ${type}`);
        this.updateControlTypeUI();
    },

    // Update UI based on selected control type
    updateControlTypeUI: function() {
        if (this.controlImageType === 'canny') {
            this.elements.cannyParamsGroup.classList.remove('hidden');
            // Set Canny defaults (referencing API spec)
            this.elements.guidanceSlider.min = "1.0";
            this.elements.guidanceSlider.max = "100.0";
            this.elements.guidanceSlider.value = "30";
            this.elements.guidanceValue.textContent = "30";
            this.elements.stepsSlider.min = "15";
            this.elements.stepsSlider.max = "50";
            this.elements.stepsSlider.value = "50";
            this.elements.stepsValue.textContent = "50";
        } else { // Depth
            this.elements.cannyParamsGroup.classList.add('hidden');
            // Set Depth defaults (referencing API spec)
            this.elements.guidanceSlider.min = "1.0";
            this.elements.guidanceSlider.max = "100.0";
            this.elements.guidanceSlider.value = "15";
            this.elements.guidanceValue.textContent = "15";
            this.elements.stepsSlider.min = "15";
            this.elements.stepsSlider.max = "50";
            this.elements.stepsSlider.value = "50";
            this.elements.stepsValue.textContent = "50";
        }
    },

    // updateFinetuneUI function removed

    // Toggle advanced options visibility
    toggleAdvancedOptions: function() {
        this.elements.advancedOptions.classList.toggle('hidden');
        const isVisible = !this.elements.advancedOptions.classList.contains('hidden');
        if (isVisible) {
            this.elements.advancedIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />`;
        } else {
            this.elements.advancedIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />`;
        }
    },

    // Setup range sliders
    setupSlider: function(slider, valueDisplay) {
        if (slider && valueDisplay) {
            slider.addEventListener('input', () => {
                valueDisplay.textContent = slider.value;
            });
        }
    },

    // Generate a random seed
    generateRandomSeed: function() {
        this.elements.seedInput.value = Math.floor(Math.random() * 1000000);
    },

    // Handle control image file upload
    handleControlImageUpload: function(e) {
        const file = e.target.files[0];
        if (!file) return;
        this.processControlImageFile(file);
    },

    // selectControlImageFromGallery function removed as selection is now initiated from the gallery modal.

    // Process the control image file (from upload)
    processControlImageFile: function(file) {
        this.elements.controlImageName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (event) => {
            this.setInputImage(event.target.result, `File: ${file.name}`); // Use setInputImage
        };
        reader.onerror = (error) => {
            console.error("Error reading control image file:", error);
            window.FluxUI.showNotification('Error reading control image file.', 'error');
            this.resetControlImage();
        };
        reader.readAsDataURL(file);
    },

    // Set input image (called from gallery or file upload)
    setInputImage: function(imageDataUrl, imageName = 'From Gallery') {
        this.controlImageData = imageDataUrl.split(',')[1]; // Store base64 part
        this.elements.controlImageName.textContent = imageName;
        this.elements.controlImagePreview.src = imageDataUrl; // Show preview
        this.elements.controlImagePreview.classList.remove('hidden');
        this.elements.controlImagePlaceholder.classList.add('hidden');
        console.log("Control image data loaded", this.controlImageData ? "successfully" : "failed");
    },

    // Reset control image input area
    resetControlImage: function() {
        this.controlImageData = null;
        this.elements.controlImagePreview.classList.add('hidden');
        this.elements.controlImagePreview.src = '';
        this.elements.controlImagePlaceholder.classList.remove('hidden');
        this.elements.controlImageName.textContent = 'No file selected';
        this.elements.controlImageInput.value = ''; // Clear file input
    },

    // Generate an image
    generateImage: function() {
        console.log('Control Generate button clicked');

        if (!window.FluxUI.getApiKey()) {
            window.FluxUI.showNotification('Please enter your API key first', 'error');
            return;
        }

        if (!this.controlImageData) {
            window.FluxUI.showNotification('Please upload or select a control image', 'error');
            return;
        }

        // Determine endpoint and build parameters
        const params = this.buildRequestParams();
        if (!params) return; // Error handled in buildRequestParams

        // Determine endpoint based on control type and finetune selection
        let endpoint;
        const finetuneId = this.elements.finetuneSelector.value;
        if (finetuneId) {
            endpoint = this.controlImageType === 'canny' ? 'flux-pro-1.0-canny-finetuned' : 'flux-pro-1.0-depth-finetuned';
        } else {
            endpoint = this.controlImageType === 'canny' ? 'flux-pro-1.0-canny' : 'flux-pro-1.0-depth';
        }
        console.log(`Using Control API endpoint: ${endpoint}`);

        this.currentParams = params; // Store params for later use (copying, gallery)
        this.toggleLoading(true);

        window.FluxAPI.makeRequest(endpoint, params)
            .then(response => {
                console.log("API response:", response);
                if (response.id) {
                    this.pollForResult(response.id, endpoint); // Pass endpoint for metadata
                } else {
                    throw new Error('No task ID returned from API');
                }
            })
            .catch(error => {
                console.error('Generation error:', error);
                window.FluxUI.showNotification(error.message || 'Failed to generate image', 'error');
                this.toggleLoading(false);
            });
    },

    // Build request parameters
    buildRequestParams: function() {
        const params = {
            prompt: this.elements.promptInput.value.trim(),
            control_image: this.controlImageData, // Always send control_image
            steps: parseInt(this.elements.stepsSlider.value),
            guidance: parseFloat(this.elements.guidanceSlider.value),
            safety_tolerance: parseInt(this.elements.safetySlider.value),
            output_format: this.elements.formatJpeg.checked ? 'jpeg' : 'png',
            prompt_upsampling: this.elements.promptUpsampling.checked
        };

        if (!params.prompt) {
            window.FluxUI.showNotification('Please enter a prompt', 'error');
            return null;
        }

        if (this.elements.seedInput.value) {
            params.seed = parseInt(this.elements.seedInput.value);
        }

        // Add Canny specific params if applicable
        if (this.controlImageType === 'canny') {
            params.canny_low_threshold = parseInt(this.elements.cannyLowThresholdSlider.value);
            params.canny_high_threshold = parseInt(this.elements.cannyHighThresholdSlider.value);
        }

        // Add finetune parameters if selected
        const finetuneId = this.elements.finetuneSelector.value;
        if (finetuneId) {
            params.finetune_id = finetuneId;
            params.finetune_strength = parseFloat(this.elements.finetuneStrengthSlider.value);
        }

        console.log("Final parameters:", params);
        return params;
    },

    // Poll for task result
    pollForResult: function(taskId, endpointUsed) { // Added endpointUsed for metadata
        this.elements.loadingText.textContent = 'Generating your image...';
        console.log(`Polling for result: ${taskId}`);

        window.FluxAPI.pollForResult(
            taskId,
            (progress) => {
                this.elements.loadingText.textContent = `Generating your image... ${Math.round(progress * 100)}%`;
            },
            (imageUrl, result) => {
                console.log("Full result object:", result);
                this.currentImageUrl = imageUrl;

                // Update currentParams with actual parameters used, especially the seed
                if (result.details && result.details.request_params) {
                     console.log("Updating params with details:", result.details.request_params);
                     this.currentParams = {
                         ...this.currentParams, // Keep originally sent params as fallback
                         ...result.details.request_params, // Overwrite with actual params used
                         seed: result.details.request_params.seed ?? this.currentParams.seed // Prioritize received seed
                     };
                }
                // Ensure model/endpoint and finetune info is stored correctly in currentParams
                this.currentParams.model = result.details?.model_id || endpointUsed; // Use endpoint if model_id missing
                if (result.details?.request_params?.finetune_id) {
                    this.currentParams.finetune_id = result.details.request_params.finetune_id;
                    this.currentParams.finetune_strength = result.details.request_params.finetune_strength;
                } else {
                    delete this.currentParams.finetune_id;
                    delete this.currentParams.finetune_strength;
                }
                this.currentParams.control_type = this.controlImageType; // Add control type
                this.currentParams.timestamp = new Date().toISOString();


                const proxiedUrl = window.FluxAPI.getProxiedImageUrl(imageUrl);
                console.log("Proxied Image URL:", proxiedUrl);

                this.displayImage(proxiedUrl);
                this.saveToGallery(proxiedUrl); // Save using proxied URL

                this.toggleLoading(false);
                window.FluxUI.showNotification('Image generated successfully!', 'success');
            },
            (error) => {
                console.error('Error polling for result:', error);
                this.toggleLoading(false);
                window.FluxUI.showNotification(`Failed to get result: ${error.message}`, 'error');
            }
        );
    },

    // Display the generated image
    displayImage: function(imageUrl) {
        console.log("Displaying image:", imageUrl);
        this.elements.previewImage.src = imageUrl;
        this.elements.previewImage.classList.remove('hidden');
        this.elements.generationPlaceholder.classList.add('hidden');

        // Show action buttons
        this.elements.copyParamsBtn.classList.remove('hidden');
        this.elements.openImageBtn.classList.remove('hidden'); // Use renamed ID
        this.elements.downloadImageBtn.classList.remove('hidden'); // Use renamed ID
        this.elements.copyImageUrlBtn.classList.remove('hidden'); // Use renamed ID

        // Add fallback in case the image doesn't load
        this.elements.previewImage.onerror = () => {
            console.error("Failed to load image through proxy. Creating direct link instead.");
            const fallbackButton = document.createElement('div');
            fallbackButton.className = 'text-center mt-4';
            fallbackButton.innerHTML = `
                <p class="mb-2 text-sm text-gray-600">Unable to display image directly:</p>
                <a href="${this.currentImageUrl}" target="_blank" class="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">
                    Open Image in New Tab
                </a>
            `;
            this.elements.previewImage.classList.add('hidden');
            const existingFallback = this.elements.previewContainer.querySelector('.text-center.mt-4');
            if (existingFallback) this.elements.previewContainer.removeChild(existingFallback);
            this.elements.previewContainer.appendChild(fallbackButton);
        };
    },

    // Toggle loading state
    toggleLoading: function(isLoading) {
        if (isLoading) {
            this.elements.loadingIndicator.classList.remove('hidden');
            this.elements.generationPlaceholder.classList.add('hidden');
            this.elements.previewImage.classList.add('hidden');
            this.elements.generateBtn.disabled = true;
            this.elements.generateBtn.classList.add('opacity-50', 'cursor-not-allowed');

            // Hide action buttons
            this.elements.copyParamsBtn.classList.add('hidden');
            this.elements.openImageBtn.classList.add('hidden'); // Use renamed ID
            this.elements.downloadImageBtn.classList.add('hidden'); // Use renamed ID
            this.elements.copyImageUrlBtn.classList.add('hidden'); // Use renamed ID

            // Remove any fallback buttons
            const fallbackButton = this.elements.previewContainer.querySelector('.text-center.mt-4');
            if (fallbackButton) this.elements.previewContainer.removeChild(fallbackButton);
        } else {
            this.elements.loadingIndicator.classList.add('hidden');
            this.elements.generateBtn.disabled = false;
            this.elements.generateBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    },

    // Open the image in a new tab
    openImage: function() {
        if (!this.currentImageUrl) {
            window.FluxUI.showNotification('No image to open', 'error');
            return;
        }
        console.log("Opening image in new tab:", this.currentImageUrl);
        window.open(this.currentImageUrl, '_blank');
        window.FluxUI.showNotification('Image opened in new tab!', 'success');
    },

    // Download the image
    downloadImage: function() {
        if (!this.currentImageUrl) {
            window.FluxUI.showNotification('No image to download', 'error');
            return;
        }
        console.log("Downloading image:", this.currentImageUrl);

        fetch(window.FluxAPI.getProxiedImageUrl(this.currentImageUrl))
            .then(response => response.blob())
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                const downloadLink = document.createElement('a');
                downloadLink.href = blobUrl;

                const modelName = this.currentParams.model || 'control';
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const fileExtension = this.elements.formatJpeg.checked ? 'jpg' : 'png';
                const filename = `flux-${modelName}-${timestamp}.${fileExtension}`;

                downloadLink.download = filename;
                document.body.appendChild(downloadLink);
                downloadLink.click();

                setTimeout(() => {
                    document.body.removeChild(downloadLink);
                    URL.revokeObjectURL(blobUrl);
                }, 100);

                window.FluxUI.showNotification('Image download started!', 'success');
            })
            .catch(error => {
                console.error('Error downloading image:', error);
                window.FluxUI.showNotification('Failed to download image: ' + error.message, 'error');
            });
    },

    // Copy the image URL to clipboard
    copyImageUrl: function() {
        if (!this.currentImageUrl) {
            window.FluxUI.showNotification('No image URL to copy', 'error');
            return;
        }
        console.log("Copying image URL:", this.currentImageUrl);
        navigator.clipboard.writeText(this.currentImageUrl)
            .then(() => window.FluxUI.showNotification('Image URL copied to clipboard!', 'success'))
            .catch(err => window.FluxUI.showNotification('Failed to copy URL: ' + err.message, 'error'));
    },

    // Copy parameters to clipboard
    copyParams: function() {
        if (Object.keys(this.currentParams).length === 0) {
            window.FluxUI.showNotification('No parameters to copy', 'error');
            return;
        }

        // Clean up params for copying (remove image data)
        const paramsToCopy = { ...this.currentParams };
        delete paramsToCopy.control_image; // Don't copy large base64 string

        const paramsString = JSON.stringify(paramsToCopy, null, 2);
        console.log("Copying parameters:", paramsString);

        navigator.clipboard.writeText(paramsString)
            .then(() => window.FluxUI.showNotification('Parameters copied to clipboard!', 'success'))
            .catch(err => window.FluxUI.showNotification('Failed to copy parameters: ' + err.message, 'error'));
    },

    // Save the generated image to the gallery
    saveToGallery: function(imageUrl) {
        if (!window.FluxGallery) {
            console.warn('Gallery module not available, cannot save image');
            return;
        }

        // Fetch the image via proxy to get data URL for gallery storage
        fetch(imageUrl)
            .then(response => response.blob())
            .then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }))
            .then(dataUrl => {
                // Prepare metadata, removing large image data and adding finetune info if present
                const metadata = { ...this.currentParams };
                delete metadata.control_image;
                // Ensure finetune details from currentParams are included if they exist
                if (this.currentParams.finetune_id) {
                   metadata.finetune_id = this.currentParams.finetune_id;
                   metadata.finetune_strength = this.currentParams.finetune_strength;
                }

                window.FluxGallery.addImage(dataUrl, metadata);
                console.log('Image saved to gallery');
            })
            .catch(error => {
                console.error('Error saving to gallery:', error);
                window.FluxUI.showNotification('Warning: Failed to save image to gallery. ' + error.message, 'warning'); // Add user notification
            });
    }
};

// Initialize the Control tab
document.addEventListener('DOMContentLoaded', function() {
    // Make ControlTab globally available for debugging
    window.ControlTab = ControlTab;

    // Initialize the tab
    ControlTab.init();

    console.log('Control tab loaded and initialized');
});