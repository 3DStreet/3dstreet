import { useEffect, useState } from 'react';
import { faEye, faEyeSlash, faPlay } from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import Events from '@/editor/lib/Events';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import { CameraSparkleIcon } from '@shared/icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import styles from './PrimaryToolbar.module.scss';

/**
 * Returns true when there is anything for Play to actually do —
 * either a driveable vehicle (`[drive-controls]`) or at least one
 * managed-street with `playable: true`. Watches the scene for both
 * via MutationObserver. Used to gate the Play button.
 */
function useHasPlayable() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const recheck = () => {
      if (sceneEl.querySelector('[drive-controls]')) return setHas(true);
      // A-Frame's getAttribute returns the parsed component data
      // object once the component has initialized. For the initial-
      // render race, components?.[name]?.data is the canonical read.
      const streets = sceneEl.querySelectorAll('[managed-street]');
      for (const s of streets) {
        if (s.components?.['managed-street']?.data?.playable) {
          return setHas(true);
        }
      }
      setHas(false);
    };
    recheck();
    const obs = new MutationObserver(recheck);
    obs.observe(sceneEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['drive-controls', 'managed-street']
    });
    // A-Frame's setAttribute for component property updates doesn't
    // always rewrite the DOM attribute string immediately, so the
    // MutationObserver above sometimes misses property toggles from
    // the inspector property panel. PropertyRow fires 'entityupdate'
    // on the editor Events bus on every change, which is the
    // authoritative signal.
    Events.on('entityupdate', recheck);
    return () => {
      obs.disconnect();
      Events.off('entityupdate', recheck);
    };
  }, []);
  return has;
}

export const PrimaryToolbar = () => {
  const panelsVisible = useStore((s) => s.panelsVisible);
  const togglePanelsVisible = useStore((s) => s.togglePanelsVisible);
  const { currentUser } = useAuthContext() || {};
  const hasPlayable = useHasPlayable();

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
      {hasPlayable && (
        <>
          <div className={styles.divider} />
          <Button
            variant="toolbtn"
            onClick={handlePlay}
            leadingIcon={<AwesomeIcon icon={faPlay} size={14} />}
            title="Enter play mode (P)"
          >
            Play
          </Button>
        </>
      )}
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
