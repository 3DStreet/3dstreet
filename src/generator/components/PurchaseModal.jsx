/**
 * PurchaseModal - Token purchase modal for image generator
 * Shows pricing tiers and handles embedded Stripe checkout
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout
} from '@stripe/react-stripe-js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase';
import useImageGenStore from '../store';
import { useAuthContext } from '../../editor/contexts';
import { getTokenProfile } from '@shared/utils/tokens';
import styles from './PurchaseModal.module.scss';
import posthog from 'posthog-js';

// Initialize Stripe
const stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);

const PurchaseModal = () => {
  const { modal, setModal } = useImageGenStore();
  const { currentUser, tokenProfile, refreshTokenProfile } = useAuthContext();
  const [modalState, setModalState] = useState('pricing');
  // States: 'pricing' | 'checkout' | 'loading' | 'success' | 'error' | 'has-subscription'

  const userPlan = currentUser?.isMax
    ? 'max'
    : currentUser?.isPro
      ? 'pro'
      : null;
  const [selectedTier, setSelectedTier] = useState(
    userPlan === 'max' ? 'max' : 'pro'
  ); // 'pro' | 'max'
  const [billingPeriod, setBillingPeriod] = useState('monthly'); // 'monthly' | 'annual'
  const selectedPlan =
    selectedTier && billingPeriod ? `${selectedTier}-${billingPeriod}` : null;
  const [sessionStatus, setSessionStatus] = useState(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  const initialTokenCount = useRef(null);
  const pollIntervalRef = useRef(null);

  const isPurchaseModalOpen = modal === 'purchase';

  // Handler functions
  const handleClose = useCallback(() => {
    // Clean up polling interval if active
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setModal(null);
    setModalState('pricing');
    setSelectedTier('pro');
    setBillingPeriod('monthly');
    setSessionStatus(null);
    initialTokenCount.current = null;
  }, [setModal]);

  // Poll token profile to wait for webhook to complete
  const startPollingForTokenUpdate = useCallback(() => {
    if (!currentUser?.uid) {
      console.error('Cannot poll - user not authenticated');
      setModalState('error');
      return;
    }

    // Store initial token count
    initialTokenCount.current = tokenProfile?.genToken || 0;

    let attempts = 0;
    const maxAttempts = 15; // Poll for up to 30 seconds (15 * 2s)

    pollIntervalRef.current = setInterval(async () => {
      attempts++;

      try {
        // Fetch fresh token profile directly from Firestore
        const freshTokenProfile = await getTokenProfile(currentUser.uid);
        const currentTokens = freshTokenProfile?.genToken || 0;

        // Also update the auth context
        await refreshTokenProfile();

        // Check if tokens have increased
        if (currentTokens > initialTokenCount.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;

          // Emit event to notify other components (like TokenDisplay)
          window.dispatchEvent(new Event('tokenCountChanged'));

          setModalState('success');
          setSessionStatus({
            status: 'complete',
            payment_status: 'paid'
          });

          // Funnel event: payment_completed (for conversion funnel analysis)
          posthog.capture('payment_completed', {
            plan: selectedPlan,
            source: 'generator'
          });
        } else if (attempts >= maxAttempts) {
          // Timeout - webhook might be delayed, but show success anyway
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;

          // Emit event even on timeout - tokens might still update
          window.dispatchEvent(new Event('tokenCountChanged'));

          setModalState('success');
        }
      } catch (error) {
        console.error('Error polling token profile:', error);
        if (attempts >= maxAttempts) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setModalState('error');
        }
      }
    }, 2000); // Poll every 2 seconds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, tokenProfile, refreshTokenProfile]);

  // Check for active subscriptions when modal opens
  useEffect(() => {
    if (!isPurchaseModalOpen || !currentUser) return;

    // Funnel event: pricing_page_viewed (for conversion funnel analysis)
    posthog.capture('pricing_page_viewed', {
      source: 'generator',
      trigger: 'gen_token_limit'
    });

    const checkSubscriptions = async () => {
      try {
        const checkActiveSubscriptions = httpsCallable(
          functions,
          'checkActiveSubscriptions'
        );
        const { data } = await checkActiveSubscriptions();

        if (data.hasActiveSubscription) {
          setSubscriptionInfo(data);
          setModalState('has-subscription');
        }
      } catch (error) {
        console.error('Error checking active subscriptions:', error);
        // Don't block the modal if check fails, just log the error
      }
    };

    checkSubscriptions();
  }, [isPurchaseModalOpen, currentUser]);

  // Clean up any stray session_id from URL (shouldn't happen with onComplete, but just in case)
  useEffect(() => {
    if (!isPurchaseModalOpen) return;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('session_id')) {
      // Clean up URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [isPurchaseModalOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isPurchaseModalOpen) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isPurchaseModalOpen, handleClose]);

  // Prevent scroll when modal is open
  useEffect(() => {
    if (isPurchaseModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isPurchaseModalOpen]);

  const handlePlanSelect = (tier) => {
    setSelectedTier(tier);
    setModalState('checkout');
    // Funnel event: checkout_started (for conversion funnel analysis)
    posthog.capture('checkout_started', {
      plan: `${tier}-${billingPeriod}`,
      source: 'generator'
    });
  };

  const handleBackToPricing = () => {
    setModalState('pricing');
  };

  // Embedded Checkout options with onComplete callback
  const checkoutOptions = useCallback(() => {
    if (!selectedPlan) return null;

    return {
      fetchClientSecret: async () => {
        try {
          const createStripeSession = httpsCallable(
            functions,
            'createStripeSession'
          );

          const priceIdMap = {
            'pro-monthly': process.env.STRIPE_MONTHLY_PRICE_ID,
            'pro-annual': process.env.STRIPE_YEARLY_PRICE_ID,
            'max-monthly': process.env.STRIPE_MAX_MONTHLY_PRICE_ID,
            'max-annual': process.env.STRIPE_MAX_YEARLY_PRICE_ID
          };

          const { data } = await createStripeSession({
            ui_mode: 'embedded',
            redirect_on_completion: 'never', // Stay in embedded mode, use onComplete callback
            line_items: [
              {
                price: priceIdMap[selectedPlan],
                quantity: 1
              }
            ],
            mode: 'subscription'
          });

          return data.clientSecret;
        } catch (error) {
          console.error('Error creating checkout session:', error);

          // Handle specific error for existing subscription
          if (error.code === 'already-exists') {
            setModalState('has-subscription');
          } else {
            setModalState('error');
          }
          throw error;
        }
      },
      onComplete: () => {
        // Payment completed in the embedded form!
        setModalState('loading');

        // Start polling for token update from webhook
        startPollingForTokenUpdate();
      }
    };
  }, [selectedPlan, startPollingForTokenUpdate]);

  if (!isPurchaseModalOpen) return null;

  // Get modal title based on state
  const getTitle = () => {
    switch (modalState) {
      case 'pricing':
        return 'Purchase AI Generation Tokens';
      case 'checkout':
        return 'Complete Your Purchase';
      case 'loading':
        return 'Processing...';
      case 'success':
        return selectedPlan?.startsWith('max')
          ? 'Welcome to Max!'
          : 'Welcome to Pro!';
      case 'error':
        return 'Payment Issue';
      case 'has-subscription':
        return 'Active Subscription';
      default:
        return 'Purchase';
    }
  };

  // Open billing portal
  const handleOpenBillingPortal = async () => {
    try {
      const createBillingPortal = httpsCallable(
        functions,
        'createStripeBillingPortal'
      );
      const { data } = await createBillingPortal({
        return_url: window.location.href
      });

      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (error) {
      console.error('Error opening billing portal:', error);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          {modalState === 'checkout' && (
            <button className={styles.backButton} onClick={handleBackToPricing}>
              ← Change Plan
            </button>
          )}
          <h2 className={styles.modalTitle}>{getTitle()}</h2>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close"
          >
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
          </button>
        </div>

        {/* Pricing State */}
        {modalState === 'pricing' && (
          <>
            <p className={styles.modalSubtitle}>
              Choose a plan to continue generating AI images:
            </p>

            {/* Monthly / Annual toggle */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '20px'
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  background: '#2d2d2d',
                  borderRadius: '8px',
                  padding: '3px'
                }}
              >
                <button
                  style={{
                    padding: '6px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                    background:
                      billingPeriod === 'monthly' ? '#4b4b4b' : 'transparent',
                    color: billingPeriod === 'monthly' ? '#fff' : '#9ca3af'
                  }}
                  onClick={() => setBillingPeriod('monthly')}
                >
                  Monthly
                </button>
                <button
                  style={{
                    padding: '6px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                    background:
                      billingPeriod === 'annual' ? '#4b4b4b' : 'transparent',
                    color: billingPeriod === 'annual' ? '#fff' : '#9ca3af'
                  }}
                  onClick={() => setBillingPeriod('annual')}
                >
                  Yearly
                  <span
                    style={{
                      marginLeft: '6px',
                      fontSize: '11px',
                      color: '#22c55e',
                      fontWeight: '600'
                    }}
                  >
                    Save 17%
                  </span>
                </button>
              </div>
            </div>

            <div className={styles.pricingContainer}>
              {/* Pro */}
              <div
                className={`${styles.pricingCard} ${selectedTier === 'pro' ? styles.featured : ''}`}
              >
                {userPlan === 'pro' ? (
                  <div className={styles.badge}>Current Plan</div>
                ) : selectedTier === 'pro' ? (
                  <div className={styles.badge}>Selected</div>
                ) : null}
                <div className={styles.cardHeader}>
                  <h3 className={styles.planName}>Pro</h3>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.tokenCount}>
                    <img
                      src="/ui_assets/token-image.png"
                      alt="Token"
                      className={styles.tokenIcon}
                    />
                    <span className={styles.tokenAmount}>
                      {billingPeriod === 'monthly' ? '140' : '1,400'}
                    </span>
                    <span className={styles.tokenLabel}>
                      {billingPeriod === 'monthly'
                        ? 'Tokens/mo'
                        : 'Tokens upfront'}
                    </span>
                  </div>
                  {billingPeriod === 'annual' && (
                    <div className={styles.tokenRefill}>
                      <img
                        src="/ui_assets/token-image.png"
                        alt="Token"
                        className={styles.tokenIconSmall}
                      />
                      <span className={styles.refillAmount}>+140</span>
                      <span className={styles.refillLabel}>
                        tokens/mo top-up
                      </span>
                    </div>
                  )}
                  <div className={styles.pricing}>
                    <span className={styles.price}>
                      {billingPeriod === 'monthly' ? '$14' : '$11.67'}
                    </span>
                    <span className={styles.period}>/month</span>
                    {billingPeriod === 'annual' && (
                      <span
                        className={styles.period}
                        style={{ fontSize: '0.75rem', marginLeft: '4px' }}
                      >
                        ($140/yr)
                      </span>
                    )}
                  </div>
                  <ul className={styles.featureList}>
                    <li>AI Render from Editor Screenshot</li>
                    <li>Text-to-Image and Image-to-Image</li>
                    <li>Inpainting & Outpainting</li>
                    <li>All 3DStreet Editor Pro features</li>
                  </ul>
                  {userPlan === 'pro' ? (
                    <button
                      className={`${styles.purchaseButton} ${styles.primary}`}
                      onClick={handleOpenBillingPortal}
                    >
                      Manage Subscription
                    </button>
                  ) : (
                    <button
                      className={`${styles.purchaseButton} ${selectedTier === 'pro' ? styles.primary : ''}`}
                      onClick={() => handlePlanSelect('pro')}
                    >
                      Subscribe to Pro
                    </button>
                  )}
                </div>
              </div>

              {/* Max */}
              <div
                className={`${styles.pricingCard} ${selectedTier === 'max' ? styles.featured : ''}`}
              >
                {userPlan === 'max' ? (
                  <div className={styles.badge}>Current Plan</div>
                ) : selectedTier === 'max' ? (
                  <div className={styles.badge}>Selected</div>
                ) : null}
                <div className={styles.cardHeader}>
                  <h3 className={styles.planName}>Max</h3>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.tokenCount}>
                    <img
                      src="/ui_assets/token-image.png"
                      alt="Token"
                      className={styles.tokenIcon}
                    />
                    <span className={styles.tokenAmount}>
                      {billingPeriod === 'monthly' ? '500' : '5,000'}
                    </span>
                    <span className={styles.tokenLabel}>
                      {billingPeriod === 'monthly'
                        ? 'Tokens/mo'
                        : 'Tokens upfront'}
                    </span>
                  </div>
                  {billingPeriod === 'annual' && (
                    <div className={styles.tokenRefill}>
                      <img
                        src="/ui_assets/token-image.png"
                        alt="Token"
                        className={styles.tokenIconSmall}
                      />
                      <span className={styles.refillAmount}>+500</span>
                      <span className={styles.refillLabel}>
                        tokens/mo top-up
                      </span>
                    </div>
                  )}
                  <div className={styles.pricing}>
                    <span className={styles.price}>
                      {billingPeriod === 'monthly' ? '$50' : '$41.67'}
                    </span>
                    <span className={styles.period}>/month</span>
                    {billingPeriod === 'annual' && (
                      <span
                        className={styles.period}
                        style={{ fontSize: '0.75rem', marginLeft: '4px' }}
                      >
                        ($500/yr)
                      </span>
                    )}
                  </div>
                  <ul className={styles.featureList}>
                    <li>Everything in Pro</li>
                    <li>3.5x more AI generation tokens</li>
                  </ul>
                  {userPlan === 'max' ? (
                    <button
                      className={`${styles.purchaseButton} ${styles.primary}`}
                      onClick={handleOpenBillingPortal}
                    >
                      Manage Subscription
                    </button>
                  ) : userPlan === 'pro' ? (
                    <button
                      className={`${styles.purchaseButton} ${styles.primary}`}
                      onClick={handleOpenBillingPortal}
                    >
                      Upgrade to Max
                    </button>
                  ) : (
                    <button
                      className={`${styles.purchaseButton} ${selectedTier === 'max' ? styles.primary : ''}`}
                      onClick={() => handlePlanSelect('max')}
                    >
                      Subscribe to Max
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Checkout State */}
        {modalState === 'checkout' && (
          <div className={styles.checkoutContainer}>
            <div className={styles.checkoutWrapper}>
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={checkoutOptions()}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        )}

        {/* Loading State */}
        {modalState === 'loading' && (
          <div className={styles.statusContainer}>
            <div className={styles.spinner}></div>
            <p>Processing your payment...</p>
            <p className={styles.subtext}>
              This usually takes just a few seconds
            </p>
          </div>
        )}

        {/* Success State */}
        {modalState === 'success' && (
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
            <h3>Payment Successful!</h3>
            <p>
              Your {selectedPlan?.startsWith('max') ? 'Max' : 'Pro'}{' '}
              subscription is now active.
            </p>
            {sessionStatus?.customer_email && (
              <p className={styles.emailConfirmation}>
                Confirmation email sent to {sessionStatus.customer_email}
              </p>
            )}
            <button
              className={`${styles.purchaseButton} ${styles.success}`}
              onClick={handleClose}
            >
              Start Generating
            </button>
          </div>
        )}

        {/* Error State */}
        {modalState === 'error' && (
          <div className={styles.statusContainer}>
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
            <h3>Payment Issue</h3>
            <p>
              {sessionStatus?.payment_status === 'unpaid'
                ? 'Your payment was not completed. Please try again.'
                : 'Something went wrong with your payment. Please try again or contact support.'}
            </p>
            <button
              className={styles.purchaseButton}
              onClick={handleBackToPricing}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Has Active Subscription State */}
        {modalState === 'has-subscription' && (
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
              You currently have {subscriptionInfo?.subscriptionCount || 1}{' '}
              active subscription
              {subscriptionInfo?.subscriptionCount > 1 ? 's' : ''}.
            </p>
            {subscriptionInfo?.subscriptionCount > 1 && (
              <p className={styles.subtext}>
                Note: You have multiple subscriptions. Please manage them
                through the billing portal.
              </p>
            )}
            <p className={styles.subtext}>
              To add more tokens, manage your subscription, or
              upgrade/downgrade, please visit the billing portal.
            </p>
            <button
              className={`${styles.purchaseButton} ${styles.primary}`}
              onClick={handleOpenBillingPortal}
            >
              Manage Subscription
            </button>
            <button
              className={styles.purchaseButton}
              onClick={handleClose}
              style={{ marginTop: '10px' }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PurchaseModal;
