import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { installEasyGizmoOutline } from '@/editor/lib/gizmos/easyGizmoOutline.js';

function fixture() {
  const scene = new THREE.Scene();
  const controls = new THREE.Group();
  controls.arcGroup = new THREE.Group();
  controls.add(controls.arcGroup);
  controls.enabled = true;
  controls.object = new THREE.Object3D();
  controls.axis = 'rotate';
  controls._lastPointerType = 'mouse';
  const geometry = new THREE.BoxGeometry(2, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 'cyan',
    opacity: 0.7,
    transparent: true
  });
  controls.arcHalfA = new THREE.Mesh(geometry, material);
  controls.arcHalfB = new THREE.Mesh(geometry, material);
  controls.arcHalfB.position.x = 2;
  controls.arcGroup.add(controls.arcHalfA, controls.arcHalfB);
  controls.arcGroup.add(
    new THREE.Mesh(new THREE.ConeGeometry(0.5, 1), material),
    new THREE.Mesh(new THREE.CircleGeometry(0.5), material)
  );
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(1000, 1000, 1000),
    material
  );
  proxy.userData.isPickProxy = true;
  proxy.visible = false;
  controls.arcGroup.add(proxy);
  scene.add(controls);
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 1000);
  camera.position.set(0, 3, 15);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  let target = null;
  let color = new THREE.Color(0x234567);
  let alpha = 0.8;
  const calls = [];
  const renderer = {
    autoClear: true,
    xr: { enabled: true, isPresenting: false },
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((value) => {
      target = value;
    }),
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (out) => out.copy(color),
    getClearAlpha: () => alpha,
    setClearColor: (value, a) => {
      color = new THREE.Color(value);
      alpha = a;
    },
    getPixelRatio: () => 1,
    getCurrentViewport: (out) => out.set(0, 0, 1200, 800),
    clear: vi.fn(),
    render: vi.fn((rendered, cam) => {
      rendered.updateMatrixWorld();
      calls.push({
        rendered,
        camera: cam.clone(),
        target,
        near: cam.near,
        far: cam.far,
        surfaces: rendered.children
          .filter((o) => o.isMesh)
          .map((o) => ({
            depthTest: o.material.depthTest,
            depthWrite: o.material.depthWrite,
            colorWrite: o.material.colorWrite,
            red: o.material.color.r
          })),
        arcVisible: controls.arcGroup.visible,
        material: rendered.isMesh ? rendered.material : null
      });
    })
  };
  const original = renderer.render;
  const overlay = installEasyGizmoOutline(
    { renderer, object3D: scene },
    controls
  );
  return { controls, scene, camera, renderer, original, overlay, calls };
}

describe('cyan-only depth overlay', () => {
  it('renders only eligible cyan surfaces into bounded targets and restores state', () => {
    const f = fixture();
    f.renderer.render(f.scene, f.camera);
    expect(f.calls).toHaveLength(5);
    expect(f.calls[0].arcVisible).toBe(false);
    const privateScene = f.calls[1].rendered;
    expect(privateScene.children.filter((o) => o.isMesh)).toHaveLength(4);
    const target = f.calls[1].target;
    expect(target.width).toBeLessThan(1200);
    expect(target.height).toBeLessThan(800);
    expect(target.width).toBeGreaterThan(0);
    expect(f.renderer.getRenderTarget()).toBe(null);
    expect(f.renderer.autoClear).toBe(true);
    expect(f.renderer.xr.enabled).toBe(true);
    expect(f.renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x234567);
    expect(f.renderer.getClearAlpha()).toBe(0.8);
    expect(f.controls.arcGroup.visible).toBe(true);
  });

  it('keeps mask IDs distinct and tests beauty against the depth-only prepass', () => {
    const f = fixture();
    f.renderer.render(f.scene, f.camera);
    const mask = f.calls[1].surfaces;
    expect(mask.map((s) => s.red)).toEqual([1 / 8, 1 / 8, 2 / 8, 3 / 8]);
    for (const surface of mask) {
      expect(surface).toMatchObject({
        depthTest: true,
        depthWrite: true,
        colorWrite: true
      });
    }
    for (const surface of f.calls[2].surfaces) {
      expect(surface).toMatchObject({
        depthTest: true,
        depthWrite: true,
        colorWrite: false
      });
    }
    for (const surface of f.calls[3].surfaces) {
      expect(surface).toMatchObject({
        depthTest: true,
        depthWrite: false,
        colorWrite: true
      });
    }
    expect(f.calls[1].target).not.toBe(f.calls[2].target);
    expect(f.calls[2].target).toBe(f.calls[3].target);
  });

  it.each(['perspective', 'orthographic'])(
    'maps a cropped %s camera back to the same screen position',
    (kind) => {
      const f = fixture();
      if (kind === 'orthographic') {
        f.camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
        f.camera.position.set(2, 3, 15);
        f.camera.lookAt(0, 0, 0);
        f.camera.updateMatrixWorld();
      }
      f.renderer.render(f.scene, f.camera);
      const point = new THREE.Vector3(1, 0.4, 0);
      const expected = point.clone().project(f.camera);
      const cropped = point.clone().project(f.calls[1].camera);
      const rect = f.calls[4].material.uniforms.clipRect.value;
      expect(cropped.x * rect.x + rect.z).toBeCloseTo(expected.x, 10);
      expect(cropped.y * rect.y + rect.w).toBeCloseTo(expected.y, 10);
      // Logarithmic depth uses far outside the projection matrix itself.
      expect(f.calls[1].near).toBe(f.camera.near);
      expect(f.calls[1].far).toBe(f.camera.far);
    }
  );

  it.each(['idle', 'hidden', 'detached', 'disabled', 'offscreen-target', 'xr'])(
    'passes through %s renders',
    (state) => {
      const f = fixture();
      if (state === 'idle') f.controls.axis = null;
      if (state === 'hidden') f.controls.visible = false;
      if (state === 'detached') f.controls.object = null;
      if (state === 'disabled') f.controls.enabled = false;
      if (state === 'offscreen-target') {
        f.renderer.setRenderTarget(new THREE.WebGLRenderTarget());
      }
      if (state === 'xr') f.renderer.xr.isPresenting = true;
      f.renderer.render(f.scene, f.camera);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].arcVisible).toBe(true);
      expect(f.renderer.clear).not.toHaveBeenCalled();
    }
  );

  it('activates on a touch rotation drag without mouse hover', () => {
    const f = fixture();
    f.controls._lastPointerType = 'touch';
    f.renderer.render(f.scene, f.camera);
    expect(f.calls).toHaveLength(1);
    f.controls.isDragging = true;
    f.renderer.render(f.scene, f.camera);
    expect(f.calls).toHaveLength(6);
  });

  it.each([1, 2, 3])(
    'restores state and renders the next frame after pass %s throws',
    (failedPass) => {
      const f = fixture();
      for (let i = 0; i < failedPass; i++) {
        f.original.mockImplementationOnce((scene) => scene.updateMatrixWorld());
      }
      f.original.mockImplementationOnce(() => {
        throw new Error('render failed');
      });
      expect(() => f.renderer.render(f.scene, f.camera)).toThrow(
        'render failed'
      );
      expect(f.controls.arcGroup.visible).toBe(true);
      expect(f.renderer.getRenderTarget()).toBe(null);
      expect(f.renderer.autoClear).toBe(true);
      expect(f.renderer.xr.enabled).toBe(true);
      expect(f.renderer.getClearAlpha()).toBe(0.8);
      f.renderer.render(f.scene, f.camera);
      expect(f.calls).toHaveLength(5);
      expect(f.calls[1].surfaces.every((s) => s.colorWrite)).toBe(true);
    }
  );

  it('caps near-plane fallback buffers and releases them on disposal', () => {
    const f = fixture();
    f.camera.position.set(0, 0, 0.2);
    f.camera.lookAt(0, 0, 0);
    f.camera.updateMatrixWorld();
    f.renderer.render(f.scene, f.camera);
    const target = f.calls[1].target;
    expect(target.width).toBeLessThanOrEqual(1024);
    expect(target.height).toBeLessThanOrEqual(1024);
    const disposed = vi.fn();
    target.addEventListener('dispose', disposed);
    const colorDisposed = vi.fn();
    f.calls[2].target.addEventListener('dispose', colorDisposed);
    f.overlay.dispose();
    f.overlay.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(colorDisposed).toHaveBeenCalledTimes(1);
    expect(f.renderer.render).toBe(f.original);
  });
});
