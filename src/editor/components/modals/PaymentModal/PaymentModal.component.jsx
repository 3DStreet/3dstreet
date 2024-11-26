import { httpsCallable } from 'firebase/functions';
import styles from './PaymentModal.module.scss';
import { useState } from 'react';

import { loadStripe } from '@stripe/stripe-js';
import { useAuthContext } from '../../../contexts/index.js';
import { CheckMark32Icon, Loader } from '../../../icons';
import { Button } from '../../components/index.js';
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
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        mode: 'subscription',
        success_url: `${window.location.href.split('?')[0]}?payment=success`,
        cancel_url: `${window.location.href.split('?')[0]}?payment=cancel`,
        metadata: { userId: currentUser.uid },
        allow_promotion_codes: true,
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
    >
      <div className={styles.paymentDetails}>
        <h3>Unlock Geospatial Features with a free 30 day trial</h3>
        <h2>
          Create with geospatial maps and share your vision in augmented reality
          with 3DStreet Pro.
        </h2>
        <ul>
          <li>
            <CheckMark32Icon /> All features in Free
          </li>
          <li>
            <CheckMark32Icon />
            Integrated 2D & 3D Maps
          </li>
          <li>
            <CheckMark32Icon />
            Advanced Street Geometry
          </li>
          <li>
            <CheckMark32Icon />
            GLTF Export and Augmented Reality
          </li>
          <li>&nbsp;</li>
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
                <Button variant="filled">Sign in to 3DStreet Cloud</Button>
              </div>
            )}
          </li>
        </ul>
      </div>
    </Modal>
  );
};

export { PaymentModal };
