import { useState } from 'react';
import classNames from 'classnames';
import styles from './SceneEditTitle.module.scss';
import { useAuthContext } from '../../../contexts/index.js';
import { updateSceneIdAndTitle } from '../../../api/scene';
import useStore from '../../../../store.js';
import InlineEditInput from '../InlineEditInput';
import { Edit24Icon } from '@shared/icons';

// readOnly renders the same title styling without the inline-rename
// affordance — used by the Viewer top bar for scenes the current user
// cannot edit.
const SceneEditTitle = ({ readOnly = false }) => {
  const title = useStore((state) => state.sceneTitle);
  const saveScene = useStore((state) => state.saveScene);
  // Hidden-panel mode shows the title for context only — no inline editing.
  const editable = useStore((state) => state.panelsVisible);
  const { currentUser } = useAuthContext();
  const [editing, setEditing] = useState(false);

  // Inline rename is offered only when the panels are visible (editing
  // session) AND the Viewer hasn't asked for a read-only title.
  const canEdit = editable && !readOnly;

  const displayTitle = title || 'Untitled';

  const commitTitle = (value) => {
    const newTitle = value.trim();
    if (!newTitle || newTitle === title) return;

    // Undoable, and keeps the store in sync.
    AFRAME.INSPECTOR.execute('scenetitle', { value: newTitle });

    // Signed out: keep the title local; it is applied at first real save.
    if (!currentUser) return;

    const sceneId = STREET.utils.getCurrentSceneId();
    if (!sceneId) {
      // New unsaved scene: run the normal save pipeline to create the scene
      // (and its uuid) under the freshly set title.
      saveScene(false);
    } else if (currentUser.uid === STREET.utils.getAuthorId()) {
      saveNewTitle(newTitle);
    }
    // Not the author: local-only, same as before.
  };

  const saveNewTitle = async (newTitle) => {
    try {
      await updateSceneIdAndTitle(STREET.utils.getCurrentSceneId(), newTitle);
      STREET.notify.successMessage(`New scene title saved: ${newTitle}`);
    } catch (error) {
      console.error('Error with update title', error);
      STREET.notify.errorMessage(`Error updating scene title: ${error}`);
    }
  };

  if (editing && canEdit) {
    return (
      <div className={styles.wrapper}>
        <InlineEditInput
          className={styles.titleInput}
          defaultValue={displayTitle}
          onCommit={commitTitle}
          onClose={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={classNames(styles.wrapper, !canEdit && styles.static)}
      onClick={canEdit ? () => setEditing(true) : undefined}
    >
      <div className={styles.readOnly}>
        <p className={styles.title}>{displayTitle}</p>
        {canEdit && (
          <span className={styles.editIcon}>
            <Edit24Icon />
          </span>
        )}
      </div>
    </div>
  );
};

export { SceneEditTitle };
