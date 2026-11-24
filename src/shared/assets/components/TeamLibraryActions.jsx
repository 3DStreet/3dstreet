/**
 * Team asset library actions (#1267 Phase 4, docs/team-assets.md) in an
 * asset's details (MeshDetailsModal for models and splats, AssetsModal for
 * images):
 *   - on one of the user's own assets: "Add to team library" (a team where
 *     they hold a seat);
 *   - on a team asset: which team and who added it, "Replace file" (with
 *     one of the user's assets of the same type, which reaches every scene
 *     using it; members only on the assets they added when the team lets
 *     members edit only their own) and "Remove from library" (owners,
 *     admins, or the member who added it).
 */
import { useState } from 'react';
import PropTypes from 'prop-types';
import posthog from 'posthog-js';
import { useAuthContext } from '@shared/contexts';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import { teamIdOfOwner } from '../assetOwner.js';
import { canEditTeamItem } from '@shared/utils/teamPermissions.js';
import {
  addAssetToTeam,
  replaceTeamAssetFile,
  removeTeamAsset,
  teamsUserCanAddTo,
  canRemoveTeamAsset,
  teamLibraryErrorKey
} from '../teamLibrary.js';
import AssetPickerModal from './AssetPickerModal.jsx';
import styles from './TeamLibraryActions.module.scss';

const LIBRARY_TYPES = ['mesh', 'splat', 'image'];

const TeamLibraryActions = ({
  assetId,
  type,
  ownerUid,
  deleted,
  addedBy,
  addedByName,
  // The Owner row of the models' details already names the team.
  showLocation = true,
  // Called with { orgId, assetId } of the new team asset after an add.
  onAdded,
  onRemoved
}) => {
  const { currentUser } = useAuthContext();
  const t = useSharedMessages();
  const [status, setStatus] = useState(null); // { running } | { done, text } | { error, text }
  const [picking, setPicking] = useState(false);
  const [targetOrgId, setTargetOrgId] = useState(null);

  const uid = currentUser?.uid;
  const orgs = currentUser?.orgs || [];
  const teamOrgId = teamIdOfOwner(ownerUid);
  if (!uid || !assetId || deleted || !LIBRARY_TYPES.includes(type)) {
    return null;
  }

  const run = async (action, doneText) => {
    setStatus({ running: true });
    try {
      await action();
      setStatus(doneText ? { done: true, text: doneText } : null);
      return true;
    } catch (error) {
      console.error('Team library action failed:', error);
      setStatus({ error: true, text: t(teamLibraryErrorKey(error)) });
      return false;
    }
  };

  const statusRow = status && (
    <div
      className={`${styles.status} ${
        status.error
          ? styles.statusError
          : status.done
            ? styles.statusDone
            : styles.statusRunning
      }`}
      role="status"
      aria-live="polite"
    >
      {status.running ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        <span className={styles.glyph} aria-hidden="true">
          {status.error ? '!' : '✓'}
        </span>
      )}
      <span>{status.running ? t('teamLibraryWorking') : status.text}</span>
    </div>
  );

  // A team asset: where it is, replace its file, remove it.
  if (teamOrgId) {
    const org = orgs.find((o) => o.orgId === teamOrgId);
    // Members replace only the assets they added when the team says so.
    const canReplace = canEditTeamItem(org, addedBy, uid);
    const canRemove = canRemoveTeamAsset(org, { addedBy }, uid);
    return (
      <div className={styles.block}>
        <p className={styles.info}>
          {[
            showLocation && t('teamLibraryIn', { team: org?.name || '' }),
            addedByName && t('teamLibraryAddedByCap', { name: addedByName })
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {(canReplace || canRemove) && (
          <div className={styles.buttons}>
            {canReplace && (
              <button
                type="button"
                className={styles.button}
                disabled={!!status?.running}
                onClick={() => setPicking(true)}
              >
                {t('teamLibraryReplace')}
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                className={styles.button}
                disabled={!!status?.running}
                onClick={async () => {
                  if (!window.confirm(t('teamLibraryRemoveConfirm'))) return;
                  const ok = await run(() =>
                    removeTeamAsset(teamOrgId, assetId)
                  );
                  if (ok) {
                    posthog.capture('team_asset_removed', {
                      org_id: teamOrgId
                    });
                    onRemoved?.();
                  }
                }}
              >
                {t('teamLibraryRemove')}
              </button>
            )}
          </div>
        )}
        {statusRow}
        {picking && (
          <AssetPickerModal
            type={type}
            title={t('teamLibraryReplaceTitle')}
            confirmLabel={t('teamLibraryReplace')}
            onCancel={() => setPicking(false)}
            onConfirm={async (item) => {
              setPicking(false);
              const ok = await run(
                () => replaceTeamAssetFile(teamOrgId, assetId, item.id),
                t('teamLibraryReplaced')
              );
              if (ok) {
                posthog.capture('team_asset_replaced', { org_id: teamOrgId });
              }
            }}
          />
        )}
      </div>
    );
  }

  // One of the user's own assets: add it to a team's library.
  if (ownerUid !== uid) return null;
  const teams = teamsUserCanAddTo(orgs);
  if (!teams.length) return null;
  const selectedOrgId =
    targetOrgId && teams.some((o) => o.orgId === targetOrgId)
      ? targetOrgId
      : teams[0].orgId;
  const selectedTeam = teams.find((o) => o.orgId === selectedOrgId);

  return (
    <div className={styles.block}>
      <div className={styles.buttons}>
        {teams.length > 1 && (
          <select
            className={styles.select}
            value={selectedOrgId}
            onChange={(e) => setTargetOrgId(e.target.value)}
            aria-label={t('teamLibraryChooseTeam')}
          >
            {teams.map((org) => (
              <option key={org.orgId} value={org.orgId}>
                {org.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={styles.button}
          disabled={!!status?.running}
          title={t('teamLibraryAddHint')}
          onClick={async () => {
            let added = null;
            const ok = await run(
              async () => {
                added = await addAssetToTeam(selectedOrgId, assetId);
              },
              t('teamLibraryAdded', { team: selectedTeam.name })
            );
            if (ok && added) onAdded?.(added);
            if (ok) {
              posthog.capture('team_asset_added', {
                org_id: selectedOrgId,
                type
              });
            }
          }}
        >
          {teams.length > 1
            ? t('teamLibraryAddTo')
            : t('teamLibraryAddToTeam', { team: selectedTeam.name })}
        </button>
      </div>
      {statusRow}
    </div>
  );
};

TeamLibraryActions.propTypes = {
  assetId: PropTypes.string,
  type: PropTypes.string,
  ownerUid: PropTypes.string,
  deleted: PropTypes.bool,
  addedBy: PropTypes.string,
  addedByName: PropTypes.string,
  showLocation: PropTypes.bool,
  onAdded: PropTypes.func,
  onRemoved: PropTypes.func
};

export default TeamLibraryActions;
