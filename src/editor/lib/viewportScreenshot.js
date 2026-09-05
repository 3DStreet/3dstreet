/**
 * Capture the current editor viewport as a small JPEG for the AI assistant.
 *
 * Unlike the takeSnapshot chat tool (nonCommandTools.js) this never moves the
 * camera and adds no title/logo overlay — it grabs exactly what the user sees,
 * minus the inspector helpers (gizmos, grid), downscaled to keep the callable
 * payload small. Returns { mimeType, data } with bare base64 (no data: prefix),
 * or null when capture isn't possible — callers degrade to text-only.
 */
export function captureViewportScreenshot({
  maxDim = 1024,
  quality = 0.7
} = {}) {
  try {
    const scene = AFRAME.scenes[0];
    if (!scene || !scene.renderer || !scene.camera) return null;
    const renderer = scene.renderer;

    const inspector = AFRAME.INSPECTOR;
    const hideHelpers = inspector && inspector.opened && inspector.sceneHelpers;
    if (hideHelpers) inspector.sceneHelpers.visible = false;
    try {
      // Re-render right before reading pixels — the drawing buffer isn't
      // preserved between frames (same pattern as takeSnapshot).
      renderer.render(scene.object3D, scene.camera);

      const src = renderer.domElement;
      if (!src.width || !src.height) return null;
      const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(src.width * scale));
      canvas.height = Math.max(1, Math.round(src.height * scale));
      canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1];
      if (!base64) return null;
      return { mimeType: 'image/jpeg', data: base64 };
    } finally {
      if (hideHelpers) inspector.sceneHelpers.visible = true;
    }
  } catch (err) {
    console.warn('[viewportScreenshot] capture failed:', err);
    return null;
  }
}
