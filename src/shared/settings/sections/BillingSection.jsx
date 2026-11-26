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
import { TeamContactLink } from '@shared/components/TeamContactLink';
import { Button } from '@shared/components/Button';
import { TokenDisplayInner } from '@shared/auth/components';
import { formatDate } from '@shared/utils/format';
import { getOrg, listMembers } from '@shared/api/orgs';
import { isDomainPro, personalPlanOf } from '@shared/utils/workspace';
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
  if (plan === 'PRO' && isDomainPro(currentUser)) {
    return intl.formatMessage(
      {
        id: 'profileModal.planProDomain',
        defaultMessage: 'Plan: Pro (from {domain})'
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
  // The team whose seat gives Pro to a user without a plan of their own.
  const seatTeam = !ownPlan && currentUser?.isPro ? currentUser.teamName : null;
  // A one-time pass (#1922) or Pro from an email domain has no subscription to manage.
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
        error?.details?.reason === 'no-stripe-customer'
          ? intl.formatMessage({
              id: 'settings.planNotInStripe',
              defaultMessage:
                "Your plan isn't billed through Stripe. Contact 3DStreet to change it."
            })
          : intl.formatMessage({
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
        {/* With Pro from a team, upgrading would lead nowhere. */}
        {!ownPlan && !seatTeam && (
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

      {seatTeam && (
        <p className={styles.hint}>
          <FormattedMessage
            id="settings.proFromTeam"
            defaultMessage="Your Pro features come from {team}."
            values={{ team: seatTeam }}
          />
        </p>
      )}
      {!ownPlan && !seatTeam && (
        <TeamContactLink source="personal_billing" className={styles.hint} />
      )}

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
          {tokenProfile.billing?.inactive && (
            <p className={styles.hint}>
              <FormattedMessage
                id="settings.activeTeamInactive"
                defaultMessage="{team} is inactive. Switch to Personal in the profile menu to use these tokens."
                values={{ team: tokenProfile.billing.teamName || '' }}
              />
            </p>
          )}
          {tokenProfile.billing && !tokenProfile.billing.inactive && (
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
  // The org (for the storage limit), and, for managers, the members
  // whose usage the wallet lists by name.
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    getOrg(team.orgId)
      .then((loaded) => !cancelled && setOrg(loaded))
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
            {team.status !== 'active' ? (
              <FormattedMessage
                id="settings.teamInactive"
                defaultMessage="This team is inactive: its scenes can be viewed, not changed. Contact 3DStreet to reactivate it."
              />
            ) : covers ? (
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
      {org && (
        <p className={styles.muted}>
          <TeamLibraryUsage org={org} />
        </p>
      )}
      {covers && team.status === 'active' && (
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
