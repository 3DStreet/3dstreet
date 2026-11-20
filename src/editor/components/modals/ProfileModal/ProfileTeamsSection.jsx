/**
 * The profile's Teams section (#1267 Phase 1): the user's organizations and
 * their pending invitations. Hidden when there are neither.
 */
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import useStore from '@/store';
import { Button } from '../../elements';
import {
  invitationState,
  listMyInvitations,
  orgErrorReason,
  refreshMembershipStatus,
  setBillingOrg
} from '../../../api/orgs';
import { useAuthContext } from '../../../contexts';
import { orgErrorMessage } from '../TeamModal/orgMessages';
import { roleMessages } from '../TeamModal/orgMessages';
import styles from './ProfileModal.module.scss';

function ProfileTeamsSection({ currentUser, isOpen }) {
  const intl = useIntl();
  const openTeamModal = useStore((state) => state.openTeamModal);
  const openInvitation = useStore((state) => state.openInvitation);
  const [invitations, setInvitations] = useState([]);
  const [isSavingBilling, setIsSavingBilling] = useState(false);
  const { setCurrentUser } = useAuthContext();
  const orgs = currentUser?.orgs || [];
  // Teams that can pay the user's AI generations (#1267 Phase 3): those
  // where they hold a seat.
  const payingTeams = orgs.filter(
    (org) =>
      org.status === 'active' && ['owner', 'admin', 'member'].includes(org.role)
  );

  const handleBillingChange = async (orgId) => {
    setIsSavingBilling(true);
    try {
      await setBillingOrg(orgId || null);
      await refreshMembershipStatus(setCurrentUser);
    } catch (error) {
      console.error('Error choosing who pays AI generations:', error);
      STREET.notify.errorMessage(orgErrorMessage(intl, orgErrorReason(error)));
    } finally {
      setIsSavingBilling(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !currentUser?.email) return;
    let cancelled = false;
    listMyInvitations(currentUser.email)
      .then((list) => {
        if (!cancelled) {
          setInvitations(
            list.filter((inv) => invitationState(inv) === 'pending')
          );
        }
      })
      .catch((error) => {
        // An unverified email can't read invitations (firestore.rules).
        if (error?.code !== 'permission-denied') {
          console.error('Error loading invitations:', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentUser?.email]);

  if (orgs.length === 0 && invitations.length === 0) return null;

  return (
    <>
      <div className={styles.teamsSection}>
        <h3 className={styles.sectionTitle}>
          <FormattedMessage id="profileModal.teams" defaultMessage="Teams" />
        </h3>
        {orgs.map((org) => (
          <div key={org.orgId} className={styles.teamRow}>
            <div className={styles.teamInfo}>
              <span className={styles.teamName}>{org.name}</span>
              <span className={styles.teamMeta}>
                {intl.formatMessage(roleMessages[org.role])} · {org.plan}
              </span>
            </div>
            <Button variant="toolbtn" onClick={() => openTeamModal(org.orgId)}>
              <FormattedMessage
                id="profileModal.openTeam"
                defaultMessage="Open"
              />
            </Button>
          </div>
        ))}
        {payingTeams.length > 0 && (
          <label className={styles.billingRow}>
            <span>
              <FormattedMessage
                id="profileModal.aiPaidBy"
                defaultMessage="AI generations paid by"
              />
            </span>
            <select
              className={styles.billingSelect}
              value={currentUser?.billingOrgId || ''}
              disabled={isSavingBilling}
              onChange={(e) => handleBillingChange(e.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: 'profileModal.aiPaidByMe',
                  defaultMessage: 'My own tokens'
                })}
              </option>
              {payingTeams.map((org) => (
                <option key={org.orgId} value={org.orgId}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {invitations.map((inv) => (
          <div key={inv.id} className={styles.teamRow}>
            <div className={styles.teamInfo}>
              <span className={styles.teamName}>{inv.orgName}</span>
              <span className={styles.teamMeta}>
                <FormattedMessage
                  id="profileModal.invitedAs"
                  defaultMessage="Invitation as {role}"
                  values={{ role: intl.formatMessage(roleMessages[inv.role]) }}
                />
              </span>
            </div>
            <Button onClick={() => openInvitation(inv.id)}>
              <FormattedMessage
                id="profileModal.viewInvitation"
                defaultMessage="View invitation"
              />
            </Button>
          </div>
        ))}
      </div>
      <hr className={styles.divider} />
    </>
  );
}

export { ProfileTeamsSection };
