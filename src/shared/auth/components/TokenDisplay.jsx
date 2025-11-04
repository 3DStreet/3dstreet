/**
 * TokenDisplay component - displays user's generation token count
 * Reusable shared component with CSS module styling
 */
import { AuthProvider, useAuthContext } from '../../contexts';
import TokenDetailsCard from './TokenDetailsCard';
import styles from '../styles/TokenDisplay.module.scss';

/**
 * TokenDisplayInner - shows token count without AuthProvider wrapper
 * Use this when already inside an AuthProvider context (e.g., in ProfileModal)
 */
export const TokenDisplayInner = ({
  showLabel = false,
  useContainer = false,
  inline = false, // Inline variant for use inside buttons
  tokenType = 'genToken', // 'genToken' or 'geoToken'
  label = null, // Custom label, or auto-generated from tokenType
  count = null, // Custom count, or auto-retrieved from tokenProfile
  iconSrc = null, // Custom icon, or auto-selected from tokenType
  showDetails = false // Enable hover card with detailed info
}) => {
  const { currentUser, tokenProfile } = useAuthContext();

  // Auto-configure based on tokenType if not explicitly provided
  const tokenCount = count !== null ? count : tokenProfile?.[tokenType];
  const tokenIcon =
    iconSrc ||
    (tokenType === 'geoToken'
      ? '/ui_assets/token-geo.png'
      : '/ui_assets/token-image.png');
  const tokenLabel =
    label || (tokenType === 'geoToken' ? 'Geo Tokens' : 'AI Generation Tokens');

  // Only show if user is logged in
  if (!currentUser) {
    return null;
  }

  // Don't render if no token count available (unless explicitly provided)
  if (tokenCount === null || tokenCount === undefined) {
    return null;
  }

  const displayClassName = [
    styles.tokenDisplay,
    inline && styles.inline,
    showDetails && styles.hoverable
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <span className={displayClassName}>
      <img src={tokenIcon} alt={tokenLabel} className={styles.tokenIcon} />
      <span className={styles.multiplier}>×</span>
      <span className={styles.count}>{tokenCount}</span>
      {showLabel && <span className={styles.label}>{tokenLabel}</span>}
    </span>
  );

  const displayContent = useContainer ? (
    <div className={styles.tokenContainer}>{content}</div>
  ) : (
    content
  );

  // Wrap with TokenDetailsCard if showDetails is enabled
  if (showDetails) {
    return (
      <TokenDetailsCard tokenType={tokenType} showDetails={showDetails}>
        {displayContent}
      </TokenDetailsCard>
    );
  }

  return displayContent;
};

/**
 * TokenDisplay - shows token count with AuthProvider wrapper
 * Use this for standalone usage (e.g., in header)
 */
const TokenDisplay = ({ showLabel = false, showDetails = false, ...props }) => {
  return (
    <AuthProvider>
      <TokenDisplayInner
        showLabel={showLabel}
        showDetails={showDetails}
        {...props}
      />
    </AuthProvider>
  );
};

export default TokenDisplay;
