import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import useStore from '@/store';
import styles from './PlayModeControls.module.scss';

/**
 * Top-right tuning panel shown while flying the helicopter — the fly
 * counterpart of PlayModeControls (which is drive-specific and keys off
 * `vehicle-built`; this one keys off `heli-built`). Sliders live-tune
 * the running rig AND persist onto the scene's [fly-controls] entity;
 * the readout row shows collective %, altitude, and ground speed so
 * takeoff is verifiable at a glance even before the model visibly
 * lifts.
 */
const fieldLabels = defineMessages({
  liftPower: {
    id: 'flyModeControls.liftPower',
    defaultMessage: 'Rotor power'
  },
  agility: { id: 'flyModeControls.agility', defaultMessage: 'Cyclic agility' },
  yawRate: { id: 'flyModeControls.yawRate', defaultMessage: 'Yaw rate' },
  stability: { id: 'flyModeControls.stability', defaultMessage: 'Stability' }
});

const FIELDS = [
  { key: 'liftPower', min: 1, max: 4, step: 0.1 },
  { key: 'agility', min: 0.2, max: 2.5, step: 0.1 },
  { key: 'yawRate', min: 0.2, max: 2.5, step: 0.1 },
  { key: 'stability', min: 0, max: 2, step: 0.1 }
];

export const FlyModeControls = () => {
  const intl = useIntl();
  const isPlaying = useStore((s) => s.isPlaying);
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const [data, setData] = useState(null);
  const [telemetry, setTelemetry] = useState({
    collective: 0,
    altitude: 0,
    speed: 0
  });
  const rafRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) {
      setData(null);
      return undefined;
    }
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const sync = () => {
      const fc =
        document.querySelector('[fly-controls]')?.components?.['fly-controls']
          ?.data;
      if (fc) setData({ ...fc });
    };
    sceneEl.addEventListener('heli-built', sync);
    // Race: fly-mode may have already finished building the rig before
    // this effect ran. Check once now.
    if (
      document.getElementById('play-mode-player-heli')?.components?.[
        'play-mode-helicopter'
      ]?.chassisBody
    ) {
      sync();
    }
    return () => sceneEl.removeEventListener('heli-built', sync);
  }, [isPlaying]);

  // Telemetry loop (10 Hz): collective %, altitude, horizontal speed.
  useEffect(() => {
    if (!isPlaying || !data) return undefined;
    let lastUpdate = 0;
    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      const pmh = document.getElementById('play-mode-player-heli')
        ?.components?.['play-mode-helicopter'];
      if (!pmh || !pmh.chassisBody) return;
      const t = pmh.chassisBody.translation();
      const v = pmh.chassisBody.linvel();
      setTelemetry({
        collective: pmh.state.collective,
        altitude: t.y,
        speed: Math.sqrt(v.x * v.x + v.z * v.z)
      });
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, data]);

  if (!isPlaying || !data) return null;

  const setField = (key, value) => {
    const next = { ...data, [key]: value };
    setData(next);
    // Persist on the scene's Flyable Helicopter entity (canonical
    // source for next Play; serialized with the scene).
    document
      .querySelector('[fly-controls]')
      ?.setAttribute('fly-controls', key, value);
    // Apply live to the running rig — play-mode-helicopter reads its
    // data every physics sub-step.
    document
      .getElementById('play-mode-player-heli')
      ?.setAttribute('play-mode-helicopter', key, value);
  };

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>
        <FormattedMessage
          id="flyModeControls.title"
          defaultMessage="Flight controls"
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
              : data[f.key].toFixed(2).replace(/\.?0+$/, '')}
          </span>
        </label>
      ))}
      <div className={styles.timers}>
        <div className={styles.timerRow}>
          <span className={styles.name}>
            <FormattedMessage
              id="flyModeControls.collective"
              defaultMessage="Collective"
            />
          </span>
          <span className={styles.value}>
            {Math.round(telemetry.collective * 100)}%
          </span>
        </div>
        <div className={styles.timerRow}>
          <span className={styles.name}>
            <FormattedMessage
              id="flyModeControls.altitude"
              defaultMessage="Altitude"
            />
          </span>
          <span className={styles.value}>{telemetry.altitude.toFixed(1)}m</span>
        </div>
        <div className={styles.timerRow}>
          <span className={styles.name}>
            <FormattedMessage
              id="flyModeControls.speed"
              defaultMessage="Speed"
            />
          </span>
          <span className={styles.value}>
            {(telemetry.speed * 3.6).toFixed(0)} km/h
          </span>
        </div>
      </div>
      {isPlayPaused ? null : (
        <>
          <p className={styles.hint}>
            <FormattedMessage
              id="flyModeControls.keyboardHint"
              defaultMessage="W/S climb/descend (release to hover) · A/D yaw · arrows tilt · Space hover hold · drag = orbit/look · R reset · C camera"
            />
          </p>
          <p className={styles.hint}>
            <FormattedMessage
              id="flyModeControls.gamepadHint"
              defaultMessage="Gamepad: RT/LT climb/descend · left stick tilt · LB/RB yaw · B hover · right stick camera/look · Y reset · X camera"
            />
          </p>
        </>
      )}
    </div>
  );
};
