import { Menubar } from 'radix-ui';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import {
  makeScreenshot,
  saveSceneWithScreenshot
} from '@/editor/lib/SceneUtils';
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
  const { setModal, postSaveScene } = useStore();

  const handleCameraChange = (option) => {
    // Let the camera system handle the camera change first
    Events.emit(option.event, option.payload);
    // The cameratoggle event will be emitted by the camera system with the proper camera object
  };
  // const { setModal, isSavingScene, doSaveAs, saveScene, postSaveScene } = useStore();

  const newHandler = () => {
    posthog.capture('new_scene_clicked');
    setModal('new');
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
              onClick={async () => {
                if (!currentUser) {
                  setModal('signin');
                  return;
                }
                if (currentUser?.uid !== STREET.utils.getAuthorId()) {
                  return;
                }
                try {
                  await saveSceneWithScreenshot(currentUser, false);
                } catch (error) {
                  STREET.notify.errorMessage(`Error saving scene: ${error}`);
                  console.error(error);
                } finally {
                  postSaveScene();
                  STREET.notify.successMessage('Scene saved successfully.');
                }
              }}
            >
              Save
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={async () => {
                if (!currentUser) {
                  setModal('signin');
                  return;
                }
                try {
                  await saveSceneWithScreenshot(currentUser, true);
                } catch (error) {
                  STREET.notify.errorMessage(`Error saving scene: ${error}`);
                  console.error(error);
                } finally {
                  postSaveScene();
                  STREET.notify.successMessage(
                    'Scene saved as a new scene successfully.'
                  );
                }
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
            <Menubar.Item className="MenubarItem">
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
              onClick={() => window.open('https://docs.3dstreet.org', '_blank')}
            >
              Documentation
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
};

export default AppMenu;
