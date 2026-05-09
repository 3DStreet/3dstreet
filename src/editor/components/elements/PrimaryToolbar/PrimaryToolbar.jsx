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
    // Close the inspector FIRST, then flip the preset. The viewer-mode
    // component's setupMode() guards on isInspectorEnabled to keep a
    // chassis from spawning while the editor is open, so the preset
    // change has to happen with the inspector already closed.
    useStore.getState().setIsInspectorEnabled(false);
    const cameraRig = document.getElementById('cameraRig');
    const viewerMode = cameraRig?.components?.['viewer-mode'];
    if (cameraRig) {
      cameraRig.setAttribute('viewer-mode', 'preset', 'drive');
    }
    // If preset was already 'drive' (e.g. after a prior Play -> Edit
    // cycle, where Edit deliberately leaves the preset alone),
    // setAttribute is a no-op and update() won't fire — so re-run
    // setupMode explicitly to (re-)spawn the player car.
    if (viewerMode) viewerMode.setupMode('drive');
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
