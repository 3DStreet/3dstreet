/**
 * MCP-only scene persistence tools: saveScene / loadScene.
 *
 * WebMCP round 3: an agent built a street, the session reloaded, and the
 * scene was blank — nothing on the tool surface could persist it. These wrap
 * the same save/load paths the toolbar and Scenes modal use. After the
 * first save the editor's autosave (Save.component.jsx, debounced on
 * `historychanged`) persists every later edit by the author, so an agent
 * only needs saveScene once per new scene. loadScene is the "resume"
 * fallback: the agent keeps the scene id in its own memory across sessions
 * and reopens it on request.
 *
 * Flagged `mutating: true` so the read-only gate blocks them like commands.
 */

import useStore from '@/store.js';
import {
  createElementsForScenesFromJSON,
  saveSceneWithScreenshot
} from '../SceneUtils.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function sceneUrlFor(sceneId) {
  return `${window.location.origin}${window.location.pathname}#/scenes/${sceneId}`;
}

/**
 * Whether edits in this tab are being persisted: a cloud scene id exists and
 * the signed-in user is its author (autosave only runs for the author).
 */
export function describeSaveState(currentUser) {
  const sceneId = STREET.utils.getCurrentSceneId?.() || null;
  const authorId = STREET.utils.getAuthorId?.() || null;
  const isAuthor = !!currentUser && !!authorId && authorId === currentUser.uid;
  return {
    sceneId,
    sceneUrl: sceneId ? sceneUrlFor(sceneId) : null,
    isAuthor,
    saved: !!sceneId && isAuthor,
    signedIn: !!currentUser
  };
}

/** One-line nudge appended to mutation results while edits are unsaved. */
export function saveNudge(currentUser) {
  const state = describeSaveState(currentUser);
  if (state.saved) return null;
  if (!state.signedIn) {
    return 'nextStep: edits are NOT persisted (signed out). Ask the user to sign in in the 3DStreet tab, then call saveScene; the scene URL it returns is how to reopen this work later.';
  }
  if (state.sceneId) {
    return "nextStep: edits are NOT persisted — this scene belongs to another user. Call saveScene to save a copy under the user's account (returns the new scene URL).";
  }
  return 'nextStep: edits are NOT persisted yet. Call saveScene once (autosave takes over afterwards) and give the user the scene URL it returns so this work can be reopened later.';
}

async function saveSceneHandler(args, currentUser) {
  if (!currentUser) {
    // The agent cannot sign in on the user's behalf; open the modal so the
    // human sees exactly what is needed.
    useStore.getState().setModal('signin');
    throw new Error(
      'Not signed in. The sign-in modal is now open in the 3DStreet tab — ask the user to sign in, then call saveScene again.'
    );
  }
  if (args?.title) {
    useStore.getState().setSceneTitle(String(args.title));
  }
  const before = describeSaveState(currentUser);
  const sceneId = await saveSceneWithScreenshot(currentUser, false, false);
  if (!sceneId) {
    throw new Error('Save did not return a scene id');
  }
  return {
    message:
      before.sceneId && !before.isAuthor
        ? 'Saved a copy under your account (original belongs to another user). Autosave is now on for this copy.'
        : 'Scene saved. Autosave is now on: every further edit in this tab persists automatically.',
    sceneId,
    title: useStore.getState().sceneTitle || null,
    sceneUrl: sceneUrlFor(sceneId),
    resume: `To reopen this scene in a future session, open the sceneUrl or call loadScene with sceneId "${sceneId}".`
  };
}

async function loadSceneHandler(args) {
  const match = UUID_RE.exec(String(args?.sceneId || ''));
  if (!match) {
    throw new Error(
      'sceneId must be a scene UUID (or a 3DStreet URL containing #/scenes/<uuid>)'
    );
  }
  const sceneId = match[0].toLowerCase();
  // Same endpoint the #/scenes/<id> hash loader fetches at startup
  // (set-loader-from-hash in json-utils_1.1.js), including its localhost
  // rewrite to the dev deployment.
  const base = window.location.href.includes('localhost')
    ? 'https://dev-3dstreet.web.app'
    : '';
  const response = await fetch(`${base}/scenes/${sceneId}.json`);
  if (response.status === 404) {
    throw new Error(`Scene ${sceneId} not found`);
  }
  if (!response.ok) {
    throw new Error(
      `Could not fetch scene ${sceneId} (HTTP ${response.status})`
    );
  }
  const json = await response.json();
  if (!Array.isArray(json?.data)) {
    throw new Error(`Scene ${sceneId} has no scene data`);
  }
  useStore.getState().startLoadingScene('Loading scene from cloud...');
  createElementsForScenesFromJSON(json.data, json.memory);
  window.location.hash = `#/scenes/${sceneId}`;
  AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
  if (json.author) {
    AFRAME.scenes[0].setAttribute('metadata', 'authorId', json.author);
  }
  if (json.title) {
    useStore.getState().setSceneTitle(json.title);
  }
  return {
    message: 'Scene loaded; replaced the previous scene contents in this tab.',
    sceneId,
    title: json.title || null,
    sceneUrl: sceneUrlFor(sceneId)
  };
}

export const mcpSceneTools = [
  {
    name: 'saveScene',
    description:
      "Persist the current scene to the signed-in user's cloud account. Edits are NOT saved until this is called once; afterwards autosave persists every further edit in this tab. Returns sceneId and sceneUrl — always give the user the sceneUrl (or remember the sceneId) so the work can be reopened in a later session with loadScene. Signed out: opens the sign-in modal and errors; ask the user to sign in, then retry. If the open scene belongs to someone else, saves a copy.",
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Optional scene title to set before saving (e.g. "Geary Blvd BRT").'
        }
      },
      required: []
    },
    mutating: true,
    handler: saveSceneHandler
  },
  {
    name: 'loadScene',
    description:
      'Replace the current scene with a saved cloud scene by id — the way to resume earlier work (e.g. when the user says "resume my scene" and you remember its sceneId, or from a sceneUrl). Unsaved edits in the current scene are discarded, so saveScene first if they matter.',
    inputSchema: {
      type: 'object',
      properties: {
        sceneId: {
          type: 'string',
          description:
            'Scene UUID, or a 3DStreet URL containing #/scenes/<uuid>.'
        }
      },
      required: ['sceneId']
    },
    mutating: true,
    handler: loadSceneHandler
  }
];
