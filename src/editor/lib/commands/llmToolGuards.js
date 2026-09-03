/**
 * Shared id → entity resolution for LLM-facing tools.
 *
 * The LLM surfaces (in-editor chat, MCP relay, WebMCP) can name any DOM id.
 * `resolveEntityId` is the plain lookup (read tools use it as-is);
 * `getEditableEntity` additionally keeps the target inside the user-editable
 * scene — the three roots getScene serializes and the Save button writes
 * (#street-container, #environment, #reference-layers) — so an agent cannot
 * mutate editor chrome, cameras, or helper entities. The registry applies
 * the editable check to every command-backed tool's `entityId` centrally
 * (`static llmAllowRootTarget = true` opts a command into targeting a root
 * itself). Throwing here surfaces a clean tool error the model can read and
 * correct, instead of a silent no-op (the tool would still report
 * "executed") or a broken editor.
 */
export const EDITABLE_ROOT_IDS = [
  'street-container',
  'environment',
  'reference-layers'
];

export function resolveEntityId(entityId, role = 'entity') {
  if (!entityId) throw new Error(`${role}Id is required`);
  const el = document.getElementById(entityId);
  if (!el) throw new Error(`Entity with ID ${entityId} not found`);
  if (!el.isEntity) {
    throw new Error(`DOM id ${entityId} is not an A-Frame entity`);
  }
  return el;
}

export function getEditableEntity(entityId, options = {}) {
  const { allowRoot = false, role = 'entity' } = options;
  const el = resolveEntityId(entityId, role);
  const roots = EDITABLE_ROOT_IDS.map((id) => document.getElementById(id));
  if (roots.includes(el)) {
    if (!allowRoot) {
      throw new Error(
        `Entity ${entityId} is a scene root (#${el.id}) and cannot be the target of this operation`
      );
    }
    return el;
  }
  if (!roots.some((root) => root && root.contains(el))) {
    throw new Error(
      `Entity ${entityId} is outside the editable scene (#${EDITABLE_ROOT_IDS.join(', #')}) — tools may only modify scene content`
    );
  }
  return el;
}
