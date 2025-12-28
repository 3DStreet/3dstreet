/**
 * Placemark Islands - React island entry point
 * Handles auth UI, app switcher, and gallery mounting for Placemark Play
 */

// Import Tailwind CSS (bundled via webpack)
import '../styles/tailwind.css';
// Import modal styles for auth components
import './styles.css';

import { auth } from '@shared/services/firebase.js';
import { mountAuthUI } from './mount-auth.js';
import { mountGallery } from './mount-gallery.js';
import { mountAppSwitcher } from './mount-app-switcher.js';

// Expose auth for compatibility with vanilla JS
window.firebaseAuth = auth;

/**
 * Wait for an element to exist in the DOM
 * @param {string} selector - CSS selector
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<Element>}
 */
const waitForElement = (selector, timeout = 10000) => {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      return resolve(element);
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
};

/**
 * Initialize all islands once mount points are available
 */
const initializeIslands = async () => {
  console.log('Placemark Islands initializing...');

  try {
    // Wait for mount points to be rendered by Placemark's React app
    await Promise.all([
      waitForElement('#app-switcher-root'),
      waitForElement('#auth-root')
    ]);

    // Mount React app switcher
    mountAppSwitcher();

    // Mount React auth UI
    mountAuthUI();

    // Mount React gallery UI and expose bridge API
    await mountGallery();

    console.log('Placemark Islands initialized');
  } catch (error) {
    console.error('Failed to initialize Placemark Islands:', error);
  }
};

// Initialize when DOM is ready, then wait for React mount points
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeIslands);
} else {
  initializeIslands();
}
