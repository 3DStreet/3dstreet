/* global AFRAME, THREE */

/**
 * play-mode-vehicle
 * =================
 *
 * Drop a raycast-wheel vehicle into a 3DStreet scene at runtime so the
 * user can drive a car around in viewer mode.
 *
 * Two pieces, both registered from this file:
 *
 *   1. `play-mode-physics` system — owns the Rapier World, steps it,
 *      and syncs registered A-Frame entities to their Rapier bodies.
 *      Lazy: does nothing until something calls system.activate(). The
 *      Rapier WASM module is loaded the first time activate() is called.
 *
 *   2. `play-mode-vehicle` component — attached to the player car
 *      entity. Creates the chassis rigid body + DynamicRayCastVehicleController,
 *      reads WASD/Space input, drives the vehicle each tick, and aims a
 *      top-down follow camera at it.
 *
 * Vehicle tuning (chassis dims, wheel positions, all setWheel* calls,
 * engine/brake/steer defaults, per-frame update order) is a literal port
 * of the known-good standalone demo at:
 *   https://github.com/kfarr/aframe-rapier-examples
 * which itself ports:
 *   https://github.com/isaac-mason/sketches
 *     /tree/main/sketches/rapier/dynamic-raycast-vehicle-controller
 *
 * The standalone demo deliberately bypassed the aframe-rapier-physics
 * wrapper because a previous wrapper-mediated attempt produced an
 * undiagnosable energy sink (~0.15 m/s terminal under any engine force).
 * This module preserves that decision: it talks to Rapier directly via
 * @dimforge/rapier3d-compat and runs its own World.step() rather than
 * relying on a wrapper.
 */

let RAPIER = null;
let rapierLoadPromise = null;

function loadRapier() {
  if (RAPIER) return Promise.resolve(RAPIER);
  if (rapierLoadPromise) return rapierLoadPromise;
  rapierLoadPromise = import(
    /* webpackChunkName: "rapier" */ '@dimforge/rapier3d-compat'
  )
    .then(async (mod) => {
      const R = mod.default || mod;
      await R.init();
      RAPIER = R;
      return R;
    })
    .catch((err) => {
      rapierLoadPromise = null;
      throw err;
    });
  return rapierLoadPromise;
}

// ---------------------------------------------------------------------
// System: owns the world, steps it, syncs bodies <-> entities.
// ---------------------------------------------------------------------
AFRAME.registerSystem('play-mode-physics', {
  schema: {
    gravity: { type: 'vec3', default: { x: 0, y: -9.81, z: 0 } }
  },

  init: function () {
    this.active = false;
    this.world = null;
    this.synced = []; // [{ body, el }]
    this.physAcc = 0;
    this.timestep = 1 / 60;
    this.afterStepCallbacks = []; // run after each physics sub-step
  },

  /**
   * Boot the world (loading Rapier WASM if needed) and start ticking.
   * Idempotent — safe to call repeatedly.
   *
   * @returns {Promise<void>} resolves once the world is ready
   */
  activate: async function () {
    if (this.active) return;
    await loadRapier();
    if (!this.world) {
      const g = this.data.gravity;
      this.world = new RAPIER.World({ x: g.x, y: g.y, z: g.z });
      this.world.timestep = this.timestep;
    }
    this.active = true;
  },

  deactivate: function () {
    this.active = false;
    // Drop synced refs but keep the world around in case we re-enter.
    this.synced.length = 0;
    this.afterStepCallbacks.length = 0;
    if (this.world) {
      // Free everything by recreating the world next activate().
      this.world.free?.();
      this.world = null;
    }
  },

  registerSync: function (body, el) {
    this.synced.push({ body, el });
  },

  unregisterSync: function (body) {
    const i = this.synced.findIndex((s) => s.body === body);
    if (i >= 0) this.synced.splice(i, 1);
  },

  onAfterStep: function (cb) {
    this.afterStepCallbacks.push(cb);
  },

  offAfterStep: function (cb) {
    const i = this.afterStepCallbacks.indexOf(cb);
    if (i >= 0) this.afterStepCallbacks.splice(i, 1);
  },

  /**
   * Add a static cuboid collider matching an entity's box geometry.
   * Used to seed ground / walls at the boundary so the player has
   * something to collide with.
   */
  addStaticCuboid: function (pos, halfExtents) {
    if (!this.world) return null;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z),
      body
    );
    return body;
  },

  tick: function (time, deltaMs) {
    if (!this.active || !this.world) return;
    const dt = Math.min((deltaMs || 16) / 1000, 0.1);
    this.physAcc += dt;
    let steps = 0;
    while (this.physAcc >= this.timestep && steps < 4) {
      this.world.step();
      for (const cb of this.afterStepCallbacks) cb(this.timestep);
      this.physAcc -= this.timestep;
      steps++;
    }
    for (const { body, el } of this.synced) {
      const t = body.translation();
      const r = body.rotation();
      el.object3D.position.set(t.x, t.y, t.z);
      el.object3D.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
});

// ---------------------------------------------------------------------
// Component: drive-controls
//
// Tag an entity with this component to mark it as a player-drivable
// vehicle in play mode. The schema mirrors the runtime tunables on
// `play-mode-vehicle`, so when the entity is selected in the editor the
// properties panel exposes the same knobs the user would otherwise have
// no way to reach. Saved with the scene via the existing component
// serialization path.
//
// At play-time, viewer-mode's enableDriveMode() looks for the first
// entity with drive-controls, reads its world position/yaw + tunables,
// and spawns the player car at that pose with those values. If no
// entity has drive-controls, drive mode falls back to default tuning at
// the cameraRig start position (the original synthetic spawn).
//
// Edit-time behavior is intentionally inert — this component does not
// add visuals, listeners, or physics during editing.
// ---------------------------------------------------------------------
AFRAME.registerComponent('drive-controls', {
  schema: {
    chassisSize: { type: 'vec3', default: { x: 1.6, y: 0.4, z: 0.8 } },
    accelerateForce: { type: 'number', default: 2 },
    brakeForce: { type: 'number', default: 0.05 },
    steerAngle: { type: 'number', default: Math.PI / 24 },
    suspensionStiffness: { type: 'number', default: 24 },
    frictionSlip: { type: 'number', default: 1.5 },
    sideFrictionStiffness: { type: 'number', default: 3 }
  }
});

// ---------------------------------------------------------------------
// Component: player car. Attach to an entity and it becomes a drivable
// raycast-wheel vehicle.
//
//   <a-entity play-mode-vehicle position="0 1 0"></a-entity>
// ---------------------------------------------------------------------
AFRAME.registerComponent('play-mode-vehicle', {
  schema: {
    chassisSize: { type: 'vec3', default: { x: 1.6, y: 0.4, z: 0.8 } },
    spawnPosition: { type: 'vec3', default: { x: 0, y: 1, z: 0 } },
    spawnYaw: { type: 'number', default: 0 }, // degrees, around world Y
    accelerateForce: { type: 'number', default: 2 },
    brakeForce: { type: 'number', default: 0.05 },
    steerAngle: { type: 'number', default: Math.PI / 24 },
    cameraSelector: { type: 'string', default: '#camera' },
    cameraHeight: { type: 'number', default: 18 },
    debugChassisVisible: { type: 'boolean', default: true }
  },

  init: async function () {
    this.system = this.el.sceneEl.systems['play-mode-physics'];
    if (!this.system) {
      console.error('play-mode-vehicle: play-mode-physics system not found');
      return;
    }
    this.input = {
      forward: false,
      back: false,
      left: false,
      right: false,
      brake: false,
      reset: false
    };
    this.keymap = {
      KeyW: 'forward',
      ArrowUp: 'forward',
      KeyS: 'back',
      ArrowDown: 'back',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      Space: 'brake',
      KeyR: 'reset'
    };
    this.onKeyDown = (e) => {
      if (this.keymap[e.code]) {
        this.input[this.keymap[e.code]] = true;
        e.preventDefault();
      }
    };
    this.onKeyUp = (e) => {
      if (this.keymap[e.code]) this.input[this.keymap[e.code]] = false;
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Boot physics, then build the vehicle.
    await this.system.activate();
    this.buildVehicle();
  },

  buildVehicle: function () {
    const data = this.data;
    const world = this.system.world;

    // --- Visual chassis (red box + yellow forward-direction cone) ---
    if (data.debugChassisVisible) {
      this.el.setAttribute(
        'geometry',
        `primitive: box; width: ${data.chassisSize.x}; height: ${data.chassisSize.y}; depth: ${data.chassisSize.z}`
      );
      this.el.setAttribute('material', 'color: #cc2222');
      const fwd = document.createElement('a-entity');
      fwd.setAttribute(
        'geometry',
        'primitive: cone; radiusBottom: 0.1; radiusTop: 0; height: 0.4; segmentsRadial: 12'
      );
      fwd.setAttribute('material', 'color: #ffd54a; shader: flat');
      // chassis-local -X = forward (engine impulse direction). Cone tip toward -X.
      fwd.setAttribute('position', `${-data.chassisSize.x / 2 - 0.2} 0.05 0`);
      fwd.setAttribute('rotation', '0 0 90');
      this.el.appendChild(fwd);
    }

    // --- Spawn pose: yaw so chassis-local -X points along world spawnYaw ---
    // Default spawnYaw=0 means chassis-local -X faces world -Z (camera default).
    const yawRad = (data.spawnYaw * Math.PI) / 180 - Math.PI / 2;
    const spawnQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, yawRad, 0)
    );

    const chassisBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          data.spawnPosition.x,
          data.spawnPosition.y,
          data.spawnPosition.z
        )
        .setRotation(spawnQuat)
        .setCanSleep(false)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        data.chassisSize.x / 2,
        data.chassisSize.y / 2,
        data.chassisSize.z / 2
      ),
      chassisBody
    );
    this.chassisBody = chassisBody;
    this.spawnQuat = spawnQuat;
    this.system.registerSync(chassisBody, this.el);

    // --- Wheel info: literal port of the known-good demo ---
    const wheelInfo = {
      axleCs: { x: 0, y: 0, z: -1 },
      suspensionRestLength: 0.125,
      suspensionStiffness: 24,
      maxSuspensionTravel: 1,
      sideFrictionStiffness: 3,
      frictionSlip: 1.5,
      radius: 0.15
    };
    const wheelPositions = [
      // Front (chassis-local -X is forward)
      { x: -0.65, y: -0.15, z: -0.45 },
      { x: -0.65, y: -0.15, z: 0.45 },
      // Rear
      { x: 0.65, y: -0.15, z: -0.45 },
      { x: 0.65, y: -0.15, z: 0.45 }
    ];

    const vehicle = world.createVehicleController(chassisBody);
    const susDir = { x: 0, y: -1, z: 0 };
    this.wheelOuterEls = [];
    for (let i = 0; i < wheelPositions.length; i++) {
      const p = wheelPositions[i];
      vehicle.addWheel(
        p,
        susDir,
        wheelInfo.axleCs,
        wheelInfo.suspensionRestLength,
        wheelInfo.radius
      );
      vehicle.setWheelSuspensionStiffness(i, wheelInfo.suspensionStiffness);
      vehicle.setWheelMaxSuspensionTravel(i, wheelInfo.maxSuspensionTravel);
      vehicle.setWheelFrictionSlip(i, wheelInfo.frictionSlip);
      vehicle.setWheelSideFrictionStiffness(i, wheelInfo.sideFrictionStiffness);

      if (data.debugChassisVisible) {
        const outer = document.createElement('a-entity');
        outer.setAttribute('position', `${p.x} ${p.y} ${p.z}`);
        this.el.appendChild(outer);
        const inner = document.createElement('a-entity');
        inner.setAttribute(
          'geometry',
          `primitive: cylinder; radius: ${wheelInfo.radius}; height: 0.15; segmentsRadial: 16`
        );
        inner.setAttribute('material', 'color: #222');
        inner.setAttribute('rotation', '-90 0 0');
        outer.appendChild(inner);
        this.wheelOuterEls.push(outer);
      } else {
        this.wheelOuterEls.push(null);
      }
    }
    this.vehicle = vehicle;

    // Drive vehicle inside the system's after-step hook so wheel forces
    // and updateVehicle land in the same Rapier sub-step as world.step().
    this._afterStep = (dt) => this.driveStep(dt);
    this.system.onAfterStep(this._afterStep);

    // Cache ref to follow camera target.
    this.cameraEl = document.querySelector(this.data.cameraSelector) || null;

    // Cache scratch objects for the wheel sync pass.
    this._up = new THREE.Vector3(0, 1, 0);
    this._qSteer = new THREE.Quaternion();
    this._qSpin = new THREE.Quaternion();
    this._axleVec = new THREE.Vector3();
  },

  driveStep: function () {
    const v = this.vehicle;
    if (!v) return;
    const data = this.data;
    const i = this.input;

    const engineForce =
      (i.forward ? 1 : 0) * data.accelerateForce - (i.back ? 1 : 0);
    v.setWheelEngineForce(0, engineForce);
    v.setWheelEngineForce(1, engineForce);

    const brake = (i.brake ? 1 : 0) * data.brakeForce;
    for (let k = 0; k < 4; k++) v.setWheelBrake(k, brake);

    const steerDir = (i.left ? 1 : 0) - (i.right ? 1 : 0);
    const cur = v.wheelSteering(0) || 0;
    const steer = THREE.MathUtils.lerp(cur, data.steerAngle * steerDir, 0.5);
    v.setWheelSteering(0, steer);
    v.setWheelSteering(1, steer);

    if (i.reset && this.chassisBody) {
      this.chassisBody.setTranslation(this.data.spawnPosition, true);
      this.chassisBody.setRotation(this.spawnQuat, true);
      this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    v.updateVehicle(this.system.timestep);
  },

  tick: function () {
    if (!this.vehicle) return;

    // Sync each wheel visual: position from suspension travel, orientation
    // from steering * spin around the (chassis-local) axle.
    for (let i = 0; i < this.wheelOuterEls.length; i++) {
      const outer = this.wheelOuterEls[i];
      if (!outer) continue;
      const conn = this.vehicle.wheelChassisConnectionPointCs(i);
      const sus = this.vehicle.wheelSuspensionLength(i) || 0;
      const stY = this.vehicle.wheelSteering(i) || 0;
      const spin = this.vehicle.wheelRotation(i) || 0;
      const axle = this.vehicle.wheelAxleCs(i);
      outer.object3D.position.set(conn.x, conn.y - sus, conn.z);
      this._qSteer.setFromAxisAngle(this._up, stY);
      this._axleVec.set(axle.x, axle.y, axle.z);
      this._qSpin.setFromAxisAngle(this._axleVec, spin);
      outer.object3D.quaternion.multiplyQuaternions(this._qSteer, this._qSpin);
    }

    // Top-down follow camera (matches the standalone demo).
    if (this.cameraEl && this.chassisBody) {
      const t = this.chassisBody.translation();
      const camObj = this.cameraEl.object3D;
      camObj.position.set(t.x, t.y + this.data.cameraHeight, t.z);
      camObj.rotation.set(-Math.PI / 2, 0, 0);
    }
  },

  remove: function () {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.system && this._afterStep) {
      this.system.offAfterStep(this._afterStep);
    }
    if (this.system && this.chassisBody) {
      this.system.unregisterSync(this.chassisBody);
    }
  }
});
