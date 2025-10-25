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
    init: function() {
        console.log('Initializing Flux Image Generator UI');
        
        // Get common elements
        this.elements = {
            tabButtons: document.querySelectorAll('.tab-button'),
            tabContents: document.querySelectorAll('.tab-content'),
            notification: document.getElementById('notification'),
            notificationMessage: document.getElementById('notification-message'),
            notificationIcon: document.getElementById('notification-icon'),
            darkModeToggle: document.getElementById('dark-mode-toggle'),
            themeToggleLightIcon: document.getElementById('theme-toggle-light-icon'),
            themeToggleDarkIcon: document.getElementById('theme-toggle-dark-icon')
        };
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize the first tab (needed for navigation only)
        this.activateTab(document.querySelector('.tab-button.active') || this.elements.tabButtons[0]);
        
        
        // Initialize dark mode based on localStorage
        this.initializeDarkMode();
        
        console.log('Main UI initialized');
    },
    
    // Set up event listeners for common elements
    setupEventListeners: function() {
        // Tab button clicks
        this.elements.tabButtons.forEach(button => {
            button.addEventListener('click', () => this.activateTab(button));
        });

        // Dark mode toggle
        this.elements.darkModeToggle.addEventListener('click', this.toggleDarkMode.bind(this));
    },
    
    // Activate a tab
    activateTab: function(tabButton) {
        if (!tabButton) return;

        const tabId = tabButton.getAttribute('data-tab');
        console.log(`Activating tab: ${tabId}`);

        // Deactivate all tabs
        this.elements.tabButtons.forEach(btn => btn.classList.remove('active'));
        this.elements.tabContents.forEach(content => content.classList.remove('active'));

        // Activate the selected tab
        tabButton.classList.add('active');
        const activeContent = document.getElementById(tabId);
        if (activeContent) {
            activeContent.classList.add('active');
        }
    },
    // Show notification
    showNotification: function(message, type = 'error') {
        console.log(`Notification (${type}): ${message}`);
        
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

    // Initialize Dark Mode
    initializeDarkMode: function() {
        if (localStorage.getItem('color-theme') === 'dark' ||
            (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            this.setDarkMode(true);
        } else {
            this.setDarkMode(false);
        }
    },

    // Toggle Dark Mode
    toggleDarkMode: function() {
        const isDark = document.documentElement.classList.contains('dark');
        this.setDarkMode(!isDark);
    },

    // Set Dark Mode state
    setDarkMode: function(isDark) {
        if (isDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('color-theme', 'dark');
            this.elements.themeToggleLightIcon.classList.remove('hidden');
            this.elements.themeToggleDarkIcon.classList.add('hidden');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('color-theme', 'light');
            this.elements.themeToggleLightIcon.classList.add('hidden');
            this.elements.themeToggleDarkIcon.classList.remove('hidden');
        }
        // Add/remove dark class from body as well if needed for specific styles
        // document.body.classList.toggle('dark', isDark);
    }
};

// Make FluxUI globally available first
window.FluxUI = FluxUI;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    FluxUI.init();
    console.log('Main FluxUI module loaded and initialized');
});