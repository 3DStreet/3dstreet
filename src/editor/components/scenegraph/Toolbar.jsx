import { useEffect, useRef, useState } from 'react';
import { faStop, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { Button } from '../elements/Button';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import primaryStyles from '../elements/PrimaryToolbar/PrimaryToolbar.module.scss';
import styles from './Toolbar.module.scss';

const DRIFT_WARN_MS = 100;

function formatSeconds(ms) {
  return (Math.max(0, ms) / 1000).toFixed(2) + 's';
}

function SimTimer() {
  const isPlaying = useStore((s) => s.isPlaying);
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const [times, setTimes] = useState({ wall: 0, sim: 0 });
  const rafRef = useRef(null);
  // Wall-time anchor: performance.now() corresponding to "wall = 0".
  // Shifted forward by the duration of each pause so wall stops while
  // paused and resumes from where it left off.
  const playStartRef = useRef(0);
  const pausedAtRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      setTimes({ wall: 0, sim: 0 });
      return undefined;
    }
    playStartRef.current = performance.now();
    let lastUpdate = 0;
    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      if (pausedAtRef.current) return; // hold last value while paused
      const timer =
        document.querySelector('a-scene')?.components?.['scene-timer'];
      setTimes({
        wall: now - playStartRef.current,
        sim: timer ? timer.simulationTime || 0 : 0
      });
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  // Stamp pause start and shift the wall anchor on resume so the
  // wall-time delta doesn't include time spent paused.
  useEffect(() => {
    if (!isPlaying) {
      pausedAtRef.current = 0;
      return;
    }
    if (isPlayPaused) {
      pausedAtRef.current = performance.now();
    } else if (pausedAtRef.current) {
      playStartRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
    }
  }, [isPlayPaused, isPlaying]);

  const drift = times.wall - times.sim;
  const desynced = drift > DRIFT_WARN_MS && !isPlayPaused;

  const onClick = () => {
    document.querySelector('a-scene')?.systems?.['play-mode']?.togglePause();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.simTimer} ${desynced ? styles.simTimerWarn : ''} ${isPlayPaused ? styles.simTimerPaused : ''}`}
      title={
        isPlayPaused
          ? 'Paused — click to resume'
          : desynced
            ? `Simulation lagging wall-clock by ${drift.toFixed(0)}ms — click to pause`
            : 'Simulation time — click to pause'
      }
    >
      <AwesomeIcon icon={isPlayPaused ? faPlay : faPause} size={10} />
      <span className={styles.simTimerLabel}>SIM</span>
      <span className={styles.simTimerValue}>{formatSeconds(times.sim)}</span>
    </button>
  );
}

function Toolbar() {
  const { isInspectorEnabled, setIsInspectorEnabled } = useStore();

  if (isInspectorEnabled) return null;

  const handleStop = () => {
    // setIsInspectorEnabled(true) already calls play-mode.stop() so
    // play-mode subscribers (drive-mode, future traffic) tear down
    // via the scene event. We deliberately don't re-enable
    // cursor-teleport / look-controls / movement-controls — see
    // play-mode-notes.md (two-click selection bug investigation).
    setIsInspectorEnabled(true);
  };

  return (
    <div id="toolbar" data-inspector="false" className={styles.toolbarRoot}>
      <div className={primaryStyles.wrapper}>
        <SimTimer />
        <div className={primaryStyles.divider} />
        <Button
          onClick={handleStop}
          variant="toolbtn"
          leadingIcon={<AwesomeIcon icon={faStop} size={14} />}
        >
          Stop
        </Button>
      </div>
    </div>
  );
}

export default Toolbar;
