/**
 * The editor's host for the shared Settings modal (src/shared/settings):
 * the store's modal and section, toasts, checkout and invitations. Settings
 * is loaded on first open (its own chunk), to keep it out of the editor's
 * main bundle (the bundle budget, rspack.prod.config.js).
 */
import { lazy, Suspense, useCallback } from 'react';
import useStore from '@/store';

const SettingsModal = lazy(() =>
  import('@shared/settings/SettingsModal').then((module) => ({
    default: module.SettingsModal
  }))
);

const notify = (message, type = 'info') => {
  if (type === 'error') STREET.notify.errorMessage(message);
  else if (type === 'success') STREET.notify.successMessage(message);
  else STREET.notify.infoMessage(message);
};

export function EditorSettingsModal() {
  const isOpen = useStore((state) => state.modal === 'settings');
  const section = useStore((state) => state.settingsSection);
  const setSettingsSection = useStore((state) => state.setSettingsSection);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const startCheckout = useStore((state) => state.startCheckout);
  const openInvitation = useStore((state) => state.openInvitation);

  const onClose = useCallback(() => {
    // A #/modal/settings/... link shouldn't reopen Settings on reload.
    if (window.location.hash.startsWith('#/modal/')) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    returnToPreviousModal();
  }, [returnToPreviousModal]);

  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <SettingsModal
        isOpen={isOpen}
        section={section}
        onSectionChange={setSettingsSection}
        onClose={onClose}
        notify={notify}
        onUpgrade={startCheckout}
        onOpenInvitation={openInvitation}
      />
    </Suspense>
  );
}
