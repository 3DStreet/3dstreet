/* global AFRAME */
import { useEffect, useState, useRef } from 'react';

import { isExperimentalNav } from './flag.js';

// Subscribes to `nav-experimental:modechange` events from the active
// `ExperimentalControls` instance via the sceneEl event bus. Exposes
// `isPedestalMode` so the toolbar can restyle when the next LB drag would be
// a truck/pedestal gesture.
//
// Flag-off: returns `false` immediately and never subscribes.
//
// Tail-debounce: the React state lags the underlying event by
// ~100ms so a rapid mode toggle on the tilt-threshold (T, TH-03) boundary doesn't visibly
// flicker the toolbar. The mode-change *event* itself is uncoalesced —
// any subscriber that needs the immediate value can read it from the
// controls instance directly.
const TAIL_DEBOUNCE_MS = 100;

function getSceneEl() {
  if (typeof AFRAME === 'undefined' || !AFRAME.scenes) return null;
  return AFRAME.scenes[0] || null;
}

function getControls() {
  if (typeof AFRAME === 'undefined') return null;
  const inspector = AFRAME.INSPECTOR;
  return inspector ? inspector.controls : null;
}

function modeFromControls() {
  const controls = getControls();
  if (!controls || typeof controls.getCurrentLbMode !== 'function') {
    return null;
  }
  return controls.getCurrentLbMode();
}

export function useNavMode() {
  const [isPedestalMode, setIsPedestalMode] = useState(() => {
    if (!isExperimentalNav()) return false;
    return modeFromControls() === 'pan-pedestal';
  });
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!isExperimentalNav()) return;
    const sceneEl = getSceneEl();
    if (!sceneEl) return;

    // Seed with the live value on mount — controls may have been
    // constructed before this hook ran, so the first event we'd hear is
    // already in the past.
    const seed = modeFromControls();
    if (seed != null) setIsPedestalMode(seed === 'pan-pedestal');

    const handler = (e) => {
      const mode = e && e.detail ? e.detail.mode : null;
      // null / 'plan-view' / 'pan' / 'rotate' don't tell us about LB
      // sub-mode — only 'pan-truck' and 'pan-pedestal' do.
      if (mode !== 'pan-truck' && mode !== 'pan-pedestal') return;
      const next = mode === 'pan-pedestal';
      // Tail-debounce: only commit to React state once the value has
      // been stable for the debounce window. The latest event wins.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        setIsPedestalMode(next);
      }, TAIL_DEBOUNCE_MS);
    };

    sceneEl.addEventListener('nav-experimental:modechange', handler);
    return () => {
      sceneEl.removeEventListener('nav-experimental:modechange', handler);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  return { isPedestalMode };
}
