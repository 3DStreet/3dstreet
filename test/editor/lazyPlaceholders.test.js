import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  applyLazyPlaceholder,
  clearLazyPlaceholder,
  getAssetPlaceholderColor,
  installMaterialPlaceholders
} from '@/lazy-textures';

function lazyImg(id, placeholder) {
  const img = document.createElement('img');
  img.id = id;
  img.setAttribute('data-src', `https://cdn/${id}.jpg`);
  if (placeholder) img.setAttribute('data-placeholder', placeholder);
  // jsdom: pending = not complete, no natural size.
  Object.defineProperty(img, 'complete', { value: false, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
  return img;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function markReady(img) {
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', {
    value: 1024,
    configurable: true
  });
}

// Stand-in for A-Frame's material component: el (with sceneEl), data, material.
function fakeComponent(src, { color = 'white', visible = true } = {}) {
  const sceneEl = document.createElement('div');
  const el = document.createElement('div');
  el.sceneEl = sceneEl;
  return {
    el,
    data: { src, color, visible },
    material: { color: new THREE.Color(color), visible }
  };
}

const linear = (hex) => new THREE.Color(hex);
const near = (a, b) => {
  expect(a.r).toBeCloseTo(b.r, 5);
  expect(a.g).toBeCloseTo(b.g, 5);
  expect(a.b).toBeCloseTo(b.b, 5);
};

describe('getAssetPlaceholderColor', () => {
  it('returns the hex, null for transparent or missing', () => {
    expect(getAssetPlaceholderColor(lazyImg('a', '#72726c'))).toBe('#72726c');
    expect(getAssetPlaceholderColor(lazyImg('b', 'transparent'))).toBeNull();
    expect(getAssetPlaceholderColor(lazyImg('c'))).toBeNull();
    expect(getAssetPlaceholderColor(null)).toBeNull();
  });
});

describe('applyLazyPlaceholder', () => {
  it('tints an opaque surface with placeholder × material color, restores on load', () => {
    const img = lazyImg('seamless-road', '#72726c');
    const comp = fakeComponent(img, { color: '#ffcc88' });
    expect(applyLazyPlaceholder(comp, THREE.Color)).toBe(true);
    near(comp.material.color, linear('#72726c').multiply(linear('#ffcc88')));
    expect(comp.material.visible).toBe(true);

    // A child's event must not settle the parent.
    const child = document.createElement('div');
    comp.el.appendChild(child);
    child.dispatchEvent(
      new CustomEvent('materialtextureloaded', { bubbles: true })
    );
    near(comp.material.color, linear('#72726c').multiply(linear('#ffcc88')));

    markReady(img);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    near(comp.material.color, linear('#ffcc88'));
    expect(comp._lazyPlaceholder).toBeNull();
  });

  it('hides a cutout (transparent placeholder) and restores visibility', () => {
    const img = lazyImg('stencils-atlas', 'transparent');
    const comp = fakeComponent(img);
    applyLazyPlaceholder(comp, THREE.Color);
    expect(comp.material.visible).toBe(false);
    near(comp.material.color, linear('white'));
    markReady(img);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    expect(comp.material.visible).toBe(true);
  });

  it('respects an authored visible:false on restore', () => {
    const img = lazyImg('stencils-atlas', 'transparent');
    const comp = fakeComponent(img, { visible: false });
    applyLazyPlaceholder(comp, THREE.Color);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    expect(comp.material.visible).toBe(false);
  });

  it('is a no-op for ready images, urls and images without a placeholder', () => {
    const ready = lazyImg('ready', '#72726c');
    markReady(ready);
    const comp = fakeComponent(ready);
    expect(applyLazyPlaceholder(comp, THREE.Color)).toBe(false);
    near(comp.material.color, linear('white'));

    const url = fakeComponent('https://cdn/plain.jpg');
    expect(applyLazyPlaceholder(url, THREE.Color)).toBe(false);

    const bare = fakeComponent(lazyImg('bare'));
    expect(applyLazyPlaceholder(bare, THREE.Color)).toBe(false);
    expect(bare._lazyPlaceholder).toBeUndefined();
  });

  it('re-applies after an update reset the color, without stacking listeners', () => {
    const img = lazyImg('seamless-road', '#72726c');
    const comp = fakeComponent(img);
    applyLazyPlaceholder(comp, THREE.Color);
    const state = comp._lazyPlaceholder;
    // A-Frame's update wrote the authored color back and changed it.
    comp.data.color = '#00ff00';
    comp.material.color.set('#00ff00');
    applyLazyPlaceholder(comp, THREE.Color);
    expect(comp._lazyPlaceholder).toBe(state);
    near(comp.material.color, linear('#72726c').multiply(linear('#00ff00')));
    markReady(img);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    near(comp.material.color, linear('#00ff00'));
  });

  it('swaps listeners when the src changes while pending', () => {
    const a = lazyImg('a', '#111111');
    const b = lazyImg('b', '#eeeeee');
    const comp = fakeComponent(a);
    applyLazyPlaceholder(comp, THREE.Color);
    comp.data.src = b;
    applyLazyPlaceholder(comp, THREE.Color);
    expect(comp._lazyPlaceholder.img).toBe(b);
    near(comp.material.color, linear('#eeeeee'));
    // The first image loading no longer matters; only b landing restores.
    markReady(a);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    near(comp.material.color, linear('#eeeeee'));
    markReady(b);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    near(comp.material.color, linear('white'));
  });

  it('keeps the placeholder but drops listeners when the image fails', async () => {
    const img = lazyImg('broken', 'transparent');
    img.setAttribute('src', img.getAttribute('data-src'));
    const comp = fakeComponent(img);
    applyLazyPlaceholder(comp, THREE.Color);
    expect(comp._lazyPlaceholder).not.toBeNull();
    img.dispatchEvent(new Event('error'));
    await flush();
    expect(comp._lazyPlaceholder).toBeNull();
    expect(comp.material.visible).toBe(false);
  });

  it('drops listeners right away for an image that already failed', async () => {
    // A later material sharing a broken image: complete, no natural size,
    // and no further error event will ever fire.
    const img = lazyImg('broken', '#333333');
    img.setAttribute('src', img.getAttribute('data-src'));
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    const comp = fakeComponent(img);
    expect(applyLazyPlaceholder(comp, THREE.Color)).toBe(true);
    await flush();
    expect(comp._lazyPlaceholder).toBeNull();
    near(comp.material.color, linear('#333333'));
  });

  it('ignores materialtextureloaded for another map while its image is pending', () => {
    const img = lazyImg('seamless-road', '#72726c');
    const comp = fakeComponent(img);
    applyLazyPlaceholder(comp, THREE.Color);
    // e.g. a normal map landing first
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    expect(comp._lazyPlaceholder).not.toBeNull();
    near(comp.material.color, linear('#72726c'));
    markReady(img);
    comp.el.dispatchEvent(new CustomEvent('materialtextureloaded'));
    expect(comp._lazyPlaceholder).toBeNull();
    near(comp.material.color, linear('white'));
  });

  it('clearLazyPlaceholder is safe without state', () => {
    expect(() => clearLazyPlaceholder({})).not.toThrow();
  });
});

describe('installMaterialPlaceholders', () => {
  it('wraps update/remove once and applies the placeholder after update', () => {
    const update = vi.fn(function () {
      this.material.color.set(this.data.color);
    });
    const remove = vi.fn();
    class Material {}
    Material.prototype.update = update;
    Material.prototype.remove = remove;
    expect(installMaterialPlaceholders(Material)).toBe(true);
    expect(installMaterialPlaceholders(Material)).toBe(false);
    expect(installMaterialPlaceholders(undefined)).toBe(false);

    const img = lazyImg('seamless-road', '#72726c');
    const comp = Object.assign(new Material(), fakeComponent(img));
    comp.update({});
    expect(update).toHaveBeenCalledTimes(1);
    near(comp.material.color, linear('#72726c'));
    comp.remove();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(comp._lazyPlaceholder).toBeNull();
  });
});
