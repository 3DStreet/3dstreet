/* global THREE */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TileFlatteningPlugin } from '3d-tiles-renderer/plugins';
import { EasyGizmoProbe } from '@/editor/lib/gizmos/easyGizmoProbe.js';

let componentDefinition;
let systemDefinition;
beforeAll(async () => {
  vi.stubGlobal('AFRAME', {
    THREE,
    registerComponent: (name, definition) => {
      componentDefinition = definition;
    },
    registerSystem: (name, definition) => {
      systemDefinition = definition;
    }
  });
  await import('@/aframe-components/geo-flatten.js');
  vi.unstubAllGlobals();
});
afterEach(() => document.body.replaceChildren());

describe('placement excludes its own terrain flattening', () => {
  it('waits for tile regeneration, then probes original terrain without feedback', () => {
    const sceneEl = document.createElement('div');
    sceneEl.object3D = new THREE.Scene();
    sceneEl.emit = (name) => sceneEl.dispatchEvent(new Event(name));
    document.body.append(sceneEl);
    const system = { ...systemDefinition, el: sceneEl };
    system.init();

    const selected = document.createElement('div');
    selected.setAttribute('managed-street', '');
    selected.setAttribute('geo-flatten', 'mode: auto');
    sceneEl.append(selected);
    selected.object3D = new THREE.Group();
    selected.object3D.el = selected;
    selected.object3D.position.y = 5;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 8));
    slab.position.y = -1;
    selected.object3D.add(slab);
    sceneEl.object3D.add(selected.object3D);
    const component = {
      ...componentDefinition,
      el: selected,
      system,
      data: { enabled: true, mode: 'auto' }
    };
    selected.components = { 'geo-flatten': component };
    component.init();

    const layerEl = document.createElement('div');
    layerEl.id = 'google3d';
    layerEl.setAttribute('google-maps-aerial', '');
    sceneEl.append(layerEl);
    const terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial()
    );
    terrain.geometry.rotateX(-Math.PI / 2);
    terrain.geometry.translate(0, 10, 0);
    terrain.el = layerEl;
    const tiles = new THREE.EventDispatcher();
    tiles.group = new THREE.Group();
    tiles.group.matrixWorldInverse = new THREE.Matrix4();
    tiles.group.add(terrain);
    sceneEl.object3D.add(tiles.group);
    tiles.activeTiles = new Set([{ engineData: { scene: tiles.group } }]);
    const plugin = new TileFlatteningPlugin();
    plugin.init(tiles);
    const layer = {
      flattenRegistryDirty: false,
      flatteningPlugin: plugin,
      flattenEntries: new Map([[component, {}]])
    };
    layerEl.components = { 'google-maps-aerial': layer };
    sceneEl.addEventListener('geo-flatten-registry-changed', () => {
      layer.flattenRegistryDirty = true;
    });
    sceneEl.object3D.updateMatrixWorld(true);
    const source = component.getFlattenMesh();
    const shape = source.clone();
    source.matrixWorld.decompose(shape.position, shape.quaternion, shape.scale);
    plugin.addShape(shape, new THREE.Vector3(0, -1, 0));
    tiles.dispatchEvent({ type: 'update-before' });
    expect(terrain.geometry.attributes.position.getY(0)).toBeCloseTo(5, 6);

    const probe = new EasyGizmoProbe(sceneEl);
    probe.excludeEl = selected;
    probe.setFlatteningSuspended(true);
    expect(component.isActive()).toBe(false);
    expect(component.data.enabled).toBe(true);
    // Removing the pending-regeneration gate makes the old 5 m terrain eligible.
    expect(probe.probeColumn(0, 0, 5.15).below).toBeNull();
    plugin.deleteShape(shape);
    layer.flattenEntries.delete(component);
    // An unrelated empty volume may keep registryDirty true without blocking terrain.
    expect(probe.probeColumn(0, 0, 5.15).below).toBeNull();
    tiles.dispatchEvent({ type: 'update-before' });
    expect(probe.probeColumn(0, 0, 5.15).above.y).toBeCloseTo(10, 6);
    expect(probe.lastHits.every((hit) => hit.point.y === 10)).toBe(true);

    selected.object3D.position.y = 1;
    sceneEl.object3D.updateMatrixWorld(true);
    tiles.dispatchEvent({ type: 'update-before' });
    expect(probe.probeColumn(0, 0, 1.15).above.y).toBeCloseTo(10, 6);
    expect(terrain.geometry.attributes.position.getY(0)).toBeCloseTo(10, 6);
    probe.dispose();
    expect(component.isActive()).toBe(true);
    expect(layer.flattenRegistryDirty).toBe(true);
    component.remove();
    plugin.dispose();
  });
});
