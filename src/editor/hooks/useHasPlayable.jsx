import { useEffect, useState } from 'react';
import Events from '../lib/Events';

/**
 * True when the scene has anything for Play to actually do — i.e. at
 * least one playable capability registered with the mode-manager
 * system reports itself present in the scene (a driveable vehicle, an
 * animated street, a traffic replay layer, ...).
 *
 * With no capabilities registered (the foundation state) this is
 * always false and play controls stay hidden.
 *
 * Watches the scene via MutationObserver, plus the editor Events bus'
 * 'entityupdate' — A-Frame's setAttribute for component property
 * updates doesn't always rewrite the DOM attribute string immediately,
 * so property toggles from the inspector panel can be missed by the
 * observer alone.
 */
export function useHasPlayable() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const runCheck = () => {
      const modeManager = sceneEl.systems?.['mode-manager'];
      setHas(!!(modeManager && modeManager.hasPlayable()));
    };
    // hasPlayable() runs several full-scene querySelectorAll sweeps. A managed
    // street generation inserts hundreds of nodes in one burst, and both the
    // MutationObserver and the entityupdate bus can fire per node — coalesce a
    // burst into a single rAF-deferred check so we don't re-scan the whole
    // scene O(mutations) times on the load hot path.
    let scheduled = 0;
    const recheck = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        runCheck();
      });
    };
    runCheck();
    const obs = new MutationObserver(recheck);
    obs.observe(sceneEl, { childList: true, subtree: true });
    Events.on('entityupdate', recheck);
    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      obs.disconnect();
      Events.off('entityupdate', recheck);
    };
  }, []);
  return has;
}
