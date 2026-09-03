/**
 * MCP-only read and meta tools.
 *
 * The in-editor Gemini assistant gets the current scene baked into its
 * prompt on every turn, so it doesn't need read tools — exposing them to
 * Gemini would just trade a free piece of context for a tool roundtrip.
 * The MCP relay can't bake context: it talks to Claude over a process
 * boundary and needs explicit reads. Keep these in their own list, away
 * from `nonCommandTools` (which is shared with Gemini).
 *
 * Same shape as a `nonCommandTools` entry: name, description, inputSchema,
 * handler. The MCP dispatcher merges these with the shared registry tools
 * before answering `tools/list`.
 */

import { getGroupedMixinOptions } from '../mixinUtils.js';
import Events from '../Events.js';
import { resolveEntityId } from '../commands/llmToolGuards.js';
import { getUserProfile } from '@shared/utils/username';
import {
  describeEntityGeo,
  getGeoFrame,
  latLonToWorld,
  sceneAxisBearings,
  worldToLatLon
} from '../geo/geoFrame.js';
import { describeCamera, orientPlanView } from '../geo/cameraState.js';
import { summarizePresets } from '../commands/segmentPresets.js';
import { describeSaveState } from './sceneTools.js';

// Guard for entity-id args: the relay forwards arbitrary strings from
// Claude. Resolve to an A-Frame entity or throw a clean error so the
// JSON-RPC reply carries it back instead of crashing the inspector.
const resolveEntity = resolveEntityId;

async function getSceneHandler() {
  const root = document.getElementById('street-container');
  if (!root) {
    throw new Error('street-container not found');
  }
  const sceneObject = STREET.utils.convertDOMElToObject(root);
  const filtered = STREET.utils.filterJSONstreet(JSON.stringify(sceneObject));
  const sceneJSON = JSON.parse(filtered);
  const selectedId = AFRAME.INSPECTOR?.selectedEntity?.id || null;
  const sceneId = STREET.utils.getCurrentSceneId?.() || null;
  return { scene: sceneJSON, selectedEntityId: selectedId, sceneId };
}

async function getEntityHandler(args) {
  const el = resolveEntity(args?.entityId);
  const data = STREET.utils.getElementData(el);
  if (!data) {
    throw new Error(`Entity ${args.entityId} produced no serializable data`);
  }
  return data;
}

async function getSelectedEntityHandler() {
  const el = AFRAME.INSPECTOR?.selectedEntity;
  if (!el) return { entityId: null, data: null };
  return {
    entityId: el.id || null,
    data: STREET.utils.getElementData(el)
  };
}

async function selectEntityHandler(args) {
  const { entityId } = args;
  if (!entityId) {
    AFRAME.INSPECTOR?.selectEntity?.(null);
    return 'Selection cleared';
  }
  const el = resolveEntity(entityId);
  AFRAME.INSPECTOR.selectEntity(el);
  return `Selected ${entityId}`;
}

async function listMixinsHandler(args) {
  const stencilIds = new Set(
    AFRAME.components['street-generated-stencil']?.schema?.modelsArray?.oneOf ||
      []
  );
  if (stencilIds.size === 0) {
    // Every id would be tagged 'clones' — the silent misclassification the
    // tag exists to prevent. Loud, so a registration-order regression shows.
    console.warn(
      '[mcp] street-generated-stencil schema unavailable; generator tags may be wrong'
    );
  }
  const groups = getGroupedMixinOptions(true).map((g) => ({
    category: g.label,
    mixins: g.options.map((o) => ({
      id: o.value,
      label: o.label,
      // Which managed-street generator accepts this id: 3D models go in
      // `generated.clones`, flat painted markings in `generated.stencil`.
      generator: stencilIds.has(o.value) ? 'stencil' : 'clones'
    }))
  }));
  const seen = new Set(groups.flatMap((g) => g.mixins.map((m) => m.id)));
  const missingStencils = [...stencilIds].filter((id) => !seen.has(id));
  if (missingStencils.length) {
    groups.push({
      category: 'Road markings (stencils)',
      mixins: missingStencils.map((id) => ({
        id,
        label: id,
        generator: 'stencil'
      }))
    });
  }
  const requested = args?.category;
  return requested ? groups.filter((g) => g.category === requested) : groups;
}

async function listSegmentPresetsHandler() {
  return summarizePresets(window.STREET?.types);
}

async function getSessionInfoHandler(args, currentUser) {
  const sceneEl = AFRAME.scenes?.[0];
  const canvas = sceneEl?.canvas;
  // Public-handle only — email comes from the auth provider and isn't ours
  // to expose to a separate local process. uid + chosen username is enough
  // for Claude to identify the session and reference the user in copy.
  let user = null;
  if (currentUser) {
    let username = null;
    try {
      const profile = await getUserProfile(currentUser.uid);
      username = profile?.username || null;
    } catch (err) {
      console.warn('[mcp] getSessionInfo: profile lookup failed:', err);
    }
    user = { uid: currentUser.uid, username };
  }
  const { sceneId, sceneUrl, saved, isAuthor } = describeSaveState(currentUser);
  return {
    user,
    sceneId,
    sceneUrl,
    // saved = a cloud scene exists and this user is its author, so autosave
    // is persisting edits. Otherwise call saveScene.
    saved,
    isAuthor,
    sceneTitle: STREET.store?.getState?.()?.sceneTitle || null,
    viewport: canvas ? { width: canvas.width, height: canvas.height } : null
  };
}

async function getManagedStreetHandler(args) {
  const el = resolveEntity(args?.entityId);
  if (!el.components?.['managed-street']) {
    throw new Error(`Entity ${args.entityId} is not a managed-street`);
  }
  return STREET.utils.getManagedStreetJSON(el);
}

async function undoHandler() {
  const inspector = AFRAME.INSPECTOR;
  if (!inspector?.history?.undos?.length) {
    return { undone: false, reason: 'Nothing to undo' };
  }
  const top = inspector.history.undos[inspector.history.undos.length - 1];
  inspector.undo();
  return { undone: true, command: top.name || top.type || null };
}

async function redoHandler() {
  const inspector = AFRAME.INSPECTOR;
  if (!inspector?.history?.redos?.length) {
    return { redone: false, reason: 'Nothing to redo' };
  }
  const top = inspector.history.redos[inspector.history.redos.length - 1];
  inspector.redo();
  return { redone: true, command: top.name || top.type || null };
}

/**
 * Local ↔ geographic correspondence. Throws a GeoFrameError (with a reason
 * the agent can act on) while the geo layer is off or still loading.
 */
async function getGeoContextHandler(args) {
  const frame = getGeoFrame();
  const out = {
    origin: {
      ...frame.origin,
      note: 'Scene world origin (0, 0, 0) sits at this latitude/longitude on the ground plane (y = 0).'
    },
    axes: {
      ...sceneAxisBearings(frame),
      up: '+y',
      note: 'Bearings (degrees clockwise from true north) of the scene +X and +Z axes at the origin. A managed street runs along its local +Z; segments are laid out across local X. 1 scene unit = 1 meter.'
    },
    camera: describeCamera()
  };
  if (args?.entityId) {
    out.entity = describeEntityGeo(resolveEntity(args.entityId), frame);
  }
  if (args?.latitude !== undefined || args?.longitude !== undefined) {
    const lat = parseFloat(args.latitude);
    const lon = parseFloat(args.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('latitude and longitude must both be finite numbers');
    }
    const world = latLonToWorld(lat, lon, null, frame);
    out.point = {
      latitude: lat,
      longitude: lon,
      worldPosition: {
        x: Math.round(world.x * 1000) / 1000,
        y: Math.round(world.y * 1000) / 1000,
        z: Math.round(world.z * 1000) / 1000
      },
      // Round-trip so the agent can see the conversion is self-consistent.
      roundTrip: worldToLatLon(world, frame)
    };
  }
  return out;
}

async function orientPlanViewHandler() {
  return orientPlanView();
}

async function focusCameraHandler(args) {
  const el = resolveEntity(args?.entityId);
  Events.emit('objectfocus', el.object3D);
  return `Focused camera on ${args.entityId}`;
}

export const mcpReadTools = [
  {
    name: 'getScene',
    description:
      'Return the full 3DStreet scene as Format-1 JSON (the same data the Save button writes), plus the currently selected entity id and scene id.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: getSceneHandler
  },
  {
    name: 'getEntity',
    description: 'Return one entity serialized as Format-1 JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The DOM id of the entity to read'
        }
      },
      required: ['entityId']
    },
    handler: getEntityHandler
  },
  {
    name: 'getSelectedEntity',
    description:
      'Return the entity the user has selected in the scene graph (or null).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: getSelectedEntityHandler
  },
  {
    name: 'selectEntity',
    description:
      'Programmatically select an entity (mirrors clicking it in the scene graph). Pass an empty entityId to clear selection.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description:
            'The DOM id to select; pass empty string to clear selection.'
        }
      },
      required: ['entityId']
    },
    handler: selectEntityHandler
  },
  {
    name: 'listMixins',
    description:
      'List available A-Frame mixins (model assets) grouped by category. Optional category arg filters to one category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category label to filter by'
        }
      },
      required: []
    },
    handler: listMixinsHandler
  },
  {
    name: 'listSegmentPresets',
    description:
      'List the per-type segment presets (surface, color, elevation, default direction, and the generated stencils/clones/pedestrians) that managedStreetCreate and managedStreetUpdate apply when a segment omits those fields — identical to picking the type in the editor sidebar. Read this before composing a cross-section so you only override what you need.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: listSegmentPresetsHandler
  },
  {
    name: 'getSessionInfo',
    description:
      'Return signed-in user, current scene id/url/title, whether edits are being persisted (`saved`: cloud scene exists and the user is its author, so autosave is on — otherwise call saveScene), and viewport size.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: getSessionInfoHandler
  },
  {
    name: 'getManagedStreet',
    description:
      'Return one managed-street entity as Format-2 segment-list JSON (reverse of the parser, reads live DOM so it includes per-segment edits).',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The DOM id of a managed-street entity'
        }
      },
      required: ['entityId']
    },
    handler: getManagedStreetHandler
  },
  {
    name: 'undo',
    mutating: true,
    description: 'Step the editor history back by one command.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: undoHandler
  },
  {
    name: 'redo',
    mutating: true,
    description: 'Step the editor history forward by one command.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: redoHandler
  },
  {
    name: 'getGeoContext',
    description:
      'Return the exact relationship between scene coordinates and geographic coordinates: the lat/lon at the scene origin, the compass bearing of the scene axes, the camera pose (tilt, north-up state, lat/lon), and optionally one entity converted to lat/lon + compass heading (for a managed street: centerline bearing and both endpoint coordinates), and/or a lat/lon converted to a scene world position. Conversions use the live Google 3D Tiles WGS84 frame, so they match where the map renders. Errors with a reason when the geo layer is off or still loading — call setLatLon or retry.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description:
            'Optional entity to describe geographically (position → lat/lon, heading → compass bearing; managed streets also get endpoint coordinates).'
        },
        latitude: {
          type: 'number',
          description:
            'Optional latitude to convert to a scene world position (pair with longitude).'
        },
        longitude: {
          type: 'number',
          description:
            'Optional longitude to convert to a scene world position (pair with latitude).'
        }
      },
      required: []
    },
    handler: getGeoContextHandler
  },
  {
    name: 'orientPlanView',
    description:
      'Move the editor camera to a top-down, north-up plan view using the same compass action a user clicks (perspective camera, framing the whole scene). Returns the resulting camera state (tilt, needle angle, isTopDown, isNorthUp, lat/lon). Use before takeSnapshot when judging alignment or orientation; focusCamera reframes around one entity and is NOT a reliable orientation reference.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: orientPlanViewHandler
  },
  {
    name: 'focusCamera',
    description:
      'Frame an entity in the viewport (same effect as double-clicking it in the scene graph). This reframes and rotates the view around that entity, so the result is NOT a north-up or alignment reference — use orientPlanView + takeSnapshot for that.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The DOM id to focus on'
        }
      },
      required: ['entityId']
    },
    handler: focusCameraHandler
  }
];
