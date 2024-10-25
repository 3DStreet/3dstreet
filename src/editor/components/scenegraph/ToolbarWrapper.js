import { useAuthContext } from '../../contexts';
import Toolbar from './Toolbar';

function ToolbarWrapper() {
  const { currentUser } = useAuthContext();
  return <Toolbar currentUser={currentUser} />;
}

export { ToolbarWrapper };
