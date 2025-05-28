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
  const [selectedPlan, setSelectedPlan] = useState('monthly');
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
        cancel_url: `${window.location.href.split('?')[0]}?payment=cancel`,
        metadata: { userId: currentUser.uid },
        // allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: 30,
          metadata: {
            userId: currentUser.uid
          }
        }
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
      title="Unlock Pro Features"
    >
      <div className={styles.paymentDetails}>
        <h3>Try 3DStreet Pro now with a free 30 day trial.</h3>
        <h2>3DStreet Geospatial Pro includes all features of Free and adds:</h2>
        <ul>
          <li>
            <CheckMark32Icon />
            Integrated 2D & 3D Maps
          </li>
          <li>
            <CheckMark32Icon />
            Intersections and Advanced Street Geometry
          </li>
          <li>
            <CheckMark32Icon />
            glTF Export with `AR Ready` Output
          </li>
          <li>
            <CheckMark32Icon />
            Import Custom 3D Models and Images
          </li>
          <li>
            <CheckMark32Icon />
            Screenshot Overlay Customization
          </li>
          <li>&nbsp;</li>
          <li className={styles.pricing}>
            <div className={styles.planSelector}>
              <button
                className={`${styles.planButton} ${selectedPlan === 'monthly' ? styles.selected : ''}`}
                onClick={() => setSelectedPlan('monthly')}
              >
                Monthly
                <span className={styles.price}>$9.99/mo</span>
              </button>
              <button
                className={`${styles.planButton} ${selectedPlan === 'yearly' ? styles.selected : ''}`}
                onClick={() => setSelectedPlan('yearly')}
              >
                Yearly
                <span className={styles.price}>$99/year</span>
                <span className={styles.savings}>Save 17%</span>
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
                        Try Now
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
