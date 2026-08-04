/**
 * Editor-side adapter around the shared BuyTokensModal (#1374).
 *
 * Opened via useStore.startBuyTokens() when a paid (Pro/Max) user hits a
 * gen-token shortfall — e.g. capture & render with an exhausted balance —
 * or routed from EditorUpgradeModal.onAlreadyPro when a token paywall finds
 * the user already paid. Purchase verification (token-bump poll +
 * tokenCountChanged broadcast, which AuthProvider listens to) lives in the
 * shared modal; this adapter only wires the editor's modal store.
 */
import BuyTokensModal from '@shared/components/BuyTokensModal';
import useStore from '@/store';

const EditorBuyTokensModal = () => {
  const modal = useStore((state) => state.modal);
  const setModal = useStore((state) => state.setModal);
  const buyTokensSource = useStore((state) => state.buyTokensSource);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );

  return (
    <BuyTokensModal
      isOpen={modal === 'buy-tokens'}
      // Close and success both land back at the trigger modal (e.g. the
      // screenshot modal) — same routing as EditorUpgradeModal.
      onClose={returnToPreviousModal}
      onSuccess={returnToPreviousModal}
      source={buyTokensSource || 'editor'}
      onSignIn={() => setModal('signin', true)}
      // Free user landed here (e.g. plan lapsed mid-flow) — send them to the
      // upgrade paywall. Plain setModal keeps previousModal intact so closing
      // the paywall still returns to the modal that triggered the shortfall.
      onUpgradeInstead={() => setModal('payment')}
    />
  );
};

export default EditorBuyTokensModal;
