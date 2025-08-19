import { useState, useEffect } from 'react';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import useStore from '@/store';
import { Button } from '@/editor/components/elements';
import {
  CloudSavedIcon,
  CloudSavingIcon,
  CloudNotSavedIcon
} from '@/editor/icons';
import debounce from 'lodash-es/debounce';
import Events from '@/editor/lib/Events';
import { Tooltip } from 'radix-ui';

const TooltipWrapper = ({ children, content, side = 'bottom', ...props }) => {
  return (
    <Tooltip.Root delayDuration={0}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={5}
          style={{
            backgroundColor: '#1f2937',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            border: '1px solid #374151',
            zIndex: 1000
          }}
          {...props}
        >
          {content}
          <Tooltip.Arrow style={{ fill: '#1f2937' }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

export const Save = ({ currentUser }) => {
  const [savedScene, setSavedScene] = useState(false);
  const {
    isSavingScene,
    doSaveAs,
    doPromptTitle,
    setModal,
    saveScene,
    postSaveScene
  } = useStore();

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
      handleSave(doSaveAs, doPromptTitle);
    }
  }, [isSavingScene]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAuthor = () => {
    return currentUser?.uid === STREET.utils.getAuthorId();
  };

  const handleSave = async (saveAs, doPromptTitle) => {
    try {
      await saveSceneWithScreenshot(currentUser, saveAs, doPromptTitle);
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
    <Tooltip.Provider>
      <div>
        {currentUser ? (
          <div className="relative">
            {isSavingScene ? (
              <TooltipWrapper content="Saving...">
                <Button variant="save">
                  <CloudSavingIcon />
                </Button>
              </TooltipWrapper>
            ) : (
              <>
                {!isAuthor() ? (
                  <TooltipWrapper content="Scene not saved, press to save as...">
                    <Button
                      onClick={() => {
                        saveScene(true, true);
                      }}
                      variant="save"
                    >
                      <CloudNotSavedIcon />
                    </Button>
                  </TooltipWrapper>
                ) : (
                  <TooltipWrapper content="Scene saved to cloud, press to save again">
                    <Button
                      onClick={() => {
                        saveScene(false);
                      }}
                      variant="save"
                    >
                      <CloudSavedIcon />
                    </Button>
                  </TooltipWrapper>
                )}
              </>
            )}
          </div>
        ) : (
          <TooltipWrapper content="Scene not saved, sign in to save as...">
            <Button
              onClick={!isSavingScene ? handleUnsignedSave : undefined}
              variant="save"
            >
              <CloudNotSavedIcon />
            </Button>
          </TooltipWrapper>
        )}
      </div>
    </Tooltip.Provider>
  );
};
