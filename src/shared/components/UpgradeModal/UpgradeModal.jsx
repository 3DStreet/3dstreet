/**
 * UpgradeModal - shared Pro upgrade / token purchase modal.
 * Used by both the editor (Pro upgrade) and the generator (token top-ups).
 *
 * Owns: modal chrome, plan picker, checkActiveSubscriptions pre-check,
 * has-subscription routing. Delegates the actual Stripe form + post-payment
 * states to the shared EmbeddedCheckout component.
 *
 * Caller-specific concerns are passed via props:
 *  - verifyPurchase: how to confirm the webhook landed (Pro claim flip vs.
 *    token bump). Different for each app; fed through to EmbeddedCheckout.
 *  - onCheckoutStart: optional hook for the caller to snapshot state before
 *    payment (e.g. generator captures tokenProfile.genToken to compare against).
 *  - onSignIn: fired when an unauthenticated user clicks the sign-in CTA.
 *    Caller routes to its own sign-in modal. If omitted, the button is inert.
 *  - onSuccess: fires when the user clicks the success CTA — editor uses this
 *    to chain into a postCheckout modal (geo / image / etc.).
 */
import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { httpsCallable } from 'firebase/functions';
import posthog from 'posthog-js';
import { functions } from '@shared/services/firebase';
import { useAuthContext } from '@shared/contexts';
import EmbeddedCheckout from '@shared/components/EmbeddedCheckout';
import { openBillingPortal } from '@shared/utils/billing';
import { getPaywallSurface } from './paywallSurfaces';
import { PRICING, TOKEN_FEATURE_LINE } from './pricing';
import styles from './UpgradeModal.module.scss';

// Single source of truth for the Pro feature list — shown once, no duplication.
const PLAN_FEATURES = [
  'Download JPEG snapshots without watermark',
  'Unlimited geospatial maps & location changes',
  'HD renders, AR-ready glTF & video export',
  'Import custom 3D models & SVG / glTF files',
  TOKEN_FEATURE_LINE
];

const StarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
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

const UpgradeModal = ({
  isOpen,
  onClose,
  source = 'unknown',
  trigger = 'manual',
  surface: surfaceKey,
  onCheckoutStart,
  onSignIn,
  onSecondaryCta,
  onAlreadyPro,
  verifyPurchase,
  onSuccess,
  successTitle = 'Welcome to Pro!',
  successMessage = 'Pro features are unlocked on your account.',
  successCta = 'Continue'
}) => {
  const surface = getPaywallSurface(surfaceKey);
  const features = surface?.features || PLAN_FEATURES;
  const { currentUser } = useAuthContext();
  const [modalState, setModalState] = useState('pricing');
  // 'pricing' | 'checkout' | 'has-subscription'
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState('yearly');
  // Annual highlighted by default — best value, matches mockup.
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  // Flips true on Stripe's onComplete. Used to hide the Back button once
  // payment is in-flight — nothing useful to go back to past that point.
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const handlePaymentSubmitted = useCallback(
    () => setPaymentSubmitted(true),
    []
  );

  const handleClose = useCallback(() => {
    onClose();
    setModalState('pricing');
    setSelectedPlan(null);
    setBillingCycle('yearly');
    setSubscriptionInfo(null);
    setPaymentSubmitted(false);
  }, [onClose]);

  const handleGoPro = () => {
    const plan = billingCycle; // 'monthly' | 'yearly'
    setSelectedPlan(plan);
    setModalState('checkout');
    onCheckoutStart?.(plan);
    posthog.capture('checkout_started', { plan, source });
  };

  const handleBackToPricing = () => {
    setModalState('pricing');
    setSelectedPlan(null);
  };

  // Short-circuit if the auth claim already says they're Pro. Covers the
  // post-login race: an anonymous user paywall-triggers, signs in, and the
  // sign-in flow returns them to this modal. By the time AuthContext
  // enriches currentUser with isPro=true, we should bail out — the Stripe
  // precheck below also catches subscribers, but Pro can be granted via
  // team membership / admin override (no Stripe sub), so isPro is the
  // broader signal. Same modalState=='pricing' guard as the precheck so we
  // don't yank the user out of the post-purchase success view.
  useEffect(() => {
    if (!isOpen) return;
    if (modalState !== 'pricing') return;
    if (!currentUser?.isPro) return;
    posthog.capture('upgrade_modal_skipped_already_pro', { source, trigger });
    if (onAlreadyPro) {
      onAlreadyPro();
    } else {
      handleClose();
    }
  }, [
    isOpen,
    modalState,
    currentUser?.isPro,
    source,
    trigger,
    onAlreadyPro,
    handleClose
  ]);

  // Pre-check for an existing subscription so we can route to billing portal
  // before showing pricing — avoids duplicate purchases. Fires
  // existing_subscription_detected only when the precheck finds one, which
  // lets the funnel separate "routed away as existing subscriber" from
  // "saw pricing, didn't click".
  //
  // Guard on modalState === 'pricing': after a successful purchase the
  // webhook flips isPro on currentUser, which retriggers this effect. Without
  // the guard, the freshly-bought subscription gets detected and we yank the
  // user out of EmbeddedCheckout's success view into has-subscription.
  useEffect(() => {
    if (!isOpen || !currentUser) return;
    if (modalState !== 'pricing') return;
    // Already-Pro users are handled by the effect above; skip the Stripe
    // precheck so we don't race the close.
    if (currentUser.isPro) return;

    const checkSubscriptions = async () => {
      try {
        const checkActiveSubscriptions = httpsCallable(
          functions,
          'checkActiveSubscriptions'
        );
        const { data } = await checkActiveSubscriptions();
        if (data.hasActiveSubscription) {
          posthog.capture('existing_subscription_detected', {
            source,
            trigger
          });
          setSubscriptionInfo(data);
          setModalState('has-subscription');
        }
      } catch (error) {
        console.error('Error checking active subscriptions:', error);
      }
    };

    checkSubscriptions();
  }, [isOpen, currentUser, source, trigger, modalState]);

  // Defensive: clear any stray session_id left in the URL.
  useEffect(() => {
    if (!isOpen) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('session_id')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [isOpen]);

  // Listen on keyup (not keydown) to match the shared Modal component used
  // by other editor modals. If we close on keydown and route the user back
  // to a previous modal (e.g. geo), the keyup half of the same press would
  // hit the freshly-mounted shared Modal and close it too — geo flashes for
  // a frame and disappears. Same-phase listeners avoid the double-close.
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    document.addEventListener('keyup', handleEscape);
    return () => document.removeEventListener('keyup', handleEscape);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const renderPricing = () => (
    <>
      {surface ? (
        <>
          <div className={styles.pricingHeader}>
            <div className={styles.surfaceCard}>
              <div className={styles.surfaceIcon}>{surface.icon}</div>
              <div className={styles.surfaceText}>
                <div className={styles.surfaceTitle}>{surface.title}</div>
                <div className={styles.surfaceSubtitle}>{surface.subtitle}</div>
              </div>
            </div>
            <button
              className={styles.closeButton}
              onClick={handleClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.pricingTitleBlock}>
            <h2 className={styles.pricingTitle}>{surface.headline}</h2>
            <p className={styles.pricingSubtitle}>{surface.description}</p>
          </div>
        </>
      ) : (
        <>
          <div className={styles.pricingHeader}>
            <div className={styles.headerIcon}>
              <StarIcon />
            </div>
            <button
              className={styles.closeButton}
              onClick={handleClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.pricingTitleBlock}>
            <h2 className={styles.pricingTitle}>Upgrade to Pro</h2>
            <p className={styles.pricingSubtitle}>
              Unlock the full 3DStreet toolkit.
            </p>
          </div>
        </>
      )}

      <div className={styles.divider} />

      <ul className={styles.featureList}>
        {features.map((f) => (
          <li key={f}>
            <CheckIcon />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {currentUser ? (
        <>
          <div className={styles.billingToggle} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={billingCycle === 'monthly'}
              className={`${styles.toggleButton} ${billingCycle === 'monthly' ? styles.toggleActive : ''}`}
              onClick={() => setBillingCycle('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={billingCycle === 'yearly'}
              className={`${styles.toggleButton} ${billingCycle === 'yearly' ? styles.toggleActive : ''}`}
              onClick={() => setBillingCycle('yearly')}
            >
              Yearly <span className={styles.savePill}>Save 30%</span>
            </button>
          </div>

          <div className={styles.priceDisplay}>
            <span className={styles.priceLarge}>
              ${PRICING[billingCycle].pricePerMonth}
            </span>
            {/* /month sits superscript-style next to the price; the cycle
                detail ("billed monthly" / "billed yearly, $84/year") stacks
                directly under it. Always present so toggling cycles doesn't
                shift the layout. */}
            <div className={styles.priceUnit}>
              <span className={styles.pricePer}>/month</span>
              <span className={styles.priceSubtext}>
                {PRICING[billingCycle].cycleDetail}
              </span>
            </div>
            <div className={styles.priceTokenGrant}>
              Includes {PRICING[billingCycle].tokens} AI generation tokens,
              delivered up front
            </div>
          </div>

          <button
            type="button"
            className={styles.ctaButton}
            onClick={handleGoPro}
          >
            Go Pro
          </button>

          {surface?.secondaryCtaLabel && onSecondaryCta && (
            <button
              type="button"
              className={styles.ctaButtonSecondary}
              onClick={onSecondaryCta}
            >
              {surface.secondaryCtaLabel}
            </button>
          )}

          <p className={styles.footerNote}>Cancel anytime</p>
        </>
      ) : (
        <div className={styles.signInPrompt}>
          <p className={styles.signInCopy}>Sign in to upgrade or access Pro.</p>
          <button type="button" className={styles.ctaButton} onClick={onSignIn}>
            Sign in to 3DStreet Cloud
          </button>
        </div>
      )}
    </>
  );

  const renderCheckout = () => (
    <>
      <div className={styles.modalHeader}>
        {!paymentSubmitted && (
          <button className={styles.backButton} onClick={handleBackToPricing}>
            ← Back
          </button>
        )}
        <h2 className={styles.modalTitle}>Complete your upgrade</h2>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <EmbeddedCheckout
        priceId={
          selectedPlan === 'monthly'
            ? process.env.STRIPE_MONTHLY_PRICE_ID
            : process.env.STRIPE_YEARLY_PRICE_ID
        }
        mode="subscription"
        source={source}
        plan={selectedPlan}
        verifyPurchase={verifyPurchase}
        onSuccess={onSuccess}
        onClose={handleClose}
        onPaymentSubmitted={handlePaymentSubmitted}
        successTitle={successTitle}
        successMessage={successMessage}
        successCta={successCta}
      />
    </>
  );

  const renderHasSubscription = () => (
    <>
      <div className={styles.modalHeader}>
        <h2 className={styles.modalTitle}>Active Subscription</h2>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <div className={styles.statusContainer}>
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
        <h3>You Already Have an Active Subscription</h3>
        <p>
          You currently have {subscriptionInfo?.subscriptionCount || 1} active
          subscription{subscriptionInfo?.subscriptionCount > 1 ? 's' : ''}.
        </p>
        {subscriptionInfo?.subscriptionCount > 1 && (
          <p className={styles.subtext}>
            Note: You have multiple subscriptions. Please manage them through
            the billing portal.
          </p>
        )}
        <p className={styles.subtext}>
          To add more tokens, manage your subscription, or upgrade/downgrade,
          please visit the billing portal.
        </p>
        <button
          className={styles.ctaButton}
          onClick={() => openBillingPortal()}
        >
          Manage Subscription
        </button>
        <button className={styles.ctaButtonSecondary} onClick={handleClose}>
          Close
        </button>
      </div>
    </>
  );

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div
        className={`${styles.modalContent} ${modalState === 'checkout' ? styles.modalContentWide : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {modalState === 'pricing' && renderPricing()}
        {modalState === 'checkout' && selectedPlan && renderCheckout()}
        {modalState === 'has-subscription' && renderHasSubscription()}
      </div>
    </div>
  );
};

UpgradeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  source: PropTypes.string,
  trigger: PropTypes.string,
  surface: PropTypes.string,
  onCheckoutStart: PropTypes.func,
  onSignIn: PropTypes.func,
  onSecondaryCta: PropTypes.func,
  onAlreadyPro: PropTypes.func,
  verifyPurchase: PropTypes.func,
  onSuccess: PropTypes.func,
  successTitle: PropTypes.string,
  successMessage: PropTypes.string,
  successCta: PropTypes.string
};

export default UpgradeModal;
