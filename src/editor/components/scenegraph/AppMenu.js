import { Menubar } from 'radix-ui';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import posthog from 'posthog-js';

const AppMenu = () => {
  const { setModal } = useStore();

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
              New
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() => setModal('scenes')}
            >
              Open
            </Menubar.Item>
            <Menubar.Item className="MenubarItem">Save</Menubar.Item>
            <Menubar.Item className="MenubarItem">Save As</Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() => {
                makeScreenshot();
                setModal('screenshot');
              }}
            >
              Share & Export
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
            <Menubar.Item className="MenubarItem">3D View</Menubar.Item>
            <Menubar.Item className="MenubarItem">Plan View</Menubar.Item>
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
