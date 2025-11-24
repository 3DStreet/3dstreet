/**
 * Image Playground Entry Point
 * Imports Firebase auth and initializes all modules
 */

// Import Sentry for error tracking
import '../editor/instrument.js';

// Import Tailwind CSS (bundled via webpack instead of CDN)
import '../styles/tailwind.css';

// Import styles
import './styles/styles.css';

// Import Firebase auth
import { auth } from '@shared/services/firebase.js';

// Import auth mount function
import { mountAuthUI, mountTokenDisplay } from './mount-auth.js';
import { mountAppSwitcher } from './mount-app-switcher.js';
import { mountPurchaseModal } from './mount-purchase-modal.js';
import { mountGallery } from './mount-gallery.js';

// Import all modules
import FluxUI from './main.js';
import ModifyTab from './modify.js';
import CreateTab from './create.js';
import InpaintTab from './inpaint.js';
import OutpaintTab from './outpaint.js';
import VideoTab from './video.js';

// Import debug tools (temporary - for debugging gallery migration)
import debugGallery from '@shared/gallery/utils/debugGallery.js';

// Expose auth for compatibility
window.firebaseAuth = auth;

/**
 * Register Service Worker for gallery image caching
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log(
        'Service Worker registered successfully:',
        registration.scope
      );

      // Wait for SW to be active
      if (registration.active) {
        console.log('Service Worker is active');
      } else {
        // Wait for activation
        await new Promise((resolve) => {
          if (registration.installing) {
            registration.installing.addEventListener('statechange', (e) => {
              if (e.target.state === 'activated') {
                resolve();
              }
            });
          } else if (registration.waiting) {
            registration.waiting.addEventListener('statechange', (e) => {
              if (e.target.state === 'activated') {
                resolve();
              }
            });
          } else {
            resolve();
          }
        });
        console.log('Service Worker activated');
      }
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  } else {
    console.warn('Service Workers not supported in this browser');
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker first (non-blocking)
  registerServiceWorker().catch((err) => {
    console.warn('Service Worker registration error:', err);
  });

  // Mount AppSwitcher
  mountAppSwitcher();

  // Mount React auth UI first
  mountAuthUI();

  // Mount token display
  mountTokenDisplay();

  // Mount purchase modal
  mountPurchaseModal();

  // Initialize main UI
  FluxUI.init();

  // Mount Gallery (React component)
  await mountGallery();

  // Initialize tabs
  ModifyTab.init();
  CreateTab.init();
  InpaintTab.init();
  OutpaintTab.init();
  VideoTab.init();

  // Hide loading screen once everything is initialized
  // Use requestAnimationFrame to ensure styles are applied
  requestAnimationFrame(() => {
    document.body.classList.add('loaded');
  });

  // Debug: Check gallery data after initialization (temporary)
  setTimeout(async () => {
    const user = auth.currentUser;
    if (user) {
      console.log('🔍 Running gallery debug check...');
      await debugGallery.fullDebugReport(user.uid);
    } else {
      console.log('⚠️ No user logged in. V2 gallery requires authentication.');
    }
  }, 2000); // Wait 2 seconds for everything to initialize
});
