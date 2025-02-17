export function Config(overrides) {
  return {
    // Keep the inspector perspective camera position in sync with the A-Frame active camera.
    copyCameraPosition: false,
    // Debug undo/redo
    debugUndoRedo: false,
    // Default parent to add new elements to
    defaultParent: '#street-container',
    ...overrides
  };
}
