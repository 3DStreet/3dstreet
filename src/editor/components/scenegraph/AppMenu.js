import { Menubar } from 'radix-ui';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import posthog from 'posthog-js';
import Events from '../../lib/Events.js';

const cameraOptions = [
  {
    value: 'perspective',
    event: 'cameraperspectivetoggle',
    payload: null,
    label: '3D View'
  },
  {
    value: 'orthotop',
    event: 'cameraorthographictoggle',
    payload: 'top',
    label: 'Plan View'
  }
];

const AppMenu = ({ currentUser }) => {
  const { setModal, isInspectorEnabled, setIsInspectorEnabled, saveScene } =
    useStore();

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
    const container = document.querySelector('.chat-panel-container');
    if (container) {
      container.style.display = 'block';
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
            {cameraOptions.map((option) => (
              <Menubar.Item
                key={option.value}
                className="MenubarItem"
                onClick={() => handleCameraChange(option)}
              >
                {option.label}
              </Menubar.Item>
            ))}
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => AFRAME.INSPECTOR.controls.resetZoom()}
            >
              Reset Camera View
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => setIsInspectorEnabled(!isInspectorEnabled)}
            >
              Enter Viewer Mode
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
