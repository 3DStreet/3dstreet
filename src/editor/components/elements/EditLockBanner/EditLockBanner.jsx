/**
 * One editor at a time on team scenes (#1267 Phase 2, docs/team-scenes.md).
 *
 * Starts and stops the edit lock (src/editor/lib/editLock.js): a team
 * editor holds it while the scene is open in the editor. Shows a notice when
 * this tab can't save: someone else is editing (owners and admins can take
 * over), or the user only views the team's scenes.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import useStore from '@/store';
import { useAuthContext } from '../../../contexts';
import { Button } from '../Button';
import {
  isTeamEditorRole,
  isTeamManagerRole,
  teamRoleOf
} from '../../../lib/sceneAccess';
import {
  retryEditLock,
  startEditLock,
  stopEditLock,
  takeOverEditLock
} from '../../../lib/editLock';
import styles from './EditLockBanner.module.scss';

// The cloud scene id, re-read when a scene loads or a save completes (a
// first save gives a new scene its id).
function useCurrentSceneId() {
  const [sceneId, setSceneId] = useState(() =>
    STREET.utils.getCurrentSceneId()
  );
  useEffect(() => {
    const refresh = () =>
      setTimeout(() => setSceneId(STREET.utils.getCurrentSceneId() || null));
    const sceneEl = document.querySelector('a-scene');
    sceneEl?.addEventListener('newScene', refresh);
    const unsubscribe = useStore.subscribe(
      (state) => [state.isSavingScene, state.sceneOrgId],
      refresh
    );
    return () => {
      sceneEl?.removeEventListener('newScene', refresh);
      unsubscribe();
    };
  }, []);
  return sceneId;
}

export function EditLockBanner() {
  const intl = useIntl();
  const { currentUser } = useAuthContext();
  const sceneOrgId = useStore((state) => state.sceneOrgId);
  const isInspectorEnabled = useStore((state) => state.isInspectorEnabled);
  const editLock = useStore((state) => state.editLock);
  // Hidden behind modals: it sits above the side panels, not above dialogs.
  const isModalOpen = useStore((state) => !!state.modal);
  const sceneId = useCurrentSceneId();
  const [busy, setBusy] = useState(false);

  const role = sceneOrgId ? teamRoleOf(currentUser, sceneOrgId) : null;
  const isEditor = isTeamEditorRole(role);
  const shouldLock = !!(
    isInspectorEnabled &&
    sceneId &&
    sceneOrgId &&
    currentUser &&
    isEditor
  );

  useEffect(() => {
    if (shouldLock) startEditLock(sceneId, currentUser);
    else stopEditLock();
  }, [shouldLock, sceneId, currentUser]);

  useEffect(() => () => stopEditLock(), []);

  // Tell the user when the lock changes hands under them.
  const previous = useRef(editLock.status);
  useEffect(() => {
    const before = previous.current;
    previous.current = editLock.status;
    if (editLock.status === 'mine' && editLock.reloaded) {
      // Someone saved since this tab loaded the scene: it was reloaded.
      STREET.notify.successMessage(
        intl.formatMessage({
          id: 'editLock.gainedReloaded',
          defaultMessage:
            'You can edit this scene now. It was reloaded with the latest changes.'
        })
      );
    } else if (before === 'other' && editLock.status === 'mine') {
      STREET.notify.successMessage(
        intl.formatMessage({
          id: 'editLock.gained',
          defaultMessage: 'You can edit this scene now.'
        })
      );
    } else if (before === 'mine' && editLock.status === 'other') {
      STREET.notify.warningMessage(
        intl.formatMessage(
          {
            id: 'editLock.lost',
            defaultMessage:
              '{name} took over editing this scene. Your changes are no longer saved.'
          },
          { name: editLock.holderName || '?' }
        )
      );
    }
  }, [editLock.status, editLock.holderName, editLock.reloaded, intl]);

  if (!isInspectorEnabled || !sceneId || !sceneOrgId || !role || isModalOpen) {
    return null;
  }

  if (!isEditor) {
    return createPortal(
      <div className={styles.banner} role="status">
        <FormattedMessage
          id="editLock.viewerOnly"
          defaultMessage="You can view this team scene, but not edit it. Changes you make here are not saved."
        />
      </div>,
      document.body
    );
  }

  if (editLock.status !== 'other') return null;

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.banner} role="status">
      <span>
        <FormattedMessage
          id="editLock.otherEditing"
          defaultMessage="{name} is editing this scene. Changes you make here are not saved. You can edit as soon as they are done."
          values={{ name: <strong>{editLock.holderName || '?'}</strong> }}
        />
      </span>
      <div className={styles.actions}>
        <Button
          variant="toolbtn"
          disabled={busy}
          onClick={() => run(retryEditLock)}
        >
          <FormattedMessage id="editLock.retry" defaultMessage="Try again" />
        </Button>
        {isTeamManagerRole(role) && (
          <Button disabled={busy} onClick={() => run(takeOverEditLock)}>
            <FormattedMessage
              id="editLock.takeOver"
              defaultMessage="Take over"
            />
          </Button>
        )}
      </div>
    </div>,
    document.body
  );
}
