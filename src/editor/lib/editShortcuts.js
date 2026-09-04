import { getOS } from './utils.js';

// Keyboard hints shown in the right slot of menu items (AppMenu's Edit/View
// menus and the scene graph's right-click context menu). Display-only: the
// actual bindings live in shortcuts.js.
const isMac = getOS() === 'macos';

export const editShortcuts = {
  undo: isMac ? '⌘Z' : 'Ctrl+Z',
  redo: isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z',
  cut: isMac ? '⌘X' : 'Ctrl+X',
  copy: isMac ? '⌘C' : 'Ctrl+C',
  paste: isMac ? '⌘V' : 'Ctrl+V',
  duplicate: 'D',
  delete: isMac ? '⌫' : 'Del',
  deselect: 'Esc',
  focus: 'F'
};
