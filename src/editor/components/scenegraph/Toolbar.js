import { ProfileButton, Logo } from '../components';
import useStore from '@/store';
import AppMenu from './AppMenu';
import { Button } from '../components/Button';
import { ScreenshotIcon } from '../../icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import { SceneEditTitle } from '../components/SceneEditTitle';
import { ActionBar } from '../components/ActionBar';
import { Save } from '../components/Save';

function Toolbar({ currentUser, entity }) {
  const { setModal, isInspectorEnabled } = useStore();

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
            >
              <div>Share</div>
            </Button>
            <div
              onClick={() => setModal(currentUser ? 'profile' : 'signin')}
              aria-label={currentUser ? 'Open profile' : 'Sign in'}
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
