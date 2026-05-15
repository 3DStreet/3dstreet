import { useEffect, useRef, useState } from 'react';
import {
  faStop,
  faPause,
  faPlay,
  faFlagCheckered,
  faTriangleExclamation,
  faRotateRight
} from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { Button } from '../elements/Button';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { CameraSparkleIcon } from '@shared/icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import primaryStyles from '../elements/PrimaryToolbar/PrimaryToolbar.module.scss';
import styles from './Toolbar.module.scss';

const DRIFT_WARN_MS = 100;

function formatSeconds(ms) {
  const totalMs = Math.max(0, ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = (totalMs % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function SimTimer() {
  const isPlaying = useStore((s) => s.isPlaying);
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const playOutcome = useStore((s) => s.playOutcome);
  const playOutcomeTimeMs = useStore((s) => s.playOutcomeTimeMs);
  const [times, setTimes] = useState({ wall: 0, sim: 0 });
  const rafRef = useRef(null);
  // Cumulative ms spent paused so wall-time doesn't include it. Wall
  // itself is anchored on play-mode.playStartedAt (set synchronously
  // in play-mode.start) — using a React useEffect anchor here drifts
  // by a frame and made sim appear to lead wall by ~50ms.
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      setTimes({ wall: 0, sim: 0 });
      pausedAtRef.current = 0;
      pausedTotalRef.current = 0;
      return undefined;
    }
    let lastUpdate = 0;
    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      if (pausedAtRef.current) return; // hold last value while paused
      const sceneEl = document.querySelector('a-scene');
      const playMode = sceneEl?.systems?.['play-mode'];
      const timer = sceneEl?.components?.['scene-timer'];
      if (!playMode || !playMode.playStartedAt) return;
      setTimes({
        wall: now - playMode.playStartedAt - pausedTotalRef.current,
        sim: timer ? timer.simulationTime || 0 : 0
      });
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  // Track total time spent paused so wall-time subtracts it on display.
  useEffect(() => {
    if (!isPlaying) return;
    if (isPlayPaused) {
      pausedAtRef.current = performance.now();
    } else if (pausedAtRef.current) {
      pausedTotalRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
    }
  }, [isPlayPaused, isPlaying]);

  // Reset clears accumulated pause-time so the freshly-zeroed
  // playStartedAt produces a wall-time of 0 on the very next tick.
  useEffect(() => {
    if (!isPlaying) return undefined;
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const onReset = () => {
      pausedAtRef.current = 0;
      pausedTotalRef.current = 0;
      setTimes({ wall: 0, sim: 0 });
    };
    sceneEl.addEventListener('play-mode-reset', onReset);
    return () => sceneEl.removeEventListener('play-mode-reset', onReset);
  }, [isPlaying]);

  const drift = times.wall - times.sim;
  const desynced = drift > DRIFT_WARN_MS && !isPlayPaused;
  const isFinish = playOutcome === 'finish';
  const isCrash = playOutcome === 'crash';

  // Outcome states freeze the display value so the user sees the
  // event time, not the still-running sim clock.
  const displayMs = isFinish || isCrash ? playOutcomeTimeMs : times.sim;

  const onClick = () => {
    document.querySelector('a-scene')?.systems?.['play-mode']?.togglePause();
  };

  const icon = isFinish
    ? faFlagCheckered
    : isCrash
      ? faTriangleExclamation
      : isPlayPaused
        ? faPlay
        : faPause;

  const title = isFinish
    ? `Finished in ${formatSeconds(playOutcomeTimeMs)} — click to resume`
    : isCrash
      ? `Crash at ${formatSeconds(playOutcomeTimeMs)}`
      : isPlayPaused
        ? 'Paused — click to resume'
        : desynced
          ? `Simulation lagging wall-clock by ${drift.toFixed(0)}ms — click to pause`
          : 'Simulation time — click to pause';

  const className = [
    styles.simTimer,
    isFinish ? styles.simTimerFinish : '',
    isCrash ? styles.simTimerCrash : '',
    !isFinish && !isCrash && desynced ? styles.simTimerWarn : '',
    !isFinish && !isCrash && isPlayPaused ? styles.simTimerPaused : ''
  ].join(' ');

  return (
    <button type="button" onClick={onClick} className={className} title={title}>
      <AwesomeIcon icon={icon} size={10} />
      <span className={styles.simTimerValue}>{formatSeconds(displayMs)}</span>
    </button>
  );
}

function Toolbar() {
  const isInspectorEnabled = useStore((s) => s.isInspectorEnabled);
  const setIsInspectorEnabled = useStore((s) => s.setIsInspectorEnabled);
  const setModal = useStore((s) => s.setModal);

  if (isInspectorEnabled) return null;

  const handleReset = () => {
    document.querySelector('a-scene')?.systems?.['play-mode']?.reset();
  };

  const handleStop = () => {
    // setIsInspectorEnabled(true) already calls play-mode.stop() so
    // play-mode subscribers (drive-mode, future traffic) tear down
    // via the scene event. We deliberately don't re-enable
    // cursor-teleport / look-controls / movement-controls — see
    // play-mode-notes.md (two-click selection bug investigation).
    setIsInspectorEnabled(true);
  };

  const handleSnapshot = () => {
    document.querySelector('a-scene')?.systems?.['play-mode']?.pause();
    // No auto-resume on modal close. Other modals (upsell, sign-in)
    // can open while paused, and we don't want closing those to
    // silently resume the simulation. The user clicks the SIM timer
    // to resume when they're ready.
    // Deliberately skip the editor-mode auto-save (`saveScene(false)`)
    // here. Play mode adds synthetic runtime entities (player-car,
    // kinematic traffic bodies) to the DOM that we don't want to bake
    // into the saved scene. The screenshot modal still handles its own
    // gallery-image save for authed users.
    makeScreenshot();
    setModal('screenshot');
  };

  return (
    <div id="toolbar" data-inspector="false" className={styles.toolbarRoot}>
      <div className={`${primaryStyles.wrapper} ${styles.toolbarRow}`}>
        <SimTimer />
        <Button
          onClick={handleReset}
          variant="toolbtn"
          leadingIcon={<AwesomeIcon icon={faRotateRight} size={14} />}
          title="Reset — restart the simulation from t=0 with objects at spawn"
        >
          Reset
        </Button>
        <Button
          onClick={handleStop}
          variant="toolbtn"
          leadingIcon={<AwesomeIcon icon={faStop} size={14} />}
        >
          Stop
        </Button>
        <Button
          variant="toolbtn"
          onClick={handleSnapshot}
          leadingIcon={<CameraSparkleIcon />}
          title="Pause and capture from the current camera"
        >
          Snapshot
        </Button>
      </div>
    </div>
  );
}

export default Toolbar;
