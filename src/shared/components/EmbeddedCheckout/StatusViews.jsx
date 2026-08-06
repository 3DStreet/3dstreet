/**
 * Post-payment status views rendered by EmbeddedCheckout.
 * Extracted as named components so each can be storied / tested in isolation
 * without driving the full Stripe state machine.
 */
import PropTypes from 'prop-types';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import styles from './EmbeddedCheckout.module.scss';

const SuccessIcon = () => (
  <div className={styles.successIcon}>
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  </div>
);

const ErrorIcon = () => (
  <div className={styles.errorIcon}>
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  </div>
);

export const LoadingView = () => {
  const t = useSharedMessages();
  return (
    <div className={styles.statusContainer}>
      <div className={styles.spinner}></div>
      <p>{t('processingPayment')}</p>
      <p className={styles.subtext}>{t('processingPaymentHint')}</p>
    </div>
  );
};

export const SuccessView = ({ title, message, ctaLabel, onCta }) => (
  <div className={styles.statusContainer}>
    <SuccessIcon />
    <h3>{title}</h3>
    <p>{message}</p>
    <button
      className={`${styles.actionButton} ${styles.success}`}
      onClick={onCta}
    >
      {ctaLabel}
    </button>
  </div>
);

SuccessView.propTypes = {
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  ctaLabel: PropTypes.string.isRequired,
  onCta: PropTypes.func
};

// Webhook didn't land within the polling window. Don't claim success — say
// the payment is being finalized so the user knows to expect the email.
export const PendingView = ({ onClose }) => {
  const t = useSharedMessages();
  return (
    <div className={styles.statusContainer}>
      <SuccessIcon />
      <h3>{t('almostThere')}</h3>
      <p>{t('paymentFinalizing')}</p>
      <button className={styles.actionButton} onClick={onClose}>
        {t('close')}
      </button>
    </div>
  );
};

PendingView.propTypes = {
  onClose: PropTypes.func
};

export const ErrorView = ({ message, onClose }) => {
  const t = useSharedMessages();
  return (
    <div className={styles.statusContainer}>
      <ErrorIcon />
      <h3>{t('paymentIssue')}</h3>
      <p>{message || t('paymentErrorFallback')}</p>
      <button className={styles.actionButton} onClick={onClose}>
        {t('close')}
      </button>
    </div>
  );
};

ErrorView.propTypes = {
  message: PropTypes.string,
  onClose: PropTypes.func
};

export const HasSubscriptionView = ({ onManage, onClose }) => {
  const t = useSharedMessages();
  return (
    <div className={styles.statusContainer}>
      <SuccessIcon />
      <h3>{t('hasActiveSubscriptionHeading')}</h3>
      <p>{t('billingPortalHint')}</p>
      <button
        className={`${styles.actionButton} ${styles.primary}`}
        onClick={onManage}
      >
        {t('manageSubscription')}
      </button>
      <button className={styles.actionButton} onClick={onClose}>
        {t('close')}
      </button>
    </div>
  );
};

HasSubscriptionView.propTypes = {
  onManage: PropTypes.func,
  onClose: PropTypes.func
};
