/**
 * TokenDetailsCard - Hover card overlay showing detailed token information
 * Uses Radix UI HoverCard for rich interactive overlays
 */
import * as HoverCard from '@radix-ui/react-hover-card';
import { useAuthContext } from '../../../editor/contexts';
import styles from '../styles/TokenDetailsCard.module.scss';

const TokenDetailsCard = ({
  children,
  tokenType = 'genToken',
  showDetails = true // Control whether to show the hover card
}) => {
  const { currentUser, tokenProfile } = useAuthContext();

  // If showDetails is false, just render the children without hover card
  if (!showDetails || !currentUser) {
    return children;
  }

  // Get token info based on type
  const tokenCount = tokenProfile?.[tokenType] || 0;
  const tokenIcon =
    tokenType === 'geoToken'
      ? '/ui_assets/token-geo.png'
      : '/ui_assets/token-image.png';
  const tokenLabel =
    tokenType === 'geoToken' ? 'Geo Tokens' : 'AI Generation Tokens';
  const tokenDescription =
    tokenType === 'geoToken'
      ? 'Used for geospatial features like 3D map tiles and location services.'
      : 'Used for AI-powered image generation, inpainting, and outpainting.';

  return (
    <HoverCard.Root openDelay={200}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>

      <HoverCard.Portal>
        <HoverCard.Content
          className={styles.hoverCardContent}
          sideOffset={5}
          align="end"
        >
          {/* Token Details Section */}
          <div className={styles.tokenSection}>
            <div className={styles.tokenHeader}>
              <img
                src={tokenIcon}
                alt={tokenLabel}
                className={styles.tokenIconLarge}
              />
              <div className={styles.tokenInfo}>
                <h4 className={styles.tokenTitle}>{tokenLabel}</h4>
                <div className={styles.tokenBalance}>
                  <span className={styles.balanceLabel}>Current Balance:</span>
                  <span className={styles.balanceCount}>{tokenCount}</span>
                </div>
              </div>
            </div>

            <p className={styles.tokenDescription}>{tokenDescription}</p>

            {/* Actions Section */}
            <div className={styles.actionsSection}>
              {tokenCount === 0 ? (
                <div className={styles.outOfTokens}>
                  <p className={styles.warningText}>
                    You are out of {tokenLabel.toLowerCase()}!
                  </p>
                  <button
                    className={styles.purchaseButton}
                    onClick={() => {
                      // This will be handled by the parent component
                      window.dispatchEvent(
                        new CustomEvent('openPurchaseModal', {
                          detail: { tokenType }
                        })
                      );
                    }}
                  >
                    Get More Tokens
                  </button>
                </div>
              ) : (
                tokenCount < 10 && (
                  <div className={styles.lowTokenWarning}>
                    <p className={styles.warningText}>Running low on tokens</p>
                    <a
                      href="#"
                      className={styles.refillLink}
                      onClick={(e) => {
                        e.preventDefault();
                        window.dispatchEvent(
                          new CustomEvent('openPurchaseModal', {
                            detail: { tokenType }
                          })
                        );
                      }}
                    >
                      Refill tokens →
                    </a>
                  </div>
                )
              )}
            </div>

            {/* Usage Tips */}
            <div className={styles.usageTips}>
              <h5 className={styles.tipsTitle}>Token Usage:</h5>
              <ul className={styles.tipsList}>
                {tokenType === 'genToken' ? (
                  <>
                    <li>1 token = 1 image generation</li>
                    <li>Inpainting uses 1 token</li>
                    <li>Outpainting uses 1 token</li>
                  </>
                ) : (
                  <>
                    <li>1 token = 1 map tile request</li>
                    <li>Location services use tokens</li>
                    <li>Geospatial features require tokens</li>
                  </>
                )}
              </ul>
            </div>
          </div>

          <HoverCard.Arrow className={styles.hoverCardArrow} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
};

export default TokenDetailsCard;
