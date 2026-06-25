/**
 * replay-demo
 * ===========
 *
 * Throwaway dev/demo bootstrap so you can SEE the traffic replay with zero
 * manual wiring. It does nothing unless the page URL carries a `?replay=...`
 * query param:
 *
 *   ?replay=sample     -> loads the committed Waterleaf busiest-hour manifest
 *                         (scripts/tmd-replay/sample-waterleaf-busiest-hour.json)
 *   ?replay=<url.json> -> fetches that manifest URL
 *
 * When present, it replaces the default scene's street with a managed-street
 * (a 60ft cross-section: sidewalks, bike lanes, drive lanes) that carries the
 * `street-traffic-replay` component. Press Play and the real, anonymized
 * Waterleaf street users animate across it.
 *
 * This is intentionally NOT the product UX — that's the "Traffic Replay" Add
 * Layer card. This is just a fast way to verify the engine end to end.
 */
(function () {
  if (typeof window === 'undefined') return;
  const replay = new URLSearchParams(window.location.search).get('replay');
  if (!replay) return;

  const boot = async () => {
    const scene = document.querySelector('a-scene');
    if (!scene) return;

    // Pull the demo cross-section, and (for ?replay=sample) the bundled
    // manifest. Both are dynamic imports so they cost nothing on normal loads.
    const tasks = [
      import('../../editor/components/elements/AddLayerPanel/defaultStreets.js')
    ];
    if (replay === 'sample') {
      tasks.push(
        import('../../../scripts/tmd-replay/sample-waterleaf-busiest-hour.json')
      );
    }
    let streetsMod, sampleMod;
    try {
      [streetsMod, sampleMod] = await Promise.all(tasks);
    } catch (err) {
      console.error('[replay-demo] failed to load demo assets', err);
      return;
    }

    // Drop the default legacy street so it doesn't overlap the demo street.
    const legacy = document.querySelector('#default-street');
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);

    const street = document.createElement('a-entity');
    street.id = 'replay-demo-street';
    street.setAttribute('data-layer-name', 'Replay Street');
    street.setAttribute('managed-street', {
      sourceType: 'json-blob',
      sourceValue: JSON.stringify(streetsMod.stroad60ftROW),
      showStriping: true,
      showVehicles: false, // keep parked/static vehicles out of the replay
      synchronize: true,
      playable: true
    });

    const replayProps = { timeScale: 1, loop: true };
    if (sampleMod) {
      const manifest = sampleMod.default || sampleMod;
      replayProps.manifestData = JSON.stringify(manifest);
    } else {
      replayProps.manifestUrl = replay; // treat the param as a manifest URL
    }
    street.setAttribute('street-traffic-replay', replayProps);

    const container = document.querySelector('#street-container') || scene;
    container.appendChild(street);

    console.log(
      '[replay-demo] added managed-street with replay (%s). Press Play to watch.',
      replay === 'sample' ? 'bundled sample' : replay
    );
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      const scene = document.querySelector('a-scene');
      if (scene && scene.hasLoaded) boot();
      else if (scene) scene.addEventListener('loaded', boot);
    });
  } else {
    const scene = document.querySelector('a-scene');
    if (scene && scene.hasLoaded) boot();
    else if (scene) scene.addEventListener('loaded', boot);
  }
})();
