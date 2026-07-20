import PropTypes from 'prop-types';
import Modal from '@shared/components/Modal/Modal.jsx';
import styles from './ConfirmModal.module.scss';

/**
 * Themed, in-app replacement for window.confirm. Fully controlled: the caller
 * owns open state and the outcome callbacks, so it works anywhere (editor,
 * generator, shared asset modals) without depending on any app store.
 *
 * @param {boolean}  isOpen       - whether the dialog is shown
 * @param {string}   title        - heading text
 * @param {node}     graphic      - optional visual shown above the message
 * @param {node}     message      - body copy (string or node)
 * @param {string}   confirmLabel - primary button label (default "Confirm")
 * @param {string}   cancelLabel  - secondary button label (default "Cancel")
 * @param {Function} onConfirm    - called when the primary button is clicked
 * @param {Function} onCancel     - called on Cancel / X / click-outside / Esc
 * @param {boolean}  destructive  - style the primary button as destructive
 */
export const ConfirmModal = ({
  isOpen,
  title,
  graphic,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive = false
}) => {
  return (
    <Modal
      className={styles.confirmModal}
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
    >
      <div className={styles.wrapper}>
        {graphic && <div className={styles.graphic}>{graphic}</div>}
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              destructive ? styles.destructiveButton : styles.confirmButton
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};

ConfirmModal.propTypes = {
  isOpen: PropTypes.bool,
  title: PropTypes.string,
  graphic: PropTypes.node,
  message: PropTypes.node,
  confirmLabel: PropTypes.string,
  cancelLabel: PropTypes.string,
  onConfirm: PropTypes.func,
  onCancel: PropTypes.func,
  destructive: PropTypes.bool
};
