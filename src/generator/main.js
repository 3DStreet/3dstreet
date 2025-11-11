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
      if (galleryToggle) {
        // Trigger the React component's toggle button
        galleryToggle.click();
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
    // Check if elements are initialized
    if (!this.elements) {
      console.error(
        'FluxUI not initialized, cannot show notification:',
        message
      );
      return;
    }

    const notification = this.elements.notification;
    const notificationMessage = this.elements.notificationMessage;
    const notificationIcon = this.elements.notificationIcon;

    // Check if notification elements exist
    if (!notification || !notificationMessage || !notificationIcon) {
      console.error(
        'Notification elements not found, cannot show notification:',
        message
      );
      return;
    }

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

    // Button IDs for all tabs
    const buttonIds = [
      'generate-btn',
      'inpaint-generate-btn',
      'outpaint-generate-btn',
      'video-generate-btn'
    ];

    buttonIds.forEach((buttonId) => {
      const button = document.getElementById(buttonId);
      if (!button) return;

      // Remove any existing tooltip
      const existingWrapper = button.querySelector('.token-tooltip-wrapper');
      if (existingWrapper) {
        existingWrapper.remove();
      }

      // Don't disable the button - let click handlers show purchase modal
      // Just update visual state to indicate low/no tokens
      if (hasTokens) {
        button.classList.remove('token-tooltip-trigger');
        button.style.cursor = '';
        button.style.position = '';
        button.style.filter = '';
      } else {
        button.classList.add('token-tooltip-trigger');
        button.style.cursor = 'pointer';
        button.style.position = 'relative';
        button.style.filter = 'brightness(0.7)';

        // Add Radix-style tooltip overlay for authenticated users with no tokens
        if (authState?.isAuthenticated) {
          const tooltipWrapper = document.createElement('div');
          tooltipWrapper.className = 'token-tooltip-wrapper';
          tooltipWrapper.innerHTML = `
            <div class="token-tooltip">
              <div class="token-tooltip-content">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" class="token-tooltip-icon">
                  <path d="M8.4449 0.608765C8.0183 -0.107015 6.9817 -0.107015 6.55509 0.608766L0.161178 11.3368C-0.275824 12.07 0.252503 13 1.10608 13H13.8939C14.7475 13 15.2758 12.07 14.8388 11.3368L8.4449 0.608765ZM7.4141 1.12073C7.45288 1.05566 7.54712 1.05566 7.5859 1.12073L13.9798 11.8488C14.0196 11.9154 13.9715 12 13.8939 12H1.10608C1.02849 12 0.980454 11.9154 1.02018 11.8488L7.4141 1.12073ZM6.8269 4.48611C6.81221 4.10423 7.11783 3.78663 7.5 3.78663C7.88217 3.78663 8.18778 4.10423 8.1731 4.48612L8.01921 8.48701C8.00848 8.76305 7.7792 8.98664 7.5 8.98664C7.2208 8.98664 6.99151 8.76305 6.98078 8.48701L6.8269 4.48611ZM8.24989 10.476C8.24989 10.8902 7.9141 11.226 7.49989 11.226C7.08567 11.226 6.74989 10.8902 6.74989 10.476C6.74989 10.0618 7.08567 9.72599 7.49989 9.72599C7.9141 9.72599 8.24989 10.0618 8.24989 10.476Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path>
                </svg>
                You are out of AI Generation Tokens. Click to purchase more.
              </div>
              <div class="token-tooltip-arrow"></div>
            </div>
          `;

          button.appendChild(tooltipWrapper);
        }
      }
    });
  }
};

export default FluxUI;
