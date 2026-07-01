/**
 * Returns true when the given event target (or the current active element) is
 * an editable field — a text input, textarea, select, or contenteditable node.
 *
 * Used by modal keyboard handlers that listen in the capture phase: arrow keys
 * must move the text cursor / caret when the user is typing, not trigger
 * asset navigation or other global shortcuts.
 */
export function isEditableTarget(target) {
  const el =
    target || (typeof document !== 'undefined' && document.activeElement);
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
