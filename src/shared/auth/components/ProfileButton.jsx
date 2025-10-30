/**
 * Shared ProfileButton component with Tooltip
 * Shows user profile icon or loading spinner with tooltip
 * Each app wraps this with their own modal/state management
 *
 * @author 3DStreet Team
 * @category Shared Components
 */

import * as Tooltip from '@radix-ui/react-tooltip';
import MsftProfileImg from '../../../../ui_assets/profile-microsoft.png';
import ProfileHoverCard from './ProfileHoverCard';
import styles from '../styles/ProfileButton.module.scss';

// Profile icon SVG (default when not using Google/Microsoft)
const Profile32Icon = (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M15.9999 16.0714C15.3875 16.0714 14.7806 15.9489 14.2135 15.7103C13.6464 15.4717 13.1296 15.1214 12.6931 14.6781C12.2567 14.2347 11.9092 13.7071 11.6717 13.1248C11.4343 12.5424 11.3117 11.9174 11.3117 11.2857C11.3117 10.654 11.4343 10.029 11.6717 9.44667C11.9092 8.86434 12.2567 8.33673 12.6931 7.89338C13.1296 7.45007 13.6464 7.09969 14.2135 6.86108C14.7806 6.62249 15.3875 6.5 15.9999 6.5C17.2357 6.5 18.4256 6.99842 19.3067 7.89338C20.1885 8.78913 20.6881 10.009 20.6881 11.2857C20.6881 12.5625 20.1885 13.7823 19.3067 14.6781C18.4256 15.573 17.2357 16.0714 15.9999 16.0714ZM15.9999 17.5714C15.1873 17.5714 14.3826 17.4088 13.6318 17.093C12.881 16.7771 12.1988 16.3141 11.6242 15.7304C11.0496 15.1467 10.5938 14.4538 10.2828 13.6912C9.97181 12.9285 9.81174 12.1112 9.81174 11.2857C9.81174 10.4603 9.97181 9.64289 10.2828 8.88028C10.5938 8.11766 11.0496 7.42473 11.6242 6.84104C12.1988 6.25736 12.881 5.79436 13.6318 5.47847C14.3826 5.16258 15.1873 5 15.9999 5C17.6411 5 19.2151 5.66224 20.3756 6.84104C21.5361 8.01984 22.1881 9.61864 22.1881 11.2857C22.1881 12.9528 21.5361 14.5516 20.3756 15.7304C19.2151 16.9092 17.6411 17.5714 15.9999 17.5714ZM9.79394 21.727C10.6213 20.8866 11.741 20.4167 12.9059 20.4167H19.0941C20.259 20.4167 21.3786 20.8866 22.206 21.727C23.0338 22.5678 23.5009 23.7107 23.5009 24.9048V27H25.0009V24.9048C25.0009 23.3204 24.3814 21.7985 23.2749 20.6747C22.1681 19.5504 20.6645 18.9167 19.0941 18.9167H12.9059C11.3355 18.9167 9.83182 19.5504 8.72502 20.6747C7.6186 21.7985 6.99908 23.3204 6.99908 24.9048V27H8.49908V24.9048C8.49908 23.7107 8.96618 22.5678 9.79394 21.727Z"
      fill="white"
    />
  </svg>
);

// Loading spinner SVG
const LoadingSpinner = ({ className }) => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ animation: 'spin 1s linear infinite' }}
  >
    <style>{`
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
    <circle
      cx="16"
      cy="16"
      r="12"
      stroke="white"
      strokeWidth="3"
      strokeLinecap="round"
      strokeDasharray="60 20"
    />
  </svg>
);

/**
 * Renders the appropriate profile icon based on user's auth provider
 */
export const renderProfileIcon = (currentUser, isLoading) => {
  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!currentUser) {
    return Profile32Icon;
  }

  const isGoogle = currentUser?.providerData?.[0]?.providerId === 'google.com';
  const isMicrosoft =
    currentUser?.providerData?.[0]?.providerId === 'microsoft.com';

  if (isGoogle && currentUser?.photoURL) {
    return (
      <img
        style={{
          width: '43px',
          height: '43px',
          borderRadius: '18px'
        }}
        src={currentUser.photoURL}
        alt="userPhoto"
        referrerPolicy="no-referrer"
      />
    );
  } else if (isMicrosoft) {
    return (
      <img
        src={MsftProfileImg}
        alt="Microsoft Profile"
        height="40"
        width="40"
      />
    );
  } else {
    return Profile32Icon;
  }
};

/**
 * ProfileButton component with Tooltip
 *
 * @param {Object} props
 * @param {Object} props.currentUser - Firebase user object (or null)
 * @param {boolean} props.isLoading - Whether auth is still loading
 * @param {Function} props.onClick - Click handler
 * @param {string} [props.className] - CSS class name
 * @param {string} [props.tooltipSide] - Tooltip position (default: 'bottom')
 * @param {string} [props.signedInText] - Tooltip text when signed in (default: 'Open profile')
 * @param {string} [props.signedOutText] - Tooltip text when signed out (default: 'Sign in')
 * @param {boolean} [props.showHoverCard] - Show detailed hover card instead of tooltip (default: false)
 * @returns {JSX.Element}
 */
export const ProfileButton = ({
  currentUser,
  isLoading,
  onClick,
  className = '',
  tooltipSide = 'bottom',
  signedInText = 'Open profile',
  signedOutText = 'Sign in',
  showHoverCard = false
}) => {
  const tooltipContent = currentUser ? signedInText : signedOutText;
  const ariaLabel = currentUser ? signedInText : signedOutText;

  const buttonElement = (
    <div role="button" aria-label={ariaLabel}>
      <button
        className={`${styles.profileButton} ${className}`}
        onClick={onClick}
        type="button"
        disabled={isLoading}
        style={{
          cursor: isLoading ? 'default' : 'pointer',
          opacity: isLoading ? 0.7 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {renderProfileIcon(currentUser, isLoading)}
      </button>
    </div>
  );

  // If hover card is enabled and user is signed in, use ProfileHoverCard
  if (showHoverCard && currentUser && !isLoading) {
    return (
      <ProfileHoverCard showDetails={true}>{buttonElement}</ProfileHoverCard>
    );
  }

  // Otherwise use the standard tooltip
  return (
    <Tooltip.Provider>
      <Tooltip.Root delayDuration={0}>
        <Tooltip.Trigger asChild>{buttonElement}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={tooltipSide}
            sideOffset={5}
            style={{
              backgroundColor: '#2d2d2d',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '500',
              zIndex: 10000,
              maxWidth: '200px'
            }}
          >
            {tooltipContent}
            <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};
