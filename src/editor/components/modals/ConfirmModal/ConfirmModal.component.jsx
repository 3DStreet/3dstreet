import { useIntl } from 'react-intl';
import useStore from '@/store.js';
import { ConfirmModal as SharedConfirmModal } from '@shared/components/ConfirmModal';
import { commonMessages } from '@/editor/i18n/commonMessages';

/**
 * Editor host for the shared ConfirmModal: binds the presentational component
 * to the editor store so any caller can open a themed confirm dialog with
 * useStore.getState().showConfirm({ title, message, onConfirm, ... }) instead
 * of window.confirm. See @shared/components/ConfirmModal for the props.
 */
export const ConfirmModal = () => {
  const intl = useIntl();
  const isOpen = useStore((state) => state.modal === 'confirm');
  const confirmProps = useStore((state) => state.confirmProps);
  const setModal = useStore((state) => state.setModal);

  const close = () => {
    setModal(null);
    useStore.setState({ confirmProps: null });
  };

  const handleCancel = () => {
    confirmProps?.onCancel?.();
    close();
  };

  const handleConfirm = () => {
    confirmProps?.onConfirm?.();
    close();
  };

  if (!isOpen || !confirmProps) return null;

  return (
    <SharedConfirmModal
      isOpen={isOpen}
      title={confirmProps.title}
      graphic={confirmProps.graphic}
      message={confirmProps.message}
      confirmLabel={
        confirmProps.confirmLabel ??
        intl.formatMessage({
          id: 'confirmModal.confirm',
          defaultMessage: 'Confirm'
        })
      }
      cancelLabel={
        confirmProps.cancelLabel ?? intl.formatMessage(commonMessages.cancel)
      }
      destructive={confirmProps.destructive}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
};
