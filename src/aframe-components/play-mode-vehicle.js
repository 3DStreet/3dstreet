/* global AFRAME, THREE */
const {
  VEHICLE_PRESETS,
  PROCEDURAL_MESH_COMPONENTS,
  PRESET_NAMES
} = require('./vehicle-presets.js');

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
    this.physAcc = 0;
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
  addStaticCuboid: function (pos, halfExtents, quat) {
    if (!this.world) return null;
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      pos.x,
      pos.y,
      pos.z
    );
    if (quat) desc.setRotation(quat);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z),
      body
    );
    return body;
  },

  /**
   * Add a kinematic-position-based cuboid. Caller drives the body
   * each tick via setNextKinematicTranslation/Rotation; the solver
   * computes correct velocity so dynamic bodies (player chassis)
   * bounce off cleanly. Used by managed-street-traffic to give
   * animated traffic real collision shapes that the player can hit.
   */
  addKinematicCuboid: function (pos, halfExtents) {
    if (!this.world) return null;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        pos.x,
        pos.y,
        pos.z
      )
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z),
      body
    );
    return body;
  },

  tick: function (time, deltaMs) {
    if (!this.active || !this.world) return;
    // Consume rAF wall-clock dt into the accumulator. The 4-sub-step
    // cap below is what produces slow-motion on weak CPUs: if rAF
    // delivers more time than we can simulate, we drop the excess
    // wall-time (rather than running endless sub-steps and falling
    // further behind). Meanwhile, simulationTime advances by EXACTLY
    // `timestep` per completed sub-step — so on a slow machine
    // simulationTime lags wall-time, and at any given simulationTime
    // every machine has executed the same number of sub-steps from
    // the same initial state.
    const dt = Math.min((deltaMs || 16) / 1000, 0.1);
    this.physAcc += dt;
    const timer = this.sceneEl.components['scene-timer'];
    let steps = 0;
    while (this.physAcc >= this.timestep && steps < 4) {
      this.world.step();
      for (const cb of this.afterStepCallbacks) cb(this.timestep);
      if (timer) timer.advanceSimulation(this.timestep * 1000);
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
// At play-time, the `drive-mode` scene component (further down in this
// file) listens for play-mode-start, finds the first [drive-controls]
// entity, reads its world position/yaw + tunables, and spawns the
// player car at that pose with those values. If no entity has
// drive-controls, drive-mode is a no-op — Play still fires for any
// other feature subscribers (traffic animation, etc.).
//
// Edit-time behavior is intentionally inert — this component does not
// add visuals, listeners, or physics during editing.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Marker component: vehicle-mesh-slot
//
// Tag the Driveable Vehicle's child entity that holds the user-picked
// mixin/glTF model. The drive-mode scene component looks up
// [vehicle-mesh-slot] to find which subtree to clone onto the player
// car. We use a marker COMPONENT (not a data-* attribute) because the
// scene serializer in json-utils only persists components, mixin,
// id/class, and data-layer-name — plain data-* attributes get dropped
// on save/reload.
// ---------------------------------------------------------------------
AFRAME.registerComponent('vehicle-mesh-slot', {});

AFRAME.registerComponent('drive-controls', {
  schema: {
    // Preset is a "package deal" selector — picking one in the
    // property panel re-applies size + physics + mesh from the
    // VEHICLE_PRESETS table. 'custom' is the leave-alone value used
    // when the user wants to hand-tune fields directly.
    preset: {
      type: 'string',
      default: 'custom',
      oneOf: ['custom', ...PRESET_NAMES]
    },
    // vehicleSize is in ENTITY frame: x=width, y=height, z=length.
    // play-mode-vehicle's internal chassisSize is in chassis frame
    // (x=length, y=height, z=width); viewer-mode swaps X<->Z when
    // forwarding so this drive-controls field stays intuitive in the
    // editor (length is Z, matching the editor box geometry).
    vehicleSize: { type: 'vec3', default: { x: 0.8, y: 0.4, z: 1.6 } },
    accelerateForce: { type: 'number', default: 2 },
    brakeForce: { type: 'number', default: 0.05 },
    steerAngle: { type: 'number', default: Math.PI / 24 },
    suspensionStiffness: { type: 'number', default: 24 },
    frictionSlip: { type: 'number', default: 1.5 },
    sideFrictionStiffness: { type: 'number', default: 3 },
    // 0 = auto-fit from vehicleSize.y. Use these for explicit override.
    wheelRadius: { type: 'number', default: 0 },
    wheelWidth: { type: 'number', default: 0 }
  },

  init: function () {
    // Add a yellow forward-direction cone child so the user can see
    // which end of the entity is "front" before they rotate it.
    // Forward is the entity's local -Z (matches A-Frame's default forward
    // axis), and the play-mode chassis is spawned with the matching
    // -π/2 yaw offset so its local -X (the vehicle controller's actual
    // forward) ends up pointing in the same world direction.
    if (this.el.querySelector('[data-drive-controls-marker]')) return;
    const cone = document.createElement('a-entity');
    cone.setAttribute('data-drive-controls-marker', '');
    cone.setAttribute('data-layer-name', 'Forward Direction');
    cone.setAttribute(
      'geometry',
      'primitive: cone; radiusBottom: 0.12; radiusTop: 0; height: 0.5; segmentsRadial: 12'
    );
    cone.setAttribute('material', 'color: #ffd54a; shader: flat');
    // Default cone tip points +Y. Rotate so it points -Z (the entity's
    // forward direction). Position is set by applyConePosition so it
    // sits just outside the front face for any vehicleSize.
    cone.setAttribute('rotation', '-90 0 0');
    // Don't expose the marker as a user-editable child node.
    cone.setAttribute('data-no-transform', '');
    cone.setAttribute('data-aframe-inspector', 'autocreated');
    this._marker = cone;
    this.el.appendChild(cone);

    // First-time geometry / cone-position sync.
    this.applyVehicleSize();
    this.applyConePosition();
  },

  update: function (oldData) {
    if (!oldData) return;
    // If the user just picked a preset (and it isn't the
    // leave-alone 'custom'), copy the whole preset bundle onto the
    // entity. Field-level update logic further down still runs after
    // — applyVehicleSize/applyConePosition pick up the new size.
    if (
      this.data.preset !== oldData.preset &&
      this.data.preset !== 'custom' &&
      VEHICLE_PRESETS[this.data.preset]
    ) {
      this.applyPreset(this.data.preset);
      // applyPreset uses setAttribute, which will fire update() again
      // with vehicleSize-changed; let that pass handle the visuals.
      return;
    }
    const old = oldData.vehicleSize;
    const cur = this.data.vehicleSize;
    if (old && cur && (old.x !== cur.x || old.y !== cur.y || old.z !== cur.z)) {
      this.applyVehicleSize();
      this.applyConePosition();
    }
  },

  applyPreset: function (name) {
    const p = VEHICLE_PRESETS[name];
    if (!p) return;
    // Single setAttribute with an object => one batched update().
    // Don't include `preset` here — that would be a no-op (already
    // set) and could cause infinite-loop edge cases.
    this.el.setAttribute('drive-controls', {
      vehicleSize: p.vehicleSize,
      accelerateForce: p.accelerateForce,
      brakeForce: p.brakeForce,
      steerAngle: p.steerAngle,
      wheelRadius: p.wheelRadius,
      wheelWidth: p.wheelWidth
    });
    // Update the editor's placeholder material to the preset color
    // (used for layer-panel-spawned entities). Geometry box auto-
    // resizes via applyVehicleSize when the vec3 change lands.
    this.el.setAttribute(
      'material',
      `color: ${p.placeholderColor}; opacity: 0; transparent: true`
    );
    // Swap mesh in the Vehicle Mesh child slot.
    this.applyMeshPreset(p);
  },

  applyMeshPreset: function (p) {
    const slot = this.el.querySelector('[vehicle-mesh-slot]');
    if (!slot) return;
    // Strip whichever previous mesh was on the slot.
    if (slot.hasAttribute('mixin')) slot.removeAttribute('mixin');
    for (const comp of PROCEDURAL_MESH_COMPONENTS) {
      if (slot.hasAttribute(comp)) slot.removeAttribute(comp);
    }
    // Apply the preset's mesh — either a catalog mixin or a
    // procedural component name (mutually exclusive in the preset
    // schema).
    if (p.meshComponent) {
      slot.setAttribute(p.meshComponent, '');
    } else if (p.meshMixin) {
      slot.setAttribute('mixin', p.meshMixin);
    }
  },

  applyConePosition: function () {
    // Place the cone tip ~0.2m beyond the front face (entity local -Z),
    // at a fixed fraction of vehicle height so it sits in the upper
    // half of the box vertically. Scales with vehicleSize so the cone
    // never gets buried inside the chassis as the box grows.
    if (!this._marker) return;
    const v = this.data.vehicleSize;
    this._marker.setAttribute(
      'position',
      `0 ${v.y * 0.25} ${-(v.z / 2 + 0.2)}`
    );
  },

  applyVehicleSize: function () {
    // Resize the editor's placeholder box to match vehicleSize so what
    // the user sees is what the play-mode chassis will be. Touches only
    // the geometry width/height/depth — leaves color/material alone.
    const v = this.data.vehicleSize;
    const existing = this.el.getAttribute('geometry');
    // Skip if the entity has no geometry primitive at all (the user
    // may have replaced it with a glTF model — leave that alone).
    if (!existing || existing.primitive !== 'box') return;
    this.el.setAttribute(
      'geometry',
      `primitive: box; width: ${v.x}; height: ${v.y}; depth: ${v.z}`
    );
  },

  remove: function () {
    if (this._marker && this._marker.parentNode) {
      this._marker.parentNode.removeChild(this._marker);
    }
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
    // CHASSIS frame: x = length, y = height, z = width.
    chassisSize: { type: 'vec3', default: { x: 1.6, y: 0.4, z: 0.8 } },
    spawnPosition: { type: 'vec3', default: { x: 0, y: 1, z: 0 } },
    spawnYaw: { type: 'number', default: 0 }, // degrees, around world Y
    accelerateForce: { type: 'number', default: 2 },
    brakeForce: { type: 'number', default: 0.05 },
    steerAngle: { type: 'number', default: Math.PI / 24 },
    // 0 = auto-fit (radius from chassisSize.y, width similar).
    wheelRadius: { type: 'number', default: 0 },
    wheelWidth: { type: 'number', default: 0 },
    cameraSelector: { type: 'string', default: '#camera' },
    cameraHeight: { type: 'number', default: 18 },
    cameraMode: {
      type: 'string',
      default: 'top-down',
      oneOf: ['top-down', 'chase', 'fpv']
    },
    debugChassisVisible: { type: 'boolean', default: true },
    // When false, skip the red placeholder box but still render the
    // forward cone and wheels. Used when a custom mesh is being
    // cloned in alongside.
    showDebugBox: { type: 'boolean', default: true }
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
      } else if (e.code === 'KeyC') {
        this.cycleCameraMode();
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

  /**
   * Tear down the chassis body, vehicle controller, and visual children
   * (cone marker + wheels). The component's input listeners and the
   * physics system stay around — only the per-build state is cleared.
   * Used when chassisSize (or any other build-time field) changes so
   * we can rebuild from scratch.
   */
  tearDownVehicle: function () {
    if (this.system && this._afterStep) {
      this.system.offAfterStep(this._afterStep);
      this._afterStep = null;
    }
    if (this.system && this.chassisBody) {
      this.system.unregisterSync(this.chassisBody);
    }
    const world = this.system && this.system.world;
    if (world && this.vehicle) {
      world.removeVehicleController(this.vehicle);
    }
    if (world && this.chassisBody) {
      world.removeRigidBody(this.chassisBody);
    }
    this.vehicle = null;
    this.chassisBody = null;
    // Clear visual children (cone, wheels). The geometry/material on
    // this.el itself will be re-set by the next buildVehicle().
    if (this.wheelOuterEls) {
      for (const w of this.wheelOuterEls) {
        if (w && w.parentNode) w.parentNode.removeChild(w);
      }
      this.wheelOuterEls = null;
    }
    // Remove the play-side forward cone created in buildVehicle.
    this.el.querySelectorAll('[data-play-cone]').forEach((c) => {
      if (c.parentNode) c.parentNode.removeChild(c);
    });
  },

  update: function (oldData) {
    if (!this.chassisBody || !oldData) return; // nothing built yet
    // Build-time fields (rebuild if any changes). Live-tick fields
    // (accelerateForce / brakeForce / steerAngle) are read each tick
    // so they don't need a rebuild.
    const oldCs = oldData.chassisSize;
    const newCs = this.data.chassisSize;
    const sizeChanged =
      oldCs &&
      (oldCs.x !== newCs.x || oldCs.y !== newCs.y || oldCs.z !== newCs.z);
    const wheelChanged =
      oldData.wheelRadius !== this.data.wheelRadius ||
      oldData.wheelWidth !== this.data.wheelWidth;
    if (sizeChanged || wheelChanged) {
      this.tearDownVehicle();
      this.buildVehicle();
    }
  },

  buildVehicle: function () {
    const data = this.data;
    const world = this.system.world;

    // --- Visual chassis (red box + yellow forward-direction cone) ---
    if (data.debugChassisVisible) {
      if (data.showDebugBox) {
        this.el.setAttribute(
          'geometry',
          `primitive: box; width: ${data.chassisSize.x}; height: ${data.chassisSize.y}; depth: ${data.chassisSize.z}`
        );
        this.el.setAttribute('material', 'color: #cc2222');
        this.el.setAttribute('shadow', 'cast: true; receive: true');
      }
      const fwd = document.createElement('a-entity');
      fwd.setAttribute('data-play-cone', '');
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

    // --- Wheel info: proportional to chassisSize so resizing the chassis
    //     auto-rescales wheels. The fractions are chosen so that the
    //     default chassisSize (1.6 x 0.4 x 0.8) produces the literal
    //     numbers from the verified standalone demo (Isaac Mason's
    //     dynamic-raycast-vehicle-controller port).
    const autoRadius = 0.375 * data.chassisSize.y; // 0.15 @ default
    const autoWidth = 0.375 * data.chassisSize.y; // 0.15 @ default
    const wheelRadius = data.wheelRadius > 0 ? data.wheelRadius : autoRadius;
    const wheelWidth = data.wheelWidth > 0 ? data.wheelWidth : autoWidth;
    // Stored for tick() to lift the wheel VISUAL up by one radius so
    // the cylinder's bottom (not its center) sits at the suspension
    // contact point.
    this._wheelRadius = wheelRadius;
    const wheelInfo = {
      axleCs: { x: 0, y: 0, z: -1 },
      suspensionRestLength: 0.3125 * data.chassisSize.y, // 0.125 @ default
      suspensionStiffness: 24,
      maxSuspensionTravel: 1,
      sideFrictionStiffness: 3,
      frictionSlip: 1.5,
      radius: wheelRadius
    };
    const wbx = 0.40625 * data.chassisSize.x; // 0.65 @ default (wheelbase / 2)
    const trz = 0.5625 * data.chassisSize.z; // 0.45 @ default (track / 2)
    const wy = -0.375 * data.chassisSize.y; // -0.15 @ default
    const wheelPositions = [
      // Front (chassis-local -X is forward)
      { x: -wbx, y: wy, z: -trz },
      { x: -wbx, y: wy, z: trz },
      // Rear
      { x: wbx, y: wy, z: -trz },
      { x: wbx, y: wy, z: trz }
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
          `primitive: cylinder; radius: ${wheelRadius}; height: ${wheelWidth}; segmentsRadial: 16`
        );
        inner.setAttribute('material', 'color: #222');
        inner.setAttribute('rotation', '-90 0 0');
        inner.setAttribute('shadow', 'cast: true; receive: true');
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

    // Let listeners (e.g. PlayModeControls) know the car is drivable.
    this.el.emit('vehicle-built', {}, true);
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

  tick: function (time, deltaMs) {
    if (!this.vehicle) return;
    this._lastDeltaMs = deltaMs;

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
      // Rapier's suspensionLength is measured to the wheel CONTACT
      // point with the ground (where the raycast lands). Placing a
      // radius-symmetric cylinder centered there would half-bury it
      // under the road. Lift the visual by `_wheelRadius` so the
      // cylinder's bottom — not its center — sits at the contact.
      outer.object3D.position.set(
        conn.x,
        conn.y - sus + this._wheelRadius,
        conn.z
      );
      this._qSteer.setFromAxisAngle(this._up, stY);
      this._axleVec.set(axle.x, axle.y, axle.z);
      this._qSpin.setFromAxisAngle(this._axleVec, spin);
      outer.object3D.quaternion.multiplyQuaternions(this._qSteer, this._qSpin);
    }

    // Follow camera. Mode is toggled at runtime with the C key.
    if (this.cameraEl && this.chassisBody) {
      this.updateCamera();
    }
  },

  cycleCameraMode: function () {
    const order = ['top-down', 'chase', 'fpv'];
    const i = order.indexOf(this.data.cameraMode);
    const next = order[(i + 1) % order.length];
    // Reset smoothing so the new mode snaps in cleanly instead of
    // lerping from the previous mode's stale position.
    this._cameraSmoothed = false;
    // setAttribute so other observers (PlayModeControls future state)
    // stay in sync.
    this.el.setAttribute('play-mode-vehicle', 'cameraMode', next);
  },

  updateCamera: function () {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    const camObj = this.cameraEl.object3D;
    const mode = this.data.cameraMode;

    // Scratch space.
    const carPos = this._carPos || (this._carPos = new THREE.Vector3());
    const camWorld = this._camWorld || (this._camWorld = new THREE.Vector3());
    const lookAt = this._lookAt || (this._lookAt = new THREE.Vector3());
    const worldUp =
      this._worldUp || (this._worldUp = new THREE.Vector3(0, 1, 0));
    carPos.set(t.x, t.y, t.z);

    // Smoothing state is per-mode (only chase uses it). Drop the flag
    // whenever we're not in chase so re-entering chase snaps in clean
    // — covers attribute-driven mode changes that bypass cycleCameraMode.
    if (mode !== 'chase') this._cameraSmoothed = false;

    if (mode === 'top-down') {
      camWorld.set(t.x, t.y + this.data.cameraHeight, t.z);
      lookAt.copy(carPos);
    } else {
      // chase + fpv: project car's forward heading onto world
      // horizontal plane so chassis pitch/roll doesn't tilt the camera.
      // Forward = chassis -X = the direction the car drives under
      // engine force.
      const carQuat = this._carQuat || (this._carQuat = new THREE.Quaternion());
      carQuat.set(r.x, r.y, r.z, r.w);
      const headingH = this._headingH || (this._headingH = new THREE.Vector3());
      headingH.set(-1, 0, 0).applyQuaternion(carQuat);
      headingH.y = 0;
      if (headingH.lengthSq() < 1e-4) {
        headingH.set(0, 0, -1);
      } else {
        headingH.normalize();
      }

      if (mode === 'chase') {
        // Camera ideally sits behind car (-headingH), elevated, looking
        // at car. The values below are the *target* the smoothed
        // camera state lerps toward — so the camera lags a bit when
        // the car turns, swerves, or jolts, instead of being rigidly
        // glued to the chassis. The momentum is asymmetric: the
        // position lags more (cinematic), the look target chases
        // faster (keeps the car centered).
        const distance = Math.max(this.data.chassisSize.x * 2.5, 4);
        const height = Math.max(this.data.chassisSize.y * 3, 2);
        camWorld.set(
          carPos.x - headingH.x * distance,
          carPos.y + height,
          carPos.z - headingH.z * distance
        );
        lookAt.copy(carPos);

        const sCam =
          this._smoothedCamPos || (this._smoothedCamPos = new THREE.Vector3());
        const sLook =
          this._smoothedLookAt || (this._smoothedLookAt = new THREE.Vector3());
        if (!this._cameraSmoothed) {
          // First chase frame (or just switched modes): snap so we
          // don't lerp from a stale position.
          sCam.copy(camWorld);
          sLook.copy(lookAt);
          this._cameraSmoothed = true;
        } else {
          // Frame-rate-independent exponential smoothing.
          // rate higher => snappier; lower => more lag.
          const dt = Math.min((this._lastDeltaMs || 16) / 1000, 0.1);
          const tPos = 1 - Math.exp(-3 * dt);
          const tLook = 1 - Math.exp(-6 * dt);
          sCam.lerp(camWorld, tPos);
          sLook.lerp(lookAt, tLook);
        }
        camWorld.copy(sCam);
        lookAt.copy(sLook);
      } else if (mode === 'fpv') {
        // Driver POV: slightly forward of car center along headingH,
        // at driver eye height, looking further ahead.
        const fwdDist = this.data.chassisSize.x * 0.15;
        const eyeUp = Math.max(this.data.chassisSize.y * 0.6, 1.2);
        camWorld.set(
          carPos.x + headingH.x * fwdDist,
          carPos.y + eyeUp,
          carPos.z + headingH.z * fwdDist
        );
        lookAt.set(
          carPos.x + headingH.x * 5,
          carPos.y + eyeUp,
          carPos.z + headingH.z * 5
        );
      }
    }

    // ---- World -> camera-parent-local conversion -----------------
    // cameraEl.object3D is a child of cameraRig; treating its
    // .position/.lookAt as world coords is wrong if cameraRig has
    // moved or rotated. Convert explicitly.
    if (camObj.parent) camObj.parent.updateMatrixWorld();

    // Position: convert world -> local.
    const localPos = this._localPos || (this._localPos = new THREE.Vector3());
    localPos.copy(camWorld);
    if (camObj.parent) camObj.parent.worldToLocal(localPos);
    camObj.position.copy(localPos);

    // Rotation: build the world matrix where -Z points from the camera
    // to the look target (this is what an actual THREE.Camera does, and
    // it's the opposite of what Object3D.lookAt does for non-camera
    // objects — which cameraEl.object3D is, since the actual
    // PerspectiveCamera is stored as a child via getObject3D('camera').
    // Using Matrix4.lookAt directly skips that asymmetry.).
    const m = this._tmpMat || (this._tmpMat = new THREE.Matrix4());
    m.lookAt(camWorld, lookAt, worldUp);
    const worldQuat = this._tmpQuat || (this._tmpQuat = new THREE.Quaternion());
    worldQuat.setFromRotationMatrix(m);
    if (camObj.parent) {
      const pq = this._parQuat || (this._parQuat = new THREE.Quaternion());
      camObj.parent.getWorldQuaternion(pq);
      pq.invert();
      worldQuat.premultiply(pq);
    }
    camObj.quaternion.copy(worldQuat);
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

// ---------------------------------------------------------------------
// Component: drive-mode (scene-level bootstrap)
//
// Attach once to the scene. Subscribes to the play-mode system's
// lifecycle events and spawns/cleans up the player car + Rapier world.
//
// This is the bridge between the generic "user pressed Play" signal
// and the drive-specific machinery. Other play-mode features (e.g.
// future managed-street traffic animation) live in their own scene
// components and listen for the same events — they have no idea drive
// mode exists and vice versa.
//
// Activation rules:
//   - Only acts when the scene contains a [drive-controls] entity (the
//     user added a Driveable Vehicle from the layers panel).
//   - If there is none, this component is a no-op: Play still works
//     for whichever other features want to respond (camera freeze,
//     traffic, etc.).
// ---------------------------------------------------------------------
AFRAME.registerComponent('drive-mode', {
  init: function () {
    this.onPlayStart = this.onPlayStart.bind(this);
    this.onPlayStop = this.onPlayStop.bind(this);
    this.el.addEventListener('play-mode-start', this.onPlayStart);
    this.el.addEventListener('play-mode-stop', this.onPlayStop);
    this.cleanup = null;
  },

  remove: function () {
    this.el.removeEventListener('play-mode-start', this.onPlayStart);
    this.el.removeEventListener('play-mode-stop', this.onPlayStop);
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  },

  onPlayStart: function () {
    const sceneEl = this.el;
    const driveEntity = sceneEl.querySelector('[drive-controls]');
    if (!driveEntity) return; // No driveable vehicle → nothing to do.

    const wp = new THREE.Vector3();
    driveEntity.object3D.getWorldPosition(wp);
    // Lift slightly so the chassis doesn't spawn intersecting ground.
    const spawnPos = { x: wp.x, y: Math.max(wp.y, 1), z: wp.z };

    const wq = new THREE.Quaternion();
    driveEntity.object3D.getWorldQuaternion(wq);
    const e = new THREE.Euler().setFromQuaternion(wq, 'YXZ');
    const spawnYawDeg = (e.y * 180) / Math.PI;

    const dcAttrs = driveEntity.getAttribute('drive-controls');

    // Hide the source entity while driving — play-mode-vehicle renders
    // its own debug chassis. Restore on cleanup.
    const prevVisible = driveEntity.object3D.visible;
    driveEntity.object3D.visible = false;

    const parts = [
      `spawnPosition: ${spawnPos.x} ${spawnPos.y} ${spawnPos.z}`,
      `spawnYaw: ${spawnYawDeg}`,
      'cameraSelector: #camera'
    ];

    const meshSlot = driveEntity.querySelector('[vehicle-mesh-slot]');
    const customMixin = meshSlot && meshSlot.getAttribute('mixin');
    // "has custom mesh" = the slot defines a visual either via a
    // catalog mixin OR via a registered procedural component. The
    // list lives in vehicle-presets.js so adding a new procedural
    // mesh component there is a one-line change everywhere.
    const hasProceduralMesh =
      !!meshSlot &&
      PROCEDURAL_MESH_COMPONENTS.some((c) => meshSlot.hasAttribute(c));
    const hasCustomMesh =
      !!(customMixin && customMixin.length) || hasProceduralMesh;

    if (dcAttrs) {
      // drive-controls.vehicleSize is in ENTITY frame (x=width, y=height,
      // z=length). play-mode-vehicle.chassisSize is in CHASSIS frame
      // (x=length, y=height, z=width). Swap X<->Z when forwarding.
      const v = dcAttrs.vehicleSize;
      parts.push(`chassisSize: ${v.z} ${v.y} ${v.x}`);
      parts.push(`accelerateForce: ${dcAttrs.accelerateForce}`);
      parts.push(`brakeForce: ${dcAttrs.brakeForce}`);
      parts.push(`steerAngle: ${dcAttrs.steerAngle}`);
      parts.push(`wheelRadius: ${dcAttrs.wheelRadius}`);
      parts.push(`wheelWidth: ${dcAttrs.wheelWidth}`);
    }
    if (hasCustomMesh) parts.push('showDebugBox: false');

    const car = document.createElement('a-entity');
    car.setAttribute('id', 'play-mode-player-car');
    car.setAttribute('data-no-transform', '');
    car.setAttribute('play-mode-vehicle', parts.join('; '));
    sceneEl.appendChild(car);

    if (hasCustomMesh) {
      const wrapper = document.createElement('a-entity');
      wrapper.setAttribute('rotation', '0 -90 0');
      const meshClone = document.createElement('a-entity');
      // Copy every visual attribute from the editor's mesh slot
      // (mixin OR procedural component, plus any future ones) so we
      // don't have to special-case each kind here. Skip the slot
      // marker, the editor's 180° rotation (the wrapper handles
      // orientation), and stuff that shouldn't be cloned.
      const SKIP_ATTRS = new Set([
        'id',
        'vehicle-mesh-slot',
        'rotation',
        'class',
        'data-aframe-inspector',
        'data-no-transform',
        'data-layer-name'
      ]);
      for (const attr of meshSlot.attributes) {
        if (SKIP_ATTRS.has(attr.name)) continue;
        meshClone.setAttribute(attr.name, attr.value);
      }
      meshClone.setAttribute('shadow', 'cast: true; receive: true');
      wrapper.appendChild(meshClone);
      car.appendChild(wrapper);
    }

    const physics = sceneEl.systems['play-mode-physics'];
    // Token guards against the Stop-before-Rapier-loaded race: if the
    // user stops play before the WASM resolves, this.cleanup will have
    // been called and reset to null, so we skip the late seeding work.
    const myToken = (this._activationToken = {});
    physics.activate().then(() => {
      if (this._activationToken !== myToken) return;
      // Flat ground plane — catches the player when off-street or in
      // an empty scene with just a driveable vehicle.
      physics.addStaticCuboid(
        { x: 0, y: -0.05, z: 0 },
        { x: 200, y: 0.05, z: 200 }
      );
      this.addSegmentColliders(sceneEl);
      this.addOtherVehicleColliders(sceneEl, driveEntity);
    });

    this.cleanup = () => {
      this._activationToken = null;
      if (car && car.parentNode) car.parentNode.removeChild(car);
      driveEntity.object3D.visible = prevVisible;
      if (this._vehicleColliderListeners) {
        for (const { el: el2, fn } of this._vehicleColliderListeners) {
          el2.removeEventListener('model-loaded', fn);
        }
        this._vehicleColliderListeners = null;
      }
      physics.deactivate();
    };
  },

  onPlayStop: function () {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  },

  /**
   * Walk every managed-street's segments and seed a static cuboid
   * matching each segment's visible top surface.
   *
   * Key fact about 3DStreet rendering (see
   * `src/tested/street-segment-utils.js`): the segment's entity
   * origin is positioned at world Y = BASE_SURFACE_DEPTH (0.15) +
   * level × CURB_HEIGHT (0.15), and the visible surface mesh has
   * its TOP face exactly at the entity origin. So a drive lane
   * (level 0) has its visible top at Y=0.15; a sidewalk (level 1)
   * at Y=0.30; an elevated bus stop (level 2) at Y=0.45; etc.
   *
   * Earlier this seeder used the literal constant 0.15 for sidewalk
   * top and skipped drive lanes, which mis-aligned with visuals by
   * 0.15m in both directions (drive-lane wheels sank into the road,
   * sidewalk wheels hovered above the curb). Reading each segment's
   * own world Y is what makes physics match visuals at every level.
   *
   * Curb walls between adjacent segments at different levels emerge
   * automatically from the slab side faces. Slabs are 0.5m deep so
   * the curb walls extend well below the visible bottom and the
   * chassis can't wedge into a gap.
   */
  addSegmentColliders: function (sceneEl) {
    const physics = sceneEl.systems['play-mode-physics'];
    const COLLIDABLE_LANE_TYPES = new Set([
      'drive-lane',
      'bus-lane',
      'bike-lane',
      'sidewalk',
      'parking-lane',
      'divider',
      'grass',
      'rail'
    ]);
    const SLAB_DEPTH = 0.5;
    const halfY = SLAB_DEPTH / 2;

    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    let count = 0;
    sceneEl
      .querySelectorAll('[managed-street] > [street-segment]')
      .forEach((segEl) => {
        const seg = segEl.components?.['street-segment']?.data;
        if (!seg || !COLLIDABLE_LANE_TYPES.has(seg.type)) return;
        const length = seg.length || 60;
        const width = seg.width || 1.5;
        segEl.object3D.updateMatrixWorld();
        segEl.object3D.getWorldPosition(wp);
        segEl.object3D.getWorldQuaternion(wq);
        // Visible top = segment world Y. Place slab so its TOP face
        // is exactly there: center the cuboid halfY below segWorldY.
        physics.addStaticCuboid(
          { x: wp.x, y: wp.y - halfY, z: wp.z },
          { x: width / 2, y: halfY, z: length / 2 },
          { x: wq.x, y: wq.y, z: wq.z, w: wq.w }
        );
        count++;
      });
    console.log(
      '[drive-mode] seeded',
      count,
      'per-segment slabs (tops at each segment world Y; curbs emerge from level differences)'
    );
  },

  /**
   * Walk the scene for entities whose mixin's <a-mixin category> starts
   * with "vehicles", "cyclists", or "buildings" and seed a static
   * cuboid collider
   * sized to each one's world-frame bounding box. The player's own
   * Driveable Vehicle (and its descendants) is skipped — that's the
   * dynamic chassis. Bounding boxes are re-evaluated on model-loaded
   * since GLBs load async.
   */
  addOtherVehicleColliders: function (sceneEl, driveEntity) {
    const physics = sceneEl.systems['play-mode-physics'];
    // 'vehicles' and 'cyclists' catch parked cars / static cyclists on
    // non-playable streets. 'buildings' is the Tier-2 add — a car
    // driving through a wall is the highest-signal break in
    // suspension of disbelief, so seed those too. Street furniture
    // (poles/benches/trees) deferred until users actually complain.
    const COLLIDABLE_CATEGORIES = ['vehicles', 'cyclists', 'buildings'];
    const isVehicleMixin = (id) => {
      const mixin = document.getElementById(id);
      if (!mixin || mixin.tagName !== 'A-MIXIN') return false;
      const cat = mixin.getAttribute('category') || '';
      return COLLIDABLE_CATEGORIES.some((c) => cat.indexOf(c) === 0);
    };
    const playerCar = sceneEl.querySelector('#play-mode-player-car');
    const isCandidate = (el) => {
      if (!el || el === driveEntity) return false;
      if (driveEntity && driveEntity.contains(el)) return false;
      // The player's own cloned mesh (mixin or procedural) lives
      // under play-mode-player-car. Skip it so we don't seed a
      // phantom static collider at the spawn point.
      if (playerCar && playerCar.contains(el)) return false;
      // Animated traffic gets kinematic colliders from
      // managed-street-traffic; don't double-seed with static cuboids.
      if (el.hasAttribute('data-play-mode-traffic')) return false;
      // Skip entities that traffic has hidden — they're visually gone,
      // so a static collider sitting at their last pose would just
      // produce phantom collisions.
      if (el.object3D && !el.object3D.visible) return false;
      const mixinAttr = el.getAttribute('mixin');
      if (!mixinAttr) return false;
      return mixinAttr.split(/\s+/).some(isVehicleMixin);
    };
    const listeners = [];
    // Bounding boxes wrap the mesh's full AABB which is generally
    // larger than the visible silhouette; shrink to 80% so the collider
    // feels closer to the mesh visually.
    const COLLIDER_SHRINK = 0.8;
    const add = (el) => {
      const box = new THREE.Box3().setFromObject(el.object3D);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return;
      const half = COLLIDER_SHRINK / 2;
      physics.addStaticCuboid(
        { x: center.x, y: center.y, z: center.z },
        { x: size.x * half, y: size.y * half, z: size.z * half }
      );
    };

    sceneEl.querySelectorAll('[mixin]').forEach((el) => {
      if (!isCandidate(el)) return;
      add(el);
      const onLoaded = () => add(el);
      el.addEventListener('model-loaded', onLoaded);
      listeners.push({ el, fn: onLoaded });
    });

    this._vehicleColliderListeners = listeners;
  }
});
