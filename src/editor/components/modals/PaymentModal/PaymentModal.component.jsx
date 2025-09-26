import { httpsCallable } from 'firebase/functions';
import styles from './PaymentModal.module.scss';
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { useAuthContext } from '../../../contexts/index.js';
import { CheckMark32Icon, Loader } from '../../../icons';
import { Button } from '../../elements/index.js';
import Modal from '../Modal.jsx';
import { functions } from '../../../services/firebase.js';
import posthog from 'posthog-js';
import useStore from '@/store';

let stripePromise;
const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);
  }

  return stripePromise;
};

const resetPaymentQueryParam = () => {
  const newUrl = window.location.href.replace(/\?payment=(success|cancel)/, '');
  window.history.replaceState({}, '', newUrl);
};

const PaymentModal = () => {
  const { currentUser } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);
  // Check if the annual hash is present to set initial plan
  const initialPlan = window.location.hash.includes('payment-modal-annual')
    ? 'yearly'
    : 'monthly';
  const [selectedPlan, setSelectedPlan] = useState(initialPlan);
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const postCheckout = useStore((state) => state.postCheckout);
  const checkoutSuccess = location.hash.includes('success');

  if (checkoutSuccess) {
    posthog.capture('checkout_finished');
  } else if (location.hash.includes('cancel')) {
    posthog.capture('checkout_canceled');
  }

  const startCheckout = async () => {
    posthog.capture('start_checkout');
    setIsLoading(true);
    try {
      const {
        data: { id }
      } = await httpsCallable(
        functions,
        'createStripeSession'
      )({
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
        success_url: `${window.location.href.split('?')[0]}?payment=success`,
        cancel_url: `${window.location.href.split('?')[0]}?payment=cancel`
        // userId is now set server-side from authenticated context for security
        // allow_promotion_codes: true
      });

      const stripe = await getStripe();
      await stripe.redirectToCheckout({ sessionId: id });
    } catch (error) {
      console.log(error);
    }
    setIsLoading(false);
  };

  const onClose = () => {
    resetPaymentQueryParam();
    if (checkoutSuccess && postCheckout) {
      setModal(postCheckout);
    } else {
      setModal(null);
    }
  };

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={modal === 'payment'}
      onClose={onClose}
      title="Activate Pro Edition"
    >
      <div className={styles.paymentDetails}>
        <p style={{ fontStyle: 'italic' }}>Everything in Free, plus:</p>
        <ul>
          <li>
            <CheckMark32Icon />
            Download JPEG snapshots without watermark
          </li>
          <li>
            <CheckMark32Icon />
            Unlimited Geospatial 3D Maps
          </li>
          <li>
            <CheckMark32Icon />
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#1a1a1a',
                  borderRadius: '4px',
                  padding: '2px 8px 2px 4px',
                  marginRight: '8px'
                }}
              >
                <img
                  src="/ui_assets/token-image.png"
                  alt="AI Generation Token"
                  style={{
                    width: '16px',
                    height: '16px',
                    marginRight: '4px',
                    display: 'inline-block',
                    verticalAlign: 'middle'
                  }}
                />
                <span style={{ color: '#6b7280', marginRight: '4px' }}>×</span>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#ffffff'
                  }}
                >
                  100
                </span>
              </span>
              AI generation tokens per month
            </span>
          </li>
          <li>
            <CheckMark32Icon />
            Import custom 3D models
          </li>
          <li>
            <CheckMark32Icon />
            Reference custom SVG and glTF files
          </li>
          <li>
            <CheckMark32Icon />
            Export &quot;AR Ready&quot; glTF for Augmented Reality apps
          </li>
          <li>&nbsp;</li>
          <li className={styles.pricing}>
            <div className={styles.planSelector}>
              <button
                className={`${styles.planButton} ${selectedPlan === 'monthly' ? styles.selected : ''}`}
                onClick={() => setSelectedPlan('monthly')}
              >
                Monthly
                <span className={styles.price}>$10/mo</span>
              </button>
              <button
                className={`${styles.planButton} ${selectedPlan === 'yearly' ? styles.selected : ''}`}
                onClick={() => setSelectedPlan('yearly')}
              >
                Yearly
                <span className={styles.savings}>Save 30%</span>
                <span className={styles.price}>$84/year</span>
                <div className={styles.bonus}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: '#1a1a1a',
                      borderRadius: '4px',
                      padding: '2px 8px 2px 4px',
                      marginRight: '4px',
                      minWidth: '50px'
                    }}
                  >
                    <img
                      src="/ui_assets/token-image.png"
                      alt="AI Generation Token"
                      style={{
                        width: '12px',
                        height: '12px',
                        marginRight: '2px'
                      }}
                    />
                    <span
                      style={{
                        color: '#6b7280',
                        marginRight: '2px',
                        fontSize: '10px'
                      }}
                    >
                      ×
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: '500',
                        color: '#ffffff'
                      }}
                    >
                      840
                    </span>
                  </span>
                  AI gen tokens on first purchase
                </div>
              </button>
            </div>
          </li>
          <li>
            {currentUser ? (
              <div className="paymentButton">
                {currentUser.isPro ? (
                  <h3>🎉 Congrats! Thank you for your subscription.</h3>
                ) : (
                  <div>
                    {isLoading ? (
                      <div className={styles.loadingSpinner}>
                        <Loader className={styles.spinner} />
                      </div>
                    ) : (
                      <Button onClick={startCheckout} variant="filled">
                        Activate Now
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.unAuth}>
                <p>To upgrade you have to sign in:</p>
                <Button onClick={() => setModal('signin')} variant="filled">
                  Sign in to 3DStreet Cloud
                </Button>
              </div>
            )}
          </li>
        </ul>
      </div>
    </Modal>
  );
};

export { PaymentModal };
