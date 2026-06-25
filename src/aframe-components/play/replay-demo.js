/**
 * replay-demo
 * ===========
 *
 * Throwaway dev/demo bootstrap so you can SEE the traffic replay with zero
 * manual wiring. It does nothing unless the page URL carries a `?replay=...`
 * query param:
 *
 *   ?replay=sample     -> the busiest MINUTE of the Waterleaf capture (dense at
 *                         real time: ~50 users, a pedestrian rush)
 *   ?replay=hour       -> the busiest HOUR (full mode mix, but sparse at real
 *                         time — users trickle in at the true pace)
 *   ?replay=<url.json> -> fetches that manifest URL
 *   &scale=N           -> playback speed (default 1× = real time; e.g. &scale=4)
 *   &maps=<type>       -> geo basemap (default google3d; mapbox2d|osm3d|none)
 *
 * When present, it replaces the default scene's street with a managed-street
 * (a 60ft cross-section: sidewalks, bike lanes, drive lanes) that carries the
 * `street-traffic-replay` component, and places the scene at the sensor's
 * real-world lat/lon (from the manifest's deployment metadata) so you have map
 * context to align the street against. Press Play and the real, anonymized
 * Waterleaf street users animate across it.
 *
 * This is intentionally NOT the product UX — that's the "Traffic Replay" Add
 * Layer card. This is just a fast way to verify the engine end to end.
 */
(function () {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const replay = params.get('replay');
  if (!replay) return;

  // Real time by default. The busiest-minute sample is dense enough at 1× that
  // no time compression is needed; &scale=N is available for faster playback.
  const scaleParam = parseFloat(params.get('scale'));
  const timeScale =
    Number.isFinite(scaleParam) && scaleParam > 0 ? scaleParam : 1;

  const boot = async () => {
    const scene = document.querySelector('a-scene');
    if (!scene) return;

    // Pull the demo cross-section, and a bundled manifest for the known keys.
    // All dynamic imports, so they cost nothing on normal loads.
    const bundled = {
      sample: () =>
        import('../../../scripts/tmd-replay/sample-waterleaf-busiest-minute.json'),
      minute: () =>
        import('../../../scripts/tmd-replay/sample-waterleaf-busiest-minute.json'),
      hour: () =>
        import('../../../scripts/tmd-replay/sample-waterleaf-busiest-hour.json')
    };
    const tasks = [
      import('../../editor/components/elements/AddLayerPanel/defaultStreets.js')
    ];
    if (bundled[replay]) tasks.push(bundled[replay]());
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

    let manifest = null;
    const replayProps = { timeScale, loop: true };
    if (sampleMod) {
      manifest = sampleMod.default || sampleMod;
      replayProps.manifestData = JSON.stringify(manifest);
    } else {
      replayProps.manifestUrl = replay; // treat the param as a manifest URL
    }
    street.setAttribute('street-traffic-replay', replayProps);

    const container = document.querySelector('#street-container') || scene;
    container.appendChild(street);

    // Place the scene at the sensor's real-world location (from the manifest's
    // deployment metadata) so there's map context to align the street against.
    // Map imagery needs the same API key the app's normal Geo feature uses;
    // override the layer with &maps=mapbox2d|osm3d|none (default google3d).
    const dep = manifest?.meta?.deployment;
    if (dep && Number.isFinite(dep.lat) && Number.isFinite(dep.lon)) {
      const maps = params.get('maps') || 'google3d';
      const geoLayer = document.getElementById('reference-layers');
      if (geoLayer) {
        try {
          geoLayer.setAttribute('street-geo', {
            latitude: dep.lat,
            longitude: dep.lon,
            maps
          });
          console.log(
            '[replay-demo] placed scene at %s, %s (maps: %s; sensor bearing %s)',
            dep.lat,
            dep.lon,
            maps,
            dep.bearing || '?'
          );
        } catch (e) {
          console.warn('[replay-demo] could not set scene geo', e);
        }
      }
    }

    console.log(
      '[replay-demo] added managed-street with replay (%s) at %d× speed. Press Play to watch.',
      bundled[replay] ? `bundled:${replay}` : replay,
      timeScale
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
