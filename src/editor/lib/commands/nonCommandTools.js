/**
 * Tool definitions that are NOT a thin wrapper over a single command class.
 * Read-only tools (takeSnapshot), composite mutations (managedStreetCreate
 * fans out into one entitycreate; managedStreetUpdate dispatches to
 * segmentadd/segmentupdate/segmentremove), and meta operations that we
 * deliberately keep outside the undo history (setLatLon — see comment).
 *
 * Each entry has the same shape as a command's `static llmTool` plus a
 * `handler(args, currentUser)`. The registry combines these with the
 * auto-generated command tools so consumers (Vertex AI today, MCP next)
 * see one unified list.
 */

import * as THREE from 'three';
import Events from '../Events.js';
import {
  describeCamera,
  orientPlanViewZoomed,
  planViewGroundExtent
} from '../geo/cameraState.js';
import { isGeospatialActive } from '../geo/geoFrame.js';
import {
  readSegmentEnums,
  validateSegments
} from './managedStreetValidation.js';
import { applySegmentPreset } from './segmentPresets.js';
import { GEO_SOURCES } from '@shared/constants/geoSources.js';
import { TRANSFORM_REFUSED } from '../transformGuard.js';

/**
 * Wait for a freshly created managed street to settle — segments mounted
 * and generated children (clones, stencils) no longer changing — then
 * report what actually exists, so "created" is backed by evidence. Bounded;
 * models may still be streaming in after this returns.
 */
async function readBackStreet(entityId, expectedSegments, timeoutMs = 4000) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const t0 = Date.now();
  let lastCount = -1;
  let stableTicks = 0;
  let el = null;
  while (Date.now() - t0 < timeoutMs) {
    el = document.getElementById(entityId);
    const segments = el
      ? Array.from(el.children).filter((c) => c.hasAttribute('street-segment'))
      : [];
    const descendants = el ? el.querySelectorAll('*').length : 0;
    if (segments.length >= expectedSegments && descendants === lastCount) {
      stableTicks++;
      if (stableTicks >= 3) break;
    } else {
      stableTicks = 0;
    }
    lastCount = descendants;
    await sleep(150);
  }
  if (!el) return { settled: false, segmentCount: 0, segments: [] };
  const segments = Array.from(el.children)
    .filter((c) => c.hasAttribute('street-segment'))
    .map((segEl, index) => {
      const data = segEl.getAttribute('street-segment') || {};
      const generators = Object.keys(segEl.components || {}).filter((n) =>
        n.startsWith('street-generated-')
      );
      return {
        index,
        type: data.type,
        width: data.width,
        direction: data.direction,
        generators,
        placedModels: segEl.querySelectorAll(
          '[data-layer-name^="Cloned Model"]'
        ).length
      };
    });
  return {
    settled: stableTicks >= 3,
    segmentCount: segments.length,
    segments
  };
}

// Appended to mutation results in geospatial scenes: the plan snapshot is
// the only view with absolute orientation, and agents reached for street-level
// shots instead when left to choose (WebMCP round 3).
const PLAN_VERIFY_HINT =
  'Scene is geospatial: verify placement against the real road with takeSnapshot { type: "plan" } (top-down, north-up) before reporting done.';

/**
 * Compose a managed-street entity from a flat segments array and create it
 * via a single entitycreate command.
 */
async function managedStreetCreateHandler(args) {
  const geospatial = isGeospatialActive();
  const inputSegments = Array.isArray(args.segments) ? args.segments : [];
  const warnings = validateSegments(inputSegments, readSegmentEnums());
  const streetData = {
    name: args.name || 'New Managed Street',
    length: parseFloat(args.length || '60'),
    segments: []
  };
  const presetsApplied = [];

  if (inputSegments.length) {
    streetData.segments = inputSegments.map((input, index) => {
      // Same preset table the sidebar applies when a user picks a type:
      // omitted surface/color/elevation/direction/generated come from it.
      const { segment, applied } = applySegmentPreset(
        { ...input, type: input.type || 'drive-lane' },
        window.STREET?.types
      );
      if (applied.length) presetsApplied.push({ index, fields: applied });
      return {
        name: segment.name || `${segment.type} • default`,
        type: segment.type,
        width: typeof segment.width === 'number' ? segment.width : 3,
        elevation:
          typeof segment.elevation === 'number' ? segment.elevation : 0,
        direction: segment.direction || 'none',
        color: segment.color || '#888888',
        surface: segment.surface || 'asphalt',
        // Boundary land-use presets; parseStreetObject reads both keys.
        ...(segment.type === 'boundary' && segment.variant
          ? { variant: segment.variant }
          : {}),
        ...(segment.type === 'boundary' && segment.side
          ? { side: segment.side }
          : {}),
        ...(segment.variants ? { variants: segment.variants } : {}),
        ...(segment.generated ? { generated: segment.generated } : {})
      };
    });
  }

  streetData.width = streetData.segments.reduce(
    (sum, segment) => sum + segment.width,
    0
  );

  const uniqueId = 'managed-street-' + Math.random().toString(36).slice(2, 11);

  const definition = {
    id: uniqueId,
    parent: '#street-container',
    components: {
      position: args.position || '0 0.01 0',
      'managed-street': {
        sourceType: 'json-blob',
        sourceValue: JSON.stringify(streetData),
        showVehicles: true,
        showStriping: true,
        synchronize: true
      },
      // New streets center on their creation point. Explicit (not a schema
      // default) so saved scenes that relied on 'start' stay put on load.
      'street-align': { length: 'middle' },
      'data-layer-name': streetData.name || 'New Managed Street'
    }
  };

  const created = AFRAME.INSPECTOR.execute('entitycreate', definition);
  if (created === TRANSFORM_REFUSED) {
    throw new Error('entitycreate refused: the target does not permit it');
  }
  if (!document.getElementById(uniqueId)) {
    throw new Error('Managed street entity was not created');
  }
  const readBack = await readBackStreet(uniqueId, streetData.segments.length);
  return {
    message: readBack.settled
      ? 'Managed street created and settled'
      : 'Managed street created; content may still be loading',
    entityId: uniqueId,
    width: streetData.width,
    ...(presetsApplied.length ? { presetsApplied } : {}),
    ...(warnings.length ? { warnings } : {}),
    readBack,
    ...(geospatial ? { nextStep: PLAN_VERIFY_HINT } : {})
  };
}

/**
 * Dispatch to the appropriate segment command so each mutation is its own
 * undoable history entry.
 */
async function managedStreetUpdateHandler(args) {
  const { entityId, operation, segmentIndex, segment } = args;
  const entity = document.getElementById(entityId);

  if (!entity) {
    throw new Error(`Entity with ID ${entityId} not found`);
  }

  const segmentEntities = Array.from(entity.children).filter((child) =>
    child.hasAttribute('street-segment')
  );
  const geospatial = isGeospatialActive();
  const withHint = (text) =>
    geospatial ? `${text}. ${PLAN_VERIFY_HINT}` : text;

  if (operation === 'add-segment') {
    if (!segment || !segment.type) {
      throw new Error('Segment must have at least a type property');
    }
    validateSegments([segment], readSegmentEnums());
    if (
      segmentIndex !== undefined &&
      (segmentIndex < 0 || segmentIndex > segmentEntities.length)
    ) {
      throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
    }
    const { segment: presetSegment, applied } = applySegmentPreset(
      segment,
      window.STREET?.types
    );
    const label = segment.name || `${segment.type} • default`;
    // segmentadd takes streetId (string), not the resolved element, because
    // its execute() runs on redo too — the parent DOM may have been recreated
    // since construction, so it looks up by id at execute time. update/remove
    // already hold the segment element and don't need that.
    AFRAME.INSPECTOR.execute(
      'segmentadd',
      { streetId: entityId, segment: presetSegment, segmentIndex },
      `Add ${label}`
    );
    return withHint(
      applied.length
        ? `Added segment: ${label} (preset supplied ${applied.join(', ')})`
        : `Added segment: ${label}`
    );
  }

  if (operation === 'update-segment') {
    if (segmentIndex === undefined || !segment) {
      throw new Error(
        'segmentIndex and segment are required for update-segment operation'
      );
    }
    if (segmentIndex < 0 || segmentIndex >= segmentEntities.length) {
      throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
    }
    validateSegments([segment], readSegmentEnums());
    const segmentEl = segmentEntities[segmentIndex];
    const label =
      segment.name ||
      segmentEl.getAttribute('data-layer-name') ||
      `segment ${segmentIndex}`;
    AFRAME.INSPECTOR.execute(
      'segmentupdate',
      { entity: segmentEl, segment },
      `Update ${label}`
    );
    return withHint(`Updated segment: ${label}`);
  }

  if (operation === 'remove-segment') {
    if (segmentIndex === undefined) {
      throw new Error('segmentIndex is required for remove-segment operation');
    }
    if (segmentIndex < 0 || segmentIndex >= segmentEntities.length) {
      throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
    }
    const segmentEl = segmentEntities[segmentIndex];
    const label =
      segmentEl.getAttribute('data-layer-name') || `segment ${segmentIndex}`;
    AFRAME.INSPECTOR.execute(
      'segmentremove',
      { entity: segmentEl },
      `Remove ${label}`
    );
    return withHint(`Removed segment: ${label}`);
  }

  throw new Error(`Unknown operation: ${operation}`);
}

async function takeSnapshotHandler(args) {
  const caption = args.caption || 'Snapshot of the current view';
  const focusEntityId = args.focusEntityId;
  // In a geospatial scene the plan view is the only one with absolute
  // orientation, so it is the default there; agents left to choose took
  // street-level shots that could not show misalignment.
  const defaultType = isGeospatialActive() ? 'plan' : 'focus';
  const snapshotType = args.type || defaultType;
  const typeDefaulted = !args.type;

  const screenshotEl = document.getElementById('screenshot');
  if (!screenshotEl) {
    throw new Error('Screenshot element not found');
  }
  if (!screenshotEl.isPlaying) {
    screenshotEl.play();
  }

  let screenshotCanvas = document.querySelector('#screenshotCanvas');
  if (!screenshotCanvas) {
    screenshotCanvas = document.createElement('canvas');
    screenshotCanvas.id = 'screenshotCanvas';
    screenshotCanvas.hidden = true;
    document.body.appendChild(screenshotCanvas);
  }

  const cameraEl = document.querySelector('[camera]');
  if (!cameraEl) {
    throw new Error('Camera element not found');
  }

  let zoomOut = 1;
  if (snapshotType === 'plan') {
    // Deterministic top-down north-up view via the compass action, then
    // pull back so the surrounding real roads are in frame (geo scenes
    // default to 2x; the compass fit alone crops them).
    zoomOut = Number.isFinite(Number(args.zoomOut))
      ? Math.max(1, Number(args.zoomOut))
      : isGeospatialActive()
        ? 2
        : 1;
    await orientPlanViewZoomed({ zoomOut });
  } else if (snapshotType !== 'focus') {
    const streetEntity = document.querySelector('[managed-street]');
    if (!streetEntity) {
      throw new Error('Street entity not found. Cannot position camera.');
    }

    let targetEntity = document.querySelector('#temp-camera-target');
    if (!targetEntity) {
      targetEntity = document.createElement('a-entity');
      targetEntity.id = 'temp-camera-target';
      document.querySelector('a-scene').appendChild(targetEntity);
    }

    const streetPosition = new THREE.Vector3();
    streetEntity.object3D.getWorldPosition(streetPosition);

    switch (snapshotType) {
      case 'birdseye':
        targetEntity.setAttribute('position', {
          x: streetPosition.x,
          y: streetPosition.y,
          z: streetPosition.z
        });
        targetEntity.setAttribute('focus-camera-pose', {
          relativePosition: { x: 0, y: 50, z: 0 }
        });
        break;
      case 'straightOn':
        targetEntity.setAttribute('position', {
          x: streetPosition.x,
          y: streetPosition.y,
          z: streetPosition.z
        });
        targetEntity.setAttribute('focus-camera-pose', {
          relativePosition: { x: 0, y: 1.6, z: 20 }
        });
        break;
      case 'closeup':
        targetEntity.setAttribute('position', {
          x: streetPosition.x,
          y: streetPosition.y,
          z: streetPosition.z
        });
        targetEntity.setAttribute('focus-camera-pose', {
          relativePosition: { x: 3, y: 1.2, z: 5 }
        });
        break;
    }

    if (typeof Events !== 'undefined' && Events.emit) {
      Events.emit('objectfocus', targetEntity.object3D);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      throw new Error('Events system not available');
    }
  } else if (focusEntityId) {
    const focusEntity = document.getElementById(focusEntityId);
    if (!focusEntity) {
      throw new Error(`Entity with ID ${focusEntityId} not found`);
    }

    if (typeof Events !== 'undefined' && Events.emit) {
      Events.emit('objectfocus', focusEntity.object3D);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      const entityPosition = new THREE.Vector3();
      focusEntity.object3D.getWorldPosition(entityPosition);

      const camera = cameraEl.object3D;
      const cameraWorldPosition = new THREE.Vector3();
      camera.getWorldPosition(cameraWorldPosition);

      const direction = new THREE.Vector3()
        .subVectors(cameraWorldPosition, entityPosition)
        .normalize()
        .multiplyScalar(5);

      camera.position.copy(entityPosition).add(direction);
      camera.lookAt(entityPosition);

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return new Promise((resolve, reject) => {
    const takeActualSnapshot = () => {
      try {
        const renderer = AFRAME.scenes[0].renderer;

        const inspector = AFRAME.INSPECTOR;
        if (inspector && inspector.opened) {
          inspector.sceneHelpers.visible = false;
        }

        const scene = AFRAME.scenes[0].object3D;
        const camera = AFRAME.scenes[0].camera;
        renderer.render(scene, camera);

        screenshotCanvas.width = renderer.domElement.width;
        screenshotCanvas.height = renderer.domElement.height;

        const ctx = screenshotCanvas.getContext('2d');
        ctx.drawImage(renderer.domElement, 0, 0);

        let sceneTitle;
        try {
          if (typeof window.AFRAME !== 'undefined') {
            const sceneEl = window.AFRAME.scenes[0].sceneEl;
            if (sceneEl && sceneEl.getAttribute('data-scene-title')) {
              sceneTitle = sceneEl.getAttribute('data-scene-title');
            }
            if (
              !sceneTitle &&
              typeof window.STREET !== 'undefined' &&
              window.STREET.sceneTitle
            ) {
              sceneTitle = window.STREET.sceneTitle;
            }
          }
        } catch (e) {
          console.warn('Could not get scene title:', e);
        }

        if (sceneTitle) {
          ctx.font = '30px Lato';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 3;
          ctx.strokeText(
            sceneTitle,
            screenshotCanvas.width / 2,
            screenshotCanvas.height - 43
          );
          ctx.fillText(
            sceneTitle,
            screenshotCanvas.width / 2,
            screenshotCanvas.height - 43
          );
        }

        const logoImg = document.querySelector('#screenshot-img');
        if (logoImg) {
          ctx.drawImage(logoImg, 0, 0, 135, 43, 40, 30, 270, 86);
        }

        const imageData = screenshotCanvas.toDataURL('image/png');

        if (inspector && inspector.opened) {
          inspector.sceneHelpers.visible = true;
        }

        // Machine-readable pose so the picture is not the only evidence:
        // tilt, north-up state, screen-up bearing, and lat/lon when geo is on.
        let metadata;
        try {
          metadata = { type: snapshotType, camera: describeCamera() };
        } catch (e) {
          metadata = { type: snapshotType, cameraError: e.message };
        }
        if (typeDefaulted) metadata.typeDefaulted = true;
        if (snapshotType === 'plan') {
          metadata.zoomOut = zoomOut;
          try {
            metadata.groundExtent = planViewGroundExtent();
          } catch (e) {
            /* camera unavailable; extent is optional */
          }
        }
        resolve({ caption, imageData, metadata });
      } catch (error) {
        reject(error);
      }
    };

    setTimeout(takeActualSnapshot, 100);
  });
}

// WebMCP hackathon demo carve-out (PR #1931): signed-out sessions may set
// locations within California until the demo window closes — third-party
// sign-in is unreliable inside agent-embedded browsers, so browser agents
// get a real geospatial demo without an account. This mirror exists only for
// a good pre-flight error message; the server (getGeoidHeight in
// public/functions/geoid-height.js, ANON_GEO_DEMO) enforces the same bbox +
// expiry from lat/lon alone and trusts no client flag. Keep in sync; remove
// both after the window closes.
const ANON_GEO_DEMO = {
  until: Date.parse('2026-10-01T00:00:00Z'),
  // California bounding box
  bbox: { latMin: 32.5, latMax: 42.05, lonMin: -124.45, lonMax: -114.13 }
};

function isAnonGeoDemoAllowed(lat, lon) {
  const { until, bbox } = ANON_GEO_DEMO;
  return (
    Date.now() < until &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= bbox.latMin &&
    lat <= bbox.latMax &&
    lon >= bbox.lonMin &&
    lon <= bbox.lonMax
  );
}

// NOT routed through INSPECTOR.execute by design. Wrapping this as a command
// would require capturing pre/post lat/lon/elevation, and undo would fire two
// extra elevation HTTP roundtrips per toggle. Leave uninstrumented until we
// have a concrete need for undoable geolocation.
async function setLatLonHandler(args, currentUser) {
  const { latitude, longitude } = args;

  if (!currentUser && !isAnonGeoDemoAllowed(latitude, longitude)) {
    throw new Error(
      'Setting this location requires a signed-in 3DStreet account. Without sign-in, only locations within California work (demo period). Either pick California coordinates (e.g. 37.7749, -122.4194 for San Francisco), or ask the user to sign in using the 3DStreet page UI.'
    );
  }

  const { setSceneLocation } = await import('../utils.js');
  const result = await setSceneLocation(latitude, longitude, {
    source: GEO_SOURCES.AI_ASSISTANT
  });

  if (!result.success) {
    // setSceneLocation reports failures as { success: false, message } for its
    // modal callers; the tool layer must throw so the call is marked an error
    // (UI status, executedCalls, verification verdict) instead of "Completed"
    // with an error string as its result.
    throw new Error(result.message || 'Failed to set location');
  }
  // The success payload is the getGeoidHeight response: coordinates are
  // lat/lon (not latitude/longitude) and the heights are null when the
  // elevation lookup times out — word it so the verification model doesn't
  // read a partial answer as a failed one.
  const data = result.data;
  const elevation =
    data.ellipsoidalHeight != null
      ? `ellipsoidal height ${data.ellipsoidalHeight}m, orthometric height ${data.orthometricHeight}m`
      : 'elevation lookup unavailable (location still set)';
  return `Successfully set location to latitude: ${data.lat}, longitude: ${data.lon} — ${elevation}`;
}

const segmentSchema = {
  type: 'object',
  description: 'Segment definition',
  properties: {
    name: { type: 'string', description: 'Display name of the segment' },
    type: {
      type: 'string',
      description:
        'Type of segment. Valid values: "drive-lane", "bike-lane", "sidewalk", "parking-lane", "divider", "grass", "rail", "bus-lane", "boundary". "boundary" is SYNTHETIC flanking land use (buildings, waterfront, fences) for scenes without geographic context — it renders outside the travelled way at the street edge and auto-tiles models edge-to-edge (`variant` + `side`, no `generated` needed). Do not add boundaries when the scene has a location: the Google 3D Tiles already show the real surroundings and synthetic buildings would overlap them.'
    },
    surface: {
      type: 'string',
      description:
        'Surface material (e.g., "asphalt", "concrete", "grass", "sidewalk", "gravel", "sand", "hatched", "planting-strip", "none", "solid"). Optional for building segments — the variant supplies a sensible default.'
    },
    color: { type: 'string', description: 'Hex color code (e.g., "#ffffff")' },
    elevation: {
      type: 'number',
      description:
        'Vertical offset in meters (0 = road level, 0.15 = curb/sidewalk height). Negative values are not supported.'
    },
    width: { type: 'number', description: 'Width in meters' },
    direction: {
      type: 'string',
      description: 'Traffic direction ("none", "inbound", "outbound")'
    },
    variant: {
      type: 'string',
      description:
        'Variant preset for `type: "boundary"` segments. Valid values: "brownstone" (urban mixed-use SM3D blocks), "suburban" (detached single-family houses), "arcade" (arched street-front buildings), "water" (seawall), "grass" (fenced grass strip), "parking" (fenced parking lot), "sp-mixeduse" (StreetPlan mixed-use), "sp-residential" (StreetPlan single-family/townhouse), "sp-big-box" (StreetPlan big-box stores), "custom" (preserve existing settings). Setting variant on a boundary segment auto-fits the model array; do NOT pass `generated.clones` for boundaries unless you want full control. Only meaningful when `type: "boundary"`, and only for scenes without geographic context (see `type`).'
    },
    side: {
      type: 'string',
      description:
        'Side of the street the segment sits on. Required for `type: "boundary"` (controls placement outside the travelled way edge and which direction the models face). Valid values: "left", "right". Frame of reference is the street\'s own cross-section, not the camera: "left" is the inbound side and "right" the outbound side (right-hand-drive convention; swap for left-hand-drive countries). segments[0] sits at the first edge; getGeoContext reports the compass bearing of each edge.',
      enum: ['left', 'right']
    },
    generated: {
      type: 'object',
      description:
        'Optional generated content — omit to receive the type preset. Two different systems: `clones` places 3D models (vehicles, cyclists, trees, lamps, furniture — any listMixins id with generator "clones"); `stencil` paints flat road markings (arrows, sharrows, words like BUS ONLY — only ids with generator "stencil"). Never put a vehicle in `stencil` or a marking in `clones`.',
      properties: {
        clones: {
          type: 'array',
          description: 'Clones configuration for repeated 3D models',
          items: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                description: 'Clone mode ("random", "fixed", "single")'
              },
              modelsArray: {
                type: 'string',
                description:
                  'Comma-separated 3D model ids from listMixins (generator "clones"), e.g. "sedan-rig, box-truck-rig" or "bus". Unknown ids are rejected.'
              },
              spacing: {
                type: 'number',
                description: 'Distance between models in meters'
              },
              count: {
                type: 'number',
                description: 'Number of models (for random mode)'
              },
              facing: { type: 'number', description: 'Rotation in degrees' },
              randomFacing: { type: 'boolean', description: 'Random rotation' },
              cycleOffset: {
                type: 'number',
                description: 'Offset in the repeating pattern (0-1)'
              }
            },
            required: ['mode', 'modelsArray', 'spacing']
          }
        },
        stencil: {
          type: 'array',
          description: 'Stencil configuration for road markings',
          items: {
            type: 'object',
            properties: {
              modelsArray: {
                type: 'string',
                description:
                  'Comma-separated painted-marking ids (generator "stencil"), e.g. "bike-arrow", "sharrow", "word-bus, word-only". Unknown ids are rejected — use listMixins.'
              },
              spacing: {
                type: 'number',
                description: 'Distance between stencils'
              },
              padding: { type: 'number', description: 'Edge padding' },
              cycleOffset: {
                type: 'number',
                description: 'Pattern offset (0-1)'
              },
              direction: {
                type: 'string',
                description: 'Stencil orientation'
              },
              stencilHeight: {
                type: 'number',
                description: 'Height of stencil'
              }
            },
            required: ['modelsArray', 'spacing']
          }
        },
        pedestrians: {
          type: 'array',
          description: 'Pedestrian configuration',
          items: {
            type: 'object',
            properties: {
              density: {
                type: 'string',
                description: 'Pedestrian density ("normal", "dense")'
              }
            },
            required: ['density']
          }
        },
        striping: {
          type: 'array',
          description: 'Striping configuration for lane markings',
          items: {
            type: 'object',
            properties: {
              striping: { type: 'string', description: 'Stripe pattern type' },
              side: {
                type: 'string',
                description: 'Side of segment ("left", "right")'
              }
            },
            required: ['striping']
          }
        }
      }
    }
  },
  required: ['type', 'surface', 'color', 'elevation', 'width', 'direction']
};

// For update-segment, every field is optional — the caller patches only what
// it wants to change. Reusing the create schema's `required` list forces the
// LLM to fabricate values for fields it doesn't intend to touch.
const segmentUpdateSchema = {
  ...segmentSchema,
  required: []
};

export const nonCommandTools = [
  {
    name: 'managedStreetCreate',
    description:
      "Create a new managed street from a cross-section (array of segments, listed from one edge to the other). If the scene has geographic context (setLatLon / Google 3D Tiles), the tiles already supply the surroundings: do NOT add boundary segments, buildings or other land-use models unless the user explicitly asks for synthetic surroundings — the cross-section should normally begin and end with sidewalks. For each segment, omit surface/color/elevation/direction/generated to receive the type's preset — the same content a user gets by picking that type in the sidebar (e.g. bike-lane → green asphalt, bike-arrow stencils, cyclists; bus-lane → BUS ONLY stencil, buses; sidewalk → pedestrians). Call listSegmentPresets to see them. Only supply `generated` to override a preset. Returns entityId, width, presetsApplied, warnings and a readBack of what actually mounted.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the street configuration'
        },
        length: {
          type: 'string',
          description: 'Length of the street in meters (default: 60)'
        },
        position: {
          type: 'string',
          description:
            'Position as space-separated x y z values (e.g., "0 0 0")'
        },
        segments: {
          type: 'array',
          description: 'Array of segment definitions for the street',
          items: segmentSchema
        }
      },
      required: ['segments']
    },
    handler: managedStreetCreateHandler
  },
  {
    name: 'managedStreetUpdate',
    description:
      'Update segments in an existing managed street (use entityUpdate for updating street properties)',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the managed street entity to update'
        },
        operation: {
          type: 'string',
          description:
            'Operation to perform ("add-segment", "update-segment", "remove-segment")'
        },
        segmentIndex: {
          type: 'number',
          description:
            'Index of the segment to update or remove (for update-segment and remove-segment operations)'
        },
        segment: {
          ...segmentUpdateSchema,
          description:
            'Segment definition. For add-segment, "type" is required; other fields fall back to defaults if omitted. For update-segment, supply only the fields you want to change — omitted fields are left untouched.'
        }
      },
      required: ['entityId', 'operation']
    },
    handler: managedStreetUpdateHandler
  },
  {
    name: 'takeSnapshot',
    description:
      'Render a snapshot of the scene and return it as an image plus `metadata.camera` (tilt, isTopDown, isNorthUp, screenUpBearingDeg, lat/lon). To VERIFY placement or alignment use type "plan": top-down, north-up, whole scene — the only view with absolute orientation. One plan snapshot beats several angled ones; do not take multiple perspective shots to check position. In a geospatial scene "plan" is the default when type is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        caption: {
          type: 'string',
          description: 'Optional caption to display with the snapshot'
        },
        focusEntityId: {
          type: 'string',
          description:
            'Optional entity ID to focus on before taking the snapshot'
        },
        type: {
          type: 'string',
          description:
            'View to render. "plan": top-down, north-up, whole scene — use this to judge orientation and alignment (default in geospatial scenes). "focus": current view, or framed on focusEntityId (default otherwise). "birdseye", "straightOn", "closeup": presentation shots of the first managed street — not orientation references; use them only when the user asks for a picture, not to verify.',
          enum: ['focus', 'plan', 'birdseye', 'straightOn', 'closeup']
        },
        zoomOut: {
          type: 'number',
          description:
            'Plan view only: altitude multiplier applied after the top-down fit. 1 = street fills the frame; 2 (default in geospatial scenes) shows about twice the ground extent so the real roads around the street are visible; use 3-4 for a wider context check. The result reports `metadata.groundExtent` (visible metres across the viewport).'
        }
      },
      required: []
    },
    handler: takeSnapshotHandler
  },
  {
    name: 'setLatLon',
    description:
      'Set the latitude and longitude for the scene, which triggers elevation lookup and activates the Google 3D Tiles map layer. Signed-in users can set any location; signed-out sessions are limited to locations within California (demo).',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Latitude in decimal degrees (e.g., 37.7637072)'
        },
        longitude: {
          type: 'number',
          description: 'Longitude in decimal degrees (e.g., -122.4151768)'
        }
      },
      required: ['latitude', 'longitude']
    },
    handler: setLatLonHandler
  }
];
