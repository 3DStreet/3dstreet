/**
 * Image Playground Entry Point
 * Imports Firebase auth and initializes all modules
 */

// Import Sentry for error tracking
import '../editor/instrument.js';

// Import Tailwind CSS (bundled via webpack instead of CDN)
import '../styles/tailwind.css';

// Import styles
import './styles/styles.css';

// Import PostHog analytics initializer
import { initPostHog } from '@shared/analytics/posthog';

// Import Firebase auth
import { auth } from '@shared/services/firebase.js';

// Import i18n helpers (framework-free — the generator has no IntlProvider)
import { applyStaticTranslations } from './i18n/static-i18n.js';
import { installLocaleReload } from './i18n/locale-reload.js';

// Import auth mount function
import { mountAuthUI, mountTokenDisplay } from './mount-auth.jsx';
import { mountAppSwitcher } from './mount-app-switcher.jsx';
import { mountPurchaseModal } from './mount-purchase-modal.jsx';
import { mountAssets } from './mount-assets.js';

// Import all modules
import FluxUI from './main.js';
import ImageTab from './image.js';
import VideoTab from './video.js';
import SplatTab from './splat.js';
import Model3DTab from './model3d.js';

// Initialize PostHog so capture() calls in handlers/effects below are not no-ops
initPostHog();

// Expose auth for compatibility
window.firebaseAuth = auth;

// Reload the page when the language changes (from the shared profile-menu
// switcher). The generator's vanilla DOM is built once at load, so a full
// reload is the simplest correct way to re-render everything in the new locale.
installLocaleReload();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  // Translate the static header/tab markup before anything is shown.
  applyStaticTranslations();

  // Mount AppSwitcher
  mountAppSwitcher();

  // Mount React auth UI first
  mountAuthUI();

  // Mount token display
  mountTokenDisplay();

  // Mount purchase modal
  mountPurchaseModal();

  // Initialize main UI
  FluxUI.init();

  // Mount Assets sidebar (React component)
  await mountAssets();

  // Initialize tabs
  ImageTab.init();
  VideoTab.init();
  SplatTab.init();
  Model3DTab.init();

  // Hide loading screen once everything is initialized
  // Use requestAnimationFrame to ensure styles are applied
  requestAnimationFrame(() => {
    document.body.classList.add('loaded');
  });
});
