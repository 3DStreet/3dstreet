import { ProfileButton, Logo } from '../components';
import useStore from '@/store';
import AppMenu from './AppMenu';
import { Button } from '../components/Button';
import { ScreenshotIcon } from '../../icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';

function Toolbar({ currentUser }) {
  const { setModal, isInspectorEnabled, setIsInspectorEnabled } = useStore();
  const isEditor = !!isInspectorEnabled;

  return (
    <div id="toolbar">
      <div className="grid grid-flow-dense grid-cols-5">
        <div className="col-span-2 flex items-center">
          <div className="flex-shrink-0">
            <Logo />
          </div>
          {isEditor && (
            <div className="ml-4">
              <AppMenu />
            </div>
          )}
        </div>
        {isEditor && (
          <div className="col-span-3 flex items-center justify-end gap-2">
            <Button
              onClick={() => setIsInspectorEnabled(!isInspectorEnabled)}
              variant="toolbtn"
            >
              {isInspectorEnabled ? 'Enter Viewer mode' : 'Enter Editor mode'}
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
