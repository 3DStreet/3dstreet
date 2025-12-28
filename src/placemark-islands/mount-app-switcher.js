/**
 * Mount AppSwitcher React component as an island in Placemark
 */
import { createRoot } from 'react-dom/client';
import { AppSwitcher } from '@shared/navigation/components';

export const mountAppSwitcher = () => {
  const container = document.getElementById('app-switcher-root');
  if (!container) {
    console.warn('AppSwitcher mount point not found');
    return;
  }

  const root = createRoot(container);
  root.render(<AppSwitcher currentApp="placemark" />);
  console.log('AppSwitcher mounted');
};
