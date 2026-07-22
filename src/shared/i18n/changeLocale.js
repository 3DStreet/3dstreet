/**
 * Framework-free locale switch for the shared profile menu.
 *
 * The profile menu renders in the generator and Bollard Buddy, neither of which
 * mounts a react-intl IntlProvider, so switching language here can't go through
 * the editor's Zustand store. Instead it persists the choice exactly the way the
 * editor's language switcher does — the `locale` localStorage key (the single
 * source of truth `getActiveLocale()` reads) plus a locale-changed broadcast so
 * shared components re-render live — and, when a signed-in uid is given, mirrors
 * it onto the user's profile so the preference follows the account across apps
 * and devices (the editor reads it back on sign-in via useProfileLocaleSync).
 *
 * The editor deliberately does NOT use this: its switcher goes through
 * store.setLocale so react-intl re-renders. Both paths converge on the same
 * localStorage key + profile field, so a choice made in any app is honored
 * everywhere.
 */

import posthog from 'posthog-js';
import { saveUserProfile } from '../utils/username';
import { SUPPORTED_LOCALE_CODES } from './locales';
import { notifyLocaleChanged } from './sharedMessages';

const LOCALE_STORAGE_KEY = 'locale';

export function changeLocale(code, { uid } = {}) {
  if (!SUPPORTED_LOCALE_CODES.includes(code)) return;

  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // localStorage unavailable (private mode) — the in-memory broadcast below
    // still updates the current page for this session.
  }

  // Re-render shared components subscribed via useSharedLocale/useSharedMessages.
  notifyLocaleChanged();

  try {
    posthog.capture('locale_changed', { locale: code });
    posthog.register({ locale: code });
  } catch {
    // PostHog may not be initialized in every island — non-fatal.
  }

  if (uid) {
    saveUserProfile(uid, { locale: code }).catch((error) =>
      console.error('Error saving locale to profile:', error)
    );
  }
}

export default changeLocale;
