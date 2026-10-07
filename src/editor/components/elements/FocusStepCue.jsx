/* global AFRAME */
import { useEffect, useRef, useState } from 'react';
import styles from './FocusStepCue.module.scss';

// Subtle hint after a double-click's heading-preserving first focus step
// (#2054): the entity is centered and closer, but not yet at its framed
// focus view. Driven by `focus-step-cue` events from ExperimentalControls;
// flashes briefly and clears on the next camera input or focus.
const CUE_FLASH_MS = 2500;

export function FocusStepCue() {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const sceneEl = typeof AFRAME !== 'undefined' && AFRAME.scenes?.[0];
    if (!sceneEl) return;

    const clearPending = () => {
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    const hide = () => {
      clearPending();
      setVisible(false);
    };
    const onCue = (e) => {
      if (!e.detail?.show) {
        hide();
        return;
      }
      setVisible(true);
      clearPending();
      timeoutRef.current = setTimeout(hide, CUE_FLASH_MS);
    };

    sceneEl.addEventListener('focus-step-cue', onCue);
    // Any camera input means the user has moved on.
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('keydown', hide, true);
    return () => {
      sceneEl.removeEventListener('focus-step-cue', onCue);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('wheel', hide, { capture: true });
      window.removeEventListener('keydown', hide, true);
      clearPending();
    };
  }, []);

  return (
    <div
      className={`${styles.cue} ${visible ? styles.visible : ''}`}
      aria-hidden={!visible}
    >
      Double-click again to frame
    </div>
  );
}
