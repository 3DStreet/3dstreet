/**
 * Shared validation for LLM-facing command args (`static transformLLMArgs`).
 *
 * The LLM surfaces (in-editor chat, MCP relay, WebMCP) can name any DOM id;
 * these guards keep destructive tool calls inside the user-editable scene
 * subtree — #street-container, the same root getScene serializes and the
 * Save button writes — so an agent cannot remove or reparent editor chrome,
 * cameras, or helper entities. Throwing here surfaces a clean tool error
 * the model can read and correct, instead of a silent no-op (the tool would
 * still report "executed") or a broken editor.
 */
export function getEditableEntity(entityId, options = {}) {
  const { allowRoot = false, role = 'entity' } = options;
  if (!entityId) throw new Error(`${role}Id is required`);
  const el = document.getElementById(entityId);
  if (!el) throw new Error(`Entity with ID ${entityId} not found`);
  if (!el.isEntity) {
    throw new Error(`DOM id ${entityId} is not an A-Frame entity`);
  }
  const root = document.getElementById('street-container');
  if (!root) throw new Error('street-container not found');
  if (el === root) {
    if (!allowRoot) {
      throw new Error(
        `Entity ${entityId} is the scene root (#street-container) and cannot be the target of this operation`
      );
    }
    return el;
  }
  if (!root.contains(el)) {
    throw new Error(
      `Entity ${entityId} is outside the editable scene (#street-container) — tools may only modify scene content`
    );
  }
  return el;
}
