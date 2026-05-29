/**
 * Editor-side adapter around the shared UpgradeModal.
 * Wires up the editor's payment-modal store state, postCheckout chaining,
 * and the Pro-claim refresh that confirms a successful upgrade.
 */
import { useCallback } from 'react';
import UpgradeModal from '@shared/components/UpgradeModal';
import { useAuthContext } from '../contexts/index.js';
import { isUserPro } from '@shared/auth/api/user';
import { auth } from '@shared/services/firebase';
import useStore from '@/store';

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
    returnToPreviousModal();
  };
  const onSuccess = () => {
    setPendingPostCheckoutAction(null);
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
    />
  );
};

export default EditorUpgradeModal;
