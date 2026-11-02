import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  await import('../../src/aframe-components/street-environment.js');
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

async function makeScene() {
  const scene = document.createElement('a-scene');
  scene.setAttribute('embedded', '');
  scene.setAttribute('style', 'width: 32px; height: 32px');
  scene.setAttribute('vr-mode-ui', 'enabled: false');
  scene.innerHTML = `
    <a-entity id="cam" camera position="0 20 0" rotation="-90 0 0"></a-entity>
    <a-entity id="environment" street-environment="preset: day"></a-entity>
  `;
  document.body.appendChild(scene);
  mounted.push(scene);
  await new Promise((resolve) => scene.addEventListener('loaded', resolve));
  const light = scene.querySelector('#env-light2').getObject3D('light');
  const env =
    scene.querySelector('#environment').components['street-environment'];
  return {
    scene,
    light,
    system: scene.systems['street-environment'],
    shadow: env.shadow
  };
}

const world = (obj) => {
  obj.updateWorldMatrix(true, false);
  return new window.THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
};

function moveCamera(scene, x, z) {
  const cam = scene.querySelector('#cam').object3D;
  cam.position.set(x, 20, z);
  cam.updateMatrixWorld(true);
}

describe('camera-following shadow box', () => {
  it('centres the light and target on the ground the camera looks at', async () => {
    const { scene, light, system, shadow } = await makeScene();
    system.tick();
    const restSun = world(light).sub(light.target.position);

    moveCamera(scene, 300, -200);
    system.tick();
    const target = light.target.position;
    expect(Math.abs(target.x - 300)).toBeLessThan(shadow.texelSize * 2);
    expect(Math.abs(target.z + 200)).toBeLessThan(shadow.texelSize * 2);
    // The sun direction and distance are unchanged.
    const sun = world(light).sub(target);
    expect(sun.distanceTo(restSun)).toBeLessThan(1e-6);
    // The light's own rest pose (and the entity) are untouched.
    expect(
      scene.querySelector('#env-light2').getAttribute('position')
    ).toMatchObject({ x: -40, y: 56, z: -43 });
  });

  it('sizes the shadow camera and map from the startup settings', async () => {
    const { light, shadow } = await makeScene();
    expect(light.shadow.camera.right).toBe(shadow.halfExtent);
    expect(light.shadow.camera.left).toBe(-shadow.halfExtent);
    expect(light.shadow.mapSize.x).toBe(shadow.mapSize);
  });

  it('touches nothing while the camera stays inside one texel', async () => {
    const { scene, light, system } = await makeScene();
    system.tick();
    let calls = 0;
    const original = light.target.updateMatrixWorld;
    light.target.updateMatrixWorld = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    for (let i = 0; i < 10; i++) system.tick();
    expect(calls).toBe(0);

    moveCamera(scene, 5, 0);
    system.tick();
    system.tick();
    expect(calls).toBe(1);
  });

  it('keeps shadows near a level camera within reach', async () => {
    const { scene, light, system, shadow } = await makeScene();
    const cam = scene.querySelector('#cam').object3D;
    cam.position.set(0, 1.6, 0);
    cam.rotation.set(0, 0, 0); // looking along -z at the horizon
    cam.updateMatrixWorld(true);
    system.tick();
    expect(light.target.position.z).toBeCloseTo(-shadow.reach, 0);
  });
});
