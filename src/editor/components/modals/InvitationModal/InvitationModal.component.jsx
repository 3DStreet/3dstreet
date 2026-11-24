/**
 * An organization invitation (#1267 Phase 1, docs/orgs.md), opened by the
 * `#invite=<id>` link of the invitation email (store.firstModal). The
 * invitee signs in with the invited email, then accepts or declines.
 * Signing in from here returns here (setModal('signin', true)).
 */
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import { signOut } from 'firebase/auth';
import Modal from '@shared/components/Modal/Modal.jsx';
import { auth } from '@shared/services/firebase';
import useStore from '@/store';
import { useAuthContext } from '../../../contexts';
import { Button } from '../../elements';
import { getInviteId } from '@/tested/org-invite-link.js';
import {
  acceptInvitation,
  declineInvitation,
  getInvitation,
  invitationState,
  orgErrorReason,
  refreshMembershipStatus
} from '../../../api/orgs';
import {
  orgErrorMessage,
  roleDescriptionMessages,
  roleMessages
} from '@shared/settings/team/orgMessages';
import styles from './InvitationModal.module.scss';

// Drop the #invite= route from the address bar once handled, so a reload
// or a shared URL doesn't reopen it.
const clearInviteHash = () => {
  if (getInviteId(window.location.hash)) {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    );
  }
};

function InvitationModal() {
  const intl = useIntl();
  const modal = useStore((state) => state.modal);
  const setModal = useStore((state) => state.setModal);
  const openTeamModal = useStore((state) => state.openTeamModal);
  const { currentUser, isLoading, setCurrentUser } = useAuthContext();
  const invitationId = useStore((state) => state.invitationId);
  const isOpen = modal === 'invitation';

  // 'loading' | 'ready' | 'wrong-account' | 'missing' | 'closed' |
  // 'expired' | 'busy' | 'accepted' | 'declined'
  const [state, setState] = useState('loading');
  const [invitation, setInvitation] = useState(null);
  const [joined, setJoined] = useState(null);

  const load = useCallback(async () => {
    if (!invitationId) {
      setState('missing');
      return;
    }
    setState('loading');
    try {
      const inv = await getInvitation(invitationId);
      setInvitation(inv);
      if (!inv) setState('missing');
      else if (inv.status !== 'pending') setState('closed');
      else if (invitationState(inv) === 'expired') setState('expired');
      else setState('ready');
    } catch (error) {
      // The rules only show an invitation to its invitee (and managers).
      if (error?.code === 'permission-denied') setState('wrong-account');
      else {
        console.error('Error loading invitation:', error);
        setState('missing');
      }
    }
  }, [invitationId]);

  // Reload when the account changes (sign-in, "use another account").
  const uid = currentUser?.uid;
  useEffect(() => {
    if (!isOpen || isLoading || !uid) return;
    load();
  }, [isOpen, isLoading, uid, load]);

  useEffect(() => {
    if (isOpen) posthog.capture('modal_opened', { modal: 'invitation' });
  }, [isOpen]);

  const close = () => {
    clearInviteHash();
    setModal(null);
  };

  const respond = async (accept) => {
    setState('busy');
    try {
      if (accept) {
        const result = await acceptInvitation(invitationId);
        setJoined(result);
        await refreshMembershipStatus(setCurrentUser);
        posthog.capture('org_invitation_accepted', { org_id: result.orgId });
        setState('accepted');
      } else {
        await declineInvitation(invitationId);
        posthog.capture('org_invitation_declined', {
          org_id: invitation?.orgId
        });
        setState('declined');
      }
      clearInviteHash();
    } catch (error) {
      console.error('Error answering invitation:', error);
      STREET.notify.errorMessage(orgErrorMessage(intl, orgErrorReason(error)));
      await load();
    }
  };

  const switchAccount = async () => {
    await signOut(auth);
    setModal('signin', true);
  };

  const role = invitation?.role;

  let body;
  if (!currentUser && !isLoading) {
    body = (
      <>
        <p>
          <FormattedMessage
            id="invitationModal.signInFirst"
            defaultMessage="Sign in with the email address that received the invitation to see it."
          />
        </p>
        <div className={styles.actions}>
          <Button onClick={() => setModal('signin', true)}>
            <FormattedMessage
              id="invitationModal.signIn"
              defaultMessage="Sign in"
            />
          </Button>
        </div>
      </>
    );
  } else if (state === 'loading' || isLoading) {
    body = (
      <p className={styles.muted}>
        <FormattedMessage
          id="invitationModal.loading"
          defaultMessage="Loading the invitation…"
        />
      </p>
    );
  } else if (state === 'ready' || state === 'busy') {
    body = (
      <>
        <p>
          {invitation.inviterName ? (
            <FormattedMessage
              id="invitationModal.invitedBy"
              defaultMessage="{inviter} invited you to join {team} on 3DStreet."
              values={{
                inviter: <strong>{invitation.inviterName}</strong>,
                team: <strong>{invitation.orgName}</strong>
              }}
            />
          ) : (
            <FormattedMessage
              id="invitationModal.invited"
              defaultMessage="You're invited to join {team} on 3DStreet."
              values={{ team: <strong>{invitation.orgName}</strong> }}
            />
          )}
        </p>
        <p>
          <FormattedMessage
            id="invitationModal.role"
            defaultMessage="Your role: {role}. {description}"
            values={{
              role: <strong>{intl.formatMessage(roleMessages[role])}</strong>,
              description: intl.formatMessage(roleDescriptionMessages[role])
            }}
          />
        </p>
        <div className={styles.actions}>
          <Button
            variant="toolbtn"
            disabled={state === 'busy'}
            onClick={() => respond(false)}
          >
            <FormattedMessage
              id="invitationModal.decline"
              defaultMessage="Decline"
            />
          </Button>
          <Button disabled={state === 'busy'} onClick={() => respond(true)}>
            <FormattedMessage
              id="invitationModal.accept"
              defaultMessage="Join the team"
            />
          </Button>
        </div>
      </>
    );
  } else if (state === 'accepted') {
    body = (
      <>
        <p>
          <FormattedMessage
            id="invitationModal.joined"
            defaultMessage="You joined {team}."
            values={{ team: <strong>{joined?.orgName}</strong> }}
          />
        </p>
        <div className={styles.actions}>
          <Button variant="toolbtn" onClick={close}>
            <FormattedMessage
              id="invitationModal.close"
              defaultMessage="Close"
            />
          </Button>
          <Button onClick={() => openTeamModal(joined.orgId)}>
            <FormattedMessage
              id="invitationModal.openTeam"
              defaultMessage="See the team"
            />
          </Button>
        </div>
      </>
    );
  } else {
    const messages = {
      declined: (
        <FormattedMessage
          id="invitationModal.declined"
          defaultMessage="You declined the invitation."
        />
      ),
      'wrong-account': (
        <FormattedMessage
          id="invitationModal.wrongAccount"
          defaultMessage="This invitation was sent to another email address. You are signed in as {email}."
          values={{ email: <strong>{currentUser?.email}</strong> }}
        />
      ),
      expired: orgErrorMessage(intl, 'invitation-expired'),
      closed: orgErrorMessage(intl, 'invitation-closed'),
      missing: orgErrorMessage(intl, 'invitation-not-found')
    };
    body = (
      <>
        <p>{messages[state] || messages.missing}</p>
        <div className={styles.actions}>
          {state === 'wrong-account' && (
            <Button variant="toolbtn" onClick={switchAccount}>
              <FormattedMessage
                id="invitationModal.switchAccount"
                defaultMessage="Use another account"
              />
            </Button>
          )}
          <Button onClick={close}>
            <FormattedMessage
              id="invitationModal.close"
              defaultMessage="Close"
            />
          </Button>
        </div>
      </>
    );
  }

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={close}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">
            <FormattedMessage
              id="invitationModal.title"
              defaultMessage="Team invitation"
            />
          </div>
        </div>
      }
    >
      <div className={styles.wrapper}>{body}</div>
    </Modal>
  );
}

export { InvitationModal };
