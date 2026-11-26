/**
 * What members can edit, in the team settings (docs/orgs.md): all team
 * scenes and library assets, or only those they created or added, and
 * whether they copy scenes to Personal. Owners and admins change it;
 * everyone else reads the current rule.
 */
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import { memberEditScopeOf } from '@shared/utils/teamPermissions';
import { orgErrorReason, updateOrgSettings } from '@shared/api/orgs';
import { orgErrorMessage } from './orgMessages';
import { useSettingsHost } from '../SettingsHost';
import styles from './TeamSection.module.scss';

export function TeamPermissionsSection({ org, canManage, onChanged }) {
  const intl = useIntl();
  const { notify } = useSettingsHost();
  const [busy, setBusy] = useState(false);
  const scope = memberEditScopeOf(org);

  const save = async (settings) => {
    setBusy(true);
    try {
      await updateOrgSettings(org.orgId, settings);
      posthog.capture('org_settings_changed', {
        org_id: org.orgId,
        ...settings
      });
      await onChanged();
    } catch (error) {
      console.error('Error saving team settings:', error);
      notify(orgErrorMessage(intl, orgErrorReason(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const scopeLabels = {
    all: intl.formatMessage({
      id: 'teamPermissions.scopeAll',
      defaultMessage: 'All team scenes and library assets'
    }),
    own: intl.formatMessage({
      id: 'teamPermissions.scopeOwn',
      defaultMessage: 'Only the scenes and assets they created'
    })
  };

  return (
    <>
      <h3 className={styles.sectionTitle}>
        <FormattedMessage
          id="teamPermissions.title"
          defaultMessage="What members can edit"
        />
      </h3>
      {canManage ? (
        <label className={styles.settingLabel}>
          <select
            className={styles.roleSelect}
            value={scope}
            disabled={busy}
            onChange={(e) => save({ memberEditScope: e.target.value })}
          >
            {['all', 'own'].map((value) => (
              <option key={value} value={value}>
                {scopeLabels[value]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className={styles.walletSummary}>{scopeLabels[scope]}</p>
      )}
      <p className={styles.muted}>
        {scope === 'own' ? (
          <FormattedMessage
            id="teamPermissions.scopeOwnHint"
            defaultMessage="Members open and view every team scene, and save a copy of the others' scenes. Owners and admins edit everything."
          />
        ) : (
          <FormattedMessage
            id="teamPermissions.scopeAllHint"
            defaultMessage="Members edit every team scene, one person at a time. Viewers only view."
          />
        )}
      </p>
      <label className={styles.settingLabel}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={org.memberCopyToPersonal === true}
          disabled={busy || !canManage}
          onChange={(e) => save({ memberCopyToPersonal: e.target.checked })}
        />
        <FormattedMessage
          id="teamPermissions.copyToPersonal"
          defaultMessage="Members can copy the scenes they created to Personal"
        />
      </label>
      <p className={styles.muted}>
        <FormattedMessage
          id="teamPermissions.copyToPersonalHint"
          defaultMessage="The team keeps the original. A copy is public when the member has no Pro plan."
        />
      </p>
    </>
  );
}
