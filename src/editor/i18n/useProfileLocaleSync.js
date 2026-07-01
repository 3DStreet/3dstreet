import { useEffect } from 'react';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { getUserProfile, saveUserProfile } from '@shared/utils/username';
import { SUPPORTED_LOCALE_CODES } from './config';

/**
 * Keeps the UI locale in sync with the signed-in user's stored preference
 * (#656). On sign-in:
 *   - if the profile has a saved locale, apply it (so the choice follows the
 *     user across devices);
 *   - otherwise, if the current session is on a non-default locale (picked
 *     while anonymous), persist that up to the profile.
 *
 * The profile field lives on `socialProfile/{uid}.locale`, which the backend
 * can also read (Admin SDK) to localize transactional emails.
 */
export function useProfileLocaleSync() {
  const { currentUser } = useAuthContext();
  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await getUserProfile(uid);
        if (cancelled) return;

        const stored = profile?.locale;
        if (stored && SUPPORTED_LOCALE_CODES.includes(stored)) {
          useStore.getState().hydrateLocale(stored);
          return;
        }

        // No profile preference yet — persist the user's explicit choice so it
        // follows the account. localStorage 'locale' is only written on an
        // explicit pick (or a prior sync), never by auto-detection, so its
        // presence is the "explicit choice" signal — including an explicit pick
        // of English (which `current !== 'en'` would have missed).
        let explicit = null;
        try {
          explicit = localStorage.getItem('locale');
        } catch {
          // localStorage unavailable
        }
        if (explicit && SUPPORTED_LOCALE_CODES.includes(explicit)) {
          await saveUserProfile(uid, { locale: explicit });
        }
      } catch (error) {
        console.error('Error syncing locale from profile:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);
}
