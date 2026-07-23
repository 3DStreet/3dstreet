/**
 * Reloads the generator when the active language changes.
 *
 * The shared profile-menu language switcher (LanguageSelector → changeLocale)
 * persists the choice to the `locale` localStorage key and broadcasts a
 * locale-changed event. React islands re-render live off that, but the bulk of
 * the generator is vanilla DOM built once at page load — the tab HTML, buttons,
 * placeholders and notifications all read `t()` at build time. Rather than wire
 * every imperative DOM update to a locale subscription, we take the simple,
 * always-correct path: reload the page so the whole app rebuilds in the new
 * locale. A language switch is a rare, deliberate action, and any in-flight
 * generation continues server-side (and can email on completion), so a reload
 * doesn't lose work.
 */

import { getActiveLocale } from '@shared/utils/format';
import { LOCALE_CHANGED_EVENT } from '@shared/i18n/sharedMessages';
import { setChangeLocaleReloads } from '@shared/i18n/changeLocale';

export function installLocaleReload() {
  // Tell the shared LanguageSelector that switching language reloads here, so it
  // confirms before applying (a reload discards the user's in-progress work).
  setChangeLocaleReloads(true);

  let renderedLocale = getActiveLocale();

  const reloadIfChanged = () => {
    if (getActiveLocale() !== renderedLocale) {
      // Pin the value so a duplicate event (same-tab broadcast + storage) can't
      // trigger a second reload mid-navigation.
      renderedLocale = getActiveLocale();
      window.location.reload();
    }
  };

  // Same-tab switch (changeLocale dispatches this) and cross-tab switch (the
  // storage event fires in other tabs when localStorage changes).
  window.addEventListener(LOCALE_CHANGED_EVENT, reloadIfChanged);
  window.addEventListener('storage', reloadIfChanged);
}

export default installLocaleReload;
