import { useEffect, useState } from 'react';
import { useAuthContext } from '../../../contexts';
import { Toolbar } from './Toolbar.component.jsx';
import { isSceneAuthor } from '../../../api';

function ToolbarWrapper({ onToggleEdit, isEditor, sceneData }) {
  const { currentUser } = useAuthContext();
  const [isAuthor, setIsAuthor] = useState(false);
  const currentSceneId = sceneData?.sceneId;
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

  return (
    <Toolbar
      currentUser={currentUser}
      isAuthor={isAuthor}
      onToggleEdit={onToggleEdit}
      isEditor={isEditor}
      sceneData={sceneData}
    />
  );
}

export { ToolbarWrapper };
