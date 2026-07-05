// managed-street → DXF plan-view exporter.
//
// Walks every [managed-street] in the scene, projects each street-segment's
// top face to Z=0, and emits it as a closed LWPOLYLINE on a layer chosen from
// the segment `type`. Segment corners are transformed by the segment's own
// world matrix so multiple managed-streets, rotations, and translations are
// preserved in one shared drawing origin.
//
// First-cut scope is explicit: segment outlines + curb lines where sidewalks
// meet non-sidewalks. Striping, stencils, blocks for trees/furniture, and
// intersection curb returns are deliberately out of scope — see the option
// stubs below for where they will hook in.

import { createDxf, INSUNITS, ACI } from './dxfWriter';

// Layer naming leans on the US National CAD Standard convention (C-ROAD-*,
// L-PLNT-*, A-FURN) so a landscape/civil consultant's existing plot styles
// and layer states light up without renaming. Kept short + prefix-aware so
// a future modal can add per-office overrides.
const SEGMENT_TYPE_TO_LAYER = {
  'drive-lane': { name: 'C-ROAD', color: ACI.DARK_GREY },
  'bus-lane': { name: 'C-ROAD-BUS', color: ACI.RED },
  'bike-lane': { name: 'C-BIKE', color: ACI.GREEN },
  'parking-lane': { name: 'C-ROAD-PARK', color: ACI.DARK_GREY },
  sidewalk: { name: 'C-WALK', color: ACI.LIGHT_GREY },
  divider: { name: 'C-ROAD-MEDN', color: ACI.YELLOW },
  grass: { name: 'L-PLNT-GRASS', color: ACI.GREEN },
  rail: { name: 'C-RAIL', color: ACI.BLUE },
  boundary: { name: 'C-ROAD-BNDY', color: ACI.WHITE }
};

const CURB_LAYER = { name: 'C-TOPO-CURB', color: ACI.WHITE };
const FALLBACK_LAYER = { name: 'C-ROAD', color: ACI.DARK_GREY };
const METERS_TO_FEET = 3.28083989501312;

// Stubbed options. Every field has a hard default so a future combined-export
// modal can bind form state to this same object without a wire-up rewrite.
// Only unitsFeet and layerPrefix are honored today; the rest are read from
// but no-ops so callers can already start persisting user preferences.
export const DEFAULT_DXF_EXPORT_OPTIONS = {
  // Output units. AutoCAD imports at the drawing's INSUNITS scale, so setting
  // this correctly is the difference between a 30-meter street landing as a
  // 30-foot alley or a 30-meter street.
  unitsFeet: false,

  // Prefix prepended to every layer name (e.g. "3DS-" → "3DS-C-ROAD"). Empty
  // string uses the raw NCS-ish names. Useful for consultants who need to
  // keep 3DStreet output namespaced away from base-plan layers.
  layerPrefix: '',

  // Reserved for the future modal — no-ops in the first cut so the field
  // shapes are stable when the modal starts writing them.
  includeStriping: false, // striping polylines from street-generated-striping
  includeStencils: false, // arrow/bike/etc. blocks from street-generated-stencil
  includeVegetation: false, // tree/plant blocks from clones
  includeFurniture: false, // benches/lights/signs from clones
  includeVehicles: false, // parked cars from clones
  flattenTo2D: true // future: false will preserve segment elevation as Z
};

// Compact corner list for a segment's top face. Geometry is built as
// `below-box` with width along local X and depth along local Z, translated so
// the top face sits at local Y=0 (see street-segment.js:generateMesh). Corners
// are ordered CCW when viewed from above so the resulting polyline is a
// well-formed closed area in AutoCAD.
function segmentLocalCorners(width, length) {
  const halfW = width / 2;
  const halfL = length / 2;
  return [
    [-halfW, 0, -halfL],
    [halfW, 0, -halfL],
    [halfW, 0, halfL],
    [-halfW, 0, halfL]
  ];
}

// Project world (x, y, z) to CAD (x, y) for a top-down plan.
// A-Frame Z+ points south (out of the screen), AutoCAD Y+ points north — flip
// Z so a Streetmix "outbound" street runs up the page like an as-built plan.
function projectToPlan(worldVec3, unitsFeet) {
  const scale = unitsFeet ? METERS_TO_FEET : 1;
  return [worldVec3.x * scale, -worldVec3.z * scale];
}

function resolveLayer(type, prefix) {
  const spec = SEGMENT_TYPE_TO_LAYER[type] || FALLBACK_LAYER;
  return {
    name: prefix ? `${prefix}${spec.name}` : spec.name,
    color: spec.color
  };
}

// True where a curb should be drawn — a sidewalk touching anything that isn't
// another sidewalk or a boundary building. Simple and fast; the general
// grade-transition case is out of scope for this pass.
function needsCurbBetween(typeA, typeB) {
  const isWalkA = typeA === 'sidewalk';
  const isWalkB = typeB === 'sidewalk';
  if (isWalkA === isWalkB) return false;
  const other = isWalkA ? typeB : typeA;
  return other !== 'boundary';
}

export function exportManagedStreetsToDxf(options = {}) {
  const opts = { ...DEFAULT_DXF_EXPORT_OPTIONS, ...options };
  const dxf = createDxf();
  dxf.setUnits(opts.unitsFeet ? INSUNITS.FEET : INSUNITS.METERS);

  const streets = Array.from(document.querySelectorAll('[managed-street]'));

  // Nothing to export → caller decides how to surface the empty case.
  let segmentCount = 0;

  for (const streetEl of streets) {
    const segmentEls = Array.from(
      streetEl.querySelectorAll('[street-segment]')
    );

    // Sort by lateral position within the street so curb detection walks
    // neighbors in the on-screen order. querySelectorAll returns DOM order,
    // which matches lateral order for managed-street's builder today but
    // costs nothing to be explicit.
    segmentEls.sort((a, b) => a.object3D.position.x - b.object3D.position.x);

    let previousSegmentType = null;
    let previousRightEdgeWorld = null;

    for (const segEl of segmentEls) {
      const segData = segEl.getAttribute('street-segment');
      if (!segData) continue;
      const width = Number(segData.width) || 0;
      const length = Number(segData.length) || 0;
      if (width <= 0 || length <= 0) continue;

      // A-Frame updates object3D.matrixWorld lazily. Force an update so the
      // first export after a scene load doesn't ship a matrix from before
      // the segment was positioned.
      segEl.object3D.updateWorldMatrix(true, false);

      const corners = segmentLocalCorners(width, length);
      const worldCorners = corners.map((c) => {
        const v = new THREE.Vector3(c[0], c[1], c[2]);
        v.applyMatrix4(segEl.object3D.matrixWorld);
        return v;
      });

      const planPoints = worldCorners.map((v) =>
        projectToPlan(v, opts.unitsFeet)
      );

      const layer = resolveLayer(segData.type, opts.layerPrefix);
      dxf.addLayer(layer.name, layer.color);
      dxf.addLwPolyline(layer.name, planPoints, { closed: true });
      segmentCount++;

      // Curb between this segment and its left neighbor. worldCorners[0] and
      // [3] are the two corners on this segment's -x edge (the shared edge
      // with the previous, lower-x segment).
      if (
        previousSegmentType &&
        needsCurbBetween(previousSegmentType, segData.type) &&
        previousRightEdgeWorld
      ) {
        const curbLayerName = opts.layerPrefix
          ? `${opts.layerPrefix}${CURB_LAYER.name}`
          : CURB_LAYER.name;
        dxf.addLayer(curbLayerName, CURB_LAYER.color);
        // Draw one line spanning the shared edge in world Z. Use this
        // segment's own -x edge — the neighbor's +x edge is co-located.
        dxf.addLine(
          curbLayerName,
          projectToPlan(worldCorners[0], opts.unitsFeet),
          projectToPlan(worldCorners[3], opts.unitsFeet)
        );
      }

      previousSegmentType = segData.type;
      // Save this segment's +x edge world coords for the next iteration
      // (currently unused since we draw the curb on the -x edge of the next
      // segment, but keeps the intent explicit if the shared-edge case grows).
      previousRightEdgeWorld = [worldCorners[1], worldCorners[2]];
    }
  }

  return {
    dxfString: dxf.toString(),
    streetCount: streets.length,
    segmentCount
  };
}
