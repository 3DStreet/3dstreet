/**
 * Flux Image Generator - Main JS
 * Handles tab switching and common functionality for all tabs
 */

// Global UI utilities object
const FluxUI = {
  // Configuration
  apiConfig: {
    // baseUrl: 'https://api.us1.bfl.ai/v1', // Removed: Using server proxy now
    // API key now stored server-side in Firebase Cloud Functions
  },

  // Common elements
  elements: {},

  // Store loaded tab modules
  tabModules: {},

  // Initialize the UI
  init: function () {
    // Get common elements
    this.elements = {
      tabButtons: document.querySelectorAll('.tab-button'),
      tabContents: document.querySelectorAll('.tab-content'),
      notification: document.getElementById('notification'),
      notificationMessage: document.getElementById('notification-message'),
      notificationIcon: document.getElementById('notification-icon')
    };

    // Setup event listeners
    this.setupEventListeners();

    // Listen for auth state changes to update button states
    window.addEventListener('authStateChanged', () => {
      this.updateGenerateButtonStates();
    });

    // Initialize the first tab (needed for navigation only)
    this.activateTab(
      document.querySelector('.tab-button.active') ||
        this.elements.tabButtons[0]
    );

    // Always enable dark mode
    this.setDarkMode(true);

    // Initial button state update
    this.updateGenerateButtonStates();
  },

  // Set up event listeners for common elements
  setupEventListeners: function () {
    // Tab button clicks
    this.elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => this.activateTab(button));
    });
  },

  // Activate a tab
  activateTab: function (tabButton) {
    if (!tabButton) return;

    const tabId = tabButton.getAttribute('data-tab');

    // Special handling for gallery tab - toggle the gallery sidebar
    if (tabId === 'gallery') {
      const galleryToggle = document.getElementById('gallery-toggle');
      const galleryContainer = document.getElementById('gallery-container');

      if (galleryToggle && galleryContainer) {
        // Toggle the gallery sidebar
        galleryContainer.classList.toggle('gallery-collapsed');

        // Update the gallery tab button active state and toggle arrow based on gallery visibility
        const isCollapsed =
          galleryContainer.classList.contains('gallery-collapsed');
        if (isCollapsed) {
          tabButton.classList.remove('active');
          // Update toggle button arrow to point left (collapsed state)
          galleryToggle.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>';
        } else {
          tabButton.classList.add('active');
          // Update toggle button arrow to point right (expanded state)
          galleryToggle.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>';
        }
      }
      return; // Don't proceed with normal tab activation
    }

    // Normal tab activation for non-gallery tabs
    // Deactivate all tabs
    this.elements.tabButtons.forEach((btn) => btn.classList.remove('active'));
    this.elements.tabContents.forEach((content) =>
      content.classList.remove('active')
    );

    // Activate the selected tab
    tabButton.classList.add('active');
    const activeContent = document.getElementById(tabId);
    if (activeContent) {
      activeContent.classList.add('active');
    }
  },
  // Show notification
  showNotification: function (message, type = 'error') {
    const notification = this.elements.notification;
    const notificationMessage = this.elements.notificationMessage;
    const notificationIcon = this.elements.notificationIcon;

    // Set message
    notificationMessage.textContent = message;

    // Set color and icon based on type
    if (type === 'success') {
      notification.classList.remove('bg-red-500', 'bg-yellow-500');
      notification.classList.add('bg-green-500');
      notificationIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />`;
    } else if (type === 'warning') {
      notification.classList.remove('bg-red-500', 'bg-green-500');
      notification.classList.add('bg-yellow-500');
      notificationIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />`;
    } else {
      notification.classList.remove('bg-green-500', 'bg-yellow-500');
      notification.classList.add('bg-red-500');
      notificationIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />`;
    }

    // Show notification
    notification.classList.remove('translate-y-20', 'opacity-0');

    // Hide after 5 seconds
    setTimeout(() => {
      notification.classList.add('translate-y-20', 'opacity-0');
    }, 5000);
  },

  // Set Dark Mode state (always dark mode)
  setDarkMode: function (isDark) {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('color-theme', 'dark');
    }
  },

  // Update generate button states based on token availability
  updateGenerateButtonStates: function () {
    const authState = window.authState;
    const hasTokens =
      authState?.isAuthenticated && authState?.tokenProfile?.genToken > 0;

    // Button IDs for all three tabs
    const buttonIds = [
      'generate-btn',
      'inpaint-generate-btn',
      'outpaint-generate-btn'
    ];

    buttonIds.forEach((buttonId) => {
      const button = document.getElementById(buttonId);
      if (!button) return;

      if (hasTokens) {
        button.disabled = false;
        button.classList.remove('opacity-50', 'cursor-not-allowed');
        button.title = '';
      } else {
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');
        if (authState?.isAuthenticated) {
          button.title =
            'You need AI Generation Tokens to generate images. Click the token display in the header to get more.';
        } else {
          button.title = 'Sign in to generate images';
        }
      }
    });
  }
};

export default FluxUI;
