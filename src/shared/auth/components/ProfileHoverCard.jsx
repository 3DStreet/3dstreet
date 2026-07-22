/**
 * ProfileHoverCard - click-toggle profile menu shown from the profile button.
 *
 * Uses Radix Popover (not HoverCard) so the trigger reliably TOGGLES: clicking
 * the profile icon while the menu is open closes it, instead of the old
 * HoverCard behaviour where a hover re-open fought the click and re-faded the
 * card back in. Renders for BOTH signed-in and signed-out users:
 *   - signed in: profile summary + Manage Account + Log Out + language picker
 *   - signed out: a sign-in / create-account action + language picker
 * so language can be changed from any app without an account. All copy is
 * localized via the framework-free shared message table (this menu renders in
 * the generator + Bollard Buddy, which don't mount react-intl).
 */
import { useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { signOut } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { useAuthContext } from '../../contexts';
import { getUserProfile } from '../../utils/username';
import { useSharedMessages } from '../../i18n/sharedMessages';
import LanguageSelector from './LanguageSelector';
import posthog from 'posthog-js';
import styles from './ProfileHoverCard.module.scss';

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
  showDetails = true, // When false, render the trigger with no menu at all.
  onSignIn = null // Called when a signed-out user chooses to sign in.
}) => {
  const { currentUser, tokenProfile, setCurrentUser } = useAuthContext();
  const t = useSharedMessages();
  const [username, setUsername] = useState(null);
  const [isLoadingUsername, setIsLoadingUsername] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Load username when the menu is opened for a signed-in user
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

  // If the menu is disabled, just render the trigger untouched.
  if (!showDetails) {
    return children;
  }

  // Logout handler
  const handleLogout = async (e) => {
    e.stopPropagation();
    posthog.capture('logout_from_hover_card');
    await signOut(auth);
    posthog.reset();
    setCurrentUser(null);
    setIsOpen(false);
  };

  // Open full profile in the 3DStreet editor
  const handleOpenFullProfile = (e) => {
    e.stopPropagation();
    posthog.capture('open_full_profile_from_hover_card');
    const editorUrl = `${window.location.origin}/#/modal/profile`;
    window.open(editorUrl, '_blank');
    setIsOpen(false);
  };

  // Sign in / create account (signed-out state)
  const handleSignIn = (e) => {
    e.stopPropagation();
    setIsOpen(false);
    if (onSignIn) onSignIn();
  };

  // Signed-in user info
  const userEmail = currentUser?.email || '';
  const userDisplayName =
    currentUser?.displayName || userEmail.split('@')[0] || '';
  const userPhotoURL = currentUser?.photoURL || null;
  const isPro = tokenProfile?.plan === 'PRO';

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className={styles.hoverCardContent}
          sideOffset={5}
          align="end"
          collisionPadding={8}
        >
          {currentUser ? (
            <>
              {/* Signed-in profile summary */}
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
                      {(userDisplayName.charAt(0) || '?').toUpperCase()}
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
                        {t('loadingUsername')}
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

              <div className={styles.actionsSection}>
                <button
                  className={`${styles.actionButton} ${styles.editProfileButton}`}
                  onClick={handleOpenFullProfile}
                >
                  {t('manageAccount')}
                  <ExternalLinkIcon />
                </button>

                <button
                  className={`${styles.actionButton} ${styles.logoutButton}`}
                  onClick={handleLogout}
                >
                  {t('logOut')}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Signed-out state */}
              <div className={styles.signedOutHeader}>
                <div className={styles.userAvatarPlaceholder}>?</div>
                <div className={styles.signedOutText}>{t('notSignedIn')}</div>
              </div>

              <div className={styles.actionsSection}>
                <button
                  className={`${styles.actionButton} ${styles.editProfileButton}`}
                  onClick={handleSignIn}
                >
                  {t('signInOrCreateAccount')}
                </button>
              </div>
            </>
          )}

          <div className={styles.divider} />

          <LanguageSelector />

          <Popover.Arrow className={styles.hoverCardArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default ProfileHoverCard;
