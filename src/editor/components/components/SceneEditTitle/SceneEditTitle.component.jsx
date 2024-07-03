import { useEffect, useState } from 'react';
import styles from './SceneEditTitle.module.scss';
import { useAuthContext } from '../../../contexts/index.js';
import { updateSceneIdAndTitle, isSceneAuthor } from '../../../api/scene';

const SceneEditTitle = ({ sceneData }) => {
  const [title, setTitle] = useState(sceneData?.sceneTitle);
  const { currentUser } = useAuthContext();

  const sceneId = STREET.utils.getCurrentSceneId();

  useEffect(() => {
    if (sceneData.sceneId === sceneId) {
      setTitle(sceneData.sceneTitle);
    }
  }, [sceneData?.sceneTitle, sceneData?.sceneId, sceneId]);

  useEffect(() => {
    AFRAME.scenes[0].addEventListener('newTitle', (event) => {
      setTitle(event.detail.sceneTitle ?? '');
    });
  }, []);

  const handleEditClick = () => {
    const newTitle = prompt('Edit the title:', title);

    if (newTitle !== null) {
      if (newTitle !== title) {
        setTitle(newTitle);
        saveNewTitle(newTitle);
      }
    }
  };

  const saveNewTitle = async (newTitle) => {
    try {
      if (sceneData?.sceneId) {
        const isCurrentUserTheSceneAuthor = await isSceneAuthor({
          sceneId: sceneData.sceneId,
          authorId: currentUser.uid
        });
        if (isCurrentUserTheSceneAuthor) {
          await updateSceneIdAndTitle(sceneData?.sceneId, newTitle);
        }
      }
      AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', newTitle);
      AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneData?.sceneId);
      STREET.notify.successMessage(`New scene title saved: ${newTitle}`);
    } catch (error) {
      console.error('Error with update title', error);
      STREET.notify.errorMessage(`Error updating scene title: ${error}`);
    }
  };

  return (
    <div className={styles.wrapper}>
      {
        <div className={styles.readOnly}>
          <p className={styles.title} onClick={handleEditClick}>
            {title || 'Untitled'}
          </p>
        </div>
      }
    </div>
  );
};

export { SceneEditTitle };
