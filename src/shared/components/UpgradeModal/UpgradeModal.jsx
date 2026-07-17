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
import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import posthog from 'posthog-js';
import { db, functions } from '@shared/services/firebase';
import { useAuthContext } from '@shared/contexts';
import EmbeddedCheckout from '@shared/components/EmbeddedCheckout';
import { openBillingPortal } from '@shared/utils/billing';
import { getPaywallSurface } from './paywallSurfaces';
import { PRICING, TOKEN_FEATURE_LINE } from './pricing';
import { formatCurrency, getPeriodSuffix } from '@shared/utils/format';
import styles from './UpgradeModal.module.scss';

// Stripe price IDs by tier + billing cycle. Injected at build time by
// dotenv-webpack from config/.env.{development,production}. The webhook
// (public/functions/index.js) maps these same IDs back to a plan tier +
// token grant, so the two sets must stay aligned.
const PRICE_IDS = {
  pro: {
    monthly: process.env.STRIPE_MONTHLY_PRICE_ID,
    yearly: process.env.STRIPE_YEARLY_PRICE_ID
  },
  max: {
    monthly: process.env.STRIPE_MAX_MONTHLY_PRICE_ID,
    yearly: process.env.STRIPE_MAX_YEARLY_PRICE_ID
  }
};

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
  successCta = 'Continue',
  // Deep-link activation (e.g. docs pricing "Go Max" → #payment-max-annual):
  // preselect the billing cycle and auto-advance straight to that tier's
  // checkout, honoring the choice the user already made on the pricing page.
  // Parsed from the URL hash by the editor adapter. Defaults keep every in-app
  // trigger (geo paywall, watermark, …) on the normal card-selection flow.
  initialTier = null,
  initialCycle = 'monthly'
}) => {
  const surface = getPaywallSurface(surfaceKey);
  const features = surface?.features || PLAN_FEATURES;
  const { currentUser } = useAuthContext();
  const [modalState, setModalState] = useState('pricing');
  // 'pricing' | 'checkout' | 'has-subscription'
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState(initialCycle);
  const [selectedTier, setSelectedTier] = useState('pro');
  // 'pro' | 'max'. MAX is a superset of Pro (more storage + tokens). Tiers show
  // as neutral side-by-side cards; selectedTier is only set when the user picks
  // a card's CTA (or a deep link auto-advances). Cycle defaults to the deep
  // link's choice, else monthly — the lowest-commitment entry point.
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  // Flips true on Stripe's onComplete. Used to hide the Back button once
  // payment is in-flight — nothing useful to go back to past that point.
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const handlePaymentSubmitted = useCallback(
    () => setPaymentSubmitted(true),
    []
  );
  // Gates the deep-link auto-advance: only fire once the subscription precheck
  // has run, so an existing subscriber is routed to the billing portal rather
  // than into a duplicate checkout. The ref makes it fire at most once per mount.
  const [subscriptionPrechecked, setSubscriptionPrechecked] = useState(false);
  const hasAutoStarted = useRef(false);

  const handleClose = useCallback(() => {
    onClose();
    setModalState('pricing');
    setSelectedPlan(null);
    setBillingCycle(initialCycle);
    setSelectedTier('pro');
    setSubscriptionInfo(null);
    setPaymentSubmitted(false);
  }, [onClose, initialCycle]);

  const handleGoPro = (tier) => {
    const plan = billingCycle; // 'monthly' | 'yearly'
    setSelectedTier(tier);
    setSelectedPlan(plan);
    setModalState('checkout');
    onCheckoutStart?.(plan);
    posthog.capture('checkout_started', { plan, tier, source });
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

  // Server-side "saw the pricing modal" signal for the pricing-nudge
  // lifecycle email (public/functions/email/lifecycle-sweeps.js). Firestore
  // rules restrict this write to the user's own lastPaymentModalAt with the
  // server clock — see userSignals in firestore.rules. Fire-and-forget;
  // never blocks the modal. PostHog keeps capturing independently, but the
  // email sweep deliberately reads only this Firestore signal.
  useEffect(() => {
    if (!isOpen || !currentUser?.uid || currentUser.isPro) return;
    // try/catch on top of the promise .catch: doc() can throw synchronously
    // (e.g. uninitialized Firestore) and a lost signal must never take down
    // the paywall.
    try {
      setDoc(
        doc(db, 'userSignals', currentUser.uid),
        { userId: currentUser.uid, lastPaymentModalAt: serverTimestamp() },
        { merge: true }
      ).catch((error) =>
        console.error('Error recording payment modal signal:', error)
      );
    } catch (error) {
      console.error('Error recording payment modal signal:', error);
    }
  }, [isOpen, currentUser?.uid, currentUser?.isPro]);

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
      } finally {
        // Unblocks the deep-link auto-advance below. By the time this runs we've
        // either routed an existing subscriber to has-subscription (modalState
        // changes, so the auto-advance's pricing guard fails) or confirmed there
        // is no active sub — safe to proceed straight to checkout.
        setSubscriptionPrechecked(true);
      }
    };

    checkSubscriptions();
  }, [isOpen, currentUser, source, trigger, modalState]);

  // Deep-link activation: when the modal was opened via a tier-specific hash
  // (#payment-max-annual etc.), skip the card-selection step and go straight to
  // that tier's checkout — honoring the choice already made on the pricing page.
  // Guards keep it from bypassing the already-Pro short-circuit or the
  // duplicate-subscription precheck, and the ref fires it at most once per mount
  // (so Back → pricing lets the user pick a different tier without re-advancing).
  useEffect(() => {
    if (!isOpen || modalState !== 'pricing') return;
    if (!initialTier || hasAutoStarted.current) return;
    if (!currentUser || currentUser.isPro) return;
    if (!subscriptionPrechecked) return;
    hasAutoStarted.current = true;
    // handleGoPro reads billingCycle (initialized from initialCycle), so this
    // opens checkout on the right tier + cycle.
    handleGoPro(initialTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, modalState, initialTier, currentUser, subscriptionPrechecked]);

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

  // Shared Pro feature list shown once above the tier cards. Each card carries
  // its own token count + storage (Pro vs Max), so drop the generic token line
  // here to avoid repeating it.
  const sharedFeatures = features.filter((f) => f !== TOKEN_FEATURE_LINE);
  const proPlan = PRICING.pro[billingCycle];
  const maxPlan = PRICING.max[billingCycle];

  // Success copy is tier-aware so a Max purchase doesn't read "Welcome to Pro!".
  // Pro keeps the caller-supplied copy (e.g. the generator's custom strings);
  // Max — which no caller passes copy for — gets its own title + message.
  const checkoutSuccessTitle =
    selectedTier === 'max' ? 'Welcome to Max!' : successTitle;
  const checkoutSuccessMessage =
    selectedTier === 'max'
      ? 'Max features are unlocked on your account.'
      : successMessage;

  // One tier card: price, billing-cycle detail, perks, and a tier-specific CTA.
  // Billing cycle is the single toggle above; the card just reprices off it.
  // Both tiers render identically (no featured/preselected tier) so neither is
  // nudged — the user picks Pro or Max with no thumb on the scale.
  const renderPlanCard = (tier, planData, perks) => (
    <div className={styles.planCard}>
      <div className={styles.planName}>{tier === 'max' ? 'Max' : 'Pro'}</div>
      <div className={styles.planPriceRow}>
        <span className={styles.planPriceLarge}>
          {formatCurrency(planData.pricePerMonth)}
        </span>
        <span className={styles.planPricePer}>{getPeriodSuffix('month')}</span>
      </div>
      <div className={styles.planCycleDetail}>{planData.cycleDetail}</div>
      <ul className={styles.planPerks}>
        <li>{planData.tokens} AI tokens / month</li>
        {perks.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.planCta}
        onClick={() => handleGoPro(tier)}
      >
        Go {tier === 'max' ? 'Max' : 'Pro'}
      </button>
    </div>
  );

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
        {sharedFeatures.map((f) => (
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

          <div className={styles.planCards}>
            {renderPlanCard('pro', proPlan, ['5 GB asset storage'])}
            {renderPlanCard('max', maxPlan, ['25 GB asset storage'])}
          </div>

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
        priceId={PRICE_IDS[selectedTier][selectedPlan]}
        mode="subscription"
        source={source}
        plan={selectedPlan}
        verifyPurchase={verifyPurchase}
        onSuccess={onSuccess}
        onClose={handleClose}
        onPaymentSubmitted={handlePaymentSubmitted}
        successTitle={checkoutSuccessTitle}
        successMessage={checkoutSuccessMessage}
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
  successCta: PropTypes.string,
  initialTier: PropTypes.oneOf(['pro', 'max']),
  initialCycle: PropTypes.oneOf(['monthly', 'yearly'])
};

export default UpgradeModal;
