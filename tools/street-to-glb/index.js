// street-to-glb — DOM-free Node assembler: managed-street JSON -> GLB Buffer.
//
//   import { streetToGlb } from './index.js';
//   const glb = await streetToGlb(streetJson);   // -> Buffer
//
// Pure THREE + GLTFExporter (no A-Frame, no jsdom). Deterministic for a fixed
// seed on random/fit content, so the same JSON always yields byte-stable GLB —
// the property the render endpoint's content-hash cache relies on.

import { THREE, GLTFExporter } from './src/three-node.js';
import { assembleStreet } from './src/assemble.js';

export { assembleStreet };

/**
 * @param {object} payload - managed-street JSON: bare {name,length,segments}
 *                           or {street, options}.
 * @param {object} [opts]  - { boundaries, vehicles, striping } visibility
 *                           toggles (default all true).
 * @returns {Promise<{ buffer: Buffer, meta: object }>}
 */
export async function streetToGlbWithMeta(payload, opts = {}) {
  const { scene, meta } = await assembleStreet(payload, opts);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, onlyVisible: false }
    );
  });
  return { buffer: Buffer.from(glb), meta };
}

/** Convenience wrapper returning just the GLB Buffer. */
export async function streetToGlb(payload, opts = {}) {
  const { buffer } = await streetToGlbWithMeta(payload, opts);
  return buffer;
}

export { THREE };
