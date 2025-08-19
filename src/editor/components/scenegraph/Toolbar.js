import { ProfileButton, Logo } from '../elements';
import useStore from '@/store';
import { Button } from '../elements/Button';
import { ScreenshotIcon } from '../../icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import { SceneEditTitle } from '../elements/SceneEditTitle';
import { ActionBar } from '../elements/ActionBar';
import { Save } from '../elements/Save';
import { useEffect } from 'react';
import TimeControls from '../elements/TimeControls';

function Toolbar({ currentUser, entity }) {
  const { setModal, isInspectorEnabled } = useStore();

  // Initialize recording status check on component mount
  useEffect(() => {
    // Start the recording status check
    useStore.getState().startRecordingCheck();

    // Clean up when component unmounts
    return () => {
      useStore.getState().stopRecordingCheck();
    };
  }, []);

  return (
    <div id="toolbar">
      <div className="flex items-center justify-between">
        {/* Left section - Logo, Title, Save */}
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <Logo currentUser={currentUser} />
          </div>
          {isInspectorEnabled && (
            <div className="flex min-w-0 items-center gap-2">
              <div id="scene-title" className="clickable truncate">
                <SceneEditTitle />
              </div>
              <Save currentUser={currentUser} />
            </div>
          )}
          {/* Time Controls - only shown in viewer mode */}
          {!isInspectorEnabled && (
            <div>
              <TimeControls entity={entity} />
            </div>
          )}
        </div>

        {/* Right section - Share, Profile */}
        <div className="flex items-center gap-2">
          {isInspectorEnabled && (
            <>
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
                className="mr-1"
              >
                <ProfileButton />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating ActionBar below toolbar */}
      {isInspectorEnabled && (
        <div className="absolute left-1/2 z-10 mt-3 -translate-x-1/2 transform">
          <ActionBar selectedEntity={entity} />
        </div>
      )}
    </div>
  );
}

export default Toolbar;
