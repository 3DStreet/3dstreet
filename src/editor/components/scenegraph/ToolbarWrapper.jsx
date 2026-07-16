/* global STREET */
import { useEffect, useState } from 'react';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import Toolbar from './Toolbar';

/**
 * Viewer-first entry: when a cloud scene loads and the signed-in user
 * isn't its author (or nobody is signed in), present it in the Viewer
 * instead of dropping straight into the editor. The Edit/Remix button
 * in the viewer top bar opens the full editor — nothing is taken away,
 * and actually editing/saving still goes through the existing
 * save-as-fork flow for non-authors.
 *
 * Auth state resolves asynchronously (Firebase session restore), so the
 * decision is deferred until AuthProvider reports it settled — this
 * avoids flapping an author into the viewer because currentUser was
 * momentarily null.
 */
function useViewerFirstEntry() {
  const { currentUser, isLoading } = useAuthContext() || {};
  const [pendingAuthorId, setPendingAuthorId] = useState(null);

  useEffect(() => {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const evaluateLoadedScene = () => {
      // metadata (sceneId/authorId) is stamped synchronously right
      // after createElementsFromJSON returns, i.e. just after the
      // newScene event — defer one tick so it's readable.
      setTimeout(() => {
        const sceneId = STREET.utils.getCurrentSceneId();
        const authorId = STREET.utils.getAuthorId();
        // Only cloud scenes have an author to compare against; local /
        // imported scenes stay in the editor.
        if (sceneId && authorId) setPendingAuthorId(authorId);
      }, 0);
    };
    sceneEl.addEventListener('newScene', evaluateLoadedScene);
    // Catch a scene that finished loading before this hook mounted.
    evaluateLoadedScene();
    return () => sceneEl.removeEventListener('newScene', evaluateLoadedScene);
  }, []);

  useEffect(() => {
    if (!pendingAuthorId || isLoading) return;
    const isAuthor = currentUser && currentUser.uid === pendingAuthorId;
    const { isInspectorEnabled, enterViewerMode } = useStore.getState();
    // No camera vantage handling needed here: view and edit share the
    // editor camera (#1848), and the newScene camera animation already
    // flew it to the scene's saved start view.
    if (!isAuthor && isInspectorEnabled) {
      enterViewerMode();
    }
    setPendingAuthorId(null);
  }, [pendingAuthorId, isLoading, currentUser]);
}

function ToolbarWrapper() {
  useViewerFirstEntry();
  return <Toolbar />;
}

export { ToolbarWrapper };
