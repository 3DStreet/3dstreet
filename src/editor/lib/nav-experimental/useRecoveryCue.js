/* global AFRAME */
import { useEffect, useRef, useState } from 'react';

import { isExperimentalNav } from './flag.js';

// Recovery cue (see docs/04-glossary.md "Recovery cue"): subscribes to
// `nav-experimental:recovery-cue` events from the active
// `ExperimentalControls` instance via the sceneEl event bus (mirroring
// `useNavMode`). Exposes `cueKind` ('enclosed' | 'drop' | null) so a small
// transient hint can prompt the user to press Space.
//
// The controls emit on a real show/hide transition only (the show/hide
// elevation hysteresis — TH-52/TH-53, 8/6 m — lives in the controls,
// independent of the 1.8/2.5 elevation band; they are different concerns).
//
// Flash-not-sticky (KD-35): "Press Space to drop down" used to fire and STAY
// for the whole time you were high — too naggy. It is a FLASH instead:
// on the non-null (show) edge start a ~3 s timeout that clears the cue kind
// EVEN WHILE the condition still holds; on the null (hide) edge cancel any
// pending timeout (and clear). Re-arm is automatic via the controls'
// TH-52/TH-53 hysteresis — the cue re-shows only after dropping below 6 m
// then rising above 8 m again (flash once per stranding). The auto-hide is
// expressed here as a timer, NOT in the sticky `cueState` (which can't
// auto-hide-while-true).
//
// Flag-off: returns null and never subscribes.

const CUE_FLASH_MS = 3000; // TH-75 — recovery-cue flash window (~3 s)

function getSceneEl() {
  if (typeof AFRAME === 'undefined' || !AFRAME.scenes) return null;
  return AFRAME.scenes[0] || null;
}

export function useRecoveryCue() {
  const [cueKind, setCueKind] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!isExperimentalNav()) return;
    const sceneEl = getSceneEl();
    if (!sceneEl) return;

    const clearPending = () => {
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const handler = (e) => {
      const kind = (e && e.detail && e.detail.kind) || null;
      if (kind) {
        // Show edge: display the cue, then auto-hide after the flash window
        // even if the condition (high / enclosed) still holds.
        setCueKind(kind);
        clearPending();
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          setCueKind(null);
        }, CUE_FLASH_MS);
      } else {
        // Hide edge: condition cleared — cancel the pending flash timeout and
        // hide immediately. This re-arms the next flash via the controls'
        // show/hide hysteresis.
        clearPending();
        setCueKind(null);
      }
    };

    sceneEl.addEventListener('nav-experimental:recovery-cue', handler);
    return () => {
      sceneEl.removeEventListener('nav-experimental:recovery-cue', handler);
      clearPending();
    };
  }, []);

  return { cueKind };
}
