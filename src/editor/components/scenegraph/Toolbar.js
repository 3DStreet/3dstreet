import { ScreenshotIcon, Upload24Icon, Edit24Icon } from '../../icons';
import { Button, ProfileButton, Logo } from '../components';
import posthog from 'posthog-js';
import { UndoRedo } from '../components/UndoRedo';
import { CameraToolbar } from '../viewport/CameraToolbar';
import useStore from '@/store';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import { Save } from '@/editor/components/components/Save';

function Toolbar({ currentUser }) {
  const { isSavingScene, setModal, isInspectorEnabled } = useStore();

  const newHandler = () => {
    posthog.capture('new_scene_clicked');
    useStore.getState().setModal('new');
  };

  const isEditor = !!isInspectorEnabled;

  return (
    <div id="toolbar" className="m-4 justify-center">
      <div className="grid grid-flow-dense grid-cols-5">
        <div className="col-span-2">
          <Logo />
        </div>
        {isEditor && (
          <>
            <div className="col-span-1 flex items-center justify-center">
              <CameraToolbar />
            </div>
            <div className="col-span-2 flex items-center justify-end gap-2">
              <Button
                leadingIcon={<Edit24Icon />}
                onClick={newHandler}
                disabled={isSavingScene}
                variant="toolbtn"
              >
                <div>New</div>
              </Button>
              <Save currentUser={currentUser} />
              <Button
                leadingIcon={<Upload24Icon />}
                onClick={() => useStore.getState().setModal('scenes')}
                variant="toolbtn"
                className="min-w-[105px]"
              >
                <div>Open</div>
              </Button>
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
              <div onClick={() => setModal('profile')}>
                <ProfileButton />
              </div>
            </div>
          </>
        )}
      </div>
      {isEditor && (
        <div className="mr-2 mt-2 flex justify-end gap-2 pr-[43px]">
          <UndoRedo />
        </div>
      )}
    </div>
  );
}

export default Toolbar;
