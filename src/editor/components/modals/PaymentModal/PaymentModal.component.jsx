import { httpsCallable } from 'firebase/functions';
import styles from './PaymentModal.module.scss';
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { useAuthContext } from '../../../contexts/index.js';
import { CheckMark32Icon, Loader } from '@shared/icons';
import { Button } from '../../elements/index.js';
import Modal from '@shared/components/Modal/Modal.jsx';
import { functions } from '@shared/services/firebase';
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

// Extract UTM params for tracking email→payment conversion funnel
const getUtmParams = () => {
  const params = new URLSearchParams(window.location.search);
  const utmParams = {};
  [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term'
  ].forEach((key) => {
    const value = params.get(key);
    if (value) utmParams[key] = value;
  });
  return Object.keys(utmParams).length > 0 ? utmParams : null;
};

const PaymentModal = () => {
  const { currentUser } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState('pro'); // 'pro' | 'max'
  const initialBilling = window.location.hash.includes('payment-modal-annual')
    ? 'yearly'
    : 'monthly';
  const [billingPeriod, setBillingPeriod] = useState(initialBilling);
  const selectedPlan = `${selectedTier}-${billingPeriod}`;
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const postCheckout = useStore((state) => state.postCheckout);
  const checkoutSuccess = location.hash.includes('success');

  if (checkoutSuccess) {
    posthog.capture('checkout_finished');
    // Funnel event: payment_completed (standardized event for conversion funnel)
    posthog.capture('payment_completed', {
      plan: selectedPlan
    });
  } else if (location.hash.includes('cancel')) {
    posthog.capture('checkout_canceled');
  }

  const startCheckout = async () => {
    const utmParams = getUtmParams();
    posthog.capture('start_checkout', utmParams || {});
    // Funnel event: checkout_started (standardized event for conversion funnel)
    posthog.capture('checkout_started', {
      plan: selectedPlan,
      ...(utmParams || {})
    });
    setIsLoading(true);
    const priceIdMap = {
      'pro-monthly': process.env.STRIPE_MONTHLY_PRICE_ID,
      'pro-yearly': process.env.STRIPE_YEARLY_PRICE_ID,
      'max-monthly': process.env.STRIPE_MAX_MONTHLY_PRICE_ID,
      'max-yearly': process.env.STRIPE_MAX_YEARLY_PRICE_ID
    };
    try {
      const {
        data: { id }
      } = await httpsCallable(
        functions,
        'createStripeSession'
      )({
        line_items: [
          {
            price: priceIdMap[selectedPlan],
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
      title="Choose Plan"
    >
      <div className={styles.paymentDetails}>
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
              background: '#f3f4f6',
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
                  billingPeriod === 'monthly' ? '#fff' : 'transparent',
                color: billingPeriod === 'monthly' ? '#000' : '#6b7280',
                boxShadow:
                  billingPeriod === 'monthly'
                    ? '0 1px 3px rgba(0,0,0,0.1)'
                    : 'none'
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
                background: billingPeriod === 'yearly' ? '#fff' : 'transparent',
                color: billingPeriod === 'yearly' ? '#000' : '#6b7280',
                boxShadow:
                  billingPeriod === 'yearly'
                    ? '0 1px 3px rgba(0,0,0,0.1)'
                    : 'none'
              }}
              onClick={() => setBillingPeriod('yearly')}
            >
              Yearly
              <span
                style={{
                  marginLeft: '6px',
                  fontSize: '11px',
                  color: '#0eaf00',
                  fontWeight: '600'
                }}
              >
                Save 17%
              </span>
            </button>
          </div>
        </div>

        {/* Two-column tier cards */}
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* Pro card */}
          <div
            onClick={() => setSelectedTier('pro')}
            style={{
              flex: 1,
              border:
                selectedTier === 'pro'
                  ? '2px solid #0eaf00'
                  : '1px solid #e0e0e0',
              borderRadius: '12px',
              padding: '20px',
              cursor: 'pointer',
              background: selectedTier === 'pro' ? '#f0fff0' : '#fff',
              transition: 'all 0.2s ease'
            }}
          >
            <h3
              style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#000' }}
            >
              Pro
            </h3>
            <div style={{ marginBottom: '12px' }}>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#000'
                }}
              >
                {billingPeriod === 'monthly' ? '$14' : '$11.67'}
              </span>
              <span style={{ color: '#6b7280', fontSize: '14px' }}>/mo</span>
              {billingPeriod === 'yearly' && (
                <span
                  style={{
                    color: '#6b7280',
                    fontSize: '12px',
                    marginLeft: '4px'
                  }}
                >
                  ($140/yr)
                </span>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: billingPeriod === 'yearly' ? '6px' : '16px',
                padding: '8px',
                background: '#1a1a1a',
                borderRadius: '6px'
              }}
            >
              <img
                src="/ui_assets/token-image.png"
                alt="Token"
                style={{ width: '18px', height: '18px' }}
              />
              <span
                style={{
                  fontWeight: '600',
                  color: '#fff',
                  fontSize: '15px'
                }}
              >
                {billingPeriod === 'monthly' ? '140' : '1,400'}
              </span>
              <span style={{ color: '#9ca3af', fontSize: '12px' }}>
                {billingPeriod === 'monthly' ? 'tokens/mo' : 'tokens upfront'}
              </span>
            </div>
            {billingPeriod === 'yearly' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '16px',
                  padding: '6px 8px',
                  background: '#1a1a1a',
                  borderRadius: '6px'
                }}
              >
                <img
                  src="/ui_assets/token-image.png"
                  alt="Token"
                  style={{ width: '14px', height: '14px' }}
                />
                <span
                  style={{
                    fontWeight: '600',
                    color: '#0eaf00',
                    fontSize: '13px'
                  }}
                >
                  +140
                </span>
                <span style={{ color: '#9ca3af', fontSize: '11px' }}>
                  tokens/mo top-up
                </span>
              </div>
            )}
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                fontSize: '13px',
                color: '#000'
              }}
            >
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> Snapshots without watermark
              </li>
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> Unlimited Geospatial 3D Maps
              </li>
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> Import custom 3D models
              </li>
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> AI image generation
              </li>
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> Export glTF for AR apps
              </li>
            </ul>
          </div>

          {/* Max card */}
          <div
            onClick={() => setSelectedTier('max')}
            style={{
              flex: 1,
              border:
                selectedTier === 'max'
                  ? '2px solid #0eaf00'
                  : '1px solid #e0e0e0',
              borderRadius: '12px',
              padding: '20px',
              cursor: 'pointer',
              background: selectedTier === 'max' ? '#f0fff0' : '#fff',
              transition: 'all 0.2s ease'
            }}
          >
            <h3
              style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#000' }}
            >
              Max
            </h3>
            <div style={{ marginBottom: '12px' }}>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#000'
                }}
              >
                {billingPeriod === 'monthly' ? '$50' : '$41.67'}
              </span>
              <span style={{ color: '#6b7280', fontSize: '14px' }}>/mo</span>
              {billingPeriod === 'yearly' && (
                <span
                  style={{
                    color: '#6b7280',
                    fontSize: '12px',
                    marginLeft: '4px'
                  }}
                >
                  ($500/yr)
                </span>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: billingPeriod === 'yearly' ? '6px' : '16px',
                padding: '8px',
                background: '#1a1a1a',
                borderRadius: '6px'
              }}
            >
              <img
                src="/ui_assets/token-image.png"
                alt="Token"
                style={{ width: '18px', height: '18px' }}
              />
              <span
                style={{
                  fontWeight: '600',
                  color: '#fff',
                  fontSize: '15px'
                }}
              >
                {billingPeriod === 'monthly' ? '500' : '5,000'}
              </span>
              <span style={{ color: '#9ca3af', fontSize: '12px' }}>
                {billingPeriod === 'monthly' ? 'tokens/mo' : 'tokens upfront'}
              </span>
            </div>
            {billingPeriod === 'yearly' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '16px',
                  padding: '6px 8px',
                  background: '#1a1a1a',
                  borderRadius: '6px'
                }}
              >
                <img
                  src="/ui_assets/token-image.png"
                  alt="Token"
                  style={{ width: '14px', height: '14px' }}
                />
                <span
                  style={{
                    fontWeight: '600',
                    color: '#0eaf00',
                    fontSize: '13px'
                  }}
                >
                  +500
                </span>
                <span style={{ color: '#9ca3af', fontSize: '11px' }}>
                  tokens/mo top-up
                </span>
              </div>
            )}
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                fontSize: '13px',
                color: '#000'
              }}
            >
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> Everything in Pro
              </li>
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}
              >
                <CheckMark32Icon /> 3.5x more AI generation tokens
              </li>
            </ul>
          </div>
        </div>

        {/* Action button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '20px'
          }}
        >
          {currentUser ? (
            <div>
              {currentUser.isPro ? (
                <p style={{ color: '#000', fontWeight: '500' }}>
                  Thank you for your subscription.
                </p>
              ) : (
                <div>
                  {isLoading ? (
                    <div className={styles.loadingSpinner}>
                      <Loader className={styles.spinner} />
                    </div>
                  ) : (
                    <Button onClick={startCheckout} variant="filled">
                      {`Activate ${selectedTier === 'max' ? 'Max' : 'Pro'}`}
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
        </div>
      </div>
    </Modal>
  );
};

export { PaymentModal };
