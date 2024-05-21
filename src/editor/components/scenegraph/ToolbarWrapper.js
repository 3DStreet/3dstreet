import { useEffect, useState } from 'react';
import { useAuthContext } from '../../contexts';
import Toolbar from './Toolbar';
import { isSceneAuthor } from '../../api';

function ToolbarWrapper() {
  const { currentUser } = useAuthContext();
  const [isAuthor, setIsAuthor] = useState(false);
  const currentSceneId = STREET.utils.getCurrentSceneId();
  useEffect(() => {
    async function checkAuthorship() {
      if (currentUser && currentUser.uid && currentSceneId) {
        try {
          const isAuthorResult = await isSceneAuthor({
            sceneId: currentSceneId,
            authorId: currentUser.uid
          });
          setIsAuthor(isAuthorResult);
        } catch (error) {
          console.error('Error:', error);
        }
      }
    }

    checkAuthorship();
  }, [currentUser, currentSceneId]);

  return <Toolbar currentUser={currentUser} isAuthor={isAuthor} />;
}

export { ToolbarWrapper };
