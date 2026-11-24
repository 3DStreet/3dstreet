/**
 * Settings > Usage and billing (docs/settings.md), for Personal or a team:
 *   - Personal (orgId null): the user's own plan (upgrade, or manage the
 *     Stripe subscription) and their own tokens; while their active team
 *     pays their AI generations, a line says so.
 *   - a team: its plan (whether it covers the user: a seat does, viewing
 *     doesn't), its library storage and its AI token wallet
 *     (docs/team-wallet.md).
 */
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase';
import { useAuthContext } from '@shared/contexts';
import { Button } from '@shared/components/Button';
import { TokenDisplayInner } from '@shared/auth/components';
import { formatDate } from '@shared/utils/format';
import { getOrg, listMembers } from '@shared/api/orgs';
import { personalPlanOf } from '@shared/utils/workspace';
import { TeamWalletSection } from '../team/TeamWalletSection';
import { TeamLibraryUsage } from '../team/TeamLibraryUsage';
import { useSettingsHost } from '../SettingsHost';
import { settingsMessages } from '../settingsMessages';
import styles from '../SettingsModal.module.scss';

const SEAT_ROLES = ['owner', 'admin', 'member'];
const MANAGER_ROLES = ['owner', 'admin'];

function personalPlanLabel(intl, currentUser, plan) {
  if (plan === 'MAX') {
    return intl.formatMessage({
      id: 'profileModal.planMax',
      defaultMessage: 'Plan: Max'
    });
  }
  if (plan === 'PRO TEAM') {
    return intl.formatMessage(
      {
        id: 'profileModal.planProTeam',
        defaultMessage: 'Plan: Pro Team ({domain})'
      },
      { domain: currentUser?.teamDomain }
    );
  }
  if (plan === 'PRO' && currentUser?.isProPass && !currentUser?.plan) {
    return intl.formatMessage(
      {
        id: 'profileModal.planProPass',
        defaultMessage: 'Plan: Pro (Project Pass) until {date}'
      },
      { date: formatDate(currentUser?.proUntil) }
    );
  }
  if (plan === 'PRO') {
    return intl.formatMessage({
      id: 'profileModal.planPro',
      defaultMessage: 'Plan: Pro'
    });
  }
  return intl.formatMessage({
    id: 'profileModal.planFree',
    defaultMessage: 'Plan: Free'
  });
}

function PersonalBilling() {
  const intl = useIntl();
  const { currentUser, tokenProfile } = useAuthContext();
  const { onUpgrade, notify } = useSettingsHost();
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const ownPlan = personalPlanOf(currentUser);
  // A one-time pass (#1922) or a domain team has no subscription to manage.
  const hasSubscription = !!currentUser?.plan;
  // While the active team pays, tokenProfile.genToken is the team's; the
  // user's own balance is personalGenToken.
  const ownTokens = tokenProfile?.billing
    ? (tokenProfile.personalGenToken ?? 0)
    : tokenProfile?.genToken;

  const manageSubscription = async () => {
    setIsOpeningPortal(true);
    try {
      const {
        data: { url }
      } = await httpsCallable(
        functions,
        'createStripeBillingPortal'
      )({
        // Back here, in whichever app opened it.
        return_url: `${location.origin}${location.pathname}#/modal/settings/billing`
      });
      window.location.href = url;
    } catch (error) {
      console.error('Error opening the billing portal:', error);
      notify(
        intl.formatMessage({
          id: 'settings.billingPortalError',
          defaultMessage: 'Could not open the subscription page. Try again.'
        }),
        'error'
      );
      setIsOpeningPortal(false);
    }
  };

  return (
    <>
      <div className={styles.card}>
        <span>{personalPlanLabel(intl, currentUser, ownPlan)}</span>
        {!ownPlan && (
          <Button variant="upgrade" onClick={() => onUpgrade('settings')}>
            <FormattedMessage {...settingsMessages.upgradeToPro} />
          </Button>
        )}
        {hasSubscription && (
          <Button
            variant="toolbtn"
            onClick={manageSubscription}
            disabled={isOpeningPortal}
          >
            {isOpeningPortal ? (
              <FormattedMessage
                id="profileModal.managingSubscription"
                defaultMessage="Managing subscription"
              />
            ) : (
              <FormattedMessage
                id="profileModal.manageSubscription"
                defaultMessage="Manage subscription"
              />
            )}
          </Button>
        )}
      </div>

      {tokenProfile && (
        <>
          <h3 className={styles.sectionTitle}>
            <FormattedMessage id="settings.tokens" defaultMessage="Tokens" />
          </h3>
          <div className={styles.card}>
            <TokenDisplayInner showLabel={true} count={ownTokens} />
            {/* Personal Pro tokens refill monthly; a pass gives them once. */}
            {hasSubscription && (
              <span className={styles.hint}>
                <FormattedMessage
                  id="profileModal.nextMonthlyRefill"
                  defaultMessage="Next monthly refill: {date}"
                  values={{
                    date: intl.formatDate(
                      new Date(
                        new Date().getFullYear(),
                        new Date().getMonth() + 1,
                        1
                      ),
                      { month: 'short', day: 'numeric' }
                    )
                  }}
                />
              </span>
            )}
          </div>
          {tokenProfile.billing && (
            <p className={styles.hint}>
              <FormattedMessage
                id="settings.activeTeamPays"
                defaultMessage="While {team} is your active team, it pays your AI generations."
                values={{ team: tokenProfile.billing.teamName || '' }}
              />
            </p>
          )}
          <div className={styles.card}>
            {/* Geo tokens are unlimited with any Pro (subscription, team
                seat, pass). */}
            {currentUser?.isPro ? (
              <TokenDisplayInner
                showLabel={true}
                tokenType="geoToken"
                count="∞"
                label={intl.formatMessage({
                  id: 'profileModal.unlimitedGeoTokens',
                  defaultMessage: 'Unlimited Geo Tokens'
                })}
              />
            ) : (
              <TokenDisplayInner showLabel={true} tokenType="geoToken" />
            )}
          </div>
        </>
      )}
    </>
  );
}

function TeamBilling({ team }) {
  const covers = SEAT_ROLES.includes(team.role);
  const canManage = MANAGER_ROLES.includes(team.role);
  // The seat count (for the storage limit), and, for managers, the members
  // whose usage the wallet lists by name.
  const [seats, setSeats] = useState(null);
  const [members, setMembers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    getOrg(team.orgId)
      .then((org) => !cancelled && setSeats(org?.seats ?? null))
      .catch((error) => console.error('Error loading the team:', error));
    if (canManage) {
      listMembers(team.orgId)
        .then((list) => !cancelled && setMembers(list))
        .catch((error) => console.error('Error loading members:', error));
    }
    return () => {
      cancelled = true;
    };
  }, [team.orgId, canManage]);

  return (
    <>
      <div className={styles.card}>
        <div className={styles.credentials}>
          <span>
            <FormattedMessage
              id="settings.teamPlan"
              defaultMessage="Plan: {plan} · {team}"
              values={{ plan: team.plan, team: team.name }}
            />
          </span>
          <span className={styles.hint}>
            {covers ? (
              <FormattedMessage
                id="settings.teamPlanHint"
                defaultMessage="Your team's plan. Its owners and admins manage it with 3DStreet."
              />
            ) : (
              <FormattedMessage
                id="settings.viewerOwnPlan"
                defaultMessage="As a viewer of {team}, you work with your own plan."
                values={{ team: team.name }}
              />
            )}
          </span>
        </div>
      </div>
      {seats !== null && (
        <p className={styles.muted}>
          <TeamLibraryUsage orgId={team.orgId} plan={team.plan} seats={seats} />
        </p>
      )}
      {covers && (
        <TeamWalletSection
          orgId={team.orgId}
          members={members}
          canManage={canManage}
        />
      )}
    </>
  );
}

/** Usage and billing for Personal (orgId null) or one of the user's teams. */
export function BillingSection({ orgId = null }) {
  const { currentUser } = useAuthContext();
  const team = orgId
    ? (currentUser?.orgs || []).find((org) => org.orgId === orgId)
    : null;
  return team ? <TeamBilling team={team} /> : <PersonalBilling />;
}
