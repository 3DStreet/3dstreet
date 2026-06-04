/* global AFRAME */
import { useEffect, useState } from 'react';

import { isExperimentalNav } from './flag.js';

// TASK-024 (3e): subscribes to `nav-experimental:recovery-cue` events from
// the active `ExperimentalControls` instance via the sceneEl event bus
// (mirroring `useNavMode`). Exposes `cueKind` ('enclosed' | 'drop' | null)
// so a small transient hint can prompt the user to press Space.
//
// The controls emit on a real show/hide transition only (the show/hide
// hysteresis lives in the controls — D7), so this hook does no throttling
// of its own: it simply mirrors the latest emitted kind.
//
// Flag-off: returns null and never subscribes.

function getSceneEl() {
  if (typeof AFRAME === 'undefined' || !AFRAME.scenes) return null;
  return AFRAME.scenes[0] || null;
}

export function useRecoveryCue() {
  const [cueKind, setCueKind] = useState(null);

  useEffect(() => {
    if (!isExperimentalNav()) return;
    const sceneEl = getSceneEl();
    if (!sceneEl) return;

    const handler = (e) => {
      const kind = e && e.detail ? e.detail.kind : null;
      setCueKind(kind || null);
    };

    sceneEl.addEventListener('nav-experimental:recovery-cue', handler);
    return () => {
      sceneEl.removeEventListener('nav-experimental:recovery-cue', handler);
    };
  }, []);

  return { cueKind };
}
