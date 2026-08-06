/**
 * BuyTokensModal - shared one-time gen-token pack purchase modal (#1374).
 *
 * Paid plans (Pro/Max) only: this is an upsell for subscribers who've burned
 * through their monthly allowance, not a subscription alternative. Free users
 * see an "Upgrade to Pro" prompt that the caller routes to UpgradeModal via
 * onUpgradeInstead. Purchased tokens are added to the current balance and are
 * never clawed back by the monthly refill (top-up-to-floor) — but they do NOT
 * stack on top of it: a balance above the plan floor absorbs the refill until
 * it's spent back down, so the UI copy deliberately makes no stacking or
 * expiry claims.
 *
 * Pack definitions live in pricing.js (TOKEN_PACKS — flat $0.10/token, v1);
 * the server mirror + webhook grant live in public/functions/token-packs.js
 * and stripe.js.
 *
 * Reuses UpgradeModal's stylesheet so the two purchase surfaces stay visually
 * identical — new class names belong there, not in a fork of it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import posthog from 'posthog-js';
import { useAuthContext } from '@shared/contexts';
import EmbeddedCheckout from '@shared/components/EmbeddedCheckout';
import { getTokenProfile } from '@shared/utils/tokens';
import { formatCurrency } from '@shared/utils/format';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import { TOKEN_PACKS } from '../UpgradeModal/pricing';
import styles from '../UpgradeModal/UpgradeModal.module.scss';

// Stripe price IDs per pack, injected at build time by dotenv-webpack from
// config/.env.{development,production}. The webhook maps these same IDs back
// to a token grant (token-packs.js), so the two sets must stay aligned. A pack
// with no configured price renders disabled rather than breaking checkout.
const PACK_PRICE_IDS = {
  starter: process.env.STRIPE_TOKENS_STARTER_PRICE_ID,
  standard: process.env.STRIPE_TOKENS_STANDARD_PRICE_ID,
  power: process.env.STRIPE_TOKENS_POWER_PRICE_ID
};

const CloseIcon = () => (
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
);

const BuyTokensModal = ({
  isOpen,
  onClose,
  source = 'unknown',
  onSignIn,
  onUpgradeInstead,
  onSuccess
}) => {
  const { currentUser, tokenProfile } = useAuthContext();
  const t = useSharedMessages();
  const [modalState, setModalState] = useState('packs');
  // 'packs' | 'checkout'
  const [selectedPack, setSelectedPack] = useState(null);
  // Hide the Back button once payment is in-flight (same as UpgradeModal).
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const handlePaymentSubmitted = useCallback(
    () => setPaymentSubmitted(true),
    []
  );
  // Balance snapshot at checkout start; the webhook grant bumps genToken past
  // it, which is what verifyPurchase polls for.
  const balanceAtCheckout = useRef(0);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Reset internal state whenever the modal closes, regardless of the path
  // out (close button, escape, or the caller routing away after a successful
  // purchase via onSuccess). Without this, reopening after a purchase would
  // land on the stale checkout view instead of the pack list — the component
  // stays mounted and only returns null while closed.
  useEffect(() => {
    if (isOpen) return;
    setModalState('packs');
    setSelectedPack(null);
    setPaymentSubmitted(false);
  }, [isOpen]);

  const handleBuyPack = useCallback(
    async (pack) => {
      // Snapshot the freshest balance we can get. On a failed fetch, fall
      // back to the auth context's cached profile rather than 0 — a zero
      // snapshot would make verifyPurchase trivially pass on any pre-existing
      // balance and show premature success before the webhook grant lands.
      try {
        const profile = currentUser?.uid
          ? await getTokenProfile(currentUser.uid)
          : null;
        balanceAtCheckout.current =
          profile?.genToken ?? tokenProfile?.genToken ?? 0;
      } catch (error) {
        console.error('Error snapshotting token balance:', error);
        balanceAtCheckout.current = tokenProfile?.genToken ?? 0;
      }
      setSelectedPack(pack);
      setModalState('checkout');
      posthog.capture('token_pack_checkout_started', { pack: pack.id, source });
    },
    [currentUser, tokenProfile, source]
  );

  const verifyPurchase = useCallback(async () => {
    if (!currentUser?.uid) return false;
    const fresh = await getTokenProfile(currentUser.uid);
    if ((fresh?.genToken || 0) > balanceAtCheckout.current) {
      // Refresh token displays (TokenDisplay, generator header, etc.).
      window.dispatchEvent(new Event('tokenCountChanged'));
      return true;
    }
    return false;
  }, [currentUser]);

  // Keyup (not keydown) to match the shared Modal component — see the
  // double-close note in UpgradeModal.
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    document.addEventListener('keyup', handleEscape);
    return () => document.removeEventListener('keyup', handleEscape);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isPaidUser = !!currentUser?.isPro;

  const renderPacks = () => (
    <>
      <div className={styles.pricingHeader}>
        <div className={styles.pricingTitleBlock}>
          <h2 className={styles.pricingTitle}>{t('buyTokensTitle')}</h2>
          <p className={styles.pricingSubtitle}>{t('buyTokensSubtitle')}</p>
        </div>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label={t('close')}
        >
          <CloseIcon />
        </button>
      </div>

      <div className={styles.divider} />

      {!currentUser ? (
        <div className={styles.signInPrompt}>
          <p className={styles.signInCopy}>{t('buyTokensSignInPrompt')}</p>
          <button type="button" className={styles.ctaButton} onClick={onSignIn}>
            {t('signInToCloud')}
          </button>
        </div>
      ) : !isPaidUser ? (
        // Token packs are a paid-plan upsell — free users upgrade instead
        // (the server enforces this too; see createStripeSession).
        <div className={styles.signInPrompt}>
          <p className={styles.signInCopy}>{t('buyTokensPaidPlanOnly')}</p>
          <button
            type="button"
            className={styles.ctaButton}
            onClick={onUpgradeInstead}
          >
            {t('upgradeToPro')}
          </button>
        </div>
      ) : !TOKEN_PACKS.some((pack) => PACK_PRICE_IDS[pack.id]) ? (
        // No pack has a configured Stripe price (env not set for this
        // deployment) — say so instead of rendering three dead buttons.
        <div className={styles.signInPrompt}>
          <p className={styles.signInCopy}>{t('buyTokensUnavailable')}</p>
        </div>
      ) : (
        <div className={styles.packList}>
          {TOKEN_PACKS.map((pack) => (
            <div key={pack.id} className={styles.packRow}>
              <div className={styles.packInfo}>
                <div className={styles.packName}>{pack.name}</div>
                <div className={styles.packTokens}>
                  {t('buyTokensPackTokens', { tokens: pack.tokens })}
                </div>
              </div>
              <div className={styles.packBuy}>
                <div className={styles.packPriceBlock}>
                  <span className={styles.packPrice}>
                    {formatCurrency(pack.price)}
                  </span>
                  <span className={styles.packOneTime}>
                    {t('buyTokensOneTime')}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.packCta}
                  disabled={!PACK_PRICE_IDS[pack.id]}
                  onClick={() => handleBuyPack(pack)}
                  aria-label={t('buyTokensBuyCta', { name: pack.name })}
                >
                  {t('buy')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderCheckout = () => (
    <>
      <div className={styles.modalHeader}>
        {!paymentSubmitted && (
          <button
            className={styles.backButton}
            onClick={() => {
              setModalState('packs');
              setSelectedPack(null);
            }}
          >
            ← {t('back')}
          </button>
        )}
        <h2 className={styles.modalTitle}>{t('buyTokensCheckoutTitle')}</h2>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label={t('close')}
        >
          <CloseIcon />
        </button>
      </div>

      <EmbeddedCheckout
        priceId={PACK_PRICE_IDS[selectedPack.id]}
        mode="payment"
        source={source}
        plan={`token-pack-${selectedPack.id}`}
        verifyPurchase={verifyPurchase}
        onSuccess={onSuccess}
        onClose={handleClose}
        onPaymentSubmitted={handlePaymentSubmitted}
        successTitle={t('buyTokensSuccessTitle')}
        successMessage={t('buyTokensSuccessMessage', {
          tokens: selectedPack.tokens
        })}
        successCta={t('done')}
      />
    </>
  );

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div
        className={`${styles.modalContent} ${modalState === 'checkout' ? styles.modalContentWide : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {modalState === 'packs' && renderPacks()}
        {modalState === 'checkout' && selectedPack && renderCheckout()}
      </div>
    </div>
  );
};

BuyTokensModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  source: PropTypes.string,
  onSignIn: PropTypes.func,
  onUpgradeInstead: PropTypes.func,
  onSuccess: PropTypes.func
};

export default BuyTokensModal;
