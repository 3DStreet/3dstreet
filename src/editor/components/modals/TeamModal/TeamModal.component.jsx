/**
 * Team settings (#1267 Phase 1, docs/orgs.md): an organization's members,
 * roles, seats and pending invitations. Everyone in the team sees the
 * members; owners and admins also manage them and invite people. Opened from
 * the profile's Teams section with the org in store.teamModalOrgId.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import Modal from '@shared/components/Modal/Modal.jsx';
import { formatDate } from '@shared/utils/format';
import useStore from '@/store';
import { useAuthContext } from '../../../contexts';
import { Button } from '../../elements';
import { commonMessages } from '@/editor/i18n/commonMessages';
import {
  changeMemberRole,
  getOrg,
  inviteMembers,
  invitationExpiresAtMs,
  invitationState,
  listMembers,
  listOrgInvitations,
  orgErrorReason,
  refreshMembershipStatus,
  removeMember,
  renameOrg,
  resendInvitation,
  revokeInvitation
} from '../../../api/orgs';
import {
  inviteResultMessages,
  orgErrorMessage,
  roleDescriptionMessages,
  roleMessages
} from './orgMessages';
import styles from './TeamModal.module.scss';

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const SEAT_ROLES = ['owner', 'admin', 'member'];
const isManager = (role) => role === 'owner' || role === 'admin';

// Emails pasted from anywhere: split on commas, semicolons and whitespace.
const parseEmails = (text) => [
  ...new Set(
    text
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean)
  )
];

function RoleSelect({ value, roles, disabled, onChange, label }) {
  const intl = useIntl();
  return (
    <select
      className={styles.roleSelect}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {intl.formatMessage(roleMessages[role])}
        </option>
      ))}
    </select>
  );
}

function TeamModal() {
  const intl = useIntl();
  const modal = useStore((state) => state.modal);
  const orgId = useStore((state) => state.teamModalOrgId);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const showConfirm = useStore((state) => state.showConfirm);
  const { currentUser, setCurrentUser } = useAuthContext();
  const isOpen = modal === 'team' && !!orgId;

  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteText, setInviteText] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteResults, setInviteResults] = useState([]);
  const [newName, setNewName] = useState(null);

  const myRole = useMemo(
    () => members.find((m) => m.uid === currentUser?.uid)?.role || null,
    [members, currentUser?.uid]
  );
  const canManage = isManager(myRole);
  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const seatsUsed =
    members.filter((m) => SEAT_ROLES.includes(m.role)).length +
    invitations.filter(
      (inv) =>
        SEAT_ROLES.includes(inv.role) && invitationState(inv) === 'pending'
    ).length;

  const load = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    try {
      const [nextOrg, nextMembers] = await Promise.all([
        getOrg(orgId),
        listMembers(orgId)
      ]);
      setOrg(nextOrg);
      setMembers(nextMembers);
      const role = nextMembers.find((m) => m.uid === currentUser?.uid)?.role;
      setInvitations(isManager(role) ? await listOrgInvitations(orgId) : []);
    } catch (error) {
      console.error('Error loading team:', error);
      STREET.notify.errorMessage(orgErrorMessage(intl, null));
    } finally {
      setIsLoading(false);
    }
  }, [orgId, currentUser?.uid, intl]);

  useEffect(() => {
    if (isOpen) {
      load();
      posthog.capture('modal_opened', { modal: 'team' });
    } else {
      setInviteResults([]);
      setInviteText('');
      setNewName(null);
    }
  }, [isOpen, load]);

  // Run a callable, report a refusal, reload. Returns the result or null.
  const run = async (action, event, { reload = true } = {}) => {
    setBusy(true);
    try {
      const result = await action();
      if (event) posthog.capture(event, { org_id: orgId });
      return result;
    } catch (error) {
      console.error('Team action failed:', error);
      STREET.notify.errorMessage(orgErrorMessage(intl, orgErrorReason(error)));
      return null;
    } finally {
      setBusy(false);
      if (reload) await load();
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const emails = parseEmails(inviteText);
    if (emails.length === 0) return;
    const result = await run(
      () =>
        inviteMembers(
          orgId,
          emails.map((email) => ({ email, role: inviteRole }))
        ),
      'org_members_invited'
    );
    if (result) {
      setInviteResults(result.results);
      setInviteText(
        result.results
          .filter((r) => r.status !== 'invited')
          .map((r) => r.email)
          .join(', ')
      );
    }
  };

  const handleRoleChange = (member, role) =>
    run(() => changeMemberRole(orgId, member.uid, role), 'org_role_changed');

  const handleRemove = (member) => {
    const isSelf = member.uid === currentUser?.uid;
    showConfirm({
      title: isSelf
        ? intl.formatMessage({
            id: 'teamModal.leaveTitle',
            defaultMessage: 'Leave this team?'
          })
        : intl.formatMessage({
            id: 'teamModal.removeTitle',
            defaultMessage: 'Remove this member?'
          }),
      message: isSelf
        ? intl.formatMessage(
            {
              id: 'teamModal.leaveMessage',
              defaultMessage:
                'You will lose access to {team} and its plan. An owner or admin can invite you again.'
            },
            { team: org?.name }
          )
        : intl.formatMessage(
            {
              id: 'teamModal.removeMessage',
              defaultMessage:
                '{name} will lose access to {team} and its plan. You can invite them again later.'
            },
            { name: member.displayName || member.email, team: org?.name }
          ),
      confirmLabel: isSelf
        ? intl.formatMessage({
            id: 'teamModal.leave',
            defaultMessage: 'Leave team'
          })
        : intl.formatMessage({
            id: 'teamModal.remove',
            defaultMessage: 'Remove'
          }),
      onConfirm: async () => {
        // Leaving: the team is no longer readable, so don't reload it.
        const result = await run(
          () => removeMember(orgId, member.uid),
          isSelf ? 'org_left' : 'org_member_removed',
          { reload: !isSelf }
        );
        if (result && isSelf) {
          await refreshMembershipStatus(setCurrentUser);
          useStore.getState().setModal(null);
        }
      }
    });
  };

  const handleRename = async (e) => {
    e.preventDefault();
    const result = await run(() => renameOrg(orgId, newName), 'org_renamed');
    if (result) {
      setNewName(null);
      await refreshMembershipStatus(setCurrentUser);
    }
  };

  // Admins don't hand out or change the owner role (org-utils.js).
  const assignableRoles = myRole === 'owner' ? ROLES : ROLES.slice(1);

  const title = org?.name || (
    <FormattedMessage id="teamModal.title" defaultMessage="Team" />
  );

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={returnToPreviousModal}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">{title}</div>
        </div>
      }
    >
      <div className={styles.wrapper}>
        {isLoading && !org ? (
          <p className={styles.muted}>
            <FormattedMessage
              id="teamModal.loading"
              defaultMessage="Loading…"
            />
          </p>
        ) : !org ? null : (
          <>
            <div className={styles.summary}>
              <span className={styles.planBadge}>{org.plan}</span>
              {/* Pending invitations hold seats and only managers can read
                  them, so only managers get a seat count that adds up. */}
              {canManage && (
                <span>
                  <FormattedMessage
                    id="teamModal.seats"
                    defaultMessage="{used} of {total} seats used"
                    values={{ used: seatsUsed, total: org.seats }}
                  />
                </span>
              )}
              {org.status !== 'active' && (
                <span className={styles.warning}>
                  <FormattedMessage
                    id="teamModal.suspended"
                    defaultMessage="Suspended"
                  />
                </span>
              )}
              {canManage && newName === null && (
                <Button
                  variant="toolbtn"
                  onClick={() => setNewName(org.name)}
                  disabled={busy}
                >
                  <FormattedMessage {...commonMessages.rename} />
                </Button>
              )}
            </div>

            {newName !== null && (
              <form className={styles.inlineForm} onSubmit={handleRename}>
                <input
                  className={styles.input}
                  value={newName}
                  maxLength={80}
                  autoFocus
                  aria-label={intl.formatMessage({
                    id: 'teamModal.nameLabel',
                    defaultMessage: 'Team name'
                  })}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button type="submit" disabled={busy || !newName.trim()}>
                  <FormattedMessage id="teamModal.save" defaultMessage="Save" />
                </Button>
                <Button
                  variant="toolbtn"
                  onClick={() => setNewName(null)}
                  disabled={busy}
                >
                  <FormattedMessage {...commonMessages.cancel} />
                </Button>
              </form>
            )}

            <h3 className={styles.sectionTitle}>
              <FormattedMessage
                id="teamModal.membersTitle"
                defaultMessage="Members ({count})"
                values={{ count: members.length }}
              />
            </h3>
            <ul className={styles.list}>
              {members
                .slice()
                .sort(
                  (a, b) =>
                    ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
                    (a.displayName || a.email).localeCompare(
                      b.displayName || b.email
                    )
                )
                .map((member) => {
                  const isSelf = member.uid === currentUser?.uid;
                  const canEditRole =
                    canManage &&
                    !isSelf &&
                    (myRole === 'owner' || member.role !== 'owner');
                  const isLastOwner =
                    member.role === 'owner' && ownerCount <= 1;
                  return (
                    <li key={member.uid} className={styles.row}>
                      <div className={styles.who}>
                        <span className={styles.name}>
                          {member.displayName || member.email}
                          {isSelf && (
                            <span className={styles.you}>
                              <FormattedMessage
                                id="teamModal.you"
                                defaultMessage="(you)"
                              />
                            </span>
                          )}
                        </span>
                        {member.displayName && (
                          <span className={styles.muted}>{member.email}</span>
                        )}
                      </div>
                      {canEditRole ? (
                        <RoleSelect
                          value={member.role}
                          roles={assignableRoles}
                          disabled={busy}
                          label={intl.formatMessage(
                            {
                              id: 'teamModal.roleOf',
                              defaultMessage: 'Role of {name}'
                            },
                            { name: member.displayName || member.email }
                          )}
                          onChange={(role) => handleRoleChange(member, role)}
                        />
                      ) : (
                        <span
                          className={styles.role}
                          title={intl.formatMessage(
                            roleDescriptionMessages[member.role]
                          )}
                        >
                          {intl.formatMessage(roleMessages[member.role])}
                        </span>
                      )}
                      {(isSelf || canEditRole) && !isLastOwner && (
                        <Button
                          variant="toolbtn"
                          disabled={busy}
                          onClick={() => handleRemove(member)}
                        >
                          {isSelf ? (
                            <FormattedMessage
                              id="teamModal.leave"
                              defaultMessage="Leave team"
                            />
                          ) : (
                            <FormattedMessage
                              id="teamModal.remove"
                              defaultMessage="Remove"
                            />
                          )}
                        </Button>
                      )}
                    </li>
                  );
                })}
            </ul>

            {canManage && invitations.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>
                  <FormattedMessage
                    id="teamModal.invitationsTitle"
                    defaultMessage="Pending invitations ({count})"
                    values={{ count: invitations.length }}
                  />
                </h3>
                <ul className={styles.list}>
                  {invitations.map((inv) => {
                    const expired = invitationState(inv) === 'expired';
                    const canHandle =
                      myRole === 'owner' || inv.role !== 'owner';
                    return (
                      <li key={inv.id} className={styles.row}>
                        <div className={styles.who}>
                          <span className={styles.name}>{inv.email}</span>
                          <span
                            className={expired ? styles.warning : styles.muted}
                          >
                            {expired ? (
                              <FormattedMessage
                                id="teamModal.invitationExpired"
                                defaultMessage="Expired"
                              />
                            ) : (
                              <FormattedMessage
                                id="teamModal.invitationExpires"
                                defaultMessage="Expires {date}"
                                values={{
                                  date: formatDate(invitationExpiresAtMs(inv))
                                }}
                              />
                            )}
                          </span>
                        </div>
                        <span className={styles.role}>
                          {intl.formatMessage(roleMessages[inv.role])}
                        </span>
                        {canHandle && (
                          <>
                            <Button
                              variant="toolbtn"
                              disabled={busy}
                              onClick={async () => {
                                const result = await run(
                                  () => resendInvitation(inv.id),
                                  'org_invitation_resent'
                                );
                                if (result) {
                                  STREET.notify.successMessage(
                                    intl.formatMessage(
                                      result.emailSent
                                        ? inviteResultMessages.invited
                                        : inviteResultMessages.invitedNoEmail,
                                      { email: inv.email }
                                    )
                                  );
                                }
                              }}
                            >
                              <FormattedMessage
                                id="teamModal.resend"
                                defaultMessage="Resend"
                              />
                            </Button>
                            <Button
                              variant="toolbtn"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => revokeInvitation(inv.id),
                                  'org_invitation_revoked'
                                )
                              }
                            >
                              <FormattedMessage
                                id="teamModal.revoke"
                                defaultMessage="Revoke"
                              />
                            </Button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {canManage && (
              <form className={styles.inviteForm} onSubmit={handleInvite}>
                <h3 className={styles.sectionTitle}>
                  <FormattedMessage
                    id="teamModal.inviteTitle"
                    defaultMessage="Invite people"
                  />
                </h3>
                <textarea
                  className={styles.input}
                  rows={2}
                  value={inviteText}
                  placeholder="ana@example.org, ben@example.org"
                  aria-label={intl.formatMessage({
                    id: 'teamModal.inviteEmailsLabel',
                    defaultMessage: 'Email addresses'
                  })}
                  onChange={(e) => setInviteText(e.target.value)}
                />
                <div className={styles.inviteControls}>
                  <RoleSelect
                    value={inviteRole}
                    roles={assignableRoles}
                    disabled={busy}
                    label={intl.formatMessage({
                      id: 'teamModal.inviteRoleLabel',
                      defaultMessage: 'Role for the people invited'
                    })}
                    onChange={setInviteRole}
                  />
                  <span className={styles.muted}>
                    {intl.formatMessage(roleDescriptionMessages[inviteRole])}
                  </span>
                  <Button
                    type="submit"
                    disabled={busy || parseEmails(inviteText).length === 0}
                  >
                    <FormattedMessage
                      id="teamModal.invite"
                      defaultMessage="Invite"
                    />
                  </Button>
                </div>
                {inviteResults.length > 0 && (
                  <ul className={styles.results}>
                    {inviteResults.map((r) => (
                      <li
                        key={r.email}
                        className={
                          r.status === 'invited' && r.emailSent !== false
                            ? styles.ok
                            : styles.warning
                        }
                      >
                        {intl.formatMessage(
                          r.status === 'invited' && r.emailSent === false
                            ? inviteResultMessages.invitedNoEmail
                            : inviteResultMessages[r.status],
                          { email: r.email }
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export { TeamModal };
