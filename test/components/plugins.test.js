/**
 * Contract test every plugin in src/plugins/ must pass (docs/plugins.md).
 * New plugins are picked up automatically; nothing here names a plugin.
 *
 * For each plugin folder:
 * - the manifest is well formed and its id matches the folder,
 * - its declared components register,
 * - its fixture.json scene renders WITHOUT network (saved scenes must load
 *   offline) and without console errors,
 * - save → reload round-trips: an entity rebuilt from the saved attributes
 *   renders the same children,
 * - removing the component leaves no generated children behind.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

const manifests = import.meta.glob('../../src/plugins/*/manifest.json', {
  eager: true,
  import: 'default'
});
const fixtures = import.meta.glob('../../src/plugins/*/fixture.json', {
  eager: true,
  import: 'default'
});
const entryPoints = import.meta.glob('../../src/plugins/*/index.js');

const folderOf = (path) => path.split('/').slice(-2)[0];
const pluginIds = Object.keys(manifests).map(folderOf);

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  for (const load of Object.values(entryPoints)) await load();
  window.AFRAME.emitReady();
});

const nextFrames = (n = 3) =>
  new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    step();
  });

const generatedChildren = (el) =>
  Array.from(el.children).filter((c) => c.classList.contains('autocreated'));

async function entityWith(components) {
  const el = await elFactory();
  for (const [name, value] of Object.entries(components)) {
    el.setAttribute(name, value);
  }
  await nextFrames();
  return el;
}

/**
 * What a scene save keeps for a component: its explicitly set properties,
 * written as an A-Frame style string ("a: 1; b: 2"), as convertDOMElToObject
 * does.
 */
const savedAttributes = (el, names) =>
  Object.fromEntries(
    names.map((n) => [
      n,
      window.AFRAME.utils.styleParser.stringify(el.getDOMAttribute(n))
    ])
  );

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('a-scene').forEach((s) => s.remove());
});

it('finds at least one plugin', () => {
  expect(pluginIds.length).toBeGreaterThan(0);
});

describe.each(pluginIds)('plugin %s', (id) => {
  const manifest = manifests[`../../src/plugins/${id}/manifest.json`];
  const fixture = fixtures[`../../src/plugins/${id}/fixture.json`];

  it('has a well-formed manifest', () => {
    expect(manifest.id).toBe(id);
    expect(typeof manifest.name).toBe('string');
    expect(['labs', 'stable']).toContain(manifest.status);
    expect(Array.isArray(manifest.components)).toBe(true);
  });

  it('registers its declared components', () => {
    for (const name of manifest.components) {
      expect(window.AFRAME.components[name], name).toBeDefined();
    }
  });

  it('ships a fixture scene', () => {
    expect(fixture, `src/plugins/${id}/fixture.json`).toBeDefined();
  });

  it('renders its fixture offline, round-trips, and cleans up', async () => {
    if (!fixture) return;
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockRejectedValue(new Error('network disabled in plugin tests'));
    const errorSpy = vi.spyOn(console, 'error');
    const names = Object.keys(fixture.components);

    const el = await entityWith(fixture.components);
    const children = generatedChildren(el);
    if (fixture.expect?.children !== undefined) {
      expect(children).toHaveLength(fixture.expect.children);
    }
    if (fixture.expect?.childMixins) {
      expect(children.map((c) => c.getAttribute('mixin'))).toEqual(
        fixture.expect.childMixins
      );
    }

    // Save → reload: rebuild from exactly what a save would keep.
    const reloaded = await entityWith(savedAttributes(el, names));
    const reloadedChildren = generatedChildren(reloaded);
    expect(reloadedChildren).toHaveLength(children.length);
    reloadedChildren.forEach((child, i) => {
      expect(child.getAttribute('mixin')).toBe(
        children[i].getAttribute('mixin')
      );
      expect(child.getAttribute('position')).toEqual(
        children[i].getAttribute('position')
      );
    });

    // Removing the component removes everything it generated.
    names.forEach((n) => el.removeAttribute(n));
    await nextFrames();
    expect(generatedChildren(el)).toHaveLength(0);

    // Let any debounced work fire before checking the network was untouched.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
