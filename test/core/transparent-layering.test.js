/* global describe, it */

/**
 * Transparent-pass layering around splats (#1732, #1754): the splat slot
 * sits between ordinary content and the overlay band, translucent reference
 * layers become overlays, and blended glTF cutouts get depth writes while
 * glass keeps the loader's defaults.
 */

import assert from 'assert';
import {
  SPLAT_RENDER_ORDER,
  REFERENCE_OVERLAY_RENDER_ORDER,
  CUTOUT_ALPHA_TEST,
  referenceLayerRenderOrder,
  applyReferenceLayerOpacity,
  applyBlendedSurfaceDepth,
  applyBlendedSurfaceDepthToObject
} from '../../src/tested/transparent-layering.js';

// Minimal Object3D stand-in: traverse visits self then children.
function node(material, children = []) {
  return {
    material,
    renderOrder: 0,
    children,
    traverse(cb) {
      cb(this);
      for (const child of this.children) child.traverse(cb);
    }
  };
}

function material(props = {}) {
  return {
    transparent: false,
    opacity: 1,
    depthWrite: true,
    alphaTest: 0,
    needsUpdate: false,
    ...props
  };
}

// GLTFLoader's output for alphaMode BLEND: transparent, no depth write.
function blended(props = {}) {
  return material({ transparent: true, depthWrite: false, ...props });
}

describe('transparent layering constants', () => {
  it('slots splats after ordinary content and before the overlay band', () => {
    assert.ok(SPLAT_RENDER_ORDER > 0);
    assert.ok(SPLAT_RENDER_ORDER < 1);
  });

  it('slots translucent reference layers after the splats', () => {
    assert.ok(REFERENCE_OVERLAY_RENDER_ORDER > SPLAT_RENDER_ORDER);
    assert.ok(REFERENCE_OVERLAY_RENDER_ORDER < 1);
  });
});

describe('referenceLayerRenderOrder', () => {
  it('is the overlay slot while translucent and 0 while opaque', () => {
    assert.strictEqual(
      referenceLayerRenderOrder(0.3),
      REFERENCE_OVERLAY_RENDER_ORDER
    );
    assert.strictEqual(referenceLayerRenderOrder(1), 0);
  });
});

describe('applyReferenceLayerOpacity', () => {
  it('makes every material translucent and every mesh an overlay', () => {
    const inner = material();
    const arrayA = material();
    const arrayB = material();
    const group = node(null, [node(inner), node([arrayA, arrayB])]);

    applyReferenceLayerOpacity(group, 0.3);

    for (const m of [inner, arrayA, arrayB]) {
      assert.strictEqual(m.transparent, true);
      assert.strictEqual(m.opacity, 0.3);
      assert.strictEqual(m.needsUpdate, true);
      // Depth writes stay on: a translucent layer still occludes itself.
      assert.strictEqual(m.depthWrite, true);
    }
    assert.strictEqual(group.renderOrder, 0); // no material: untouched
    for (const child of group.children) {
      assert.strictEqual(child.renderOrder, REFERENCE_OVERLAY_RENDER_ORDER);
    }
  });

  it('returns to opaque and the default order at opacity 1', () => {
    const m = material();
    const mesh = node(m);
    applyReferenceLayerOpacity(mesh, 0.3);
    m.needsUpdate = false;
    applyReferenceLayerOpacity(mesh, 1);
    assert.strictEqual(m.transparent, false);
    assert.strictEqual(m.opacity, 1);
    assert.strictEqual(m.needsUpdate, true);
    assert.strictEqual(mesh.renderOrder, 0);
  });

  it('only flags a recompile when the transparent flag actually flips', () => {
    const m = material({ transparent: true, opacity: 0.5 });
    applyReferenceLayerOpacity(node(m), 0.3);
    assert.strictEqual(m.needsUpdate, false);
    assert.strictEqual(m.opacity, 0.3);
  });
});

describe('applyBlendedSurfaceDepth', () => {
  it('gives a blended cutout (textured, factor alpha 1) a depth write and alpha test', () => {
    const m = blended({ map: {} });
    assert.strictEqual(applyBlendedSurfaceDepth(m), true);
    assert.strictEqual(m.depthWrite, true);
    assert.strictEqual(m.alphaTest, CUTOUT_ALPHA_TEST);
    assert.strictEqual(m.transparent, true); // still blends its soft edges
    assert.strictEqual(m.needsUpdate, true);
  });

  it('treats a mostly opaque untextured blend as a surface too', () => {
    const m = blended({ opacity: 0.84 });
    assert.strictEqual(applyBlendedSurfaceDepth(m), true);
    assert.strictEqual(m.depthWrite, true);
  });

  it('leaves glass alone', () => {
    const m = blended({ opacity: 0.3 });
    assert.strictEqual(applyBlendedSurfaceDepth(m), false);
    assert.strictEqual(m.depthWrite, false);
    assert.strictEqual(m.alphaTest, 0);
    assert.strictEqual(m.needsUpdate, false);
  });

  it('leaves opaque and already depth-writing materials alone', () => {
    const opaque = material();
    assert.strictEqual(applyBlendedSurfaceDepth(opaque), false);
    assert.strictEqual(opaque.alphaTest, 0);
    const writing = material({ transparent: true, opacity: 0.9 });
    assert.strictEqual(applyBlendedSurfaceDepth(writing), false);
    assert.strictEqual(writing.alphaTest, 0);
    assert.strictEqual(applyBlendedSurfaceDepth(null), false);
  });

  it('keeps a stricter alpha test the asset already had', () => {
    const m = blended({ alphaTest: 0.5 });
    applyBlendedSurfaceDepth(m);
    assert.strictEqual(m.alphaTest, 0.5);
  });

  it('is idempotent', () => {
    const m = blended({ map: {} });
    applyBlendedSurfaceDepth(m);
    m.needsUpdate = false;
    assert.strictEqual(applyBlendedSurfaceDepth(m), false);
    assert.strictEqual(m.needsUpdate, false);
  });
});

describe('applyBlendedSurfaceDepthToObject', () => {
  it('visits single and array materials across the subtree', () => {
    const cutout = blended({ map: {} });
    const glass = blended({ opacity: 0.2 });
    const petals = blended({ opacity: 0.84 });
    const root = node(null, [node(cutout), node([glass, petals])]);
    applyBlendedSurfaceDepthToObject(root);
    assert.strictEqual(cutout.depthWrite, true);
    assert.strictEqual(glass.depthWrite, false);
    assert.strictEqual(petals.depthWrite, true);
  });
});
