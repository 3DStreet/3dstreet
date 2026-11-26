/**
 * ProfileHoverCard - click-toggle profile menu shown from the profile button.
 *
 * Uses Radix Popover (not HoverCard) so the trigger reliably TOGGLES: clicking
 * the profile icon while the menu is open closes it, instead of the old
 * HoverCard behaviour where a hover re-open fought the click and re-faded the
 * card back in. Renders for BOTH signed-in and signed-out users:
 *   - signed in: profile summary, the team switcher ("Working in":
 *     Personal or a team with its plan, docs/settings.md), Settings,
 *     Log Out, language picker
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
import { refreshMembershipStatus, setActiveOrg } from '../../api/orgs';
import { personalPlanOf } from '../../utils/workspace';
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

const ROLE_KEYS = {
  owner: 'menuRoleOwner',
  admin: 'menuRoleAdmin',
  member: 'menuRoleMember',
  viewer: 'menuRoleViewer'
};

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5 12.5 10 17.5 19 7"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ProfileHoverCard = ({
  children,
  showDetails = true, // When false, render the trigger with no menu at all.
  onSignIn = null, // Called when a signed-out user chooses to sign in.
  // Opens a Settings section ({ id, orgId? }) in the app. Without it (an
  // app with no Settings panel), Settings opens in the editor, in a new tab.
  onOpenSettings = null,
  // Told when the user switches team (or Personal: null), after it's saved.
  onActiveTeamChange = null
}) => {
  const { currentUser, setCurrentUser } = useAuthContext();
  const t = useSharedMessages();
  const [username, setUsername] = useState(null);
  const [isLoadingUsername, setIsLoadingUsername] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Load username when the menu is opened for a signed-in user. Keyed on
  // currentUser?.uid so switching accounts (or signing out) clears the previous
  // user's username instead of briefly showing it under the new identity.
  const currentUid = currentUser?.uid;
  useEffect(() => {
    // Reset on any identity change; the fetch below repopulates if signed in.
    setUsername(null);
    setIsLoadingUsername(false);

    if (!showDetails || !currentUid || !isOpen) return;

    let cancelled = false;
    const loadUsername = async () => {
      setIsLoadingUsername(true);
      try {
        const userProfile = await getUserProfile(currentUid);
        if (!cancelled && userProfile?.username) {
          setUsername(userProfile.username);
        }
      } catch (error) {
        console.error('Error loading username:', error);
      }
      if (!cancelled) setIsLoadingUsername(false);
    };

    loadUsername();
    return () => {
      cancelled = true;
    };
  }, [currentUid, showDetails, isOpen]);

  // The team switcher: the active team sets the defaults for new work and
  // pays the user's AI generations (docs/team-wallet.md).
  const [switchingTo, setSwitchingTo] = useState(undefined);
  const [switchFailed, setSwitchFailed] = useState(false);
  const switchTeam = async (orgId) => {
    if (orgId === (currentUser?.activeOrgId || null)) return;
    setSwitchingTo(orgId);
    setSwitchFailed(false);
    const previous = currentUser?.activeOrgId || null;
    setCurrentUser((prev) => ({ ...prev, activeOrgId: orgId }));
    try {
      await setActiveOrg(orgId);
      posthog.capture('active_team_switched', {
        to: orgId ? 'team' : 'personal'
      });
      await refreshMembershipStatus(setCurrentUser);
      onActiveTeamChange?.(orgId);
    } catch (error) {
      console.error('Error switching team:', error);
      setCurrentUser((prev) => ({ ...prev, activeOrgId: previous }));
      setSwitchFailed(true);
    } finally {
      setSwitchingTo(undefined);
    }
  };

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

  // Open a Settings section here, or in the editor when this app has none.
  const openSettings = (section) => (e) => {
    e.stopPropagation();
    posthog.capture('open_settings_from_profile_menu', { section: section.id });
    setIsOpen(false);
    if (onOpenSettings) {
      onOpenSettings(section);
    } else {
      const path =
        section.id === 'team'
          ? `team/${encodeURIComponent(section.orgId)}`
          : section.id;
      window.open(
        `${window.location.origin}/#/modal/settings/${path}`,
        '_blank'
      );
    }
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
  // Entitlement comes from checkUserProStatus (subscription, team or a
  // one-time pass, #1922) via the auth context — tokenProfile has no plan.
  const teams = currentUser?.orgs || [];

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
              </div>

              {teams.length > 0 && (
                <>
                  <div className={styles.divider} />
                  <div className={styles.workspaceLabel}>
                    {t('menuWorkspace')}
                  </div>
                  <div className={styles.workspaceList} role="radiogroup">
                    {[null, ...teams].map((org) => {
                      const orgId = org ? org.orgId : null;
                      const selected =
                        (currentUser?.activeOrgId || null) === orgId;
                      const plan = org ? org.plan : personalPlanOf(currentUser);
                      return (
                        <button
                          key={orgId || 'personal'}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`${styles.workspaceOption} ${selected ? styles.workspaceSelected : ''}`}
                          disabled={switchingTo !== undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            switchTeam(orgId);
                          }}
                        >
                          <span className={styles.workspaceText}>
                            <span className={styles.workspaceName}>
                              {org ? org.name : t('menuPersonal')}
                            </span>
                            <span className={styles.workspaceMeta}>
                              {[
                                org && org.status !== 'active'
                                  ? t('teamInactiveLabel')
                                  : // A viewer gets no plan from the team.
                                    org?.role === 'viewer'
                                    ? null
                                    : plan || t('menuPlanFree'),
                                org && t(ROLE_KEYS[org.role])
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          {selected && <CheckIcon />}
                        </button>
                      );
                    })}
                  </div>
                  {switchFailed && (
                    <div className={styles.workspaceError} role="alert">
                      {t('menuSwitchError')}
                    </div>
                  )}
                </>
              )}

              <div className={styles.divider} />

              <div className={styles.menuLinks}>
                <button
                  type="button"
                  className={styles.menuLink}
                  onClick={openSettings({ id: 'profile' })}
                >
                  {t('menuSettings')}
                  {!onOpenSettings && <ExternalLinkIcon />}
                </button>
              </div>

              <div className={styles.actionsSection}>
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
