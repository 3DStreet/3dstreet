/**
 * The profile's Teams section (#1267 Phase 1): the user's organizations and
 * their pending invitations. Hidden when there are neither.
 */
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import useStore from '@/store';
import { Button } from '../../elements';
import { invitationState, listMyInvitations } from '../../../api/orgs';
import { roleMessages } from '../TeamModal/orgMessages';
import styles from './ProfileModal.module.scss';

function ProfileTeamsSection({ currentUser, isOpen }) {
  const intl = useIntl();
  const openTeamModal = useStore((state) => state.openTeamModal);
  const openInvitation = useStore((state) => state.openInvitation);
  const [invitations, setInvitations] = useState([]);
  const orgs = currentUser?.orgs || [];

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
