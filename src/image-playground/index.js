/**
 * Image Playground Entry Point
 * Imports Firebase auth and initializes all modules
 */

// Import styles
import './styles/styles.css';
import './styles/gallery.css';

// Import Firebase auth (available for future use)
import { auth } from '../editor/services/firebase.js';

// Import all modules
import FluxUI from './main.js';
import FluxGallery from './gallery.js';
import GeneratorTab from './generator.js';
import InpaintTab from './inpaint.js';
import OutpaintTab from './outpaint.js';

// Also expose auth for potential future use
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
  console.log('Initializing Image Playground');

  // Initialize main UI
  FluxUI.init();

  // Initialize Gallery (async)
  await FluxGallery.init();

  // Initialize tabs
  GeneratorTab.init();
  InpaintTab.init();
  OutpaintTab.init();

  console.log('Image Playground initialized');
});
