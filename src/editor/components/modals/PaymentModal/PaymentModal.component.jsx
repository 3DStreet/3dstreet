import { httpsCallable } from 'firebase/functions';
import styles from './PaymentModal.module.scss';

import { loadStripe } from '@stripe/stripe-js';
import PaymentPlaceholderImg from '../../../../../ui_assets/payment-placeholder.png';
import { useAuthContext } from '../../../contexts/index.js';
import { CheckMark32Icon } from '../../../icons/icons.jsx';
import { Button } from '../../components/index.js';
import Modal from '../Modal.jsx';
import { functions } from '../../../services/firebase.js';

let stripePromise;
const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(
      'pk_test_51PAsDFP2BZd7kkhq6uIm5LRHQQCR2qBppnVwMA1vAokzkgjlngXgAgfaz1jexz1IbqoE2WjEQSWxjTpdeDNeJZSP00PqhX34fp'
    );
  }

  return stripePromise;
};

const PaymentModal = ({ isOpen, onClose }) => {
  const { currentUser } = useAuthContext();

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
    >
      <div className={styles.paymentDetails}>
        <h3>Unlock Geospatial Features with 3DStreet Pro</h3>
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
            Google Maps 3D Tiles
          </li>
          <li>
            <CheckMark32Icon />
            Augmented Reality (QR Anchor)
          </li>
          <li>
            <CheckMark32Icon />
            Custom SVG Paths
          </li>
          <li>
            <CheckMark32Icon />
            Mapbox Layers
          </li>
        </ul>
        <Button className={styles.learnMoreBtn} variant="ghost">
          Learn more
        </Button>
      </div>
      <div className={styles.rightCol}>
        {currentUser ? (
          <>
            <img
              className={styles.paymentPlaceholder}
              src={PaymentPlaceholderImg}
            />
            {currentUser.isPremium ? (
              <CheckMark32Icon />
            ) : (
              <Button
                onClick={async () => {
                  try {
                    const {
                      data: { id }
                    } = await httpsCallable(
                      functions,
                      'createStripeSession'
                    )({
                      line_items: [
                        { price: 'price_1PAsLrP2BZd7kkhqoVPaJOT3', quantity: 1 }
                      ],
                      mode: 'subscription',
                      success_url: `${location.origin}/#/modal/payment`,
                      cancel_url: `${location.origin}/#/modal/payment`,
                      metadata: {
                        userId: currentUser.uid
                      }
                    });

                    const stripe = await getStripe();
                    await stripe.redirectToCheckout({ sessionId: id });
                  } catch (error) {
                    console.log(error);
                  }
                }}
                className={styles.checkoutWithBtn}
                variant="filled"
              >
                Checkout with Stripe
              </Button>
            )}
          </>
        ) : (
          <div className={styles.unAuth}>
            <p>To upgrade you have to sign in:</p>
            <Button variant="filled">Sign in to 3DStreet Cloud</Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export { PaymentModal };
