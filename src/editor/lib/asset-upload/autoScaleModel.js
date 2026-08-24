/* global AFRAME, THREE */
/**
 * Unit-mismatch auto-scale for user-supplied models (#1923).
 *
 * glTF says its unit is the meter, but a large share of real-world exports
 * ignore that: CAD/BIM (Revit, Rhino, Inventor) authors in millimeters,
 * anything that round-tripped through FBX or SketchUp tends to land in
 * centimeters. Dropped into a street scene those files are 100–1000x too big,
 * which does not look "too big" — the camera ends up *inside* the geometry
 * staring at back-faces, so the model reads as invisible and the user
 * concludes the upload failed.
 *
 * There is no unit field in glTF and no widely-implemented extension for one,
 * so the authoring unit can't be read from the file. What we can do is measure
 * the loaded bounding box and, when it lands somewhere no real street asset
 * could be, reinterpret it as one of the handful of units these files are
 * actually authored in — a unit mismatch is a power of ten, never an arbitrary
 * factor.
 *
 * The guess is deliberately cheap to reject: it's applied as an ordinary
 * `scale` on the entity, as a single undoable history entry, and announced
 * with a toast. A wrong guess costs the user one Ctrl+Z.
 */

import posthog from 'posthog-js';

// The band of measured extents (largest bounding-box dimension, in meters) we
// accept as authored-in-meters and leave alone.
//
// Both bounds come from the same reasoning: for a measurement M, the competing
// readings are "M meters" and "M in some other unit". Weighing those by how
// plausible the resulting object size is for a street asset (log-normal around
// TYPICAL_ASSET_METERS, roughly an order of magnitude of spread) against how
// often each unit actually shows up in exports (meters dominate; centimeters
// and millimeters are common but a few times rarer; kilometers rarer still),
// the meters reading stops winning at roughly 300m on the high side and 5cm on
// the low side. Above the upper bound we are past any single asset a user drops
// in — the tallest buildings people upload sit comfortably under it. The lower
// bound is set below where that reasoning puts it, at 1cm: a too-small model is
// a speck you can still select and fix, not the enveloping shell that made this
// a bug report, so there is no reason to risk inflating a genuinely small prop.
export const MIN_PLAUSIBLE_METERS = 0.01;
export const MAX_PLAUSIBLE_METERS = 300;

// Size we expect a typical uploaded street asset to be: vehicles, trees, street
// furniture and small buildings cluster around single-digit meters. Used to
// choose between the surviving unit readings, not as a size to force models to.
const TYPICAL_ASSET_METERS = 8;

// Conversions to meters for the units these files are actually authored in.
// Deliberately not every power of ten: nobody exports in decimeters, so a
// measurement of 450 is a 4.5m object in centimeters, never a 45m object — and
// offering the 45m reading would be the wrong answer more often than not.
// 1 is in the list so "leave it alone" can win outright.
const UNIT_FACTORS = [
  1000, // kilometers
  1, // meters
  0.01, // centimeters
  0.001, // millimeters
  0.000001 // micrometers (Unity/Unreal round-trips that scaled twice)
];

// Feet and inches are not on the ladder on purpose. They are real exporter
// units, but they are off by 3x and 39x, not 100x — such a model is oversized
// and obviously so, not invisible, which is the failure this exists to fix.

/**
 * Power-of-ten scale correction for a model whose largest dimension measures
 * `maxDimensionMeters` at scale 1.
 *
 * @param {number} maxDimensionMeters
 * @returns {number} Multiplier to apply to the entity's scale. 1 means the
 *   measurement is plausible and nothing should change.
 */
export function computeAutoScaleFactor(maxDimensionMeters) {
  if (!Number.isFinite(maxDimensionMeters) || maxDimensionMeters <= 0) {
    return 1;
  }
  if (
    maxDimensionMeters >= MIN_PLAUSIBLE_METERS &&
    maxDimensionMeters <= MAX_PLAUSIBLE_METERS
  ) {
    return 1;
  }
  // Outside the band, take the unit reading that lands the model closest to a
  // typical street asset in log space.
  const target = Math.log10(TYPICAL_ASSET_METERS);
  let best = 1;
  let bestDistance = Infinity;
  for (const factor of UNIT_FACTORS) {
    const distance = Math.abs(Math.log10(maxDimensionMeters * factor) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = factor;
    }
  }
  return best;
}

/**
 * Human-readable rendering of a measured extent, for the toast.
 * @param {number} meters
 */
export function formatMeasuredSize(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return '?';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  if (meters >= 10) return `${Math.round(meters)} m`;
  if (meters >= 0.1) return `${meters.toFixed(2)} m`;
  if (meters >= 0.001) return `${Math.round(meters * 1000)} mm`;
  return `${meters.toExponential(1)} m`;
}

/**
 * Toast copy for an applied correction. Exported for tests.
 * @param {number} factor
 * @param {number} measuredMeters
 */
export function autoScaleMessage(factor, measuredMeters) {
  const times =
    factor < 1
      ? `1/${Math.round(1 / factor).toLocaleString()}`
      : `${Math.round(factor).toLocaleString()}×`;
  return `Model measured ${formatMeasuredSize(measuredMeters)} across — auto-scaled to ${times} size. Undo to keep the original scale.`;
}

// Entities already considered. The upload path loads a model twice (local blob
// first, cloud URL after the swap); without this the second load would measure
// the already-corrected model and, worse, a future change to the listener could
// stack a second correction on top of the first.
const evaluated = new WeakSet();

/**
 * Largest world-space dimension of an entity's loaded model, in meters.
 * Returns 0 when there's nothing measurable yet.
 *
 * Called at placement time, when the entity's own scale is still 1 — the
 * world-space box is therefore the model's own extent.
 *
 * @param {Element} entity
 */
function measureModelExtent(entity) {
  const object3D = entity.getObject3D('mesh') ?? entity.object3D;
  if (!object3D) return 0;
  const box = new THREE.Box3().setFromObject(object3D);
  if (box.isEmpty()) return 0;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return Number.isFinite(maxDim) ? maxDim : 0;
}

/**
 * Measure a just-placed model entity and, if its extent is implausible, apply
 * a power-of-ten scale correction as one undoable command.
 *
 * Safe to call before the model has loaded — it waits for `model-loaded`, and
 * gives up quietly if that never arrives (a failed load surfaces its own error
 * through the gltf-model component).
 *
 * @param {Element} entity
 * @param {object} [options]
 * @param {string} [options.source] - Analytics label for where the model came
 *   from ('upload' | 'gallery').
 * @returns {Promise<number>} The factor applied (1 when nothing changed).
 */
export function autoScaleModelEntity(entity, options = {}) {
  if (!entity || evaluated.has(entity)) return Promise.resolve(1);
  evaluated.add(entity);

  return new Promise((resolve) => {
    const run = () => {
      let factor = 1;
      try {
        factor = applyAutoScale(entity, options);
      } catch (err) {
        console.warn('[asset-upload] auto-scale failed', err);
      }
      resolve(factor);
    };

    // A model already attached means load beat us here (cached GLB, retry path).
    if (entity.getObject3D('mesh')) {
      run();
      return;
    }
    const onLoaded = () => {
      entity.removeEventListener('model-error', onError);
      run();
    };
    const onError = () => {
      // Nothing was measured, so let a retry (same entity, fresh upload
      // attempt) evaluate this entity again.
      evaluated.delete(entity);
      entity.removeEventListener('model-loaded', onLoaded);
      resolve(1);
    };
    entity.addEventListener('model-loaded', onLoaded, { once: true });
    entity.addEventListener('model-error', onError, { once: true });
  });
}

function applyAutoScale(entity, { source = 'upload' } = {}) {
  const measured = measureModelExtent(entity);
  const factor = computeAutoScaleFactor(measured);
  if (factor === 1) return 1;

  // Multiply rather than assign: the entity is freshly created so this is
  // normally 1 1 1, but a caller that pre-set a scale keeps its intent.
  const current = entity.getAttribute('scale') ?? { x: 1, y: 1, z: 1 };
  const value = {
    x: current.x * factor,
    y: current.y * factor,
    z: current.z * factor
  };

  AFRAME.INSPECTOR.execute(
    'entityupdate',
    { entity, component: 'scale', value, noSelectEntity: true },
    'Auto-scale model'
  );

  if (window.STREET?.notify?.infoMessage) {
    window.STREET.notify.infoMessage(autoScaleMessage(factor, measured));
  }
  posthog.capture('asset_auto_scaled', {
    source,
    measured_max_dimension_m: measured,
    scale_factor: factor
  });
  return factor;
}
