/**
 * The team's AI tokens (#1267 Phase 3, docs/team-wallet.md) in the team
 * settings: what's left this month and the monthly budget for everyone; the
 * per-member cap and this month's usage per member for owners and admins.
 * The budget is set by 3DStreet (it's what the team pays for).
 */
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import { Button } from '@shared/components/Button';
import {
  getTeamWallet,
  orgErrorReason,
  setMemberMonthlyCap
} from '@shared/api/orgs';
import { monthKey, refillWallet } from '@shared/utils/teamWallet';
import { orgErrorMessage } from './orgMessages';
import { useSettingsHost } from '../SettingsHost';
import styles from './TeamSection.module.scss';

export function TeamWalletSection({ orgId, members, canManage }) {
  const intl = useIntl();
  const { notify } = useSettingsHost();
  const [data, setData] = useState(null);
  const [capText, setCapText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { wallet, usage } = await getTeamWallet(orgId, monthKey());
      setData({ wallet: refillWallet(wallet), usage });
      setCapText(
        wallet.memberMonthlyCap === null ||
          wallet.memberMonthlyCap === undefined
          ? ''
          : String(wallet.memberMonthlyCap)
      );
    } catch (error) {
      console.error('Error loading the team wallet:', error);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;
  const { wallet, usage } = data;
  const cap = wallet.memberMonthlyCap ?? null;
  const nameOf = (uid) => {
    const member = members.find((m) => m.uid === uid);
    return member ? member.displayName || member.email : uid;
  };
  const usageRows = Object.entries(usage.members || {})
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1]);

  const parsedCap = capText.trim() === '' ? null : Number(capText);
  const capIsValid =
    parsedCap === null || (Number.isInteger(parsedCap) && parsedCap >= 0);

  const handleSaveCap = async (e) => {
    e.preventDefault();
    if (!capIsValid) return;
    setBusy(true);
    try {
      await setMemberMonthlyCap(orgId, parsedCap);
      posthog.capture('org_member_cap_set', { org_id: orgId, cap: parsedCap });
      await load();
    } catch (error) {
      notify(orgErrorMessage(intl, orgErrorReason(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className={styles.sectionTitle}>
        <FormattedMessage id="teamWallet.title" defaultMessage="AI tokens" />
      </h3>
      <p className={styles.walletSummary}>
        <FormattedMessage
          id="teamWallet.balance"
          defaultMessage="{balance} tokens left this month, from a budget of {budget} per month."
          values={{
            balance: <strong>{wallet.genToken || 0}</strong>,
            budget: wallet.monthlyTokenBudget || 0
          }}
        />{' '}
        {cap !== null && !canManage && (
          <FormattedMessage
            id="teamWallet.capInfo"
            defaultMessage="Each member can use up to {cap} tokens per month."
            values={{ cap }}
          />
        )}
      </p>
      {canManage && (
        <>
          <form className={styles.inlineForm} onSubmit={handleSaveCap}>
            <label className={styles.capLabel}>
              <FormattedMessage
                id="teamWallet.capLabel"
                defaultMessage="Limit per member per month"
              />
              <input
                className={styles.capInput}
                type="number"
                min="0"
                step="1"
                value={capText}
                placeholder={intl.formatMessage({
                  id: 'teamWallet.noCap',
                  defaultMessage: 'No limit'
                })}
                onChange={(e) => setCapText(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={
                busy ||
                !capIsValid ||
                parsedCap === (wallet.memberMonthlyCap ?? null)
              }
            >
              <FormattedMessage id="teamModal.save" defaultMessage="Save" />
            </Button>
          </form>
          {usageRows.length > 0 && (
            <ul className={styles.list}>
              {usageRows.map(([uid, tokens]) => (
                <li key={uid} className={styles.row}>
                  <span className={styles.who}>{nameOf(uid)}</span>
                  <span className={styles.role}>
                    <FormattedMessage
                      id="teamWallet.usedTokens"
                      defaultMessage="{tokens} tokens this month"
                      values={{ tokens }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.muted}>
            <FormattedMessage
              id="teamWallet.budgetHint"
              defaultMessage="To change the monthly budget or add tokens, contact 3DStreet."
            />
          </p>
        </>
      )}
    </>
  );
}
