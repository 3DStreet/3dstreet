/**
 * Mount the shared UpgradeModal + BuyTokensModal for the generator.
 * Generator-specific bits (token-bump verification, generator store hookup)
 * are wired here; the modal UIs themselves live in @shared/components.
 */
import { useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthContext } from '../editor/contexts';
import UpgradeModal from '@shared/components/UpgradeModal';
import BuyTokensModal from '@shared/components/BuyTokensModal';
import { getTokenProfile } from '@shared/utils/tokens';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import useImageGenStore from './store.js';

const GeneratorUpgradeModal = () => {
  const { modal, setModal } = useImageGenStore();
  const { currentUser, tokenProfile } = useAuthContext();
  const t = useSharedMessages();
  // Snapshot of genToken at the moment the user clicked subscribe; the
  // webhook will bump this once payment lands, which is what we poll for.
  const initialTokenCount = useRef(0);

  const handleCheckoutStart = useCallback(() => {
    initialTokenCount.current = tokenProfile?.genToken || 0;
  }, [tokenProfile]);

  const verifyPurchase = useCallback(async () => {
    if (!currentUser?.uid) return false;
    const fresh = await getTokenProfile(currentUser.uid);
    const current = fresh?.genToken || 0;
    if (current > initialTokenCount.current) {
      // Refresh other components (TokenDisplay, etc.).
      window.dispatchEvent(new Event('tokenCountChanged'));
      return true;
    }
    return false;
  }, [currentUser]);

  // The modal is only opened on a token shortfall (gen_token_limit). For an
  // already-Pro/Max user that means they're out of tokens, not that they need
  // to upgrade — route them to the one-time token pack purchase (#1374)
  // instead of a dead-end toast.
  const onAlreadyPro = useCallback(() => {
    setModal('buy-tokens');
  }, [setModal]);

  return (
    <UpgradeModal
      isOpen={modal === 'purchase'}
      onClose={() => setModal(null)}
      source="generator"
      trigger="gen_token_limit"
      onAlreadyPro={onAlreadyPro}
      onCheckoutStart={handleCheckoutStart}
      // rememberPrevious=true so closing/completing sign-in lands the user
      // back in the upgrade modal where they started.
      onSignIn={() => setModal('signin', true)}
      verifyPurchase={verifyPurchase}
      successTitle={t('welcomeToPro')}
      successMessage={t('genTokensReady')}
      successCta={t('startGenerating')}
    />
  );
};

// One-time token pack purchases (#1374). Reached via UpgradeModal's
// onAlreadyPro routing above — an out-of-tokens Pro/Max user lands here. The
// modal handles verification internally (token-bump poll + tokenCountChanged
// broadcast), so only the store hookup lives in this adapter.
const GeneratorBuyTokensModal = () => {
  const { modal, setModal } = useImageGenStore();

  return (
    <BuyTokensModal
      isOpen={modal === 'buy-tokens'}
      onClose={() => setModal(null)}
      source="generator"
      onSignIn={() => setModal('signin', true)}
      // Free user somehow landed here — send them to the upgrade flow.
      onUpgradeInstead={() => setModal('purchase')}
    />
  );
};

export const mountPurchaseModal = () => {
  let modalRoot = document.getElementById('purchase-modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'purchase-modal-root';
    document.body.appendChild(modalRoot);
  }

  const root = createRoot(modalRoot);
  root.render(
    <AuthProvider>
      <GeneratorUpgradeModal />
      <GeneratorBuyTokensModal />
    </AuthProvider>
  );

  window.addEventListener('openPurchaseModal', () => {
    useImageGenStore.getState().setModal('purchase');
  });
};

export default mountPurchaseModal;
