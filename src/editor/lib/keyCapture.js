/**
 * Whether a key event belongs to the editor's own keymap rather than to
 * whatever currently has focus.
 *
 * Its own module because two layers apply it: the shortcut map, and the
 * easy-mode gizmo, which swallows keys for the duration of a held press and
 * without this test would eat text typed into a properties-panel field while a
 * gesture happened to be live. One rule, one place, so the two cannot drift.
 */
export function shouldCaptureKeyEvent(event) {
  // A menu item is a plain div, so the tag test below admits it — and menus
  // implement typeahead, so typing a letter to jump to an item would also fire
  // the global shortcut of that letter, which re-renders or closes the menu
  // being navigated.
  if (event.target.closest && event.target.closest('[role="menu"]')) {
    return false;
  }
  return (
    event.target.closest('#cameraToolbar') ||
    (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA')
  );
}
