import { ProfileButton, Logo } from '../elements';
import useStore from '@/store';
import AppMenu from './AppMenu';
import { Button } from '../elements/Button';
import { ScreenshotIcon } from '../../icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import { SceneEditTitle } from '../elements/SceneEditTitle';
import { ActionBar } from '../elements/ActionBar';
import { Save } from '../elements/Save';
import canvasRecorder from '../../lib/CanvasRecorder';
import { useState, useEffect } from 'react';
import TimeControls from '../elements/TimeControls';

function Toolbar({ currentUser, entity }) {
  const { setModal, isInspectorEnabled } = useStore();
  const [isRecording, setIsRecording] = useState(false);

  // Check recording status on each render
  useEffect(() => {
    const checkRecordingStatus = () => {
      const recordingStatus = canvasRecorder.isCurrentlyRecording();
      if (isRecording !== recordingStatus) {
        setIsRecording(recordingStatus);
      }
    };

    // Check immediately and then set up interval
    checkRecordingStatus();
    const intervalId = setInterval(checkRecordingStatus, 1000);

    return () => clearInterval(intervalId);
  }, [isRecording]);

  return (
    <div id="toolbar">
      <div className="grid grid-flow-dense grid-cols-5">
        <div className="col-span-2 flex items-center">
          <div className="flex-shrink-0">
            <Logo />
          </div>
          {isInspectorEnabled && (
            <>
              <div className="ml-4">
                <AppMenu currentUser={currentUser} />
              </div>
              <div className="ml-4">
                <ActionBar selectedEntity={entity} />
              </div>
            </>
          )}
          {/* Time Controls - only shown in viewer mode */}
          {!isInspectorEnabled && (
            <div className="ml-4">
              <TimeControls entity={entity} />
            </div>
          )}
        </div>
        {isInspectorEnabled && (
          <div className="col-span-3 flex items-center justify-end gap-2">
            <div id="scene-title" className="clickable">
              <SceneEditTitle />
            </div>
            <Save currentUser={currentUser} />
            <Button
              leadingIcon={<ScreenshotIcon />}
              onClick={() => {
                makeScreenshot();
                useStore.getState().setModal('screenshot');
              }}
              variant="toolbtn"
              className="min-w-[105px]"
              title="Take screenshot and download scene"
            >
              <div>Share</div>
            </Button>
            <div
              onClick={() => setModal(currentUser ? 'profile' : 'signin')}
              aria-label={currentUser ? 'Open profile' : 'Sign in'}
              title={currentUser ? 'Open profile' : 'Sign in'}
            >
              <ProfileButton />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Toolbar;
