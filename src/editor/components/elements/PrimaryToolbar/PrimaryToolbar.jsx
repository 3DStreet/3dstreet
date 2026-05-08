import { faEye, faEyeSlash, faPlay } from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import { CameraSparkleIcon } from '@shared/icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import styles from './PrimaryToolbar.module.scss';

export const PrimaryToolbar = () => {
  const panelsVisible = useStore((s) => s.panelsVisible);
  const togglePanelsVisible = useStore((s) => s.togglePanelsVisible);
  const { currentUser } = useAuthContext() || {};

  const handlePlay = () => {
    // Close the inspector FIRST, then flip the preset. The viewer-mode
    // component's setupMode() guards on isInspectorEnabled to keep a
    // chassis from spawning while the editor is open, so the preset
    // change has to happen with the inspector already closed.
    useStore.getState().setIsInspectorEnabled(false);
    const cameraRig = document.getElementById('cameraRig');
    if (cameraRig) {
      cameraRig.setAttribute('viewer-mode', 'preset', 'drive');
    }
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
        leadingIcon={<AwesomeIcon icon={faPlay} size={14} />}
        title="Enter play mode (drive a vehicle around the scene)"
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
