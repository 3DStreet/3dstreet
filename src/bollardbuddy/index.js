/**
 * Bollard Buddy - React island entry point
 * Handles auth UI mounting for the AR street furniture placement app
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

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Bollard Buddy React island initializing...');

  // Mount React app switcher
  mountAppSwitcher();

  // Mount React auth UI
  mountAuthUI();

  // Mount React gallery UI
  await mountGallery();

  console.log('Bollard Buddy React island initialized');
});
