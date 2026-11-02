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
    shadow: env.shadow,
    near: env.shadow.steps[0]
  };
}

const world = (obj) => {
  obj.updateWorldMatrix(true, false);
  return new window.THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
};

function moveCamera(scene, x, z, y = 20) {
  const cam = scene.querySelector('#cam').object3D;
  cam.position.set(x, y, z);
  cam.updateMatrixWorld(true);
}

describe('camera-following shadow box', () => {
  it('centres the light and target on the ground the camera looks at', async () => {
    const { scene, light, system, near } = await makeScene();
    system.tick();
    const restDir = world(light).sub(light.target.position).normalize();

    moveCamera(scene, 300, -200);
    system.tick();
    const target = light.target.position;
    expect(Math.abs(target.x - 300)).toBeLessThan(near.texelSize * 2);
    expect(Math.abs(target.z + 200)).toBeLessThan(near.texelSize * 2);
    // The sun direction is unchanged; the light sits the step's distance back.
    const sun = world(light).sub(target);
    expect(sun.length()).toBeCloseTo(near.distance, 6);
    expect(sun.normalize().distanceTo(restDir)).toBeLessThan(1e-9);
    // The light's own rest pose (and the entity) are untouched.
    expect(
      scene.querySelector('#env-light2').getAttribute('position')
    ).toMatchObject({ x: -40, y: 56, z: -43 });
  });

  it('sizes the shadow camera and map from the startup settings', async () => {
    const { light, shadow, near } = await makeScene();
    expect(light.shadow.camera.right).toBe(near.halfExtent);
    expect(light.shadow.camera.left).toBe(-near.halfExtent);
    expect(light.shadow.camera.far).toBe(near.far);
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
    const { scene, light, system, near } = await makeScene();
    const cam = scene.querySelector('#cam').object3D;
    cam.position.set(0, 1.6, 0);
    cam.rotation.set(0, 0, 0); // looking along -z at the horizon
    cam.updateMatrixWorld(true);
    system.tick();
    expect(light.target.position.z).toBeCloseTo(-near.reach, 0);
  });

  it('steps the box up with height and switches off above 500 m', async () => {
    const { scene, light, system, shadow } = await makeScene();
    const shadowCam = light.shadow.camera;
    moveCamera(scene, 0, 0, 120);
    system.tick();
    expect(shadowCam.right).toBe(shadow.steps[1].halfExtent);
    expect(shadowCam.far).toBe(shadow.steps[1].far);

    moveCamera(scene, 0, 0, 600);
    system.tick();
    expect(light.shadow.autoUpdate).toBe(false);
    expect(shadowCam.right).toBeLessThan(1);

    // A preset change while off must not bring back a stale box.
    scene
      .querySelector('#environment')
      .setAttribute('street-environment', 'preset', 'sunny-noon');
    system.tick();
    expect(shadowCam.right).toBeLessThan(1);

    moveCamera(scene, 0, 0, 10);
    system.tick();
    expect(light.shadow.autoUpdate).toBe(true);
    expect(shadowCam.right).toBe(shadow.steps[0].halfExtent);
    expect(shadowCam.far).toBe(shadow.steps[0].far);
  });
});
