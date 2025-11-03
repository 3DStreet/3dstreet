/**
 * PurchaseModal - Token purchase modal for image generator
 * Shows pricing tiers and handles embedded Stripe checkout
 */
import { useEffect, useState, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout
} from '@stripe/react-stripe-js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../editor/services/firebase';
import useImageGenStore from '../store';
import styles from './PurchaseModal.module.scss';

// Initialize Stripe
const stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);

const PurchaseModal = () => {
  const { modal, setModal } = useImageGenStore();
  const [modalState, setModalState] = useState('pricing');
  // States: 'pricing' | 'checkout' | 'loading' | 'success' | 'error'

  const [selectedPlan, setSelectedPlan] = useState(null); // 'monthly' | 'annual'
  const [sessionStatus, setSessionStatus] = useState(null);

  const isPurchaseModalOpen = modal === 'purchase';

  // Handler functions
  const handleClose = useCallback(() => {
    setModal(null);
    setModalState('pricing');
    setSelectedPlan(null);
    setSessionStatus(null);
  }, [setModal]);

  // Check URL on mount for return from Stripe
  useEffect(() => {
    if (!isPurchaseModalOpen) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');

    if (sessionId) {
      // User returned from Stripe embedded checkout
      setModalState('loading');

      const checkSessionStatus = async () => {
        try {
          const getSessionStatus = httpsCallable(
            functions,
            'getStripeSessionStatus'
          );
          const { data } = await getSessionStatus({ sessionId });

          setSessionStatus(data);

          if (data.status === 'complete' && data.payment_status === 'paid') {
            setModalState('success');
          } else {
            setModalState('error');
          }
        } catch (error) {
          console.error('Error checking session status:', error);
          setModalState('error');
        }
      };

      checkSessionStatus();

      // Clean up URL
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

  // Fetch client secret for Stripe Embedded Checkout
  const fetchClientSecret = useCallback(async () => {
    if (!selectedPlan) {
      throw new Error('No plan selected');
    }

    try {
      const createStripeSession = httpsCallable(
        functions,
        'createStripeSession'
      );

      const { data } = await createStripeSession({
        ui_mode: 'embedded',
        line_items: [
          {
            price:
              selectedPlan === 'monthly'
                ? process.env.STRIPE_MONTHLY_PRICE_ID
                : process.env.STRIPE_YEARLY_PRICE_ID,
            quantity: 1
          }
        ],
        mode: 'subscription',
        return_url: `${window.location.origin}/image-generator?session_id={CHECKOUT_SESSION_ID}`
      });

      return data.clientSecret;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      setModalState('error');
      throw error;
    }
  }, [selectedPlan]);

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
      default:
        return 'Purchase';
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
                options={{ fetchClientSecret }}
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
            <p>Checking payment status...</p>
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
              className={`${styles.purchaseButton} ${styles.primary}`}
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
      </div>
    </div>
  );
};

export default PurchaseModal;
