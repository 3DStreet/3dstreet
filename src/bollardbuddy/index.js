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

// Expose auth for compatibility with vanilla JS
window.firebaseAuth = auth;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Bollard Buddy React island initializing...');

  // Mount React auth UI
  mountAuthUI();

  console.log('Bollard Buddy React island initialized');
});
