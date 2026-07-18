// Shared 2D plan model for the scene plan-view exports.
//
// Walks every street-shaped thing in the scene — managed-streets, legacy
// street/streetmix-loader streets, and intersections — projects each footprint
// to Z=0, and collects it as closed polylines on layers chosen by element
// type. Points are transformed by each entity's own world matrix so multiple
// streets, intersections, rotations, and translations are preserved in one
// shared drawing origin.
//
// This model is the single geometry pass behind three consumers — the DXF
// writer, the PDF writer, and the Export modal's SVG preview — so what the
// user previews is guaranteed to match what they download.
//
// Scope per element type:
// - managed-street: segment outlines + curb lines where sidewalks meet
//   non-sidewalks (from live [street-segment] children).
// - legacy street (street component / streetmix-loader): same outlines +
//   curbs, reconstructed from the component's streetmix segments JSON since
//   its DOM children carry no per-segment geometry data.
// - intersection: asphalt footprint, sidewalks, corner curbs (with radius
//   arcs), and crosswalk markings, reconstructed from the same parametric
//   layout math as the intersection component's update().
// - loose geometry shapes: any other entity carrying an A-Frame geometry
//   component (shape layers, "Street Shapes" scenes) gets a best-effort
//   parametric footprint, layered by its data-layer-name type prefix.
// - clones (opt-in, includeClones): generated/baked striping, stencil, and
//   flat model clones as footprints on the markings layer.
// Parametric striping and blocks for trees/furniture remain out of scope —
// see the option stubs below for where they will hook in.

import { CROSSWALKS_REV } from '../../../aframe-components/intersection';
import { isSidewalk } from '../../../tested/aframe-streetmix-parsers-tested';

// AutoCAD Color Index — 1-based palette baked into every AutoCAD install.
// Using ACI (not true RGB) keeps the DXF the smallest possible and lets users
// apply their office ctb/stb plot styles by layer, which is what the target
// workflow actually wants. SVG/PDF consumers map through ACI_TO_HEX below.
export const ACI = {
  RED: 1,
  YELLOW: 2,
  GREEN: 3,
  CYAN: 4,
  BLUE: 5,
  MAGENTA: 6,
  WHITE: 7,
  DARK_GREY: 8,
  LIGHT_GREY: 9
};

// Screen colors for the ACI palette above (dark model-space background).
// Values match AutoCAD's model-space rendering of ACI 1-9 (8/9 are the
// standard greys). Used by the DXF-style SVG preview.
export const ACI_TO_HEX = {
  [ACI.RED]: '#ff0000',
  [ACI.YELLOW]: '#ffff00',
  [ACI.GREEN]: '#00ff00',
  [ACI.CYAN]: '#00ffff',
  [ACI.BLUE]: '#0000ff',
  [ACI.MAGENTA]: '#ff00ff',
  [ACI.WHITE]: '#ffffff',
  [ACI.DARK_GREY]: '#808080',
  [ACI.LIGHT_GREY]: '#c0c0c0'
};

// Print palette for the same ACI codes. Follows CAD plot convention: "white"
// plots as black on paper, and screen-bright hues are darkened so they
// survive white paper. Shared by the PDF writer and the PDF-page preview so
// what the user previews is what prints.
export const ACI_TO_PLOT_HEX = {
  [ACI.RED]: '#c0392b',
  [ACI.YELLOW]: '#b8860b',
  [ACI.GREEN]: '#1e8449',
  [ACI.CYAN]: '#0e7490',
  [ACI.BLUE]: '#1f4e9c',
  [ACI.MAGENTA]: '#8e44ad',
  [ACI.WHITE]: '#000000',
  [ACI.DARK_GREY]: '#555555',
  [ACI.LIGHT_GREY]: '#999999'
};

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
// Pavement markings (crosswalks). NCS-ish sibling of C-ROAD.
const MARKING_LAYER = { name: 'C-ROAD-MRKG', color: ACI.WHITE };
// Loose geometry shapes whose data-layer-name doesn't map to a segment type.
const SHAPE_LAYER = { name: 'C-SITE', color: ACI.CYAN };
const METERS_TO_FEET = 3.28083989501312;

// Streetmix segment types (legacy street component) that don't exist in the
// managed street-segment vocabulary, mapped onto the closest layer type.
// Sidewalk-ish types (any `sidewalk-*` flavor plus transit-shelter, bikeshare,
// utilities, … — the same list the 3D renderer uses via isSidewalk) normalize
// to plain sidewalk first — see normalizeLegacySegmentType.
const LEGACY_SEGMENT_TYPE_ALIASES = {
  'light-rail': 'rail',
  streetcar: 'rail',
  'turn-lane': 'drive-lane',
  'brt-lane': 'bus-lane',
  scooter: 'bike-lane',
  'bike-share': 'bike-lane',
  'magic-carpet': 'drive-lane'
};

function normalizeLegacySegmentType(type) {
  if (!type) return type;
  if (isSidewalk(type)) return 'sidewalk';
  return LEGACY_SEGMENT_TYPE_ALIASES[type] || type;
}

// Export options. Every field has a hard default so the Export modal can bind
// form state to this same object without a wire-up rewrite. unitsFeet,
// layerPrefix, and the include* layer-group toggles are honored today; the
// remaining fields are read but no-ops so callers can already start
// persisting user preferences.
export const DEFAULT_PLAN_EXPORT_OPTIONS = {
  // Output units. AutoCAD imports at the drawing's INSUNITS scale, so setting
  // this correctly is the difference between a 30-meter street landing as a
  // 30-foot alley or a 30-meter street.
  unitsFeet: false,

  // Prefix prepended to every layer name (e.g. "3DS-" → "3DS-C-ROAD"). Empty
  // string uses the raw NCS-ish names. Useful for consultants who need to
  // keep 3DStreet output namespaced away from base-plan layers.
  layerPrefix: '',

  // Layer-group toggles — one per collected group, surfaced as pills in the
  // Export modal.
  includeSegments: true, // managed + legacy street segments (and curbs)
  includeIntersections: true,
  includeShapes: true, // loose geometry primitives (shape layers)
  // Generated/baked striping, stencil, and model clones, drawn as best-effort
  // footprints on the markings layer. Off by default — dozens of tiny stencil
  // rects bury the lane linework.
  includeClones: false,

  // Reserved for the future modal — no-ops in the first cut so the field
  // shapes are stable when the modal starts writing them. (includeStriping /
  // includeStencils are the future *parametric* replacements for the
  // footprint-only includeClones above — see issue #1828.)
  includeStriping: false, // striping polylines from street-generated-striping
  includeStencils: false, // arrow/bike/etc. blocks from street-generated-stencil
  includeVegetation: false, // tree/plant blocks from clones
  includeFurniture: false, // benches/lights/signs from clones
  includeVehicles: false, // parked cars from clones
  flattenTo2D: true // future: false will preserve segment elevation as Z
};

// Compact corner list for a segment's top face. Geometry is built as
// `below-box` with width along local X and depth along local Z, translated so
// the top face sits at local Y=0 (see street-segment.js:generateMesh). Corner
// order is consistent around the face; note that projectToPlan's Z-flip means
// the emitted polyline winds clockwise, which AutoCAD accepts for closed
// LWPOLYLINEs (winding only matters if hatch/area logic is added later).
// Corners [0] and [3] are the segment's -x edge (shared with its lower-x
// neighbor) — the curb-line passes rely on that.
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

// Build the plan model from the live scene DOM. Returns:
//   {
//     layers: [{ name, color /* ACI */ }],           // declaration order
//     polylines: [{ layer, points: [[x,y],…], closed }],
//     lines: [{ layer, p1: [x,y], p2: [x,y] }],
//     bounds: { minX, minY, maxX, maxY } | null,     // null when empty
//     unitsFeet,
//     streetCount,        // managed + legacy streets
//     segmentCount,       // segments across all streets
//     intersectionCount,
//     shapeCount,         // loose geometry-primitive footprints
//     cloneCount          // generated/baked clone footprints (opt-in)
//   }
export function buildStreetPlanModel(options = {}) {
  const opts = { ...DEFAULT_PLAN_EXPORT_OPTIONS, ...options };

  const layers = [];
  const layerNames = new Set();
  const addLayer = (name, color) => {
    if (!layerNames.has(name)) {
      layerNames.add(name);
      layers.push({ name, color });
    }
  };
  const resolveAndAddLayer = (spec) => {
    const name = opts.layerPrefix
      ? `${opts.layerPrefix}${spec.name}`
      : spec.name;
    addLayer(name, spec.color);
    return name;
  };

  const polylines = [];
  const lines = [];
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
  const growBounds = ([x, y]) => {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  };

  // Transform entity-local [x, y, z] points through the entity's world matrix
  // and project them to plan coordinates (growing the drawing bounds).
  // A-Frame updates object3D.matrixWorld lazily — callers must
  // updateWorldMatrix() once per entity before batching points through this.
  const localPointsToPlan = (el, localPoints) =>
    localPoints.map((p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]);
      v.applyMatrix4(el.object3D.matrixWorld);
      const planPoint = projectToPlan(v, opts.unitsFeet);
      growBounds(planPoint);
      return planPoint;
    });

  const ctx = {
    opts,
    polylines,
    lines,
    resolveAndAddLayer,
    localPointsToPlan,
    streetCount: 0,
    segmentCount: 0,
    intersectionCount: 0,
    shapeCount: 0,
    cloneCount: 0
  };

  if (opts.includeSegments) {
    collectManagedStreets(ctx);
    collectLegacyStreets(ctx);
  }
  if (opts.includeIntersections) {
    collectIntersections(ctx);
  }
  if (opts.includeShapes || opts.includeClones) {
    collectGeometryShapes(ctx);
  }

  const isEmpty = polylines.length === 0 && lines.length === 0;

  return {
    layers,
    polylines,
    lines,
    bounds: isEmpty ? null : bounds,
    unitsFeet: opts.unitsFeet,
    streetCount: ctx.streetCount,
    segmentCount: ctx.segmentCount,
    intersectionCount: ctx.intersectionCount,
    shapeCount: ctx.shapeCount,
    cloneCount: ctx.cloneCount
  };
}

// --- managed-street pass ----------------------------------------------------
// Segment geometry read from the live [street-segment] children.
function collectManagedStreets(ctx) {
  const streets = Array.from(document.querySelectorAll('[managed-street]'));
  ctx.streetCount += streets.length;

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

    for (const segEl of segmentEls) {
      const segData = segEl.getAttribute('street-segment');
      const width = Number(segData?.width) || 0;
      const length = Number(segData?.length) || 0;
      if (width <= 0 || length <= 0 || entityIsHidden(segEl)) {
        // A skipped segment breaks adjacency — reset so we don't draw a curb
        // across the gap between its two neighbors. entityIsHidden also
        // covers a hidden parent street (it walks ancestors).
        previousSegmentType = null;
        continue;
      }

      // Force the lazy world matrix so the first export after a scene load
      // doesn't ship a matrix from before the segment was positioned.
      segEl.object3D.updateWorldMatrix(true, false);

      const planPoints = ctx.localPointsToPlan(
        segEl,
        segmentLocalCorners(width, length)
      );

      const layerName = ctx.resolveAndAddLayer(
        SEGMENT_TYPE_TO_LAYER[segData.type] || FALLBACK_LAYER
      );
      ctx.polylines.push({
        layer: layerName,
        points: planPoints,
        closed: true
      });
      ctx.segmentCount++;

      // Curb between this segment and its left neighbor, spanning this
      // segment's own -x edge (the neighbor's +x edge is co-located).
      if (
        previousSegmentType &&
        needsCurbBetween(previousSegmentType, segData.type)
      ) {
        const curbLayerName = ctx.resolveAndAddLayer(CURB_LAYER);
        ctx.lines.push({
          layer: curbLayerName,
          p1: planPoints[0],
          p2: planPoints[3]
        });
      }

      previousSegmentType = segData.type;
    }
  }
}

// --- legacy street pass -----------------------------------------------------
// Streets built by the deprecated street component (incl. streetmix-loader
// imports). Their DOM children are mixin-driven meshes with no per-segment
// geometry attributes, so the footprint is reconstructed from the component's
// streetmix segments JSON with the same layout math as
// aframe-streetmix-parsers.js (createCenteredStreetElement + processSegments):
// segments run along local Z for `length` meters, laid out left-to-right on
// local X and centered on the street entity.
function collectLegacyStreets(ctx) {
  const streetEls = Array.from(document.querySelectorAll('[street]'));

  for (const streetEl of streetEls) {
    const data = streetEl.getAttribute('street');
    if (!data?.JSON || !streetEl.object3D) continue;
    if (entityIsHidden(streetEl)) continue;

    let segments;
    try {
      segments = JSON.parse(data.JSON).streetmixSegmentsMetric;
    } catch {
      continue;
    }
    const length = Number(data.length) || 0;
    if (!Array.isArray(segments) || segments.length === 0 || length <= 0) {
      continue;
    }

    ctx.streetCount++;
    streetEl.object3D.updateWorldMatrix(true, false);

    const totalWidth = segments.reduce(
      (sum, segment) => sum + (Number(segment.width) || 0),
      0
    );

    let cumulativeWidth = 0;
    let previousSegmentType = null;

    for (const segment of segments) {
      const width = Number(segment.width) || 0;
      if (width <= 0) {
        previousSegmentType = null;
        continue;
      }
      const centerX = cumulativeWidth + width / 2 - totalWidth / 2;
      cumulativeWidth += width;

      const type = normalizeLegacySegmentType(segment.type);
      const planPoints = ctx.localPointsToPlan(
        streetEl,
        segmentLocalCorners(width, length).map(([x, y, z]) => [
          x + centerX,
          y,
          z
        ])
      );

      const layerName = ctx.resolveAndAddLayer(
        SEGMENT_TYPE_TO_LAYER[type] || FALLBACK_LAYER
      );
      ctx.polylines.push({
        layer: layerName,
        points: planPoints,
        closed: true
      });
      ctx.segmentCount++;

      if (previousSegmentType && needsCurbBetween(previousSegmentType, type)) {
        const curbLayerName = ctx.resolveAndAddLayer(CURB_LAYER);
        ctx.lines.push({
          layer: curbLayerName,
          p1: planPoints[0],
          p2: planPoints[3]
        });
      }

      previousSegmentType = type;
    }
  }
}

// --- intersection pass ------------------------------------------------------
// The intersection component is fully parametric (see intersection.js:update),
// so the plan reconstructs the same layout from the component data instead of
// chasing its autocreated mixin/extrusion children: asphalt footprint,
// sidewalk slabs, corner curbs (with the same bounded-radius arc), and
// crosswalk markings. Stop signs and signals are point objects — out of scope
// like street furniture. The intersection lies in its entity-local XY plane
// (the entity itself carries the -90° X rotation), so local points are
// [x, y, 0] here and the world matrix does the rest.
const CURB_ARC_DIVISIONS = 12;

// Plan width of a crosswalk band, from the crosswalk mixin geometries in
// assets.js: zebra is a 2m-wide plane at scale 1; the image variants
// (rainbow, double, mural, piano) are 2m planes at scale 1.5; the raised
// crosswalk GLB is approximated at the same 3m.
function crosswalkBandWidth(mixinName) {
  return mixinName === 'crosswalk-zebra' ? 2 : 3;
}

function collectIntersections(ctx) {
  const intersectionEls = Array.from(
    document.querySelectorAll('[intersection]')
  );

  for (const el of intersectionEls) {
    const data = el.getAttribute('intersection');
    if (!data || !el.object3D) continue;
    if (entityIsHidden(el)) continue;

    const [width, depth] = (data.dimensions || '')
      .split(' ')
      .map((n) => Number(n));
    if (!(width > 0) || !(depth > 0)) continue;

    ctx.intersectionCount++;
    el.object3D.updateWorldMatrix(true, false);

    const emitLocalXY = (layerSpec, xyPoints) => {
      const layerName = ctx.resolveAndAddLayer(layerSpec);
      ctx.polylines.push({
        layer: layerName,
        points: ctx.localPointsToPlan(
          el,
          xyPoints.map(([x, y]) => [x, y, 0])
        ),
        closed: true
      });
    };
    const emitCenteredRect = (layerSpec, cx, cy, w, h) =>
      emitLocalXY(layerSpec, [
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2]
      ]);

    // Asphalt footprint — the box geometry on the entity itself.
    emitCenteredRect(FALLBACK_LAYER, 0, 0, width, depth);

    // Sidewalk slabs + corner curbs share one shape recipe in the component
    // (createSidewalkElem): a length×width rect anchored at positionVec and
    // mirrored into its quadrant by scaleVec, with an optional corner arc.
    const emitSlab = ({
      position,
      scale = [1, 1],
      length,
      width: slabWidth,
      radius = 0
    }) => {
      if (!(length > 0) || !(slabWidth > 0)) return;
      const shapePoints = [
        [0, 0],
        [length, 0]
      ];
      const boundedRadius = Math.min(radius, length, slabWidth);
      if (radius > 0) {
        const arc = new THREE.EllipseCurve(
          length - boundedRadius,
          slabWidth - boundedRadius,
          boundedRadius,
          boundedRadius,
          0,
          Math.PI / 2
        );
        arc
          .getSpacedPoints(CURB_ARC_DIVISIONS)
          .forEach((p) => shapePoints.push([p.x, p.y]));
      } else {
        shapePoints.push([length, slabWidth]);
      }
      shapePoints.push([0, slabWidth]);
      emitLocalXY(
        SEGMENT_TYPE_TO_LAYER.sidewalk,
        shapePoints.map(([x, y]) => [
          position[0] + scale[0] * x,
          position[1] + scale[1] * y
        ])
      );
    };

    const sidewalkArray = (data.sidewalk || '')
      .split(' ')
      .map((n) => Number(n));
    const sidewalkParams = [
      // west, east, north, south — same order + anchors as intersection.js
      {
        position: [-width / 2, -depth / 2],
        length: sidewalkArray[0],
        width: depth
      },
      {
        position: [width / 2, -depth / 2],
        scale: [-1, 1],
        length: sidewalkArray[1],
        width: depth
      },
      {
        position: [-width / 2, depth / 2],
        scale: [1, -1],
        length: width,
        width: sidewalkArray[2]
      },
      {
        position: [-width / 2, -depth / 2],
        length: width,
        width: sidewalkArray[3]
      }
    ];
    sidewalkParams.forEach((params) => emitSlab(params));

    const curbAnchors = {
      northeastcurb: { position: [width / 2, depth / 2], scale: [-1, -1] },
      southwestcurb: { position: [-width / 2, -depth / 2], scale: [1, 1] },
      southeastcurb: { position: [width / 2, -depth / 2], scale: [-1, 1] },
      northwestcurb: { position: [-width / 2, depth / 2], scale: [1, -1] }
    };
    for (const [curbName, anchor] of Object.entries(curbAnchors)) {
      if (data[curbName] === '0 0 0') continue;
      const [curbLength, curbWidth, curbRadius] = (data[curbName] || '')
        .split(' ')
        .map((n) => Number(n));
      emitSlab({
        ...anchor,
        length: curbLength,
        width: curbWidth,
        radius: curbRadius || 0
      });
    }

    // Crosswalk bands, centered 2m inside each edge like the component
    // places them: west/east bands span the depth, north/south the width.
    const crosswalkArray = (data.crosswalk || '')
      .split(' ')
      .map((n) => Number(n));
    const crosswalkRects = [
      // west, east, north, south
      (band) => [-width / 2 + 2, 0, band, depth],
      (band) => [width / 2 - 2, 0, band, depth],
      (band) => [0, depth / 2 - 2, width, band],
      (band) => [0, -depth / 2 + 2, width, band]
    ];
    crosswalkRects.forEach((rectFor, index) => {
      const mixinName = CROSSWALKS_REV[crosswalkArray[index]];
      if (!crosswalkArray[index] || !mixinName) return;
      emitCenteredRect(
        MARKING_LAYER,
        ...rectFor(crosswalkBandWidth(mixinName))
      );
    });
  }
}

// --- loose geometry shapes pass ---------------------------------------------
// Best-effort footprints for entities that carry an A-Frame geometry component
// but belong to none of the passes above — shape layers (building box, asphalt
// circle, …) and "Street Shapes" scenes whose lanes are plain below-box
// entities. Footprints are parametric from the geometry component data (never
// the mesh — runtime batching may have stripped it), so only known primitives
// are drawn. Layer choice reuses the segment mapping via the entity's
// data-layer-name type prefix ("drive-lane • inbound" → C-ROAD); anything
// unrecognized lands on the generic C-SITE layer.
const SHAPE_ARC_DIVISIONS = 24;

// Closed N-gon of `radius` in the entity-local 'xy' plane (primitives that
// face +Z: circle, ring, torus) or 'xz' plane (y-axis solids: cylinder).
function shapeCirclePoints(radius, plane) {
  const points = [];
  for (let i = 0; i < SHAPE_ARC_DIVISIONS; i++) {
    const angle = (i / SHAPE_ARC_DIVISIONS) * Math.PI * 2;
    const a = radius * Math.cos(angle);
    const b = radius * Math.sin(angle);
    points.push(plane === 'xz' ? [a, 0, b] : [a, b, 0]);
  }
  return points;
}

// Entity-local footprint points for a geometry component, or null when the
// primitive has no sensible plan footprint (or degenerate dimensions).
function shapeLocalFootprint(geom) {
  const num = (v) => Number(v) || 0;
  switch (geom.primitive) {
    case 'box':
    case 'below-box': {
      const w = num(geom.width);
      const d = num(geom.depth);
      return w > 0 && d > 0 ? segmentLocalCorners(w, d) : null;
    }
    case 'plane': {
      const w = num(geom.width);
      const h = num(geom.height);
      if (!(w > 0) || !(h > 0)) return null;
      return [
        [-w / 2, -h / 2, 0],
        [w / 2, -h / 2, 0],
        [w / 2, h / 2, 0],
        [-w / 2, h / 2, 0]
      ];
    }
    case 'circle':
      return num(geom.radius) > 0
        ? shapeCirclePoints(num(geom.radius), 'xy')
        : null;
    case 'ring':
      return num(geom.radiusOuter) > 0
        ? shapeCirclePoints(num(geom.radiusOuter), 'xy')
        : null;
    case 'torus':
    case 'torusKnot': {
      const r = num(geom.radius) + num(geom.radiusTubular);
      return r > 0 ? shapeCirclePoints(r, 'xy') : null;
    }
    case 'cylinder':
    case 'sphere':
      return num(geom.radius) > 0
        ? shapeCirclePoints(num(geom.radius), 'xz')
        : null;
    case 'cone': {
      const r = Math.max(num(geom.radiusBottom), num(geom.radiusTop));
      return r > 0 ? shapeCirclePoints(r, 'xz') : null;
    }
    default:
      return null;
  }
}

// True when the entity or any ancestor is explicitly hidden. Reads the
// visible attribute (never object3D.visible — see the batching gotcha in
// CLAUDE.md) so hidden layers stay out of the drawing.
function entityIsHidden(el) {
  for (
    let node = el;
    node && node.getAttribute && node.tagName !== 'A-SCENE';
    node = node.parentElement
  ) {
    if (node.getAttribute('visible') === false) return true;
  }
  return false;
}

function shapeLayerSpec(el) {
  const layerName = el.getAttribute('data-layer-name') || '';
  const typeToken = normalizeLegacySegmentType(
    layerName.split('•')[0].trim().toLowerCase()
  );
  return SEGMENT_TYPE_TO_LAYER[typeToken] || SHAPE_LAYER;
}

function collectGeometryShapes(ctx) {
  const sceneEl = document.querySelector('a-scene');
  if (!sceneEl) return;

  // [geometry] catches entities with their own geometry attribute; clone
  // entities usually get their plane geometry from a mixin instead (stencils
  // with the default stencilHeight never write a geometry attribute), so the
  // clone selectors also sweep mixin-carrying entities in/on "Cloned …"
  // layers. getAttribute('geometry') below returns the merged component data
  // either way; mixins with no geometry (GLB model clones) resolve to no
  // footprint and are skipped.
  const shapeSelector =
    '[geometry],' +
    ' [data-layer-name^="Cloned "] [mixin],' +
    ' [mixin][data-layer-name^="Cloned "]';
  for (const el of Array.from(sceneEl.querySelectorAll(shapeSelector))) {
    // Entities only — [geometry] also matches <a-mixin> definitions.
    if (!el.isEntity || !el.object3D) continue;

    // Striping/stencil/model clones (opt-in via includeClones) — live clones
    // are children of "Cloned …"-named wrappers; scenes saved from converted
    // streets bake them as plain entities where only that data-layer-name
    // survives, so the name prefix (self or ancestor) is the marker. Clones
    // may live inside street entities (their lane is drawn by the street
    // pass, which never draws markings), so ownership doesn't exclude them.
    const isClone = !!el.closest('[data-layer-name^="Cloned "]');
    if (isClone) {
      if (!ctx.opts.includeClones) continue;
    } else {
      if (!ctx.opts.includeShapes) continue;
      // Owned by an earlier pass (drawn parametrically there).
      const owned = el.closest(
        '[managed-street],[street],[street-segment],[intersection]'
      );
      if (owned) continue;
      // Other generated helpers (street labels, …) — never plan linework.
      if (el.closest('.autocreated')) continue;
    }
    if (entityIsHidden(el)) continue;

    const geom = el.getAttribute('geometry');
    const localPoints = geom && shapeLocalFootprint(geom);
    if (!localPoints) continue;

    el.object3D.updateWorldMatrix(true, false);
    const layerName = ctx.resolveAndAddLayer(
      isClone ? MARKING_LAYER : shapeLayerSpec(el)
    );
    ctx.polylines.push({
      layer: layerName,
      points: ctx.localPointsToPlan(el, localPoints),
      closed: true
    });
    if (isClone) {
      ctx.cloneCount++;
    } else {
      ctx.shapeCount++;
    }
  }
}
