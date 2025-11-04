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
import './styles/gallery.css';

// Import Firebase auth
import { auth } from '@shared/services/firebase.js';

// Import auth mount function
import { mountAuthUI, mountTokenDisplay } from './mount-auth.js';
import { mountAppSwitcher } from './mount-app-switcher.js';
import { mountPurchaseModal } from './mount-purchase-modal.js';

// Import all modules
import FluxUI from './main.js';
import FluxGallery from './gallery.js';
import GeneratorTab from './generator.js';
import InpaintTab from './inpaint.js';
import OutpaintTab from './outpaint.js';

// Expose auth for compatibility
window.firebaseAuth = auth;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
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

  // Initialize Gallery (async)
  await FluxGallery.init();

  // Initialize tabs
  GeneratorTab.init();
  InpaintTab.init();
  OutpaintTab.init();

  // Hide loading screen once everything is initialized
  // Use requestAnimationFrame to ensure styles are applied
  requestAnimationFrame(() => {
    document.body.classList.add('loaded');
  });
});
