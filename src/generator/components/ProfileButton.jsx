/**
 * Image Generator ProfileButton - wraps shared ProfileButton with hover card
 * Click or hover to open profile card, click to sign in if not logged in.
 * Hosts the shared Settings panel (src/shared/settings): the generator has
 * no react-intl, so Settings loads the editor's text catalogs on first open.
 */
import { useEffect, useState } from 'react';
import {
  ProfileButton as SharedProfileButton,
  SignInModal,
  WorkspaceBadge
} from '@shared/auth/components';
import { onTeamsJoined } from '@shared/utils/teamsJoined';
import { workspaceOf } from '@shared/utils/workspace';
import { useAuthContext } from '../../editor/contexts';
import { auth } from '@shared/services/firebase';
import useImageGenStore from '../store';
import { SettingsModal } from '@shared/settings/SettingsModal';
import { parseSettingsHash } from '../../tested/settings-hash.js';

// The editor's catalogs, only when Settings opens (they're ~90 KB each).
const loadMessages = () =>
  import('../../editor/i18n/messages.js').then((module) => module.MESSAGES);

// A #/modal/settings/... link (e.g. back from the Stripe portal) opens it.
const initialSettings = parseSettingsHash(window.location.hash);
import posthog from 'posthog-js';
import FluxUI from '../main.js';

const ProfileButton = () => {
  const { currentUser, isLoading } = useAuthContext();
  const { modal, setModal, returnToPreviousModal } = useImageGenStore();
  const [settingsSection, setSettingsSection] = useState(
    initialSettings || { id: 'profile' }
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(!!initialSettings);

  useEffect(
    () =>
      onTeamsJoined((message) => FluxUI.showNotification(message, 'success')),
    []
  );

  const openSettings = (section) => {
    setSettingsSection(section);
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    if (window.location.hash.startsWith('#/modal/')) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  };

  const onClick = () => {
    if (isLoading) return;
    // The profile menu (open/close, sign-in, language) is handled by the shared
    // component; this click just records the interaction.
    posthog.capture('profile_button_clicked', { is_logged_in: !!currentUser });
  };

  const handleAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  // Surface sign-in errors (e.g. email already linked to another provider)
  // through the generator's toast, as the editor does with STREET.notify.
  const handleNotification = (type, message) => {
    FluxUI.showNotification(message, type);
  };

  return (
    <>
      {/* The active workspace's plan and name, like the editor's badge;
          it opens that workspace's Usage and billing. */}
      <WorkspaceBadge
        onClick={() =>
          openSettings({
            id: 'billing',
            orgId: workspaceOf(currentUser).team?.orgId || null
          })
        }
      />
      <SharedProfileButton
        currentUser={currentUser}
        isLoading={isLoading}
        onClick={onClick}
        tooltipSide="bottom"
        showHoverCard={true}
        onSignIn={() => setModal('signin')}
        onOpenSettings={openSettings}
      />

      {currentUser && (
        <SettingsModal
          isOpen={isSettingsOpen}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onClose={closeSettings}
          notify={(message, type) =>
            FluxUI.showNotification(message, type === 'info' ? 'success' : type)
          }
          onUpgrade={() => {
            closeSettings();
            setModal('purchase');
          }}
          // Invitations open in the editor, which shows them.
          onOpenInvitation={(id) =>
            window.open(
              `${window.location.origin}/#invite=${encodeURIComponent(id)}`,
              '_blank'
            )
          }
          loadMessages={loadMessages}
        />
      )}

      <SignInModal
        isOpen={modal === 'signin'}
        onClose={returnToPreviousModal}
        message="Sign in to use AI image generation."
        firebaseAuth={auth}
        onAnalytics={handleAnalytics}
        onNotification={handleNotification}
      />
    </>
  );
};

export default ProfileButton;
