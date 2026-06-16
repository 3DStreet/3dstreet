/**
 * Editor-side adapter around the shared UpgradeModal.
 * Wires up the editor's payment-modal store state, postCheckout chaining,
 * and the Pro-claim refresh that confirms a successful upgrade.
 */
import { useCallback, useState } from 'react';
import UpgradeModal from '@shared/components/UpgradeModal';
import { useAuthContext } from '../contexts/index.js';
import { isUserPro } from '@shared/auth/api/user';
import { auth } from '@shared/services/firebase';
import useStore from '@/store';

// Maps a payment deep-link hash to a tier + billing cycle. e.g.
// #payment-max-annual → { initialTier: 'max', initialCycle: 'yearly' }.
// Only payment hashes are parsed; any other hash (scene ids, etc.) yields the
// neutral default, so in-app paywall triggers open the normal selection flow.
const parsePaymentHash = (hash = '') => {
  const h = hash.toLowerCase();
  if (!h.includes('payment')) {
    return { initialTier: null, initialCycle: 'monthly' };
  }
  const initialTier = h.includes('max')
    ? 'max'
    : h.includes('pro')
      ? 'pro'
      : null;
  const initialCycle =
    h.includes('annual') || h.includes('yearly') ? 'yearly' : 'monthly';
  return { initialTier, initialCycle };
};

const EditorUpgradeModal = () => {
  const { currentUser, setCurrentUser } = useAuthContext();
  const modal = useStore((state) => state.modal);
  const setModal = useStore((state) => state.setModal);
  const postCheckout = useStore((state) => state.postCheckout);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const pendingPostCheckoutAction = useStore(
    (state) => state.pendingPostCheckoutAction
  );
  const setPendingPostCheckoutAction = useStore(
    (state) => state.setPendingPostCheckoutAction
  );

  // Capture the activation deep link once at mount (app load). Consumed on
  // close/success so it can't reapply to a later in-app paywall (geo, watermark)
  // opened in the same session without a reload.
  const [deepLink, setDeepLink] = useState(() =>
    parsePaymentHash(window.location.hash)
  );
  const consumeDeepLink = () =>
    setDeepLink({ initialTier: null, initialCycle: 'monthly' });

  // Force a token refresh and re-check Pro status. Returns true once the
  // webhook flips the plan claim — keeps polling open until then so a
  // delayed webhook lands in the "still finalizing" state, not fake success.
  // Note: AuthContext's currentUser is a plain spread of the Firebase user,
  // so prototype methods like getIdToken aren't on it — use auth.currentUser.
  const verifyPurchase = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !currentUser) return false;
    try {
      await firebaseUser.getIdToken(true);
      const status = await isUserPro(firebaseUser);
      if (status?.isPro) {
        setCurrentUser({
          ...currentUser,
          isPro: true,
          isProTeam: status.isProTeam,
          teamDomain: status.teamDomain
        });
        // Tell plan-dependent panels (assets storage meter, etc.) to refetch.
        window.dispatchEvent(new Event('planChanged'));
        return true;
      }
    } catch (error) {
      console.error('Error verifying Pro status:', error);
    }
    return false;
  }, [currentUser, setCurrentUser]);

  // Both close and success route through previousModal — set by
  // startCheckout — so bailing out OR completing payment lands the user
  // back at the modal that triggered the paywall (e.g. geo). Falls through
  // to modal=null when there's no previous (manual /upgrade entry, or the
  // signin chain consumed previousModal).
  // Any pendingPostCheckoutAction is dropped here: the user dismissed
  // without choosing the soft-decline path, so we don't run their original
  // action automatically (e.g. they X'd out of the watermark paywall —
  // they'll click Download again, and the session flag lets it through).
  const onClose = () => {
    setPendingPostCheckoutAction(null);
    consumeDeepLink();
    returnToPreviousModal();
  };
  const onSuccess = () => {
    setPendingPostCheckoutAction(null);
    consumeDeepLink();
    returnToPreviousModal();
  };
  // Soft-decline path. Runs the trigger site's original action (e.g. the
  // watermarked download) so users only need one click to continue free.
  // Only wired up when a trigger site queued a pendingPostCheckoutAction —
  // pure upsell triggers (e.g. the inline "Upgrade to Pro to hide watermark"
  // button) leave it null, which suppresses the secondary CTA in the modal
  // since "Download now with watermark" makes no sense without a download
  // intent.
  const onSecondaryCta = pendingPostCheckoutAction
    ? () => {
        pendingPostCheckoutAction();
        setPendingPostCheckoutAction(null);
        returnToPreviousModal();
      }
    : undefined;

  // Fired when the modal opens (or returns from sign-in) and finds the user
  // is already Pro. The paywall-gated action (e.g. GLB export) was dropped
  // when they hit the paywall, so we can't auto-resume it — just dismiss
  // the modal and toast a hint to retry. Match the close routing so a
  // previous modal (geo, screenshot) is restored if there was one.
  const onAlreadyPro = () => {
    STREET.notify.successMessage(
      "You're already a Pro member — try that action again to continue."
    );
    returnToPreviousModal();
  };

  return (
    <UpgradeModal
      isOpen={modal === 'payment'}
      onClose={onClose}
      source={postCheckout || 'editor'}
      trigger={postCheckout ? `${postCheckout}_paywall` : 'manual'}
      surface={postCheckout}
      verifyPurchase={verifyPurchase}
      // rememberPrevious=true so closing/completing sign-in lands the user
      // back in the upgrade modal where they started.
      onSignIn={() => setModal('signin', true)}
      onSecondaryCta={onSecondaryCta}
      onAlreadyPro={onAlreadyPro}
      onSuccess={onSuccess}
      initialTier={deepLink.initialTier}
      initialCycle={deepLink.initialCycle}
    />
  );
};

export default EditorUpgradeModal;
