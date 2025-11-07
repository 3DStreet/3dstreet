/**
 * Mount AppSwitcher - Renders the app switcher component
 */

import { createRoot } from 'react-dom/client';
import { AppSwitcher } from '@shared/navigation/components';

/**
 * Mount the AppSwitcher component
 * @param {string} elementId - ID of the element to mount to (default: 'app-switcher-root')
 */
export const mountAppSwitcher = (elementId = 'app-switcher-root') => {
  const appSwitcherRoot = document.getElementById(elementId);

  if (!appSwitcherRoot) {
    console.error(
      `Element with id '${elementId}' not found. Cannot mount AppSwitcher.`
    );
    return;
  }

  const root = createRoot(appSwitcherRoot);
  root.render(<AppSwitcher />);
};

export default mountAppSwitcher;
