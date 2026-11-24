/**
 * Where a scene lives (#1267 Phase 2, docs/team-scenes.md), in the Share
 * modal:
 *   - a team scene: its team, and its project, which the team's editors can
 *     change;
 *   - your own personal scene: "Move to a team" into a team (and project)
 *     where you're an editor. A team scene can't move back out.
 */
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import {
  listProjects,
  moveScene,
  orgErrorReason,
  refreshMembershipStatus
} from '../../../api/orgs';
import { orgErrorMessage } from '../TeamModal/orgMessages';
import { canEditTeamScene, isTeamEditorRole } from '@/editor/lib/sceneAccess';
import { useAuthContext } from '../../../contexts';
import styles from './ShareModal.module.scss';

const NO_PROJECT = '';

export function ShareTeamSection({ sceneId, sceneData, currentUser, onMoved }) {
  const intl = useIntl();
  const { setCurrentUser } = useAuthContext();
  const teams = (currentUser?.orgs || []).filter(
    (org) => org.status === 'active' && isTeamEditorRole(org.role)
  );
  const sceneTeam = sceneData?.orgId
    ? (currentUser?.orgs || []).find((org) => org.orgId === sceneData.orgId)
    : null;
  const isAuthor = !!currentUser && sceneData?.author === currentUser.uid;

  // The team the project list is for: the scene's team, or the one picked
  // to move a personal scene into.
  const [targetOrgId, setTargetOrgId] = useState('');
  const orgId = sceneData?.orgId || targetOrgId;
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProjectId(sceneData?.projectId || NO_PROJECT);
  }, [sceneData?.projectId]);

  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    listProjects(orgId)
      .then(setProjects)
      .catch((error) => console.error('Error loading projects:', error));
  }, [orgId]);

  if (!sceneData) return null;
  // Moving between projects: the team's editors (only of their own scenes
  // when the team says so; the server checks too).
  const canMoveTeamScene =
    !!sceneTeam &&
    canEditTeamScene(currentUser, sceneData.orgId, sceneData.author);
  const canMoveIn = !sceneData.orgId && isAuthor && teams.length > 0;
  if (!sceneTeam && !canMoveIn) return null;

  const move = async (toOrgId, toProjectId) => {
    setBusy(true);
    try {
      await moveScene(sceneId, toOrgId, toProjectId || null);
      posthog.capture(
        sceneData.orgId ? 'scene_project_changed' : 'scene_moved_to_team',
        {
          scene_id: sceneId,
          org_id: toOrgId
        }
      );
      useStore.getState().setSceneTeam({
        orgId: toOrgId,
        projectId: toProjectId || null
      });
      onMoved(toOrgId, toProjectId || null);
      if (!sceneData.orgId) {
        const team = teams.find((t) => t.orgId === toOrgId);
        STREET.notify.successMessage(
          intl.formatMessage(
            {
              id: 'shareTeam.moved',
              defaultMessage: 'The scene now belongs to {team}.'
            },
            { team: team?.name }
          )
        );
        await refreshMembershipStatus(setCurrentUser);
      }
    } catch (error) {
      console.error('Error moving the scene:', error);
      STREET.notify.errorMessage(orgErrorMessage(intl, orgErrorReason(error)));
    } finally {
      setBusy(false);
    }
  };

  const projectSelect = (onChange, disabled) => (
    <select
      className={styles.teamSelect}
      value={projectId}
      disabled={disabled}
      aria-label={intl.formatMessage({
        id: 'shareTeam.project',
        defaultMessage: 'Project'
      })}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={NO_PROJECT}>
        {intl.formatMessage({
          id: 'teamScenes.noProject',
          defaultMessage: 'No project'
        })}
      </option>
      {projects.map((project) => (
        <option key={project.projectId} value={project.projectId}>
          {project.name}
        </option>
      ))}
    </select>
  );

  if (sceneTeam) {
    return (
      <div className={styles.teamSection}>
        <span className={styles.teamLabel}>
          <FormattedMessage
            id="shareTeam.inTeam"
            defaultMessage="Team: {team}"
            values={{ team: <strong>{sceneTeam.name}</strong> }}
          />
        </span>
        {projectSelect((next) => {
          setProjectId(next);
          move(sceneData.orgId, next);
        }, busy || !canMoveTeamScene)}
      </div>
    );
  }

  return (
    <div className={styles.teamSection}>
      <span className={styles.teamLabel}>
        <FormattedMessage
          id="shareTeam.moveToTeam"
          defaultMessage="Move to a team"
        />
      </span>
      <select
        className={styles.teamSelect}
        value={targetOrgId}
        disabled={busy}
        aria-label={intl.formatMessage({
          id: 'shareTeam.team',
          defaultMessage: 'Team'
        })}
        onChange={(e) => {
          setTargetOrgId(e.target.value);
          setProjectId(NO_PROJECT);
        }}
      >
        <option value="">
          {intl.formatMessage({
            id: 'shareTeam.pickTeam',
            defaultMessage: 'Pick a team'
          })}
        </option>
        {teams.map((team) => (
          <option key={team.orgId} value={team.orgId}>
            {team.name}
          </option>
        ))}
      </select>
      {targetOrgId && projectSelect(setProjectId, busy)}
      <Button
        variant="toolbtn"
        disabled={busy || !targetOrgId}
        onClick={() => {
          const team = teams.find((t) => t.orgId === targetOrgId);
          useStore.getState().showConfirm({
            title: intl.formatMessage(
              {
                id: 'shareTeam.confirmTitle',
                defaultMessage: 'Move this scene to {team}?'
              },
              { team: team?.name }
            ),
            message: intl.formatMessage({
              id: 'shareTeam.confirmMessage',
              defaultMessage:
                "The scene will belong to the team: its members can open and edit it, and you can't move it back to your scenes. If it's private, it becomes team-only."
            }),
            confirmLabel: intl.formatMessage({
              id: 'shareTeam.move',
              defaultMessage: 'Move'
            }),
            onConfirm: () => move(targetOrgId, projectId)
          });
        }}
      >
        <FormattedMessage id="shareTeam.move" defaultMessage="Move" />
      </Button>
    </div>
  );
}
