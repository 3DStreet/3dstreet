import { useEffect, useRef, useState } from 'react';
import useStore from '@/store';
import styles from './PlayModeControls.module.scss';

/**
 * Top-right tuning panel shown only while the user is in play (drive)
 * mode. Reads from the cameraRig's `drive-controls` component (the
 * single source of truth) and live-updates the running player car
 * entity's `play-mode-vehicle` attributes on every change so sliders
 * affect feel immediately.
 *
 * Shown when:
 *   - inspector is closed (isInspectorEnabled === false), AND
 *   - the cameraRig's viewer-mode preset is currently 'drive'.
 *
 * The component polls the player car's existence on mount because the
 * Rapier WASM module is loaded lazily, so the chassis isn't ready
 * synchronously when Play is clicked.
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
  const isInspectorEnabled = useStore((s) => s.isInspectorEnabled);
  const [active, setActive] = useState(false);
  // Local mirror of drive-controls data. Updates in lockstep with both
  // the cameraRig component and the live player-car so sliders are the
  // sole UI surface — no need to read across components every render.
  const [data, setData] = useState(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (isInspectorEnabled) {
      setActive(false);
      setData(null);
      return undefined;
    }
    // Watch for the player car to appear (lazy Rapier WASM load) and
    // pick up the cameraRig's drive-controls data once it's there.
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const car = document.getElementById('play-mode-player-car');
      const rig = document.getElementById('cameraRig');
      const dc = rig?.components?.['drive-controls']?.data;
      const carReady = !!car?.components?.['play-mode-vehicle']?.vehicle;
      if (carReady && dc) {
        setActive(true);
        setData({ ...dc });
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isInspectorEnabled]);

  if (!active || !data) return null;

  const setField = (key, value) => {
    const next = { ...data, [key]: value };
    setData(next);
    // Persist on cameraRig (canonical source for next Play).
    document
      .getElementById('cameraRig')
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
      <p className={styles.hint}>WASD drive · Space brake · R reset</p>
    </div>
  );
};
