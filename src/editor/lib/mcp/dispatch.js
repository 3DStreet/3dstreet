/**
 * MCP-side JSON-RPC dispatcher.
 *
 * The relay (separate npm package, see #1582) forwards each MCP frame from
 * Claude verbatim over the local WebSocket. This module unwraps the
 * envelope and routes:
 *
 *   - `tools/list`  → registry tools + MCP-only read tools
 *   - `tools/call`  → registry's `dispatchToolCall` for command-backed
 *                     tools, or local handler for an MCP read tool
 *
 * Result shape mirrors the MCP spec so the relay is a pure pipe — the
 * browser produces the same `{ content: [{ type: 'text', text: ... }] }`
 * envelope Claude expects.
 *
 * Frames are intentionally transport-agnostic. The same envelope flows
 * over localhost today and could flow over a hosted relay tomorrow (open
 * Q #6 in the design doc) without per-transport branching here.
 */

import { getToolDefinitions, dispatchToolCall } from '../commands/registry.js';
import { mcpReadTools } from './readTools.js';
import { mcpSceneTools, saveNudge } from './sceneTools.js';
import useStore from '@/store';

// Modals that merely greet the user and would hide what an agent is doing.
// Anything else (payment, profile, share…) is deliberate and stays open.
const GREETING_MODALS = ['new', 'intro'];
let revealedAgentActivity = false;

/**
 * First remote tool call of the session: dismiss a greeting modal (the
 * "Create a New Scene" dialog shown on a bare load) and switch the right
 * panel to the Console tab so the user can watch the agent's calls stream
 * in. Once per page load — after that the user owns the UI.
 */
function revealAgentActivity() {
  if (revealedAgentActivity) return;
  revealedAgentActivity = true;
  try {
    const {
      modal,
      setModal,
      setRightPanelTab,
      panelsVisible,
      setPanelsVisible
    } = useStore.getState();
    if (GREETING_MODALS.includes(modal)) setModal(null);
    if (!panelsVisible) setPanelsVisible(true);
    setRightPanelTab('console');
  } catch (err) {
    console.warn('[mcp] could not reveal agent activity:', err);
  }
}

// name → { source: 'registry' | 'read', handler? }. Built lazily on first
// frame so the registry has finished initializing.
let toolIndex = null;

function buildToolIndex() {
  const index = new Map();
  for (const tool of getToolDefinitions()) {
    index.set(tool.name, { source: 'registry', definition: tool });
  }
  for (const tool of [...mcpReadTools, ...mcpSceneTools]) {
    if (index.has(tool.name)) {
      throw new Error(
        `MCP read tool name collides with registry tool: ${tool.name}`
      );
    }
    index.set(tool.name, {
      source: 'read',
      // Read-list entries default to non-mutating; undo/redo and the scene
      // persistence tools opt in so the read-only gate blocks them.
      mutating: !!tool.mutating,
      definition: {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      handler: tool.handler
    });
  }
  return index;
}

function ensureIndex() {
  if (!toolIndex) toolIndex = buildToolIndex();
  return toolIndex;
}

/**
 * Returns the unified MCP tool list (registry + reads) as plain JSON
 * Schema, ready to put inside a `tools/list` result.
 */
export function listMCPTools() {
  return Array.from(ensureIndex().values()).map((entry) => entry.definition);
}

/**
 * Wrap a handler return into the MCP `content` array. JSON-stringifies
 * non-string returns; takeSnapshot's image gets a dedicated content type
 * so Claude can see the picture instead of a base64 wall of text.
 */
function toMCPContent(toolName, value) {
  if (toolName === 'takeSnapshot' && value && value.imageData) {
    const dataUrl = value.imageData;
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
    const content = [];
    if (value.caption) {
      content.push({ type: 'text', text: value.caption });
    }
    if (match) {
      content.push({
        type: 'image',
        data: match[2],
        mimeType: match[1]
      });
    } else {
      content.push({ type: 'text', text: '[snapshot data unavailable]' });
    }
    if (value.metadata) {
      content.push({
        type: 'text',
        text: JSON.stringify(value.metadata, null, 2)
      });
    }
    return content;
  }
  if (value === undefined || value === null) {
    return [{ type: 'text', text: '' }];
  }
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }];
  }
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/**
 * Execute one tool and wrap its return as an MCP content array. Shared by
 * the WebSocket relay path (`handleFrame` below) and the in-browser WebMCP
 * path (`useWebMCP`), so both transports stay behavior-identical —
 * including the read-only gate. Throws on unknown tool, read-only block,
 * or handler failure; the caller owns the transport-specific error shape.
 */
const NO_SAVE_NUDGE = new Set(['saveScene', 'loadScene', 'undo', 'redo']);

export async function callToolAsMCPContent(toolName, args, ctx = {}) {
  revealAgentActivity();
  const value = await callTool(toolName, args, ctx.currentUser, {
    readOnly: !!ctx.readOnly
  });
  const content = toMCPContent(toolName, value);
  // Unsaved-edits nudge: a mutation that is not itself persistence gets one
  // trailing line pointing at saveScene while nothing is being autosaved.
  // Agents otherwise built whole streets that vanished on reload.
  const entry = ensureIndex().get(toolName);
  const isMutating = entry.source === 'registry' || entry.mutating;
  if (isMutating && !NO_SAVE_NUDGE.has(toolName)) {
    const nudge = saveNudge(ctx.currentUser);
    if (nudge) content.push({ type: 'text', text: nudge });
  }
  return content;
}

async function callTool(toolName, args, currentUser, options = {}) {
  const entry = ensureIndex().get(toolName);
  if (!entry) {
    const err = new Error(`Unknown tool: ${toolName}`);
    err.code = -32601;
    throw err;
  }
  if (options.readOnly) {
    // The registry contains only mutating tools today (every llmTool is a
    // command). Read-list entries are non-mutating unless flagged.
    const isMutating = entry.source === 'registry' || entry.mutating;
    if (isMutating) {
      const err = new Error(`Read-only mode: ${toolName} blocked`);
      err.code = -32000;
      throw err;
    }
  }
  if (entry.source === 'read') {
    return await entry.handler(args || {}, currentUser);
  }
  return await dispatchToolCall(toolName, args || {}, currentUser);
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: '3dstreet-browser', version: '0.1.0' };

/**
 * Top-level frame handler. Returns the JSON-RPC reply to send back over
 * the WebSocket, or `null` for notifications (no reply expected).
 *
 * @param {object} frame  Parsed JSON-RPC 2.0 frame from the relay.
 * @param {object} ctx    { currentUser, readOnly }.
 */
export async function handleFrame(frame, ctx = {}) {
  const { id, method, params } = frame;
  const isNotification = id === undefined || id === null;

  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message, data) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data ? { data } : {}) }
  });

  try {
    switch (method) {
      case 'initialize': {
        if (isNotification) return null;
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO
        });
      }
      case 'ping': {
        if (isNotification) return null;
        return reply({});
      }
      case 'tools/list': {
        if (isNotification) return null;
        return reply({ tools: listMCPTools() });
      }
      case 'tools/call': {
        if (!params || typeof params.name !== 'string') {
          return fail(-32602, 'tools/call requires params.name');
        }
        const content = await callToolAsMCPContent(
          params.name,
          params.arguments,
          { currentUser: ctx.currentUser, readOnly: ctx.readOnly }
        );
        if (isNotification) return null;
        return reply({ content });
      }
      default: {
        if (isNotification) return null;
        return fail(-32601, `Method not found: ${method}`);
      }
    }
  } catch (err) {
    if (isNotification) {
      console.error('[mcp] notification handler failed:', err);
      return null;
    }
    const code = typeof err.code === 'number' ? err.code : -32000;
    return fail(code, err.message || String(err));
  }
}
