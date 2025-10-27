/**
 * Mount Auth - Renders React auth island and exposes auth state to vanilla JS
 */

import { createRoot } from 'react-dom/client';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../editor/services/firebase';
import AuthIsland from './auth-island.jsx';
import TokenDisplay from './components/TokenDisplay.jsx';

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
  console.log('Auth state changed:', user ? user.email : 'Not signed in');

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

  console.log('Auth UI mounted successfully');
};

/**
 * Mount the Token Display component
 * @param {string} elementId - ID of the element to mount to (default: 'token-display-root')
 */
export const mountTokenDisplay = (elementId = 'token-display-root') => {
  const tokenDisplayRoot = document.getElementById(elementId);

  if (!tokenDisplayRoot) {
    console.error(
      `Element with id '${elementId}' not found. Cannot mount token display.`
    );
    return;
  }

  const root = createRoot(tokenDisplayRoot);
  root.render(<TokenDisplay />);

  console.log('Token Display mounted successfully');
};

export default mountAuthUI;
