/**
 * EmbeddedCheckout - shared inline Stripe checkout for editor + generator.
 *
 * Encapsulates the Stripe EmbeddedCheckout provider, client-secret fetch,
 * onComplete polling, and the post-payment loading / success / pending /
 * error / has-subscription states. Caller handles plan selection UI and
 * mounts this component once a price has been chosen.
 *
 * IMPORTANT: callers must pass a stable `verifyPurchase` (use `useCallback`).
 * It feeds into the memoized `checkoutOptions` passed to Stripe's
 * `EmbeddedCheckoutProvider`. If the reference changes between renders the
 * provider tears down and re-creates the iframe, which mid-payment is bad.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout as StripeEmbeddedCheckout
} from '@stripe/react-stripe-js';
import { httpsCallable } from 'firebase/functions';
import posthog from 'posthog-js';
import { functions } from '@shared/services/firebase';
import { openBillingPortal } from '@shared/utils/billing';
import {
  LoadingView,
  SuccessView,
  PendingView,
  ErrorView,
  HasSubscriptionView
} from './StatusViews';
import styles from './EmbeddedCheckout.module.scss';

let stripePromise;
const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
};

// Webhooks usually land in seconds, but we give them up to 30s before
// switching to the "still finalizing" state instead of claiming success.
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

const EmbeddedCheckout = ({
  priceId,
  mode = 'subscription',
  source,
  plan,
  metadata,
  verifyPurchase,
  onSuccess,
  onClose,
  onPaymentSubmitted,
  successTitle = 'Payment Successful!',
  successMessage = 'Thanks for your purchase. Your account is ready to go.',
  successCta = 'Done'
}) => {
  const [state, setState] = useState('checkout');
  // 'checkout' | 'loading' | 'success' | 'pending' | 'error' | 'has-subscription'
  const [errorMessage, setErrorMessage] = useState(null);
  const formLoadedRef = useRef(false);
  const pollIntervalRef = useRef(null);
  // Mirror state and props into refs so the unmount cleanup reads the
  // latest values — empty deps avoid re-firing on prop churn.
  const stateRef = useRef(state);
  const planRef = useRef(plan);
  const sourceRef = useRef(source);
  useEffect(() => {
    stateRef.current = state;
    planRef.current = plan;
    sourceRef.current = source;
  });

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => clearPolling, [clearPolling]);

  // Funnel: emit checkout_canceled when the user bails mid-flow (back to
  // pricing or close while still on the Stripe form). Splits drop-off into
  // pre_form (createStripeSession failed / Stripe.js latency) vs in_form
  // (user saw form, didn't complete). Skipped for terminal states
  // (success / pending / error / has-subscription) — those aren't cancels.
  useEffect(() => {
    return () => {
      if (stateRef.current !== 'checkout') return;
      posthog.capture('checkout_canceled', {
        plan: planRef.current,
        source: sourceRef.current,
        stage: formLoadedRef.current ? 'in_form' : 'pre_form'
      });
    };
  }, []);

  const startPolling = useCallback(() => {
    if (typeof verifyPurchase !== 'function') {
      // No verification predicate — assume webhook will catch up.
      setState('success');
      posthog.capture('payment_completed', { plan, source });
      return;
    }

    let attempts = 0;
    pollIntervalRef.current = setInterval(async () => {
      attempts++;
      try {
        const ok = await verifyPurchase();
        if (ok) {
          clearPolling();
          setState('success');
          posthog.capture('payment_completed', { plan, source });
        } else if (attempts >= POLL_MAX_ATTEMPTS) {
          clearPolling();
          // Webhook still pending — be honest about it instead of
          // showing premature success (which leads to refund requests).
          setState('pending');
          posthog.capture('payment_completed', {
            plan,
            source,
            finalizing: true
          });
        }
      } catch (err) {
        console.error('Error verifying purchase:', err);
        if (attempts >= POLL_MAX_ATTEMPTS) {
          clearPolling();
          setState('pending');
        }
      }
    }, POLL_INTERVAL_MS);
  }, [verifyPurchase, plan, source, clearPolling]);

  const checkoutOptions = useMemo(
    () => ({
      fetchClientSecret: async () => {
        try {
          const createStripeSession = httpsCallable(
            functions,
            'createStripeSession'
          );
          const { data } = await createStripeSession({
            ui_mode: 'embedded',
            redirect_on_completion: 'never',
            line_items: [{ price: priceId, quantity: 1 }],
            mode,
            ...(metadata ? { metadata } : {})
          });

          if (!formLoadedRef.current) {
            formLoadedRef.current = true;
            // Fires when our backend returns clientSecret — i.e. the Stripe
            // session exists and Stripe.js is about to mount the iframe.
            // Not the same as iframe-ready (which we don't track).
            posthog.capture('checkout_session_created', { plan, source, mode });
          }

          return data.clientSecret;
        } catch (error) {
          console.error('Error creating checkout session:', error);
          if (error.code === 'already-exists') {
            setState('has-subscription');
          } else {
            setErrorMessage(error.message || 'Could not start checkout.');
            setState('error');
          }
          throw error;
        }
      },
      onComplete: () => {
        setState('loading');
        // Lets the parent (UpgradeModal) hide the Back button once the
        // payment is in-flight — no useful "back" past this point.
        onPaymentSubmitted?.();
        startPolling();
      }
    }),
    [priceId, mode, metadata, plan, source, startPolling, onPaymentSubmitted]
  );

  // If a caller provides onSuccess they own the post-success transition
  // (close, route back to a prior modal, etc.). Calling onClose afterward
  // would race with that navigation and clobber it, so fall back to onClose
  // only when no onSuccess handler was supplied.
  const handleSuccessClick = () => {
    if (onSuccess) {
      onSuccess();
    } else {
      onClose?.();
    }
  };

  if (state === 'checkout') {
    return (
      <div className={styles.checkoutWrapper}>
        <EmbeddedCheckoutProvider
          stripe={getStripe()}
          options={checkoutOptions}
        >
          <StripeEmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    );
  }

  if (state === 'loading') return <LoadingView />;
  if (state === 'success') {
    return (
      <SuccessView
        title={successTitle}
        message={successMessage}
        ctaLabel={successCta}
        onCta={handleSuccessClick}
      />
    );
  }
  if (state === 'pending') return <PendingView onClose={onClose} />;
  if (state === 'error') {
    return <ErrorView message={errorMessage} onClose={onClose} />;
  }
  if (state === 'has-subscription') {
    return (
      <HasSubscriptionView
        onManage={() => openBillingPortal()}
        onClose={onClose}
      />
    );
  }
  return null;
};

EmbeddedCheckout.propTypes = {
  priceId: PropTypes.string.isRequired,
  mode: PropTypes.oneOf(['subscription', 'payment']),
  source: PropTypes.string,
  plan: PropTypes.string,
  metadata: PropTypes.object,
  verifyPurchase: PropTypes.func,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
  onPaymentSubmitted: PropTypes.func,
  successTitle: PropTypes.string,
  successMessage: PropTypes.string,
  successCta: PropTypes.string
};

export default EmbeddedCheckout;
