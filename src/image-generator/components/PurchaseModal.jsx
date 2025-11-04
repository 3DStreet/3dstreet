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
import { functions } from '../../editor/services/firebase';
import useImageGenStore from '../store';
import { useAuthContext } from '../../editor/contexts';
import { getTokenProfile } from '../../editor/utils/tokens';
import styles from './PurchaseModal.module.scss';

// Initialize Stripe
const stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);

const PurchaseModal = () => {
  const { modal, setModal } = useImageGenStore();
  const { currentUser, tokenProfile, refreshTokenProfile } = useAuthContext();
  const [modalState, setModalState] = useState('pricing');
  // States: 'pricing' | 'checkout' | 'loading' | 'success' | 'error' | 'has-subscription'

  const [selectedPlan, setSelectedPlan] = useState(null); // 'monthly' | 'annual'
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
    setSelectedPlan(null);
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

    console.log('Starting to poll for token update...');

    // Store initial token count
    initialTokenCount.current = tokenProfile?.genToken || 0;

    let attempts = 0;
    const maxAttempts = 15; // Poll for up to 30 seconds (15 * 2s)

    pollIntervalRef.current = setInterval(async () => {
      attempts++;
      console.log(`Polling attempt ${attempts}/${maxAttempts}`);

      try {
        // Fetch fresh token profile directly from Firestore
        const freshTokenProfile = await getTokenProfile(currentUser.uid);
        const currentTokens = freshTokenProfile?.genToken || 0;

        // Also update the auth context
        await refreshTokenProfile();

        // Check if tokens have increased
        if (currentTokens > initialTokenCount.current) {
          console.log(
            `Tokens updated! ${initialTokenCount.current} -> ${currentTokens}`
          );
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;

          // Emit event to notify other components (like TokenDisplay)
          window.dispatchEvent(new Event('tokenCountChanged'));

          setModalState('success');
          setSessionStatus({
            status: 'complete',
            payment_status: 'paid'
          });
        } else if (attempts >= maxAttempts) {
          // Timeout - webhook might be delayed, but show success anyway
          console.warn(
            'Polling timeout - showing success but webhook may still be processing'
          );
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
  }, [currentUser, tokenProfile, refreshTokenProfile]);

  // Check for active subscriptions when modal opens
  useEffect(() => {
    if (!isPurchaseModalOpen || !currentUser) return;

    const checkSubscriptions = async () => {
      try {
        const checkActiveSubscriptions = httpsCallable(
          functions,
          'checkActiveSubscriptions'
        );
        const { data } = await checkActiveSubscriptions();

        if (data.hasActiveSubscription) {
          console.log(
            `User has ${data.subscriptionCount} active subscription(s)`,
            data.subscriptions
          );
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

  const handlePlanSelect = (plan) => {
    setSelectedPlan(plan);
    setModalState('checkout');
  };

  const handleBackToPricing = () => {
    setModalState('pricing');
    setSelectedPlan(null);
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

          const { data } = await createStripeSession({
            ui_mode: 'embedded',
            redirect_on_completion: 'never', // Stay in embedded mode, use onComplete callback
            line_items: [
              {
                price:
                  selectedPlan === 'monthly'
                    ? process.env.STRIPE_MONTHLY_PRICE_ID
                    : process.env.STRIPE_YEARLY_PRICE_ID,
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
        console.log('Payment completed, waiting for webhook confirmation...');
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
        return 'Welcome to Pro!';
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

            <div className={styles.pricingContainer}>
              {/* Monthly Plan */}
              <div className={styles.pricingCard}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.planName}>Pro Monthly</h3>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.tokenCount}>
                    <img
                      src="/ui_assets/token-image.png"
                      alt="Token"
                      className={styles.tokenIcon}
                    />
                    <span className={styles.tokenAmount}>100</span>
                    <span className={styles.tokenLabel}>Tokens Now</span>
                  </div>
                  <div className={styles.tokenRefill}>
                    <img
                      src="/ui_assets/token-image.png"
                      alt="Token"
                      className={styles.tokenIconSmall}
                    />
                    <span className={styles.refillAmount}>+100</span>
                    <span className={styles.refillLabel}>
                      top-up each month
                    </span>
                  </div>
                  <div className={styles.pricing}>
                    <span className={styles.price}>$10</span>
                    <span className={styles.period}>/month</span>
                  </div>
                  <p>Use AI Gen Tokens for:</p>
                  <ul className={styles.featureList}>
                    <li>AI Render from Editor Scene Screenshot</li>
                    <li>Text-to-Image and Image-to-Image</li>
                    <li>Inpainting & Outpainting</li>
                    <li>All 3DStreet Editor Pro features</li>
                  </ul>
                  <button
                    className={styles.purchaseButton}
                    onClick={() => handlePlanSelect('monthly')}
                  >
                    Subscribe to Pro Monthly
                  </button>
                </div>
              </div>

              {/* Annual Plan */}
              <div className={`${styles.pricingCard} ${styles.featured}`}>
                <div className={styles.badge}>Best Value</div>
                <div className={styles.cardHeader}>
                  <h3 className={styles.planName}>Pro Annual</h3>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.tokenCount}>
                    <img
                      src="/ui_assets/token-image.png"
                      alt="Token"
                      className={styles.tokenIcon}
                    />
                    <span className={styles.tokenAmount}>840</span>
                    <span className={styles.tokenLabel}>Tokens Now</span>
                  </div>
                  <div className={styles.tokenRefill}>
                    <img
                      src="/ui_assets/token-image.png"
                      alt="Token"
                      className={styles.tokenIconSmall}
                    />
                    <span className={styles.refillAmount}>+100</span>
                    <span className={styles.refillLabel}>
                      top-up each month
                    </span>
                  </div>
                  <div className={styles.pricing}>
                    <span className={styles.price}>$84</span>
                    <span className={styles.period}>/year</span>
                  </div>
                  <div className={styles.savings}>Save 30% vs monthly</div>
                  <ul className={styles.featureList}>
                    <li>AI Render from Editor Screenshot</li>
                    <li>Text-to-Image and Image-to-Image</li>
                    <li>Inpainting & Outpainting</li>
                    <li>All 3DStreet Editor Pro features</li>
                  </ul>
                  <button
                    className={`${styles.purchaseButton} ${styles.primary}`}
                    onClick={() => handlePlanSelect('annual')}
                  >
                    Subscribe to Pro Annual
                  </button>
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
            <p>Your Pro subscription is now active.</p>
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
