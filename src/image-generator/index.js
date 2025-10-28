/**
 * Image Playground Entry Point
 * Imports Firebase auth and initializes all modules
 */

// Import styles
import './styles/styles.css';
import './styles/gallery.css';

// Import Firebase auth
import { auth } from '../editor/services/firebase.js';

// Import auth mount function
import { mountAuthUI, mountTokenDisplay } from './mount-auth.js';
import { mountAppSwitcher } from './mount-app-switcher.js';

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

  // Initialize main UI
  FluxUI.init();

  // Initialize Gallery (async)
  await FluxGallery.init();

  // Initialize tabs
  GeneratorTab.init();
  InpaintTab.init();
  OutpaintTab.init();
});
