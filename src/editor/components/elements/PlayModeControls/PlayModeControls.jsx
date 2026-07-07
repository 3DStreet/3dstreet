import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import useStore from '@/store';
import styles from './PlayModeControls.module.scss';

const DRIFT_WARN_MS = 100;

const formatSeconds = (ms) => (Math.max(0, ms) / 1000).toFixed(2) + 's';

/**
 * Top-right tuning panel shown only while the user is in drive mode.
 * Reads from the scene's first `[drive-controls]` entity and
 * live-updates the running player car's `play-mode-vehicle`
 * attributes on every change.
 *
 * Shown when isPlaying === true AND drive-mode has built a player car
 * (signaled by the `vehicle-built` event since Rapier WASM is
 * loaded lazily). If play mode is entered without a driveable vehicle
 * (future traffic-only play), this panel stays hidden.
 */
const fieldLabels = defineMessages({
  accelerateForce: {
    id: 'playControls.engineForce',
    defaultMessage: 'Engine force'
  },
  brakeForce: {
    id: 'playControls.brakeForce',
    defaultMessage: 'Brake force'
  },
  steerAngle: {
    id: 'playControls.steer',
    defaultMessage: 'Steer (rad)'
  }
});

const FIELDS = [
  { key: 'accelerateForce', min: 0, max: 20, step: 0.5 },
  { key: 'brakeForce', min: 0, max: 0.5, step: 0.01 },
  { key: 'steerAngle', min: 0, max: 0.5, step: 0.01 }
];

export const PlayModeControls = () => {
  const intl = useIntl();
  const isPlaying = useStore((s) => s.isPlaying);
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const [data, setData] = useState(null);
  const [times, setTimes] = useState({ wall: 0, sim: 0 });
  const rafRef = useRef(null);
  const playStartRef = useRef(0);
  const pausedAtRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      setData(null);
      return undefined;
    }
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const sync = () => {
      const dc =
        document.querySelector('[drive-controls]')?.components?.[
          'drive-controls'
        ]?.data;
      if (dc) setData({ ...dc });
    };
    sceneEl.addEventListener('vehicle-built', sync);
    // Race: drive-mode may have already finished building the car
    // before this effect ran. Check once now.
    if (
      document.getElementById('play-mode-player-car')?.components?.[
        'play-mode-vehicle'
      ]?.vehicle
    ) {
      sync();
    }
    return () => sceneEl.removeEventListener('vehicle-built', sync);
  }, [isPlaying]);

  // Wall + sim readouts. Wall anchored locally on Play press so it
  // doesn't depend on scene-timer.elapsedTime (which can be polluted
  // if timerActive was already set elsewhere). The toolbar SimTimer
  // does the same — keeping this independent so the debug panel can
  // be enabled/disabled without affecting the toolbar.
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
      if (pausedAtRef.current) return;
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

  // Match toolbar pause behavior: freeze readouts on pause, shift the
  // wall anchor forward by paused duration on resume.
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

  // Re-anchor on toolbar Reset so wall time visually snaps to 0.
  useEffect(() => {
    if (!isPlaying) return undefined;
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const onReset = () => {
      playStartRef.current = performance.now();
      pausedAtRef.current = 0;
      setTimes({ wall: 0, sim: 0 });
    };
    sceneEl.addEventListener('play-mode-reset', onReset);
    return () => sceneEl.removeEventListener('play-mode-reset', onReset);
  }, [isPlaying]);

  if (!isPlaying || !data) return null;

  const drift = times.wall - times.sim;
  const desynced = drift > DRIFT_WARN_MS && !isPlayPaused;

  const setField = (key, value) => {
    const next = { ...data, [key]: value };
    setData(next);
    // Persist on the scene's Driveable Vehicle entity (canonical source
    // for next Play; serialized with the scene).
    document
      .querySelector('[drive-controls]')
      ?.setAttribute('drive-controls', key, value);
    // Apply live to the running car. play-mode-vehicle reads its data
    // each tick, so this lands immediately.
    document
      .getElementById('play-mode-player-car')
      ?.setAttribute('play-mode-vehicle', key, value);
  };

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>
        <FormattedMessage
          id="playControls.title"
          defaultMessage="Drive controls"
        />
      </h3>
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.row}>
          <span className={styles.name}>
            {intl.formatMessage(fieldLabels[f.key])}
          </span>
          <input
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={data[f.key]}
            onChange={(e) => setField(f.key, parseFloat(e.target.value))}
          />
          <span className={styles.value}>
            {Number.isInteger(data[f.key])
              ? data[f.key]
              : data[f.key].toFixed(3).replace(/\.?0+$/, '')}
          </span>
        </label>
      ))}
      <div className={styles.timers}>
        <div className={styles.timerRow}>
          <span className={styles.name}>
            <FormattedMessage id="playControls.wall" defaultMessage="Wall" />
          </span>
          <span className={styles.value}>{formatSeconds(times.wall)}</span>
        </div>
        <div className={styles.timerRow}>
          <span className={styles.name}>
            <FormattedMessage id="playControls.sim" defaultMessage="Sim" />
          </span>
          <span
            className={`${styles.value} ${desynced ? styles.valueWarn : ''}`}
            title={
              desynced
                ? intl.formatMessage(
                    {
                      id: 'playControls.driftWarning',
                      defaultMessage: 'Sim lagging wall by {ms}ms'
                    },
                    { ms: drift.toFixed(0) }
                  )
                : ''
            }
          >
            {formatSeconds(times.sim)}
            {desynced ? ` (-${(drift / 1000).toFixed(2)}s)` : ''}
          </span>
        </div>
      </div>
      <p className={styles.hint}>
        <FormattedMessage
          id="playControls.keyboardHint"
          defaultMessage="WASD drive · Space brake · R reset · C camera"
        />
      </p>
      <p className={styles.hint}>
        <FormattedMessage
          id="playControls.gamepadHint"
          defaultMessage="Gamepad: RT/LT throttle · B brake · stick steer · Y reset · X camera · Start pause · Back stop"
        />
      </p>
    </div>
  );
};
