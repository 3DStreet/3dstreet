/**
 * My profile > pending team invitations (#1267, docs/orgs.md), by the
 * user's verified email. Hidden when there are none; the user's teams are
 * in the profile menu's team switcher.
 */
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useAuthContext } from '@shared/contexts';
import { Button } from '@shared/components/Button';
import { invitationState, listMyInvitations } from '@shared/api/orgs';
import { roleMessages } from '../team/orgMessages';
import { useSettingsHost } from '../SettingsHost';
import styles from '../SettingsModal.module.scss';

export function InvitationsSection() {
  const intl = useIntl();
  const { currentUser } = useAuthContext();
  const { onOpenInvitation } = useSettingsHost();
  const email = currentUser?.email;
  const [invitations, setInvitations] = useState([]);

  useEffect(() => {
    if (!email) return undefined;
    let cancelled = false;
    listMyInvitations(email)
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
  }, [email]);

  if (invitations.length === 0) return null;

  return (
    <>
      <h3 className={styles.sectionTitle}>
        <FormattedMessage
          id="settings.invitations"
          defaultMessage="Team invitations"
        />
      </h3>
      {invitations.map((inv) => (
        <div key={inv.id} className={styles.card}>
          <div className={styles.credentials}>
            <span className={styles.name}>{inv.orgName}</span>
            <span className={styles.muted}>
              <FormattedMessage
                id="profileModal.invitedAs"
                defaultMessage="Invitation as {role}"
                values={{ role: intl.formatMessage(roleMessages[inv.role]) }}
              />
            </span>
          </div>
          <Button onClick={() => onOpenInvitation(inv.id)}>
            <FormattedMessage
              id="profileModal.viewInvitation"
              defaultMessage="View invitation"
            />
          </Button>
        </div>
      ))}
    </>
  );
}
