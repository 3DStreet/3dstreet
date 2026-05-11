import { useEffect, useState } from 'react';
import { faEye, faEyeSlash, faPlay } from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import { CameraSparkleIcon } from '@shared/icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import styles from './PrimaryToolbar.module.scss';

/**
 * Watches the scene for entities tagged with `drive-controls` (a.k.a.
 * "Driveable Vehicle" entries from the AddLayerPanel) and returns a
 * boolean indicating whether at least one is currently present. Used to
 * gate the Play button — without one, Play has nothing to spawn.
 */
function useHasDriveable() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const recheck = () => setHas(!!sceneEl.querySelector('[drive-controls]'));
    recheck();
    const obs = new MutationObserver(recheck);
    obs.observe(sceneEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['drive-controls']
    });
    return () => obs.disconnect();
  }, []);
  return has;
}

export const PrimaryToolbar = () => {
  const panelsVisible = useStore((s) => s.panelsVisible);
  const togglePanelsVisible = useStore((s) => s.togglePanelsVisible);
  const { currentUser } = useAuthContext() || {};
  const hasDriveable = useHasDriveable();

  const handlePlay = () => {
    // Play is feature-agnostic: close the inspector and tell the
    // play-mode system to start. Drive-mode, and any future
    // subscribers (traffic animation, etc.), react to the scene
    // event play-mode-start independently.
    useStore.getState().setIsInspectorEnabled(false);
    document.querySelector('a-scene')?.systems?.['play-mode']?.start();
  };

  const handleSnapshot = () => {
    if (currentUser && STREET.utils.getAuthorId() === currentUser.uid) {
      useStore.getState().saveScene(false);
    }
    makeScreenshot();
    useStore.getState().setModal('screenshot');
  };

  return (
    <div className={styles.wrapper}>
      <Button
        variant="toolbtn"
        onClick={togglePanelsVisible}
        title="Toggle panels visibility (`)"
        leadingIcon={
          <AwesomeIcon icon={panelsVisible ? faEyeSlash : faEye} size={16} />
        }
      >
        {panelsVisible ? 'Hide panels' : 'Show panels'}
      </Button>
      <div className={styles.divider} />
      <Button
        variant="toolbtn"
        onClick={handlePlay}
        disabled={!hasDriveable}
        leadingIcon={<AwesomeIcon icon={faPlay} size={14} />}
        title={
          hasDriveable
            ? 'Enter play mode (drive the vehicle around the scene)'
            : 'Add a Driveable Vehicle from the layers panel to enable Play'
        }
      >
        Play
      </Button>
      <div className={styles.divider} />
      <Button
        variant="toolbtn"
        onClick={handleSnapshot}
        leadingIcon={<CameraSparkleIcon />}
        title="Capture screenshot and generate rendered images"
      >
        Snapshot
      </Button>
    </div>
  );
};
