/**
 * TokenDisplay component - displays user's generation token count
 * Reusable shared component with CSS module styling
 */
import { AuthProvider, useAuthContext } from '../../contexts';
import TokenDetailsCard from './TokenDetailsCard';
import styles from './TokenDisplay.module.scss';

/**
 * TokenDisplayBase - Pure presentational component without auth context
 * Use this when you want to display a token count without needing auth
 */
export const TokenDisplayBase = ({
  count,
  showLabel = false,
  useContainer = false,
  inline = false,
  tokenType = 'genToken',
  label = null,
  iconSrc = null,
  className = ''
}) => {
  // Don't render if no token count available
  if (count === null || count === undefined) {
    return null;
  }

  const tokenIcon =
    iconSrc ||
    (tokenType === 'geoToken'
      ? '/ui_assets/token-geo.png'
      : '/ui_assets/token-image.png');
  const tokenLabel =
    label || (tokenType === 'geoToken' ? 'Geo Tokens' : 'AI Generation Tokens');

  const displayClassName = [
    styles.tokenDisplay,
    inline && styles.inline,
    className
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <span className={displayClassName}>
      <img src={tokenIcon} alt={tokenLabel} className={styles.tokenIcon} />
      <span className={styles.count}>{count}</span>
      {showLabel && <span className={styles.label}>{tokenLabel}</span>}
    </span>
  );

  return useContainer ? (
    <div className={styles.tokenContainer}>{content}</div>
  ) : (
    content
  );
};

/**
 * TokenDisplayInner - shows token count without AuthProvider wrapper
 * Use this when already inside an AuthProvider context (e.g., in ProfileModal)
 */
export const TokenDisplayInner = ({
  showLabel = false,
  useContainer = false,
  inline = false,
  tokenType = 'genToken',
  label = null,
  count = null,
  iconSrc = null,
  showDetails = false
}) => {
  const { currentUser, tokenProfile } = useAuthContext();

  // Auto-configure based on tokenType if not explicitly provided
  const tokenCount = count !== null ? count : tokenProfile?.[tokenType];

  // Only check for user if count is not explicitly provided
  if (count === null && !currentUser) {
    return null;
  }

  // Don't render if no token count available
  if (tokenCount === null || tokenCount === undefined) {
    return null;
  }

  const baseDisplay = (
    <TokenDisplayBase
      count={tokenCount}
      showLabel={showLabel}
      useContainer={useContainer}
      inline={inline}
      tokenType={tokenType}
      label={label}
      iconSrc={iconSrc}
      className={showDetails ? styles.hoverable : ''}
    />
  );

  // Wrap with TokenDetailsCard if showDetails is enabled
  if (showDetails) {
    return (
      <TokenDetailsCard tokenType={tokenType} showDetails={showDetails}>
        {baseDisplay}
      </TokenDetailsCard>
    );
  }

  return baseDisplay;
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
