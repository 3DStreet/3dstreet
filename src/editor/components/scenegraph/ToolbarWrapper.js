import { useAuthContext } from '../../contexts';
import Toolbar from './Toolbar';

function ToolbarWrapper() {
  const { currentUser } = useAuthContext();
  const authorId = STREET.utils.getAuthorId();
  return <Toolbar currentUser={currentUser} authorId={authorId} />;
}

export { ToolbarWrapper };
