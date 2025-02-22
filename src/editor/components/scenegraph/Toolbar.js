import { ProfileButton, Logo } from '../components';
import useStore from '@/store';
import AppMenu from './AppMenu';

function Toolbar({ currentUser }) {
  const { setModal, isInspectorEnabled } = useStore();
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
              <AppMenu />
            </div>
            <div className="col-span-2 flex items-center justify-end gap-2">
              <div
                onClick={() => setModal(currentUser ? 'profile' : 'signin')}
                aria-label={currentUser ? 'Open profile' : 'Sign in'}
              >
                <ProfileButton />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Toolbar;
