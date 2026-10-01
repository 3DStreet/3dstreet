/**
 * RedeemPassModal - redeem a Project Pass code someone else paid for
 * (#1922 follow-up), opened by the `#redeem?code=CODE` deep link.
 *
 * An organization buys N passes and shares ONE code capped at N uses. Each
 * recipient signs in (onSignIn — the editor adapter returns them here) and
 * redeems it. The `redeemPassCode` callable (public/functions/pass-codes.js)
 * consumes a use and runs the same grantPass as a paid pass, so the days
 * start now. Redeeming a code twice is harmless: the server answers
 * 'already-redeemed' with the existing pass.
 *
 * Reuses UpgradeModal's stylesheet and EmbeddedCheckout's SuccessView.
 */
import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import posthog from 'posthog-js';
import { httpsCallable } from 'firebase/functions';
import { useAuthContext } from '@shared/contexts';
import { isUserPro } from '@shared/auth/api/user';
import { auth, functions } from '@shared/services/firebase';
import { formatDate } from '@shared/utils/format';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import { SuccessView } from '../EmbeddedCheckout/StatusViews';
import { PROJECT_PASS } from '../UpgradeModal/pricing';
import styles from '../UpgradeModal/UpgradeModal.module.scss';

const CloseIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

// Server rejection reason (HttpsError details.reason) → localized message.
const ERROR_MESSAGE_IDS = {
  'invalid-code': 'redeemPassErrorInvalid',
  'not-found': 'redeemPassErrorInvalid',
  inactive: 'redeemPassErrorExpired',
  expired: 'redeemPassErrorExpired',
  exhausted: 'redeemPassErrorExhausted'
};

const RedeemPassModal = ({ isOpen, onClose, initialCode = '', onSignIn }) => {
  const { currentUser, setCurrentUser } = useAuthContext();
  const t = useSharedMessages();
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState('form');
  // 'form' | 'redeeming' | 'success'
  const [errorId, setErrorId] = useState(null);
  const [result, setResult] = useState(null);

  // Reset on close; keep the code so reopening after sign-in still has it.
  useEffect(() => {
    if (isOpen) return;
    setState('form');
    setErrorId(null);
    setResult(null);
  }, [isOpen]);

  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);

  const passName = t('projectPassName');

  const handleRedeem = useCallback(
    async (e) => {
      e?.preventDefault();
      const trimmed = code.trim();
      if (!trimmed) {
        setErrorId('redeemPassErrorInvalid');
        return;
      }
      setState('redeeming');
      setErrorId(null);
      try {
        const redeem = httpsCallable(functions, 'redeemPassCode');
        const { data } = await redeem({ code: trimmed });
        setResult(data);
        posthog.capture('pass_code_redeemed', {
          product: 'pro-pass',
          status: data.status,
          code: trimmed.toUpperCase()
        });

        // Push the new Pro status into the auth context so every Pro gate
        // flips without a reload (same as ProjectPassModal).
        const firebaseUser = auth.currentUser;
        if (firebaseUser) {
          const status = await isUserPro(firebaseUser);
          setCurrentUser((prev) => ({
            ...(prev || currentUser),
            isPro: status.isPro,
            isProTeam: status.isProTeam,
            teamDomain: status.teamDomain,
            plan: status.plan ?? null,
            isProPass: !!status.isProPass,
            proUntil: status.proUntil ?? null
          }));
          window.dispatchEvent(new Event('planChanged'));
          window.dispatchEvent(new Event('tokenCountChanged'));
        }
        setState('success');
      } catch (error) {
        const reason = error?.details?.reason;
        posthog.capture('pass_code_redeem_failed', {
          product: 'pro-pass',
          reason: reason || error?.code || 'unknown'
        });
        setErrorId(ERROR_MESSAGE_IDS[reason] || 'redeemPassErrorGeneric');
        setState('form');
      }
    },
    [code, currentUser, setCurrentUser]
  );

  // Keyup (not keydown) to match the shared Modal component.
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keyup', handleEscape);
    return () => document.removeEventListener('keyup', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const renderForm = () => (
    <>
      <div className={styles.pricingHeader}>
        <div className={styles.pricingTitleBlock}>
          <h2 className={styles.pricingTitle}>
            {t('redeemPassTitle', { name: passName })}
          </h2>
          <p className={styles.pricingSubtitle}>
            {t('redeemPassSubtitle', {
              days: PROJECT_PASS.days,
              tokens: PROJECT_PASS.tokens
            })}
          </p>
        </div>
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label={t('close')}
        >
          <CloseIcon />
        </button>
      </div>

      <div className={styles.divider} />

      <form className={styles.signInPrompt} onSubmit={handleRedeem}>
        <input
          className={styles.codeInput}
          aria-label={t('redeemPassCodeLabel')}
          placeholder={t('redeemPassCodeLabel')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={48}
          disabled={state === 'redeeming'}
        />
        {errorId && <p className={styles.formError}>{t(errorId)}</p>}
        {currentUser ? (
          <button
            type="submit"
            className={styles.ctaButton}
            disabled={state === 'redeeming'}
          >
            {state === 'redeeming'
              ? t('redeemPassRedeeming')
              : t('redeemPassCta')}
          </button>
        ) : (
          <>
            <p className={styles.signInCopy}>{t('redeemPassSignInPrompt')}</p>
            <button
              type="button"
              className={styles.ctaButton}
              onClick={onSignIn}
            >
              {t('signInToCloud')}
            </button>
          </>
        )}
      </form>
    </>
  );

  const renderSuccess = () => {
    const date = formatDate(result?.proUntil);
    return (
      <SuccessView
        title={t('projectPassSuccessTitle')}
        message={
          result?.status === 'already-redeemed'
            ? t('redeemPassAlreadyRedeemed', { date })
            : t('projectPassSuccessMessage', {
                date,
                tokens: result?.tokens ?? PROJECT_PASS.tokens
              })
        }
        ctaLabel={t('done')}
        onCta={onClose}
      />
    );
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {state === 'success' ? renderSuccess() : renderForm()}
      </div>
    </div>
  );
};

RedeemPassModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  initialCode: PropTypes.string,
  onSignIn: PropTypes.func
};

export default RedeemPassModal;
