// Editor lines drawn with three's screen-space "fat" lines: WebGL ignores
// LineBasicMaterial.linewidth (always 1px), so the selection and hover helpers,
// the group outline and the shape tool's snap guide render LineSegments2 at
// HIGHLIGHT_LINE_PX. LineMaterial needs the viewport size to convert pixels to
// clip space. Every material is registered so the viewport's resize handler
// can refresh them; LineSegments2 also sets its material's resolution from the
// renderer's viewport on every draw, so a material created after start-up
// draws at the right width too.

import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const HIGHLIGHT_LINE_PX = 2;
const fatLineMaterials = new Set();

export function createFatLineMaterial(color) {
  const material = new LineMaterial({
    color,
    linewidth: HIGHLIGHT_LINE_PX,
    transparent: true,
    depthTest: false
  });
  fatLineMaterials.add(material);
  return material;
}

// For a material about to be disposed: the resize handler stops updating it.
export function releaseFatLineMaterial(material) {
  fatLineMaterials.delete(material);
}

// CSS pixels, deliberately: the renderer draws at devicePixelRatio, so
// HIGHLIGHT_LINE_PX comes out as CSS pixels, not device pixels. Guarded
// against a not-yet-laid-out container (0 would divide by zero in the
// shader and hide the lines until the first resize).
export function setFatLineResolution(width, height) {
  const w = Math.max(1, width || 0);
  const h = Math.max(1, height || 0);
  fatLineMaterials.forEach((m) => m.resolution.set(w, h));
}

// Set a LineSegments2's segments from flat xyz pairs. When the segment
// count is unchanged the existing interleaved instance buffer is written in
// place (the box case: 12 segments, updated on every drag frame); otherwise
// the geometry is rebuilt.
export function setFatLinePositions(lines, positions) {
  const buffer = lines.geometry.attributes.instanceStart?.data;
  if (buffer && buffer.array.length === positions.length) {
    buffer.array.set(positions);
    buffer.needsUpdate = true;
    lines.geometry.computeBoundingBox();
    lines.geometry.computeBoundingSphere();
    return;
  }
  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry().setPositions(positions);
}
