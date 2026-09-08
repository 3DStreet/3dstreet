// One Streetmix "curb level" step in meters. Elevation is stored in meters
// everywhere in 3DStreet; this constant exists only to convert deprecated
// integer `level` values (legacy saved scenes, pre-33 Streetmix payloads).
const CURB_HEIGHT = 0.15;
const BASE_SURFACE_DEPTH = 0.15; // Minimum material depth above dirt layer

// How far above a segment's top surface the generated lane markings and
// stencils sit. Their clones are children of the segment entity, whose origin
// IS the top surface, so this is a surface-relative offset at any elevation.
//
// Known to be too high: it should follow the segment surface rather than float
// a fixed distance above it, and what it was originally working around is no
// longer recorded. It lives here as one value because anything that has to sit
// clear of the markings must move with it rather than be pinned to a number
// nobody can justify.
const MARKING_SURFACE_OFFSET = 0.05;

// Calculate the Y position and below-box geometry height for a given elevation
// in meters. The below-box primitive places its top face at the entity's local
// origin, so using the same value for both entity Y and box height means the
// top surface sits at Y=height and the box extends downward to Y=0 (the dirt
// layer top).
// elevation 0 = 0.15m (base depth only), 0.15m (curb) = 0.30m, 0.30m = 0.45m, etc.
// Negative elevations (below road level) are intentionally unsupported for
// now: the Math.max clamps them to the base surface depth, so they render at
// road level.
function calculateHeight(elevation) {
  if (elevation === undefined || elevation === null) {
    return BASE_SURFACE_DEPTH;
  }
  return Math.max(BASE_SURFACE_DEPTH, BASE_SURFACE_DEPTH + elevation);
}

// Surface heights for a sloped segment (coastmix schema v34): the surface
// tilts between two metric elevations across the segment width. The segment
// entity sits at the mean height; the geometry's top face is displaced by
// startDelta at the segment's start (local -x) edge and endDelta at the end
// (local +x) edge.
function calculateSlopedHeights(startElevation, endElevation) {
  const startHeight = calculateHeight(startElevation);
  const endHeight = calculateHeight(endElevation);
  const height = (startHeight + endHeight) / 2;
  return {
    height,
    startDelta: startHeight - height,
    endDelta: endHeight - height
  };
}

// Convert a deprecated integer elevation level to meters.
// e.g., level 0 → 0m, level 1 → 0.15m, level 2 → 0.30m
// Negative levels clamp to 0: negative elevations are intentionally
// unsupported, and legacy levels below 0 already rendered at road level.
function levelToElevation(level) {
  if (level === undefined || level === null || isNaN(level)) {
    return 0;
  }
  return Math.max(0, level * CURB_HEIGHT);
}

// Migrate a saved street-segment component value from the deprecated integer
// `level` property to metric `elevation`. Saved scenes serialize components as
// prop strings ("type: sidewalk; level: 1; ...") but callers may also hold the
// parsed object form — both are handled. Values that already carry `elevation`
// are returned unchanged (the stray `level`, if any, is ignored by the schema).
function migrateSegmentLevelToElevation(componentValue) {
  if (typeof componentValue === 'string') {
    if (/(^|;)\s*elevation\s*:/.test(componentValue)) {
      return componentValue;
    }
    return componentValue.replace(
      /(^|;)(\s*)level\s*:\s*(-?\d+(?:\.\d+)?)/g,
      (match, sep, ws, num) =>
        `${sep}${ws}elevation: ${levelToElevation(parseFloat(num))}`
    );
  }
  if (
    componentValue &&
    typeof componentValue === 'object' &&
    'level' in componentValue
  ) {
    const { level, ...rest } = componentValue;
    if (rest.elevation === undefined) {
      rest.elevation = levelToElevation(parseFloat(level));
    }
    return rest;
  }
  return componentValue;
}

// Migrate a saved street-segment component value from the deprecated
// `type: building` to `type: boundary` (the rename covers the wider set of
// adjacent land uses: buildings, waterfront, fences, parking lots, ...).
// Handles the serialized prop-string form and the parsed object form.
function migrateSegmentBuildingType(componentValue) {
  if (typeof componentValue === 'string') {
    return componentValue.replace(
      /(^|;)(\s*)type\s*:\s*building(\s*)(;|$)/,
      '$1$2type: boundary$3$4'
    );
  }
  if (
    componentValue &&
    typeof componentValue === 'object' &&
    componentValue.type === 'building'
  ) {
    return { ...componentValue, type: 'boundary' };
  }
  return componentValue;
}

// Migrate a saved entity carrying the deprecated `surface: hatched`
// street-segment value (#1728): hatching is now a full-width
// street-generated-striping treatment that crops to the segment width instead
// of stretching a surface texture across it. The migration spans two
// components — the surface becomes asphalt and a striping instance with
// `striping: hatched` is added in the first free slot — so it operates on the
// entity's whole serialized components object (mutated in place and
// returned). Handles the prop-string and parsed-object forms of the
// street-segment value, like the other segment migrations.
function migrateSegmentHatchedSurface(components) {
  const segmentValue = components?.['street-segment'];
  if (!segmentValue) {
    return components;
  }
  let migrated = false;
  if (typeof segmentValue === 'string') {
    if (/(^|;)\s*surface\s*:\s*hatched\s*(;|$)/.test(segmentValue)) {
      components['street-segment'] = segmentValue.replace(
        /(^|;)(\s*)surface\s*:\s*hatched(\s*)(;|$)/,
        '$1$2surface: asphalt$3$4'
      );
      migrated = true;
    }
  } else if (
    typeof segmentValue === 'object' &&
    segmentValue.surface === 'hatched'
  ) {
    components['street-segment'] = { ...segmentValue, surface: 'asphalt' };
    migrated = true;
  }
  if (migrated) {
    components[findFreeStripingKey(components)] = 'striping: hatched';
  }
  return components;
}

// Strip the removed `direction` property from saved street-generated-pedestrians
// values: pedestrians now walk in the segment's own direction (one source of
// truth; the sidewalk default of `none` mixes them). The walk direction the
// scene was saved with (explicit, else the old component default `none`) is
// carried onto the street-segment so the crowd renders as before — without
// this a Streetmix-derived sidewalk (segment direction `outbound`, pedestrians
// `none`) would turn into a one-way crowd. Handles the prop-string and
// parsed-object forms; mutates and returns the components object.
function migratePedestriansDirection(components) {
  if (!components) {
    return components;
  }
  let walkDirection;
  for (const key of Object.keys(components)) {
    if (!key.startsWith('street-generated-pedestrians')) {
      continue;
    }
    const value = components[key];
    let direction = 'none';
    if (typeof value === 'string') {
      const match = value.match(/(?:^|;)\s*direction\s*:\s*([^;\s]+)/);
      if (match) {
        direction = match[1];
      }
      components[key] = value
        .split(';')
        .filter((pair) => !/^\s*direction\s*:/.test(pair))
        .join(';')
        .trim();
    } else if (value && typeof value === 'object') {
      if ('direction' in value) {
        const { direction: saved, ...rest } = value;
        direction = saved || 'none';
        components[key] = rest;
      }
    } else {
      continue;
    }
    // first pedestrians instance wins
    walkDirection = walkDirection ?? direction;
  }
  if (walkDirection !== undefined) {
    components['street-segment'] = setSegmentDirection(
      components['street-segment'],
      walkDirection
    );
  }
  return components;
}

// Set `direction` on a serialized street-segment value (prop-string or
// parsed-object form); a missing value is left alone.
function setSegmentDirection(segmentValue, direction) {
  if (typeof segmentValue === 'string') {
    if (/(^|;)\s*direction\s*:/.test(segmentValue)) {
      return segmentValue.replace(
        /(^|;)(\s*)direction\s*:\s*[^;]*/,
        `$1$2direction: ${direction}`
      );
    }
    return `${segmentValue.replace(/;?\s*$/, '')}; direction: ${direction}`;
  }
  if (segmentValue && typeof segmentValue === 'object') {
    return { ...segmentValue, direction };
  }
  return segmentValue;
}

// First unused street-generated-striping key in a serialized components
// object. First instance is __1; a bare unsuffixed instance occupies the same
// export index as __1 (see managed-street's GENERATED_RE), so it blocks __1.
function findFreeStripingKey(components) {
  if (
    !('street-generated-striping' in components) &&
    !('street-generated-striping__1' in components)
  ) {
    return 'street-generated-striping__1';
  }
  let n = 2;
  while (`street-generated-striping__${n}` in components) {
    n++;
  }
  return `street-generated-striping__${n}`;
}

// Migrate a saved managed-street component value from the short-lived
// `showBuildings` property name to `showBoundaries` (renamed with the
// building -> boundary segment type).
function migrateShowBuildingsFlag(componentValue) {
  if (typeof componentValue === 'string') {
    return componentValue.replace(
      /(^|;)(\s*)showBuildings\s*:/,
      '$1$2showBoundaries:'
    );
  }
  if (
    componentValue &&
    typeof componentValue === 'object' &&
    'showBuildings' in componentValue
  ) {
    const { showBuildings, ...rest } = componentValue;
    if (rest.showBoundaries === undefined) {
      rest.showBoundaries = showBuildings;
    }
    return rest;
  }
  return componentValue;
}

export {
  calculateHeight,
  calculateSlopedHeights,
  levelToElevation,
  migrateSegmentLevelToElevation,
  migrateSegmentBuildingType,
  migrateSegmentHatchedSurface,
  migratePedestriansDirection,
  migrateShowBuildingsFlag,
  CURB_HEIGHT,
  BASE_SURFACE_DEPTH,
  MARKING_SURFACE_OFFSET
};
