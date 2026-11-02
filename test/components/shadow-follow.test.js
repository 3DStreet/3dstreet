import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shadowDepth } from '../../src/tested/shadow-follow.js';

// The day sun, (-40, 56, -43) above the origin.
const DAY_SIN = 56 / Math.hypot(40, 56, 43);

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

async function makeScene(preset = 'day') {
  const scene = document.createElement('a-scene');
  scene.setAttribute('embedded', '');
  scene.setAttribute('style', 'width: 32px; height: 32px');
  scene.setAttribute('vr-mode-ui', 'enabled: false');
  scene.innerHTML = `
    <a-entity id="cam" camera position="0 20 0" rotation="-90 0 0"></a-entity>
    <a-entity id="environment" street-environment="preset: ${preset}"></a-entity>
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
    expect(sun.length()).toBeCloseTo(
      shadowDepth(near.halfExtent, DAY_SIN).distance,
      6
    );
    expect(sun.normalize().distanceTo(restDir)).toBeLessThan(1e-9);
    // The light's own rest pose (and the entity) are untouched.
    expect(
      scene.querySelector('#env-light2').getAttribute('position')
    ).toMatchObject({ x: -40, y: 56, z: -43 });
  });

  it('sizes the shadow camera and map from the startup settings', async () => {
    const { light, shadow, near, system } = await makeScene();
    system.tick();
    expect(light.shadow.camera.right).toBe(near.halfExtent);
    expect(light.shadow.camera.left).toBe(-near.halfExtent);
    expect(light.shadow.camera.far).toBeCloseTo(
      shadowDepth(near.halfExtent, DAY_SIN).far,
      6
    );
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
    expect(shadowCam.far).toBeCloseTo(
      shadowDepth(shadow.steps[1].halfExtent, DAY_SIN).far,
      6
    );

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
    expect(shadowCam.far).toBe(system.far);
  });

  it('gives presets without their own sun the day sun', async () => {
    for (const preset of ['cloudy', 'cloudy-afternoon', 'night']) {
      const { light, system } = await makeScene(preset);
      system.tick();
      const dir = world(light).sub(light.target.position).normalize();
      const day = new window.THREE.Vector3(-40, 56, -43).normalize();
      expect(dir.distanceTo(day)).toBeLessThan(1e-6);
    }
  });

  it('follows a custom sun and keeps the low sun box in front of the light', async () => {
    const { scene, light, system, near } = await makeScene();
    const env = scene.querySelector('#environment');
    // Sun low in the west (+X north, +Z east, so west is -Z).
    env.setAttribute('street-environment', {
      sunCustom: true,
      sunAzimuth: 270,
      sunElevation: 10
    });
    system.tick();
    const dir = world(light).sub(light.target.position).normalize();
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.z).toBeLessThan(0);
    expect(Math.asin(dir.y) * (180 / Math.PI)).toBeCloseTo(10, 6);
    const { distance, far } = shadowDepth(near.halfExtent, dir.y);
    expect(light.shadow.camera.far).toBeCloseTo(far, 6);
    expect(world(light).distanceTo(light.target.position)).toBeCloseTo(
      distance,
      6
    );
    // Ground across the tilted box spans halfExtent / tan(10°) in depth.
    expect(distance).toBeGreaterThan(near.halfExtent / Math.tan(Math.PI / 18));
  });
});

describe('environment background (#2118)', () => {
  it('keeps the sky lighting behind a solid colour background', async () => {
    const { scene } = await makeScene();
    const env = scene.querySelector('#environment');
    env.setAttribute('street-environment', {
      background: 'color',
      backgroundColor: '#000000'
    });
    const three = scene.object3D;
    expect(three.background.isColor).toBe(true);
    expect(three.background.getHexString()).toBe('000000');
    expect(three.environment?.isTexture).toBe(true);

    env.setAttribute('street-environment', 'background', 'sky');
    expect(three.background).toBe(three.environment);
  });

  it('migrates the old color preset to day lighting with a colour background', async () => {
    const { scene } = await makeScene('color');
    const data = scene
      .querySelector('#environment')
      .getAttribute('street-environment');
    expect(data.preset).toBe('day');
    expect(data.background).toBe('color');
    expect(scene.object3D.environment?.isTexture).toBe(true);
  });
});
