import { vi } from 'vitest';
import * as THREE from 'three';
import { Viewport } from '@/editor/lib/viewport.js';

// A viewport mounted on a bare scene: no A-Frame, no renderer, the store,
// raycaster and camera controls mocked by the importing test file (vi.mock is
// per test file, so each keeps its own copy of those mocks). `dispose()`
// takes the gizmos' window listeners and timers down again.
export function mountViewport() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const sceneEl = document.createElement('a-scene');
  document.body.append(sceneEl);
  sceneEl.object3D = new THREE.Scene();
  sceneEl.renderer = { render: vi.fn() };
  sceneEl.canvas = canvas;
  sceneEl.systems = {};
  const inspector = {
    sceneEl,
    container: canvas,
    sceneHelpers: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    helpers: {},
    opened: true,
    execute: vi.fn()
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector });
  Viewport(inspector);
  function dispose() {
    inspector.easyGizmoControls.dispose();
    inspector.groupStockGesture.dispose();
    inspector.shapeVertexControls.dispose();
    inspector.streetNodeControls.dispose();
    inspector.segmentWidthControls.dispose();
  }
  return { inspector, sceneEl, dispose };
}

export function entity(parentEl) {
  const el = document.createElement('a-entity');
  parentEl.append(el);
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.components = {};
  el.getObject3D = () => undefined;
  const nativeSet = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    if (name === 'position') {
      el.object3D.position.set(value.x, value.y, value.z);
    } else if (name === 'rotation') {
      el.object3D.rotation.set(
        THREE.MathUtils.degToRad(value.x),
        THREE.MathUtils.degToRad(value.y),
        THREE.MathUtils.degToRad(value.z)
      );
    } else nativeSet(name, value);
  };
  const nativeGet = el.getAttribute.bind(el);
  el.getAttribute = (name) => {
    if (name === 'position') return el.object3D.position.clone();
    if (name === 'rotation') {
      const d = THREE.MathUtils.radToDeg;
      const { x, y, z } = el.object3D.rotation;
      return { x: d(x), y: d(y), z: d(z) };
    }
    return nativeGet(name);
  };
  parentEl.object3D.add(el.object3D);
  return el;
}
