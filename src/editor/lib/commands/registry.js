/**
 * LLM tool registry.
 *
 * Single source of truth for the tools the AI assistants (Vertex AI Gemini
 * today, MCP next per #1582) can call. Tool definitions are plain JSON
 * Schema — provider-neutral and JSON-serializable so a future MCP relay
 * can fetch them over WS and forward to Claude unchanged.
 *
 * Two sources feed the registry:
 *
 * 1. **Command-backed tools.** Any class in `commandsByType` that defines a
 *    `static llmTool = { name, description, inputSchema }` is automatically
 *    exposed. The dispatcher resolves id args to DOM elements, applies the
 *    optional `static transformLLMArgs`, and calls `INSPECTOR.execute(type,
 *    payload)` so every mutation lands in the undo history.
 *
 * 2. **Non-command tools** (`./nonCommandTools.js`). Composite mutations and
 *    read-only/meta operations that don't map 1:1 to a command class.
 *
 * Adding a new command with the three static fields exposes it as a tool with
 * no further wiring — the acceptance criterion from #1594.
 */

import { commandsByType } from './index.js';
import { nonCommandTools } from './nonCommandTools.js';

// class → command type string. Built once from commandsByType.
const commandTypeByClass = new Map();
for (const [type, CommandClass] of commandsByType) {
  commandTypeByClass.set(CommandClass, type);
}

// tool name → dispatch entry. Built once at module load.
const toolEntries = new Map();

for (const CommandClass of commandTypeByClass.keys()) {
  const llmTool = CommandClass.llmTool;
  if (!llmTool) continue;
  if (toolEntries.has(llmTool.name)) {
    throw new Error(`Duplicate LLM tool name: ${llmTool.name}`);
  }
  toolEntries.set(llmTool.name, {
    source: 'command',
    definition: llmTool,
    commandType: commandTypeByClass.get(CommandClass),
    transformLLMArgs: CommandClass.transformLLMArgs
  });
}

for (const tool of nonCommandTools) {
  if (toolEntries.has(tool.name)) {
    throw new Error(`Duplicate LLM tool name: ${tool.name}`);
  }
  toolEntries.set(tool.name, {
    source: 'handler',
    definition: {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    },
    handler: tool.handler
  });
}

/**
 * Returns the unified tool list as plain JSON Schema entries:
 *   [{ name, description, inputSchema }, ...]
 *
 * This is the function the MCP relay (#1582) will call to populate its
 * `tools/list` response.
 */
export function getToolDefinitions() {
  return Array.from(toolEntries.values()).map((entry) => entry.definition);
}

/**
 * Resolve string ids in LLM args to live DOM elements before handing the
 * payload to a command. Convention: any `entityId` becomes `entity`, any
 * `parentId` becomes `parentEl`. Throws if a referenced id is missing.
 *
 * Applied centrally so individual commands don't each repeat the lookup.
 */
function resolveIdRefs(args) {
  const out = { ...args };
  if ('entityId' in out) {
    const el = document.getElementById(out.entityId);
    if (!el) throw new Error(`Entity with ID ${out.entityId} not found`);
    out.entity = el;
    delete out.entityId;
  }
  if ('parentId' in out) {
    const el = document.getElementById(out.parentId);
    if (!el) throw new Error(`Parent with ID ${out.parentId} not found`);
    out.parentEl = el;
    delete out.parentId;
  }
  return out;
}

/**
 * Single execution path for any tool call (Gemini today, MCP tomorrow).
 * Returns whatever the underlying command/handler returns.
 */
export async function dispatchToolCall(toolName, args, currentUser) {
  const entry = toolEntries.get(toolName);
  if (!entry) throw new Error(`Unknown tool: ${toolName}`);

  if (entry.source === 'handler') {
    return await entry.handler(args || {}, currentUser);
  }

  let payload = args || {};
  if (entry.transformLLMArgs) {
    payload = entry.transformLLMArgs(payload);
  }
  payload = resolveIdRefs(payload);
  AFRAME.INSPECTOR.execute(entry.commandType, payload);
  return `${entry.commandType} executed`;
}

/**
 * Returns the tool list for the model's `tools: [{ functionDeclarations }]`
 * slot. `inputSchema` is already plain JSON Schema (the OpenAPI subset the
 * Vertex/Gen AI API accepts), so it passes straight through. The server proxy
 * (generateEditorChat) sanitizes defensively as a backstop.
 */
export function getGeminiFunctionDeclarations() {
  return getToolDefinitions().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }));
}
