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
import { mountAuthUI } from './mount-auth.js';

// Import all modules
import FluxUI from './main.js';
import FluxGallery from './gallery.js';
import GeneratorTab from './generator.js';
import InpaintTab from './inpaint.js';
import OutpaintTab from './outpaint.js';

// Expose auth for compatibility
window.firebaseAuth = auth;

// TEST: Verify Firebase auth integration
console.log('=== IMAGE PLAYGROUND FIREBASE AUTH TEST ===');
console.log('✓ Firebase auth imported:', !!auth);
console.log('✓ Firebase auth type:', auth?.constructor?.name || 'undefined');
console.log(
  '✓ Firebase auth available on window.firebaseAuth:',
  !!window.firebaseAuth
);
console.log('Current user:', auth?.currentUser?.email || 'Not signed in');
console.log('===========================================');

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing Image Generator');

  // Mount React auth UI first
  mountAuthUI();

  // Initialize main UI
  FluxUI.init();

  // Initialize Gallery (async)
  await FluxGallery.init();

  // Initialize tabs
  GeneratorTab.init();
  InpaintTab.init();
  OutpaintTab.init();

  console.log('Image Generator initialized');
});
