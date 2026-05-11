import { useEffect, useState } from 'react';
import useStore from '@/store';
import styles from './PlayModeControls.module.scss';

const stallMainThread = (durationMs) => {
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    // intentional busy-wait to simulate a slow CPU / hitch
  }
};

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
const FIELDS = [
  {
    key: 'accelerateForce',
    label: 'Engine force',
    min: 0,
    max: 20,
    step: 0.5
  },
  { key: 'brakeForce', label: 'Brake force', min: 0, max: 0.5, step: 0.01 },
  { key: 'steerAngle', label: 'Steer (rad)', min: 0, max: 0.5, step: 0.01 }
];

export const PlayModeControls = () => {
  const isPlaying = useStore((s) => s.isPlaying);
  const [data, setData] = useState(null);

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

  if (!isPlaying || !data) return null;

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
      <h3 className={styles.title}>Drive controls</h3>
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.row}>
          <span className={styles.name}>{f.label}</span>
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
      <button
        type="button"
        className={styles.stallBtn}
        onClick={() => stallMainThread(2000)}
      >
        Stall 2s (force desync)
      </button>
      <p className={styles.hint}>
        WASD drive · Space brake · R reset · C camera
      </p>
    </div>
  );
};
