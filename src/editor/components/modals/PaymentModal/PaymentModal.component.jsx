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

let stripePromise;
const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);
  }

  return stripePromise;
};

const PaymentModal = ({ isOpen, onClose }) => {
  const { currentUser } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

  if (location.hash.includes('success')) {
    posthog.capture('checkout_finished');
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
        success_url: `${location.origin}/#/modal/payment/success`,
        cancel_url: `${location.origin}/#/modal/payment`,
        metadata: { userId: currentUser.uid },
        allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: 7,
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

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
    >
      <div className={styles.paymentDetails}>
        <h3>Unlock Geospatial Features with a free 7 day trial</h3>
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
