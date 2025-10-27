/**
 * TokenDisplay component - displays user's generation token count
 * Reusable component with CSS module styling
 */
import { AuthProvider, useAuthContext } from '../../editor/contexts';
import styles from './TokenDisplay.module.scss';

/**
 * TokenDisplayInner - shows token count without AuthProvider wrapper
 * Use this when already inside an AuthProvider context (e.g., in ProfileModal)
 */
export const TokenDisplayInner = ({
  showLabel = false,
  useContainer = false
}) => {
  const { currentUser, tokenProfile } = useAuthContext();

  // Only show if user is logged in and has a token profile
  if (!currentUser || !tokenProfile) {
    return null;
  }

  const content = (
    <span className={styles.tokenDisplay}>
      <img
        src="/ui_assets/token-image.png"
        alt="Image Token"
        className={styles.tokenIcon}
      />
      <span className={styles.multiplier}>×</span>
      <span className={styles.count}>{tokenProfile.genToken}</span>
      {showLabel && <span className={styles.label}>AI Generation Tokens</span>}
    </span>
  );

  if (useContainer) {
    return <div className={styles.tokenContainer}>{content}</div>;
  }

  return content;
};

/**
 * TokenDisplay - shows token count with AuthProvider wrapper
 * Use this for standalone usage (e.g., in header)
 */
const TokenDisplay = ({ showLabel = false }) => {
  return (
    <AuthProvider>
      <TokenDisplayInner showLabel={showLabel} />
    </AuthProvider>
  );
};

export default TokenDisplay;
