/**
 * PurchaseModal - Token purchase modal for image generator
 * Shows pricing tiers and handles checkout
 */
import { useEffect, useState } from 'react';
import useImageGenStore from '../store';
import styles from './PurchaseModal.module.scss';

const PurchaseModal = () => {
  const { modal, setModal } = useImageGenStore();
  const [isLoading, setIsLoading] = useState(false);

  const isPurchaseModalOpen = modal === 'purchase';

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isPurchaseModalOpen) {
        setModal(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isPurchaseModalOpen, setModal]);

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

  const handlePurchase = async (plan) => {
    setIsLoading(true);
    try {
      // TODO: Implement actual checkout flow
      // This should trigger Firebase Cloud Function to create Stripe checkout session
      console.log('Purchasing plan:', plan);

      // For now, just show a message
      alert(`Purchasing ${plan} plan - checkout flow coming soon!`);
    } catch (error) {
      console.error('Purchase error:', error);
      alert('Purchase failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isPurchaseModalOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={() => setModal(null)}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Purchase AI Generation Tokens</h2>
          <button
            className={styles.closeButton}
            onClick={() => setModal(null)}
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

        {/* Subtitle */}
        <p className={styles.modalSubtitle}>
          Choose a plan to continue generating AI images:
        </p>

        {/* Pricing Cards */}
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
                <span className={styles.refillLabel}>top-up each month</span>
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
                onClick={() => handlePurchase('monthly')}
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Subscribe to Pro Monthly'}
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
                <span className={styles.refillLabel}>top-up each month</span>
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
                onClick={() => handlePurchase('annual')}
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Subscribe to Pro Annual'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PurchaseModal;
