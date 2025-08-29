import PropTypes from 'prop-types';
import { useAuthContext } from '../../../contexts/index.js';

const TokenDisplay = ({
  tokenType = 'geoToken',
  showDescription = false,
  inline = false
}) => {
  const { currentUser, tokenProfile } = useAuthContext();

  if (!currentUser || currentUser.isPro || !tokenProfile) {
    return null;
  }

  const tokenCount = tokenProfile[tokenType] || 0;
  const tokenName =
    tokenType === 'geoToken'
      ? 'Geo'
      : tokenType === 'imageToken'
        ? 'Image'
        : 'Token';

  if (inline) {
    return (
      <span
        className="badge"
        style={{ backgroundColor: '#10b981', marginLeft: '4px' }}
      >
        {tokenCount} Free
      </span>
    );
  }

  return (
    <div className="token-display">
      <p>
        Free {tokenName} Tokens: {tokenCount}
      </p>
      {showDescription && (
        <p className="token-description">
          Use free tokens to access premium features. Upgrade to Pro for
          unlimited access.
        </p>
      )}
    </div>
  );
};

TokenDisplay.propTypes = {
  tokenType: PropTypes.string,
  showDescription: PropTypes.bool,
  inline: PropTypes.bool
};

export default TokenDisplay;
