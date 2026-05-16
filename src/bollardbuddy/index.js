/**
 * Bollard Buddy - React island entry point
 * Handles auth UI mounting for the AR street furniture placement app
 */

// Import Tailwind CSS (bundled via webpack)
import '../styles/tailwind.css';
// Import modal styles for auth components
import './styles.css';

import { auth } from '@shared/services/firebase.js';
import { mountAuthUI } from './mount-auth.jsx';
import { mountAssets } from './mount-assets.js';
import { mountAppSwitcher } from './mount-app-switcher.jsx';

// Expose auth for compatibility with vanilla JS
window.firebaseAuth = auth;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Bollard Buddy React island initializing...');

  // Mount React app switcher
  mountAppSwitcher();

  // Mount React auth UI
  mountAuthUI();

  // Mount React Assets sidebar
  await mountAssets();

  console.log('Bollard Buddy React island initialized');
});
