/**
 * A team's scenes in the scenes modal (#1267 Phase 2, docs/team-scenes.md):
 * filter by project, create a project, start a new scene in a project.
 * Owners and admins can delete scenes; renaming happens in the scene (it
 * needs the edit lock). The modal stays mounted while closed, so the
 * projects and scenes are reloaded each time it opens (a scene saved
 * meanwhile shows up).
 */
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import useStore from '@/store';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { Loader } from '@shared/icons';
import { Button, SceneCard } from '../../elements';
import { getTeamScenes } from '../../../api/scene';
import { createProject, listProjects, orgErrorReason } from '../../../api/orgs';
import { orgErrorMessage } from '@shared/settings/team/orgMessages';
import { isTeamEditorRole, isTeamManagerRole } from '../../../lib/sceneAccess';
import styles from './ScenesModal.module.scss';

const ALL = '__all__';
const NONE = '__none__';

export function TeamScenesPanel({ org, isOpen, handleSceneClick }) {
  const intl = useIntl();
  const [projects, setProjects] = useState([]);
  const [filter, setFilter] = useState(ALL);
  const [scenes, setScenes] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState(null);
  // A suspended team's scenes are view only.
  const isActive = org.status === 'active';
  const isEditor = isActive && isTeamEditorRole(org.role);
  const isManager = isActive && isTeamManagerRole(org.role);

  const projectId =
    filter === ALL ? undefined : filter === NONE ? null : filter;

  const loadScenes = useCallback(
    async (after) => {
      setIsLoading(true);
      try {
        const page = await getTeamScenes(org.orgId, { projectId, after });
        setScenes((previous) => (after ? [...previous, ...page] : page));
        setHasMore(page.length === 20);
      } catch (error) {
        console.error('Error loading team scenes:', error);
        STREET.notify.errorMessage(orgErrorMessage(intl, null));
      } finally {
        setIsLoading(false);
      }
    },
    [org.orgId, projectId, intl]
  );

  useEffect(() => {
    if (!isOpen) return;
    listProjects(org.orgId)
      .then(setProjects)
      .catch((error) => console.error('Error loading projects:', error));
  }, [org.orgId, isOpen]);

  useEffect(() => {
    if (isOpen) loadScenes();
  }, [loadScenes, isOpen]);

  const handleCreateProject = async (e) => {
    e.preventDefault();
    try {
      const created = await createProject(org.orgId, newProjectName);
      setProjects((list) =>
        [...list, { projectId: created.projectId, name: created.name }].sort(
          (a, b) => a.name.localeCompare(b.name)
        )
      );
      setNewProjectName(null);
      setFilter(created.projectId);
    } catch (error) {
      STREET.notify.errorMessage(orgErrorMessage(intl, orgErrorReason(error)));
    }
  };

  // The New modal's templates save the scene they create: it goes to this
  // team project (store.newSceneTarget, see SceneUtils.saveScene).
  const handleNewScene = () => {
    useStore.getState().setNewSceneTarget({
      orgId: org.orgId,
      projectId: projectId || null
    });
    useStore.getState().setModal('new');
  };

  const projectName = (id) => projects.find((p) => p.projectId === id)?.name;

  return (
    <div className={styles.teamPanel}>
      <div className={styles.teamToolbar}>
        <select
          className={styles.teamSelect}
          value={filter}
          aria-label={intl.formatMessage({
            id: 'teamScenes.projectFilter',
            defaultMessage: 'Project'
          })}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value={ALL}>
            {intl.formatMessage({
              id: 'teamScenes.allProjects',
              defaultMessage: 'All projects'
            })}
          </option>
          {projects.map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
          <option value={NONE}>
            {intl.formatMessage({
              id: 'teamScenes.noProject',
              defaultMessage: 'No project'
            })}
          </option>
        </select>
        {isEditor && newProjectName === null && (
          <Button variant="toolbtn" onClick={() => setNewProjectName('')}>
            <FormattedMessage
              id="teamScenes.newProject"
              defaultMessage="New project"
            />
          </Button>
        )}
        {isEditor && newProjectName !== null && (
          <form
            className={styles.teamInlineForm}
            onSubmit={handleCreateProject}
          >
            <input
              className={styles.teamInput}
              value={newProjectName}
              maxLength={80}
              autoFocus
              placeholder={intl.formatMessage({
                id: 'teamScenes.projectNamePlaceholder',
                defaultMessage: 'Project name'
              })}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <Button type="submit" disabled={!newProjectName.trim()}>
              <FormattedMessage
                id="teamScenes.createProject"
                defaultMessage="Create"
              />
            </Button>
            <Button variant="toolbtn" onClick={() => setNewProjectName(null)}>
              <FormattedMessage {...commonMessages.cancel} />
            </Button>
          </form>
        )}
        <span className={styles.teamSpacer} />
        {isEditor && (
          <Button onClick={handleNewScene}>
            {projectId ? (
              <FormattedMessage
                id="teamScenes.newSceneInProject"
                defaultMessage="New scene in {project}"
                values={{ project: projectName(projectId) }}
              />
            ) : (
              <FormattedMessage
                id="teamScenes.newScene"
                defaultMessage="New team scene"
              />
            )}
          </Button>
        )}
      </div>

      {isLoading && scenes.length === 0 ? (
        <div className={styles.loadingSpinner}>
          <Loader className={styles.spinner} />
        </div>
      ) : scenes.length === 0 ? (
        <p className={styles.teamEmpty}>
          <FormattedMessage
            id="teamScenes.empty"
            defaultMessage="No scenes here yet."
          />
        </p>
      ) : (
        <SceneCard
          scenesData={scenes}
          setScenesData={setScenes}
          handleSceneClick={handleSceneClick}
          showAuthor
          // Across projects, each card says which one it's in.
          projectNameOf={
            filter === ALL
              ? (scene) => projectName(scene.data().projectId)
              : undefined
          }
          canRename={false}
          canDelete={isManager}
        />
      )}
      {hasMore && !isLoading && (
        <div className={styles.loadMore}>
          <Button
            className={styles.button}
            onClick={() => loadScenes(scenes[scenes.length - 1])}
          >
            <FormattedMessage
              id="scenesModal.loadMore"
              defaultMessage="Load More"
            />
          </Button>
        </div>
      )}
    </div>
  );
}
