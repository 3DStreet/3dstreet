// What the easy gizmo counts as ground, which surface in a column supports an
// object, and whether a frame's travel crossed anything discontinuous.
//
// THIS IS PLACEMENT'S DEFINITION OF GROUND, AND IT IS DELIBERATELY WIDER THAN
// THE CAMERA'S BY ONE BRANCH. The navigation system's floor predicate is an
// allowlist of three kinds — street segments, catalog-known buildings and
// Google 3D Tiles — and its coverage boundary (a non-catalog glTF reads as
// scatter, so the camera can sink through it) is an accepted one for camera
// collision. It is not acceptable for placement: a user who imports a building
// and drags a bollard at it expects the bollard to rest on it.
//
// The nav predicate is NOT widened. It decides where the camera may stand, and
// it is read by the descent clamp, the orbit pivot, the swoop, WASD flight and
// the enclosure sensor — so widening it would move camera collision for every
// user whether or not this gizmo exists. Instead the fourth branch is added
// here, in a wrapper this subsystem owns, over the same classifier. Nav's
// predicate and its documented key decision about catalog-gated solidity remain
// true of navigation and are unchanged.
//
// Nothing in this module raycasts. It decides over a hit list it is handed and
// over sampled heights, which is what makes the rules here directly testable.

import {
  classifyHitEntity,
  isSolidFloorHit,
  owningEntity
} from '../nav-experimental/cursorAnchor.js';
import { continuityAllowance } from './easyGizmoMath.js';
import { STEP_METRES, SUBSTEP_METRES } from './easyGizmoConstants.js';

/** Heights within this of the base are treated as level with it. */
const SPLIT_EPSILON = 1e-3;

// An item can rest only on an item earlier in this list. Tiles are terrain.
const PLACEMENT_ORDER = ['street', 'building', 'import', 'furniture'];

/** Batched hits belong to the instance's entity, not the shared batch host. */
export function owningPlacementEntity(hit) {
  return hit?.object?._batchIdToEl?.[hit.batchId] || owningEntity(hit?.object);
}

function placementHitOf(hit) {
  const object = hit?.object;
  const el = object?._batchIdToEl?.[hit.batchId];
  if (!el) return hit;
  // Keep visibility on the real mesh and the original hit available to callers.
  return {
    object: {
      el,
      parent: object,
      material: object.material,
      visible: object.visible
    }
  };
}

export function classifyPlacementHit(hit) {
  return classifyHitEntity(placementHitOf(hit));
}

export function isStreetEntity(el) {
  return (
    !!el &&
    typeof el.hasAttribute === 'function' &&
    (el.hasAttribute('managed-street') ||
      el.hasAttribute('street') ||
      el.hasAttribute('street-segment'))
  );
}

/** Placement identity belongs to the selected entity, not its child geometry. */
export function placementKindOf(el) {
  if (isStreetEntity(el)) return 'street';
  const hit = { object: { el } };
  if (isUserImportedMeshHit(hit)) return 'import';
  if (classifyHitEntity(hit) === 'building') return 'building';
  return 'furniture';
}

/**
 * A surface the user imported themselves.
 *
 * The upload path stamps persistent identity attributes on every asset it
 * places, so this is a fourth POSITIVE branch rather than a polarity flip:
 * anything matching no branch is still rejected.
 *
 * It additionally requires a `gltf-model`, which the markers alone do not
 * imply. They are applied to uploaded images and splats too, and neither is a
 * surface anyone means to stand a bollard on — an uploaded logo becomes a flat
 * plane, which lying over a road would swallow the road's footprint. Stated as
 * a rule rather than a list of the upload path's current kinds: it admits
 * imported geometry and excludes imported decals, whatever gets added next.
 * The one decal admitted is a level, visible image, which is ground for every
 * kind — see `isLevelImportedImageHit` below.
 */
export function isUserImportedMeshHit(hit) {
  if (!hit || !hit.object) return false;
  const el = owningPlacementEntity(hit);
  if (!el || typeof el.hasAttribute !== 'function') return false;
  if (!el.hasAttribute('gltf-model')) return false;
  return (
    el.hasAttribute('data-asset-id') || el.hasAttribute('data-temporary-file')
  );
}

/** cos(30°): an image face tilted further than this from level is no floor. */
const LEVEL_IMAGE_MIN_NORMAL_Y = Math.cos((30 * Math.PI) / 180);

function _chainVisible(object) {
  for (let node = object; node; node = node.parent) {
    if (node.visible === false) return false;
  }
  return true;
}

// Fully opaque: three ignores opacity on a non-transparent material, and an
// uploaded image is `transparent: true` (for PNG alpha) at opacity 1.
function _materialOpaque(material) {
  const list = Array.isArray(material) ? material : [material];
  return list.some(
    (m) =>
      !m || (m.visible !== false && (!m.transparent || (m.opacity ?? 1) >= 1))
  );
}

/**
 * An uploaded image laid (nearly) flat and visible: a surface (#2128).
 *
 * The decal exclusion above was about images in general; an aerial plan or
 * a traced site image lifted over the 3D Tiles is the surface the user is
 * building on, and an object dragged across it should rest on it rather than
 * on the drape beneath. Like the tiles it is ground, not an item, so it sits
 * outside the item ranking and supports every kind — street, building,
 * imported mesh and furniture alike. Within a column it competes as a solid
 * surface: it beats the tiles beneath it, and against a street or building
 * the higher surface wins, so a logo a centimetre above a road lifts what
 * rests there by that centimetre and no more.
 *
 * Unlike a mesh, a flat image is easy to leave in the scene hidden, at
 * opacity 0 (a terrain-flattening helper) or part-transparent (a reference
 * plan laid over another to trace against), and the probe raycasts all of
 * them, so the whole ancestor chain must be visible and the material fully
 * opaque. Anything under full opacity is an overlay, never ground. Level is
 * judged from the world transform of the plane's local X and Y axes, whose
 * cross product is the face normal under any (non-uniform) scale.
 */
export function isLevelImportedImageHit(hit) {
  const object = hit?.object;
  if (!object) return false;
  const el = owningPlacementEntity(hit);
  if (!el || typeof el.hasAttribute !== 'function') return false;
  if (el.hasAttribute('gltf-model') || el.hasAttribute('splat')) return false;
  if (!el.hasAttribute('geometry')) return false;
  if (
    !el.hasAttribute('data-asset-id') &&
    !el.hasAttribute('data-temporary-file')
  ) {
    return false;
  }
  if (!_chainVisible(object) || !_materialOpaque(object.material)) return false;
  const e = object.matrixWorld?.elements;
  if (!e) return false;
  const nx = e[1] * e[6] - e[2] * e[5];
  const ny = e[2] * e[4] - e[0] * e[6];
  const nz = e[0] * e[5] - e[1] * e[4];
  const len = Math.hypot(nx, ny, nz);
  return len > 0 && Math.abs(ny) / len >= LEVEL_IMAGE_MIN_NORMAL_Y;
}

/** Eligible support for this selection; furniture preserves the widest policy. */
export function isGizmoGroundHit(hit, selectedKind = 'furniture') {
  if (isLevelImportedImageHit(hit)) return true;
  const imported = isUserImportedMeshHit(hit);
  const identityHit = placementHitOf(hit);
  if (!isSolidFloorHit(identityHit) && !imported) return false;
  const kind = classifyHitEntity(identityHit);
  if (kind === 'tiles') return true;
  const supportKind =
    kind === 'segment' ? 'street' : imported ? 'import' : 'building';
  return (
    PLACEMENT_ORDER.indexOf(supportKind) < PLACEMENT_ORDER.indexOf(selectedKind)
  );
}

/**
 * The class a qualifying hit belongs to, for the precedence rule below.
 * User imports rank with segments and buildings rather than with tiles.
 */
export function groundHitClass(hit) {
  const kind = classifyPlacementHit(hit);
  if (kind === 'tiles') return 'tiles';
  return 'solid';
}

/**
 * The support BELOW a reference height, out of hits already filtered to ground.
 *
 * NOT simply nearest-wins. A segment, building or user import beats a tiles hit
 * whether or not the tiles hit is nearer; within a class the nearest wins. This
 * is the precedence the camera's own floor pick applies, and carrying it across
 * is what stops the gizmo resting an object on the photogrammetric drape while
 * navigation stands the camera on the street underneath it — a permanent
 * disagreement of the drape's thickness, invisible in any scene that does not
 * carry both surfaces in one column.
 */
export function pickSupportBelow(hits, refY) {
  let best = null;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const y = hit.point.y;
    if (y > refY + SPLIT_EPSILON) continue;
    const cls = groundHitClass(hit);
    if (
      best === null ||
      (cls === 'solid' && best.cls === 'tiles') ||
      (cls === best.cls && y > best.y)
    ) {
      best = { y, cls, hit, entity: owningPlacementEntity(hit) };
    }
  }
  return best;
}

/**
 * The nearest qualifying surface ABOVE a reference height.
 *
 * NEAREST WINS, WITH NO CLASS PREFERENCE, and the asymmetry with the downward
 * rule is the whole point. The tiles skin drapes OVER real geometry, so looking
 * down the nearest hit is systematically the drape rather than the road it
 * covers. Looking up from an object's base that bias is absent and inverts: a
 * photogrammetric roof three metres overhead is the real surface, and a
 * building slab forty metres up — a tower floor, an overpass deck — is not the
 * surface anyone would name.
 */
export function pickSurfaceAbove(hits, refY) {
  let best = null;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const y = hit.point.y;
    if (y <= refY + SPLIT_EPSILON) continue;
    if (best === null || y < best.y) {
      best = {
        y,
        cls: groundHitClass(hit),
        hit,
        entity: owningPlacementEntity(hit)
      };
    }
  }
  return best;
}

/**
 * Split an already-filtered hit list about a different reference height.
 *
 * Following uses an evolving support ceiling; landing uses the resulting
 * object base. Reuse the endpoint hits rather than cast a second ray.
 */
export function resplitColumn(hits, refY) {
  return {
    below: pickSupportBelow(hits, refY),
    above: pickSurfaceAbove(hits, refY)
  };
}

function supportHeightOf(column) {
  if (column === null || column === undefined) return null;
  if (typeof column === 'number') return column;
  return column.below ? column.below.y : null;
}

/**
 * Is the ground under this frame's travel continuous with the object's current
 * support, and where does that support end up?
 *
 * `probeAt(x, z, ceilingY)` selects support no higher than the pairwise
 * reference plus its allowance. `from` and `to` are `{ x, z }`;
 * `fromSupportY` seeds the comparison. Landing columns use a separate split.
 *
 * THE ENDPOINT IS PROBED FIRST, AND USUALLY ALONE. A frame whose destination
 * column carries support level with the remembered reference — within one
 * step, under a ceiling of everything the sampled chain below could have
 * climbed to — is continuous on that one ray: the interior samples could only
 * have withheld a step that the next frame, starting from that very column,
 * would take anyway, and a step is bounded by `STEP_METRES` however the frame
 * is judged. The one ray this costs is what keeps a drag over Google 3D Tiles
 * (#2059) at one triangle scan per frame at any pointer speed, where sampling
 * the interior of a fast frame cast thirteen and read as a slideshow. A
 * destination lower than that chain could possibly have stepped down to is
 * discontinuous on the same ray, since every interior probe picks under a
 * lower ceiling and can only find lower support, and an empty column holds
 * the reference as a miss does anywhere. What is left — more than a step up
 * or down, within reach — is what the interior sampling below exists for: a
 * ramp is followable and a riser is not, and only the chain tells them apart.
 *
 * THE COMPARISON IS PAIRWISE AND THE REFERENCE ADVANCES. Each consecutive pair
 * of samples is judged against the allowance for its own sub-span, and an
 * accepted sample becomes the reference for the next one — so a frame's total
 * climb is unbounded in the number of sub-steps, which is what keeps a ramp
 * followable at any drag speed. Comparing every sample against the frame's
 * starting support instead caps the followable rise at one step per FRAME,
 * making the effective followable angle a function of drag speed and camera
 * distance.
 *
 * A FRAME IS ALL OR NOTHING. If any pair fails, the object holds its height and
 * the remembered support does not move at all — partial credit for the samples
 * before the failure would be a level assignment by another name.
 *
 * A PROBE MISS HOLDS the reference rather than clearing it. The safe failure
 * here is to leave the object where it is; the camera's own probe answers the
 * opposite question and treats a miss as "no floor" for the opposite reason.
 */
export function evaluatePath({
  from,
  to,
  fromSupportY,
  probeAt,
  budget,
  substep = SUBSTEP_METRES
}) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(d / substep));
  const demanded = n - 1;
  const overBudget = demanded > budget;

  // A frame within one sub-span is the single endpoint probe below already;
  // the look-ahead is for frames that would otherwise sample their interior.
  // (With the sampler switched off every frame is one sub-span, so that
  // diagnostic build keeps its plain endpoint probe and no step limit.)
  if (demanded > 0) {
    // The endpoint alone, under the highest ceiling the sampled chain could
    // have reached: every accepted interior sample may step up by at most one
    // allowance, and at these sub-spans an allowance is a step.
    const reach = n * STEP_METRES;
    const endFirst = probeAt(to.x, to.z, fromSupportY + reach);
    const endY = supportHeightOf(endFirst);
    const settled = (continuous, supportY) => ({
      continuous,
      supportY,
      samples: [],
      demanded,
      cast: 0,
      overBudget,
      endColumn: endFirst
    });
    // An empty column holds the reference, as a miss does anywhere; with no
    // reference yet, whatever the column holds becomes it.
    if (endY === null || fromSupportY === null) {
      return settled(true, endY ?? fromSupportY);
    }
    if (Math.abs(endY - fromSupportY) <= STEP_METRES) {
      return settled(true, endY);
    }
    if (endY < fromSupportY - reach) return settled(false, fromSupportY);
    if (overBudget) {
      // Skip interiors, but keep the destination column current for landing.
      return settled(false, fromSupportY);
    }
    // More than a step up or down, within reach: a ramp or a riser, which
    // only the sampled chain can tell apart.
  }

  const samples = [];
  for (let k = 1; k <= demanded; k++) {
    const u = (k * substep) / d;
    samples.push({ x: from.x + dx * u, z: from.z + dz * u });
  }

  let reference = fromSupportY;
  let prev = from;
  let endColumn = null;
  let continuous = true;
  const stops = samples.concat([to]);
  for (let i = 0; i < stops.length; i++) {
    const at = stops[i];
    const subSpan = Math.hypot(at.x - prev.x, at.z - prev.z);
    // Following may step UP from the preceding support. Landing targets use
    // a separate split about the object's base after the move.
    const column = probeAt(
      at.x,
      at.z,
      reference + continuityAllowance(subSpan)
    );
    if (i === stops.length - 1) endColumn = column;
    const y = supportHeightOf(column);
    if (y === null) {
      prev = at;
      continue;
    }
    if (
      reference !== null &&
      Math.abs(y - reference) > continuityAllowance(subSpan)
    ) {
      continuous = false;
    }
    if (continuous) reference = y;
    prev = at;
  }

  return {
    continuous,
    supportY: continuous ? reference : fromSupportY,
    samples,
    demanded,
    cast: demanded,
    overBudget: false,
    endColumn
  };
}
