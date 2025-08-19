import { ProfileButton, Logo } from '../elements';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { Tooltip } from 'radix-ui';
import { Button } from '../elements/Button';
import { ScreenshotIcon } from '../../icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import { SceneEditTitle } from '../elements/SceneEditTitle';
import { ActionBar } from '../elements/ActionBar';
import { Save } from '../elements/Save';
import { useEffect } from 'react';
import TimeControls from '../elements/TimeControls';

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

function Toolbar({ currentUser, entity }) {
  const { setModal, isInspectorEnabled } = useStore();
  const { currentUser: authUser } = useAuthContext();

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
    <Tooltip.Provider>
      <div id="toolbar">
        <div className="flex items-center justify-between">
          {/* Left section - Logo, Title, Save */}
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <Logo currentUser={currentUser} />
            </div>
            {isInspectorEnabled && (
              <div className="flex min-w-0 items-center gap-2">
                <TooltipWrapper content="Edit scene title" side="bottom">
                  <div id="scene-title" className="clickable truncate">
                    <SceneEditTitle />
                  </div>
                </TooltipWrapper>
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
                <TooltipWrapper
                  content="Take screenshot and download scene"
                  side="bottom"
                >
                  <Button
                    leadingIcon={<ScreenshotIcon />}
                    onClick={() => {
                      makeScreenshot();
                      useStore.getState().setModal('screenshot');
                    }}
                    variant="toolbtn"
                    className="min-w-[105px]"
                  >
                    <div>Share</div>
                  </Button>
                </TooltipWrapper>
                {/* User Status Pill */}
                <TooltipWrapper
                  content={
                    authUser?.isPro
                      ? '3DStreet Geospatial Pro Plan'
                      : '3DStreet Free Community Plan'
                  }
                  side="bottom"
                >
                  <div
                    className="cursor-pointer rounded-full bg-gray-700 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-gray-600"
                    onClick={() => setModal(currentUser ? 'profile' : 'signin')}
                  >
                    {authUser?.isPro ? 'PRO' : 'FREE'}
                  </div>
                </TooltipWrapper>
                <TooltipWrapper
                  content={currentUser ? 'Open profile' : 'Sign in'}
                  side="bottom"
                >
                  <div
                    onClick={() => setModal(currentUser ? 'profile' : 'signin')}
                    aria-label={currentUser ? 'Open profile' : 'Sign in'}
                    className="mr-1"
                  >
                    <ProfileButton />
                  </div>
                </TooltipWrapper>
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
    </Tooltip.Provider>
  );
}

export default Toolbar;
