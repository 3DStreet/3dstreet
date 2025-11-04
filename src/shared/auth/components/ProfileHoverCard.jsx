/**
 * ProfileHoverCard - Hover card overlay showing user profile information
 * Uses Radix UI HoverCard for profile button interactions
 */
import { useState, useEffect } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { signOut } from 'firebase/auth';
import { auth } from '../../../editor/services/firebase';
import { useAuthContext } from '../../../editor/contexts';
import { getUserProfile } from '../../../editor/utils/username';
import posthog from 'posthog-js';
import styles from '../styles/ProfileHoverCard.module.scss';

// External link icon SVG
const ExternalLinkIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ marginLeft: '6px' }}
  >
    <path
      d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15 3h6v6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 14L21 3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ProfileHoverCard = ({
  children,
  showDetails = true, // Control whether to show the hover card
  onClickTrigger = null // Optional click handler to pass through
}) => {
  const { currentUser, tokenProfile, setCurrentUser } = useAuthContext();
  const [username, setUsername] = useState(null);
  const [isLoadingUsername, setIsLoadingUsername] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Load username when hover card is opened
  useEffect(() => {
    const loadUsername = async () => {
      if (currentUser?.uid) {
        setIsLoadingUsername(true);
        try {
          const userProfile = await getUserProfile(currentUser.uid);
          if (userProfile?.username) {
            setUsername(userProfile.username);
          }
        } catch (error) {
          console.error('Error loading username:', error);
        }
        setIsLoadingUsername(false);
      }
    };

    if (showDetails && currentUser && isOpen) {
      loadUsername();
    }
  }, [currentUser, showDetails, isOpen]);

  // Handle click on trigger
  const handleTriggerClick = (e) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
    if (onClickTrigger) {
      onClickTrigger(e);
    }
  };

  // If showDetails is false, just render the children without hover card
  if (!showDetails || !currentUser) {
    return children;
  }

  // User profile info
  const userEmail = currentUser?.email || 'Not available';
  const userDisplayName = currentUser?.displayName || userEmail.split('@')[0];
  const userPhotoURL = currentUser?.photoURL || null;
  const isPro = tokenProfile?.plan === 'PRO';

  // Logout handler
  const handleLogout = async (e) => {
    e.stopPropagation();
    posthog.capture('logout_from_hover_card');
    await signOut(auth);
    posthog.reset();
    setCurrentUser(null);
  };

  // Open full profile in 3DStreet editor
  const handleOpenFullProfile = (e) => {
    e.stopPropagation();
    posthog.capture('open_full_profile_from_hover_card');
    const editorUrl = `${window.location.origin}/#/modal/profile`;
    window.open(editorUrl, '_blank');
  };

  return (
    <HoverCard.Root open={isOpen} onOpenChange={setIsOpen} openDelay={200}>
      <HoverCard.Trigger asChild>
        <div onClick={handleTriggerClick}>{children}</div>
      </HoverCard.Trigger>

      <HoverCard.Portal>
        <HoverCard.Content
          className={styles.hoverCardContent}
          sideOffset={5}
          align="end"
          onInteractOutside={() => setIsOpen(false)}
        >
          {/* User Profile Section */}
          <div className={styles.profileSection}>
            <div className={styles.profileHeader}>
              {userPhotoURL ? (
                <img
                  src={userPhotoURL}
                  alt={userDisplayName}
                  className={styles.userAvatar}
                />
              ) : (
                <div className={styles.userAvatarPlaceholder}>
                  {userDisplayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className={styles.userDetails}>
                <div className={styles.userName}>{userDisplayName}</div>
                <div className={styles.userEmail}>{userEmail}</div>
                {username && (
                  <div className={styles.publicUsername}>@{username}</div>
                )}
                {isLoadingUsername && !username && (
                  <div className={styles.publicUsername}>
                    Loading username&hellip;
                  </div>
                )}
              </div>
            </div>

            {isPro && (
              <div className={styles.planBadge}>
                <span className={styles.proBadge}>PRO</span>
              </div>
            )}
          </div>

          <div className={styles.divider} />

          {/* Quick Actions */}
          <div className={styles.actionsSection}>
            <button
              className={`${styles.actionButton} ${styles.editProfileButton}`}
              onClick={handleOpenFullProfile}
            >
              Manage Account
              <ExternalLinkIcon />
            </button>

            <button
              className={`${styles.actionButton} ${styles.logoutButton}`}
              onClick={handleLogout}
            >
              Log Out
            </button>
          </div>

          <HoverCard.Arrow className={styles.hoverCardArrow} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
};

export default ProfileHoverCard;
