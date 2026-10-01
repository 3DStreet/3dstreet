/**
 * ProjectPassModal - one-time time-boxed Pro pass purchase (#1922).
 *
 * Opened by the `#project-pass` deep link (email campaigns, docs); it is
 * deliberately NOT part of the UpgradeModal tier grid. One payment buys
 * PROJECT_PASS.days of Pro plus PROJECT_PASS.tokens AI tokens up front, with
 * no subscription and no renewal. Free users are the main audience; signed-out
 * visitors sign in first (onSignIn), and active subscribers may buy one too
 * (the server never touches their plan claim).
 *
 * Fulfillment is the Stripe webhook (public/functions/stripe.js →
 * grantPass), which extends tokenProfile.proUntil. verifyPurchase polls
 * checkUserProStatus until proUntil moves past its pre-checkout value, then
 * pushes the new Pro status into the auth context so every Pro gate flips
 * without a reload.
 *
 * Reuses UpgradeModal's stylesheet and the shared EmbeddedCheckout, same as
 * BuyTokensModal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import posthog from 'posthog-js';
import { useAuthContext } from '@shared/contexts';
import EmbeddedCheckout from '@shared/components/EmbeddedCheckout';
import { isUserPro } from '@shared/auth/api/user';
import { auth } from '@shared/services/firebase';
import { formatCurrency, formatDate } from '@shared/utils/format';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import { PROJECT_PASS } from '../UpgradeModal/pricing';
import styles from '../UpgradeModal/UpgradeModal.module.scss';

// Stripe price ID, injected at build time by dotenv-webpack from
// config/.env.{development,production}. The webhook maps the same ID back to
// the pass (pro-pass.js, STRIPE_PROJECT_PASS_PRICE_ID secret). Unset → the
// modal says the pass is unavailable instead of opening a dead checkout.
const PROJECT_PASS_PRICE_ID = process.env.STRIPE_PROJECT_PASS_PRICE_ID;

// Analytics `plan` value — matches the server's checkoutSessions `product`.
const PASS_PLAN = `pro-pass-${PROJECT_PASS.id}`;

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

const CheckIcon = () => (
  <svg
    className={styles.checkIcon}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle cx="12" cy="12" r="10" fill="#10b981" />
    <path
      d="M8 12.5l3 3 5-6"
      stroke="white"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const toMs = (iso) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

const ProjectPassModal = ({
  isOpen,
  onClose,
  source = 'unknown',
  onSignIn
}) => {
  const { currentUser, setCurrentUser } = useAuthContext();
  const t = useSharedMessages();
  const [modalState, setModalState] = useState('offer');
  // 'offer' | 'checkout'
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const handlePaymentSubmitted = useCallback(
    () => setPaymentSubmitted(true),
    []
  );
  // proUntil (ms) at checkout start; the webhook grant pushes it later,
  // which is what verifyPurchase polls for.
  const proUntilAtCheckout = useRef(0);
  const [grantedProUntil, setGrantedProUntil] = useState(null);

  // Stable reference: EmbeddedCheckout memoizes its Stripe options on it.
  const checkoutMetadata = useMemo(() => ({ source }), [source]);

  const passName = t('projectPassName');
  const passDays = PROJECT_PASS.days;
  const passMonths = Math.round(passDays / 30);
  // isProPass is expiry-checked server-side (and on the cached status).
  const hasActivePass = !!currentUser?.isProPass && !!currentUser?.proUntil;
  const isSubscriber = !!currentUser?.plan;

  // Reset internal state whenever the modal closes (see BuyTokensModal).
  useEffect(() => {
    if (isOpen) return;
    setModalState('offer');
    setPaymentSubmitted(false);
    setGrantedProUntil(null);
  }, [isOpen]);

  const handleBuy = useCallback(() => {
    proUntilAtCheckout.current = toMs(currentUser?.proUntil);
    setModalState('checkout');
    posthog.capture('checkout_started', {
      plan: PASS_PLAN,
      tier: 'pro',
      product: 'pro-pass',
      source
    });
  }, [currentUser, source]);

  // Force a token refresh and re-check Pro status until the webhook has
  // extended proUntil past its pre-checkout value. Comparing proUntil (not
  // isPro) also confirms a purchase by someone who was already Pro.
  // AuthContext's currentUser is a plain spread of the Firebase user, so use
  // auth.currentUser for prototype methods.
  const verifyPurchase = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !currentUser) return false;
    const status = await isUserPro(firebaseUser);
    const newProUntil = toMs(status?.proUntil);
    if (!status?.isPro || newProUntil <= proUntilAtCheckout.current) {
      return false;
    }
    setGrantedProUntil(status.proUntil);
    setCurrentUser({
      ...currentUser,
      isPro: true,
      isProTeam: status.isProTeam,
      teamDomain: status.teamDomain,
      plan: status.plan ?? null,
      isProPass: !!status.isProPass,
      proUntil: status.proUntil ?? null
    });
    // Plan-dependent panels (assets storage meter, etc.) and token displays.
    window.dispatchEvent(new Event('planChanged'));
    window.dispatchEvent(new Event('tokenCountChanged'));
    return true;
  }, [currentUser, setCurrentUser]);

  // Keyup (not keydown) to match the shared Modal component — see the
  // double-close note in UpgradeModal.
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

  const renderOffer = () => (
    <>
      <div className={styles.pricingHeader}>
        <div className={styles.pricingTitleBlock}>
          <h2 className={styles.pricingTitle}>{passName}</h2>
          <p className={styles.pricingSubtitle}>
            {t('projectPassSubtitle', { months: passMonths })}
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

      <ul className={styles.featureList}>
        <li>
          <CheckIcon />
          <span>{t('projectPassFeatPro', { days: passDays })}</span>
        </li>
        <li>
          <CheckIcon />
          <span>{t('projectPassFeatExports')}</span>
        </li>
        <li>
          <CheckIcon />
          <span>
            {t('projectPassFeatTokens', { tokens: PROJECT_PASS.tokens })}
          </span>
        </li>
        <li>
          <CheckIcon />
          <span>{t('projectPassFeatKeep')}</span>
        </li>
      </ul>

      {!currentUser ? (
        <div className={styles.signInPrompt}>
          <p className={styles.signInCopy}>{t('projectPassSignInPrompt')}</p>
          <button type="button" className={styles.ctaButton} onClick={onSignIn}>
            {t('signInToCloud')}
          </button>
        </div>
      ) : !PROJECT_PASS_PRICE_ID ? (
        <div className={styles.signInPrompt}>
          <p className={styles.signInCopy}>{t('projectPassUnavailable')}</p>
        </div>
      ) : (
        <div className={styles.signInPrompt}>
          {hasActivePass && (
            <p className={styles.signInCopy}>
              {t('projectPassActiveUntil', {
                date: formatDate(currentUser.proUntil),
                days: passDays
              })}
            </p>
          )}
          {isSubscriber && (
            <p className={styles.signInCopy}>
              {t('projectPassSubscriberNote')}
            </p>
          )}
          <div className={styles.packPriceBlock}>
            <span className={styles.packPrice}>
              {formatCurrency(PROJECT_PASS.price)}
            </span>
            <span className={styles.packOneTime}>{t('buyTokensOneTime')}</span>
          </div>
          <button
            type="button"
            className={styles.ctaButton}
            onClick={handleBuy}
          >
            {t('projectPassBuyCta', { name: passName })}
          </button>
        </div>
      )}
    </>
  );

  const renderCheckout = () => (
    <>
      <div className={styles.modalHeader}>
        {!paymentSubmitted && (
          <button
            className={styles.backButton}
            onClick={() => setModalState('offer')}
          >
            ← {t('back')}
          </button>
        )}
        <h2 className={styles.modalTitle}>{passName}</h2>
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label={t('close')}
        >
          <CloseIcon />
        </button>
      </div>

      <EmbeddedCheckout
        priceId={PROJECT_PASS_PRICE_ID}
        mode="payment"
        source={source}
        plan={PASS_PLAN}
        metadata={checkoutMetadata}
        verifyPurchase={verifyPurchase}
        onSuccess={onClose}
        onClose={onClose}
        onPaymentSubmitted={handlePaymentSubmitted}
        successTitle={t('projectPassSuccessTitle')}
        successMessage={t('projectPassSuccessMessage', {
          date: formatDate(grantedProUntil),
          tokens: PROJECT_PASS.tokens
        })}
        successCta={t('done')}
      />
    </>
  );

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={`${styles.modalContent} ${modalState === 'checkout' ? styles.modalContentWide : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {modalState === 'offer' && renderOffer()}
        {modalState === 'checkout' && renderCheckout()}
      </div>
    </div>
  );
};

ProjectPassModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  source: PropTypes.string,
  onSignIn: PropTypes.func
};

export default ProjectPassModal;
