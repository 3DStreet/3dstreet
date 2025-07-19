import { Menubar } from 'radix-ui';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import posthog from 'posthog-js';
import Events from '../../lib/Events.js';
import canvasRecorder from '../../lib/CanvasRecorder';
import { useAuthContext } from '@/editor/contexts';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { AwesomeIcon } from '../elements/AwesomeIcon';

const cameraOptions = [
  {
    value: 'perspective',
    event: 'cameraperspectivetoggle',
    payload: null,
    label: '3D View',
    shortcut: '1'
  },
  {
    value: 'orthotop',
    event: 'cameraorthographictoggle',
    payload: 'top',
    label: 'Plan View',
    shortcut: '4'
  }
];

const AppMenu = ({ currentUser }) => {
  const {
    setModal,
    isInspectorEnabled,
    setIsInspectorEnabled,
    isGridVisible,
    setIsGridVisible,
    saveScene,
    startCheckout
  } = useStore();
  const { currentUser: authUser } = useAuthContext();

  const handleCameraChange = (option) => {
    // Let the camera system handle the camera change first
    Events.emit(option.event, option.payload);
    // The cameratoggle event will be emitted by the camera system with the proper camera object
  };

  const newHandler = () => {
    posthog.capture('new_scene_clicked');
    setModal('new');
  };

  const showAIChatPanel = () => {
    // Use the global ref to access the AIChatPanel component
    if (
      window.aiChatPanelRef &&
      typeof window.aiChatPanelRef.openPanel === 'function'
    ) {
      window.aiChatPanelRef.openPanel();
    }
  };

  return (
    <Menubar.Root className="MenubarRoot">
      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">File</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item className="MenubarItem" onClick={newHandler}>
              New...
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() => setModal('scenes')}
            >
              Open...
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              disabled={!STREET.utils.getCurrentSceneId()}
              onClick={() => {
                if (!currentUser) {
                  setModal('signin');
                  return;
                }
                if (currentUser?.uid !== STREET.utils.getAuthorId()) {
                  return;
                }
                saveScene(false);
              }}
            >
              Save
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() => {
                if (!currentUser) {
                  setModal('signin');
                  return;
                }
                saveScene(true, true);
              }}
            >
              Save As...
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => {
                makeScreenshot();
                setModal('screenshot');
              }}
            >
              Share & Download...
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">View</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.CheckboxItem
              className="MenubarCheckboxItem"
              checked={isGridVisible}
              onCheckedChange={setIsGridVisible}
            >
              <Menubar.ItemIndicator className="MenubarItemIndicator">
                <AwesomeIcon icon={faCheck} size={14} />
              </Menubar.ItemIndicator>
              Show Grid
              <div className="RightSlot">G</div>
            </Menubar.CheckboxItem>
            <Menubar.Separator className="MenubarSeparator" />
            {cameraOptions.map((option) => (
              <Menubar.Item
                key={option.value}
                className="MenubarItem"
                onClick={() => handleCameraChange(option)}
              >
                {option.label}
                <div className="RightSlot">{option.shortcut}</div>
              </Menubar.Item>
            ))}
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => AFRAME.INSPECTOR.controls.resetZoom()}
            >
              Reset Camera View
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">Run</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item
              className="MenubarItem"
              onClick={() => {
                // Enter viewer mode
                setIsInspectorEnabled(!isInspectorEnabled);
              }}
            >
              Start Viewer
              <div className="RightSlot">5</div>
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={async () => {
                // Check if user is logged in and has pro access
                if (!authUser) {
                  // Not logged in, show signin modal
                  setModal('signin');
                  return;
                }

                if (!authUser.isPro) {
                  // User doesn't have pro access, show payment modal
                  // Pass the current location as postCheckout to return here after payment
                  startCheckout(null); // No redirect after payment
                  posthog.capture('recording_feature_paywall_shown');
                  return;
                }

                // User has pro access, proceed with recording
                const aframeCanvas = document.querySelector('a-scene').canvas;
                if (!aframeCanvas) {
                  console.error('Could not find A-Frame canvas for recording');
                  return;
                }

                // Start recording the canvas
                const success = await canvasRecorder.startRecording(
                  aframeCanvas,
                  {
                    name:
                      '3DStreet-Recording-' +
                      new Date().toISOString().slice(0, 10)
                  }
                );

                if (success) {
                  // Enter viewer mode
                  setIsInspectorEnabled(!isInspectorEnabled);
                }
              }}
            >
              Start and Record{' '}
              <div className="RightSlot">
                <span className="pro-badge">Pro</span>
              </div>
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">Help</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item
              className="MenubarItem"
              onClick={() =>
                window.open('https://www.3dstreet.org/docs/', '_blank')
              }
            >
              Documentation
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() =>
                window.open(
                  'https://www.3dstreet.org/docs/3dstreet-editor/keyboard-shortcuts',
                  '_blank'
                )
              }
            >
              Keyboard Shortcuts
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() =>
                window.open(
                  'https://www.3dstreet.org/docs/3dstreet-editor/mouse-and-touch-controls',
                  '_blank'
                )
              }
            >
              Mouse and Touch Controls
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item className="MenubarItem" onClick={showAIChatPanel}>
              AI Scene Assistant
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
};

export default AppMenu;
