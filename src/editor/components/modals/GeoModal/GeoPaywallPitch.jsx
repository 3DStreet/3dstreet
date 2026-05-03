import PropTypes from 'prop-types';
import { Button } from '../../elements';
import useStore from '@/store.js';
import { getPaywallSurface } from '@shared/components/UpgradeModal/paywallSurfaces';
import posthog from 'posthog-js';
import styles from './GeoPaywallPitch.module.scss';

// Mirrors the initial geoToken grant in shared/utils/tokens.js — used to
// render "X of Y used" in the token usage bar. If the grant changes there,
// update here too.
const FREE_GEO_TOKEN_QUOTA = 3;

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#10b981" />
    <path
      d="M8 12.5l3 3 5-6"
      stroke="white"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const TokenUsageBar = () => (
  <div className={styles.tokenUsageBar}>
    <div className={styles.tokenUsageHeader}>
      <span className={styles.tokenUsageLabel}>GEO TOKENS</span>
      <span className={styles.tokenUsageStatus}>
        0 left · {FREE_GEO_TOKEN_QUOTA} used
      </span>
    </div>
    <div className={styles.tokenUsageTrack}>
      <div className={styles.tokenUsageFill} />
    </div>
  </div>
);

/**
 * Inline paywall pitch shown when a free user runs out of geo tokens.
 * Two variants:
 *   - "modal":   wide, full headline + description + 5 features + Cancel + CTA.
 *                Used inside GeoModal beneath the map.
 *   - "sidebar": narrow, just token bar + short headline + 3 short features + CTA.
 *                Used inside the properties panel's GeoSidebar.
 *
 * Click handler always routes through startCheckout('geo') → existing
 * shared UpgradeModal so the pricing/checkout step stays in one place.
 */
const GeoPaywallPitch = ({ variant = 'modal', onCancel, source }) => {
  const startCheckout = useStore((state) => state.startCheckout);
  const surface = getPaywallSurface('geo');

  const handleUpgrade = () => {
    posthog.capture('geo_paywall_cta_clicked', { source });
    startCheckout('geo');
  };

  const features =
    variant === 'sidebar' ? surface.features.slice(0, 3) : surface.features;

  return (
    <div
      className={`${styles.pitch} ${variant === 'sidebar' ? styles.pitchSidebar : ''}`}
    >
      <TokenUsageBar />

      <h2 className={styles.headline}>{surface.headline}</h2>

      {variant === 'modal' && (
        <p className={styles.description}>{surface.description}</p>
      )}

      <ul className={styles.features}>
        {features.map((feature) => (
          <li key={feature}>
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        {variant === 'modal' && onCancel && (
          <Button
            variant="ghost"
            onClick={onCancel}
            style={{
              background: 'transparent',
              color: '#9ca3af',
              border: '1px solid #404040',
              borderRadius: '8px'
            }}
          >
            Cancel
          </Button>
        )}
        <button type="button" className={styles.cta} onClick={handleUpgrade}>
          Upgrade to Pro
        </button>
      </div>
    </div>
  );
};

GeoPaywallPitch.propTypes = {
  variant: PropTypes.oneOf(['modal', 'sidebar']),
  onCancel: PropTypes.func,
  source: PropTypes.string.isRequired
};

export default GeoPaywallPitch;
