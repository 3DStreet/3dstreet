import { useState, useEffect } from 'react';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import useStore from '@/store';
import { Button } from '@/editor/components/components';
import {
  CloudSavedIcon,
  CloudSavingIcon,
  CloudNotSavedIcon
} from '@/editor/icons';
import debounce from 'lodash-es/debounce';
import Events from '@/editor/lib/Events';

export const Save = ({ currentUser }) => {
  const [savedScene, setSavedScene] = useState(false);
  const { isSavingScene, doSaveAs, setModal, saveScene, postSaveScene } =
    useStore();

  useEffect(() => {
    if (savedScene) {
      debounce(() => {
        setSavedScene(false);
      }, 1000);
    }
  }, [savedScene]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const autoSaveScene = debounce((cmd) => {
      if (cmd) {
        if (currentUser && STREET.utils.getAuthorId() === currentUser.uid) {
          const streetGeo = document
            .getElementById('reference-layers')
            ?.getAttribute('street-geo');
          if (
            !currentUser.isPro &&
            streetGeo &&
            streetGeo['latitude'] &&
            streetGeo['longitude']
          ) {
            setModal('payment');
            return;
          }
          saveScene(false);
        }
      }
    }, 1000);
    Events.on('historychanged', autoSaveScene);
    return () => {
      Events.off('historychanged', autoSaveScene);
    };
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSavingScene) {
      handleSave(doSaveAs);
    }
  }, [isSavingScene]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAuthor = () => {
    return currentUser?.uid === STREET.utils.getAuthorId();
  };

  const handleSave = async (saveAs) => {
    try {
      await saveSceneWithScreenshot(currentUser, saveAs);
    } catch (error) {
      STREET.notify.errorMessage(
        `Error trying to save 3DStreet scene to cloud. Error: ${error}`
      );
      console.error(error);
    } finally {
      postSaveScene();
      setSavedScene(true);
    }
  };

  const handleUnsignedSave = () => {
    setModal('signin');
  };

  return (
    <div>
      {currentUser ? (
        <div className="relative">
          {isSavingScene ? (
            <Button variant="save" title="Saving...">
              <CloudSavingIcon />
            </Button>
          ) : (
            <>
              {!isAuthor() ? (
                <Button
                  onClick={() => {
                    saveScene(false);
                  }}
                  variant="save"
                  title="Scene not saved, click to save as new file"
                >
                  <CloudNotSavedIcon />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    saveScene(false);
                  }}
                  variant="save"
                  title="Scene saved to cloud, click to save again"
                >
                  <CloudSavedIcon />
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <Button
          onClick={!isSavingScene ? handleUnsignedSave : undefined}
          variant="save"
          title="Scene not saved, sign in to save"
        >
          <CloudNotSavedIcon />
        </Button>
      )}
    </div>
  );
};
