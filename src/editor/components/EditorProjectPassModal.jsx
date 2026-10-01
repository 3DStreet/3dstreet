/**
 * Editor-side adapter around the shared ProjectPassModal (#1922).
 *
 * Opened by the `#project-pass` deep link (store.firstModal). Signed-out
 * visitors go through sign-in first: setModal('signin', true) remembers this
 * modal, so completing sign-in lands them back here, ready to check out.
 * The optional `src` tag (`#project-pass?src=winback`) is captured once at
 * mount and forwarded to checkout metadata + analytics as `source`.
 */
import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import ProjectPassModal from '@shared/components/ProjectPassModal';
import { getProjectPassSource } from '../../tested/project-pass-link.js';
import useStore from '@/store';

const EditorProjectPassModal = () => {
  const modal = useStore((state) => state.modal);
  const setModal = useStore((state) => state.setModal);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const [source] = useState(
    () => getProjectPassSource(window.location.hash) || 'direct_link'
  );
  const isOpen = modal === 'project-pass';

  useEffect(() => {
    if (!isOpen) return;
    posthog.capture('modal_opened', {
      modal: 'project-pass',
      product: 'pro-pass',
      source
    });
  }, [isOpen, source]);

  return (
    <ProjectPassModal
      isOpen={isOpen}
      onClose={returnToPreviousModal}
      source={source}
      onSignIn={() => setModal('signin', true)}
    />
  );
};

export default EditorProjectPassModal;
