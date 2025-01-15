import { useState, useEffect } from 'react';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import useStore from '@/store';
import { Button } from '@/editor/components/components';
import { Cloud24Icon, Save24Icon } from '@/editor/icons';
import debounce from 'lodash-es/debounce';
import Events from '@/editor/lib/Events';

export const Save = ({ currentUser }) => {
  const [savedScene, setSavedScene] = useState(false);
  const [isSaveActionActive, setIsSaveActionActive] = useState(false);
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

  const toggleSaveActionState = () => {
    setIsSaveActionActive(!isSaveActionActive);
  };

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
        <div className="saveButtonWrapper relative">
          {isSavingScene ? (
            <Button
              leadingIcon={<Save24Icon />}
              variant="filled"
              className="min-w-[110px]"
            >
              <div className="grow">Saved</div>
            </Button>
          ) : (
            <Button
              leadingIcon={<Save24Icon />}
              onClick={toggleSaveActionState}
              variant="toolbtn"
              className="min-w-[110px]"
            >
              <div className="grow">Save</div>
            </Button>
          )}
          {isSaveActionActive && (
            <div className="dropdownedButtons">
              <Button
                leadingIcon={<Cloud24Icon />}
                variant="white"
                onClick={() => saveScene(false)}
                disabled={isSavingScene || !isAuthor()}
              >
                <div>Save</div>
              </Button>
              <Button
                leadingIcon={<Cloud24Icon />}
                variant="white"
                onClick={() => saveScene(true)}
                disabled={isSavingScene}
              >
                <div>Make a Copy</div>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          leadingIcon={<Save24Icon />}
          onClick={!isSavingScene ? handleUnsignedSave : undefined}
          variant="toolbtn"
          className="min-w-[110px]"
        >
          <div className="grow">Save</div>
        </Button>
      )}
    </div>
  );
};
