/**
 * Editor-side adapter around the shared RedeemPassModal (#1922 follow-up).
 *
 * Opened by the `#redeem?code=CODE` deep link (store.firstModal). Signed-out
 * visitors sign in first: setModal('signin', true) remembers this modal, so
 * completing sign-in lands them back here with the code still filled in.
 */
import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import { RedeemPassModal } from '@shared/components/ProjectPassModal';
import { getRedeemCode } from '../../tested/project-pass-link.js';
import useStore from '@/store';

const EditorRedeemPassModal = () => {
  const modal = useStore((state) => state.modal);
  const setModal = useStore((state) => state.setModal);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const [initialCode] = useState(() => getRedeemCode(window.location.hash));
  const isOpen = modal === 'redeem-pass';

  useEffect(() => {
    if (!isOpen) return;
    posthog.capture('modal_opened', {
      modal: 'redeem-pass',
      product: 'pro-pass',
      source: 'pass-code'
    });
  }, [isOpen]);

  return (
    <RedeemPassModal
      isOpen={isOpen}
      onClose={returnToPreviousModal}
      initialCode={initialCode}
      onSignIn={() => setModal('signin', true)}
    />
  );
};

export default EditorRedeemPassModal;
