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
  const groups = getGroupedMixinOptions(true);
  const requested = args?.category;
  const filtered = requested
    ? groups.filter((g) => g.label === requested)
    : groups;
  return filtered.map((g) => ({
    category: g.label,
    mixins: g.options.map((o) => ({
      id: o.value,
      label: o.label
    }))
  }));
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
  return {
    user,
    sceneId: STREET.utils.getCurrentSceneId?.() || null,
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
    name: 'getSessionInfo',
    description:
      'Return signed-in user, current scene id/title, and viewport size for the connected browser tab.',
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
    description: 'Step the editor history back by one command.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: undoHandler
  },
  {
    name: 'redo',
    description: 'Step the editor history forward by one command.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: redoHandler
  },
  {
    name: 'focusCamera',
    description:
      'Frame an entity in the viewport (same effect as double-clicking it in the scene graph).',
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
