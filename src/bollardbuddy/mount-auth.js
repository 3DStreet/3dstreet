/**
 * Mount Auth - Bridges React auth components with vanilla JS
 */

import { createRoot } from 'react-dom/client';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@shared/services/firebase';
import AuthIsland from './auth-island.jsx';

/**
 * Global auth state object accessible to vanilla JS
 */
window.authState = {
  currentUser: null,
  isAuthenticated: false,
  isPro: false,
  tokenProfile: null
};

/**
 * Listen for auth state changes and update global state
 * Dispatches custom events so vanilla JS can react to auth changes
 */
onAuthStateChanged(auth, (user) => {
  window.authState.currentUser = user;
  window.authState.isAuthenticated = !!user;

  // Dispatch custom event for vanilla JS listeners
  window.dispatchEvent(
    new CustomEvent('authStateChanged', {
      detail: {
        user,
        isAuthenticated: !!user
      }
    })
  );

  console.log('Auth state changed:', user ? 'signed in' : 'signed out');
});

/**
 * Mount the React auth island
 * @param {string} elementId - ID of the element to mount to (default: 'auth-root')
 */
export const mountAuthUI = (elementId = 'auth-root') => {
  const authRoot = document.getElementById(elementId);

  if (!authRoot) {
    console.error(
      `Element with id '${elementId}' not found. Cannot mount auth UI.`
    );
    return;
  }

  const root = createRoot(authRoot);
  root.render(<AuthIsland />);
  console.log('Auth UI mounted to', elementId);
};
