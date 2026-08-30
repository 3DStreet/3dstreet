/* global AFRAME, THREE */
const {
  createHeliState,
  stepHeliState,
  computeHeliForces
} = require('./heli-flight-model.js');
const {
  seedSegmentColliders,
  seedObstacleColliders
} = require('./scene-colliders.js');

/**
 * play-mode-helicopter
 * ====================
 *
 * GTA / Battlefield-style helicopter flying for play mode, layered on
 * the same Rapier infrastructure as drive mode (`play-mode-physics`
 * system in play-mode-vehicle.js). Three pieces, all in this file:
 *
 *   1. `fly-controls` component — editor-time marker + tunables. Tag
 *      an entity with it (the "Flyable Helicopter" layer card does)
 *      and Play spawns the player helicopter at its pose. Inert at
 *      edit time apart from a forward-direction cone.
 *
 *   2. `play-mode-helicopter` component — the flying player rig.
 *      Creates a dynamic cuboid chassis body and, each physics
 *      sub-step, applies the forces from the pure flight model in
 *      `heli-flight-model.js` (rotor thrust along body-up, cyclic /
 *      yaw torques, auto-level, hover assist). Renders via the
 *      procedural `helicopter-mesh`.
 *
 *   3. `fly-mode` scene component — the play-mode-start bootstrap,
 *      mirroring `drive-mode`. Registers the 'fly' control mode +
 *      'fly-controls' playable check, spawns/tears down the player
 *      helicopter, and seeds the same street/obstacle colliders the
 *      car uses (shared `scene-colliders.js`) so you can land on
 *      sidewalks and crash into buildings.
 *
 * Controls (keyboard):
 *   W / S            collective up / down (throttle lever)
 *   A / D            yaw left / right
 *   Arrow keys       cyclic — Up = nose down (fly forward), Down =
 *                    nose up, Left / Right = roll
 *   Space            hover assist (levels out + brakes drift + trims
 *                    collective to hover)
 *   C                camera mode (chase / fpv / top-down)
 *   R                reset run
 * Gamepad (standard mapping, wired in play-mode.pollGamepad):
 *   RT / LT collective · left stick cyclic · LB / RB yaw · B assist ·
 *   right stick chase-cam orbit/zoom · Y reset · X camera ·
 *   Start pause · Back stop
 *
 * If the scene also contains a [drive-controls] entity, drive mode
 * wins the play session and fly-mode stays idle (one player rig per
 * session — they'd otherwise fight over the camera, gamepad, and the
 * single chassis-contact listener slot).
 */

// Chassis-frame collider half-extents. Sized to the helicopter-mesh
// fuselage + skids (skids at local y=-0.9, rotor hub at +1.0; the
// rotor disc itself is deliberately NOT part of the collider — an
// invisible 5m collision disc feels unfair when threading buildings).
const COLLIDER_HALF = { x: 0.7, y: 0.95, z: 2.2 };
// How high above the fly-controls entity's origin the body spawns so
// the skids (collider bottom) start on, not in, the ground.
const SPAWN_LIFT = COLLIDER_HALF.y + 0.1;
// Visual rotor speed at full collective, rad/s.
const ROTOR_VISUAL_MAX = 40;
const ROTOR_VISUAL_IDLE = 6;

// ---------------------------------------------------------------------
// Component: fly-controls (editor-time marker)
//
// Mirrors drive-controls: the schema exposes the runtime tunables in
// the properties panel, values are serialized with the scene, and at
// play time fly-mode forwards them onto the spawned player rig. The
// entity's own visual is the `helicopter-mesh` component (added by the
// layer card) — this component only contributes the forward cone.
// ---------------------------------------------------------------------
AFRAME.registerComponent('fly-controls', {
  schema: {
    // Rotor thrust at full collective, in multiples of gravity.
    // 1.0 can only hover at full lever; 2.2 gives a brisk climb.
    liftPower: { type: 'number', default: 2.2 },
    // Scales cyclic (pitch/roll) authority.
    agility: { type: 'number', default: 1 },
    // Scales yaw (pedal) authority.
    yawRate: { type: 'number', default: 1 },
    // Auto-level spring strength. 0 = raw physics (experts only),
    // 2 = very docile.
    stability: { type: 'number', default: 1 }
  },

  init: function () {
    // Yellow forward-direction cone, same convention as drive-controls:
    // forward is the entity's local -Z (and the helicopter-mesh nose).
    if (this.el.querySelector('[data-fly-controls-marker]')) return;
    const cone = document.createElement('a-entity');
    cone.setAttribute('data-fly-controls-marker', '');
    cone.setAttribute('data-layer-name', 'Forward Direction');
    cone.setAttribute(
      'geometry',
      'primitive: cone; radiusBottom: 0.14; radiusTop: 0; height: 0.55; segmentsRadial: 12'
    );
    cone.setAttribute('material', 'color: #ffd54a; shader: flat');
    cone.setAttribute('rotation', '-90 0 0');
    cone.setAttribute('position', '0 0.2 -2.3');
    cone.setAttribute('data-no-transform', '');
    cone.setAttribute('data-aframe-inspector', 'autocreated');
    this._marker = cone;
    this.el.appendChild(cone);
  },

  remove: function () {
    if (this._marker && this._marker.parentNode) {
      this._marker.parentNode.removeChild(this._marker);
    }
  }
});

// ---------------------------------------------------------------------
// Component: the flying player rig. Attach to an entity and it becomes
// a flyable helicopter (once the play-mode-physics system is active).
// ---------------------------------------------------------------------
AFRAME.registerComponent('play-mode-helicopter', {
  schema: {
    spawnPosition: { type: 'vec3', default: { x: 0, y: 1, z: 0 } },
    spawnYaw: { type: 'number', default: 0 }, // degrees around world Y
    liftPower: { type: 'number', default: 2.2 },
    agility: { type: 'number', default: 1 },
    yawRate: { type: 'number', default: 1 },
    stability: { type: 'number', default: 1 },
    cameraSelector: { type: 'string', default: '#camera' },
    cameraHeight: { type: 'number', default: 30 }, // top-down mode
    cameraMode: {
      type: 'string',
      default: 'chase',
      oneOf: ['chase', 'fpv', 'top-down']
    }
  },

  init: async function () {
    this.system = this.el.sceneEl.systems['play-mode-physics'];
    if (!this.system) {
      console.error('play-mode-helicopter: play-mode-physics system missing');
      return;
    }
    this.state = createHeliState();
    this.input = {
      collUp: false,
      collDown: false,
      yawLeft: false,
      yawRight: false,
      pitchFwd: false,
      pitchBack: false,
      rollLeft: false,
      rollRight: false,
      assist: false,
      // Analog gamepad overrides (set by play-mode.pollGamepad). When
      // non-zero they preempt the boolean keys above.
      collectiveAxis: 0,
      pitchAxis: 0,
      rollAxis: 0,
      yawAxis: 0,
      padAssist: false
    };
    this.keymap = {
      KeyW: 'collUp',
      KeyS: 'collDown',
      KeyA: 'yawLeft',
      KeyD: 'yawRight',
      ArrowUp: 'pitchFwd',
      ArrowDown: 'pitchBack',
      ArrowLeft: 'rollLeft',
      ArrowRight: 'rollRight',
      Space: 'assist'
    };
    this.onKeyDown = (e) => {
      if (this.keymap[e.code]) {
        this.input[this.keymap[e.code]] = true;
        e.preventDefault();
      } else if (e.code === 'KeyC') {
        this.cycleCameraMode();
        e.preventDefault();
      } else if (e.code === 'KeyR') {
        this.el.sceneEl.systems['play-mode']?.reset();
        e.preventDefault();
      }
    };
    this.onKeyUp = (e) => {
      if (this.keymap[e.code]) this.input[this.keymap[e.code]] = false;
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Chase-cam zoom (wheel) + orbit (left-drag on canvas) — same
    // interaction scheme as play-mode-vehicle so switching between
    // driving and flying feels consistent.
    this.chaseZoom = 1;
    this.chaseYaw = 0;
    this._chaseDragging = false;
    this.onChaseWheel = (e) => {
      if (this.data.cameraMode !== 'chase') return;
      const factor = Math.exp(e.deltaY * 0.001);
      this.chaseZoom = THREE.MathUtils.clamp(this.chaseZoom * factor, 0.4, 4);
      e.preventDefault();
    };
    this.onChasePointerDown = (e) => {
      if (e.button !== 0) return;
      if (this.data.cameraMode !== 'chase') return;
      const canvas = this.el.sceneEl && this.el.sceneEl.canvas;
      if (!canvas || e.target !== canvas) return;
      this._chaseDragging = true;
      this._chaseDragLastX = e.clientX;
      if (canvas.setPointerCapture && e.pointerId !== undefined) {
        try {
          canvas.setPointerCapture(e.pointerId);
          this._chasePointerId = e.pointerId;
        } catch (_) {}
      }
      e.preventDefault();
    };
    this.onChasePointerMove = (e) => {
      if (!this._chaseDragging) return;
      const dx = e.clientX - this._chaseDragLastX;
      this._chaseDragLastX = e.clientX;
      this.chaseYaw += dx * 0.005;
    };
    this.onChasePointerUp = (e) => {
      if (!this._chaseDragging) return;
      this._chaseDragging = false;
      const canvas = this.el.sceneEl && this.el.sceneEl.canvas;
      if (
        canvas &&
        canvas.releasePointerCapture &&
        this._chasePointerId !== undefined
      ) {
        try {
          canvas.releasePointerCapture(this._chasePointerId);
        } catch (_) {}
        this._chasePointerId = undefined;
      }
    };
    // Non-passive wheel listener scoped to the scene canvas (see the
    // rationale in play-mode-vehicle.init).
    this._wheelTarget = this.el.sceneEl.canvas || window;
    this._wheelTarget.addEventListener('wheel', this.onChaseWheel, {
      passive: false
    });
    window.addEventListener('pointerdown', this.onChasePointerDown);
    window.addEventListener('pointermove', this.onChasePointerMove);
    window.addEventListener('pointerup', this.onChasePointerUp);
    window.addEventListener('pointercancel', this.onChasePointerUp);

    // Toolbar Reset / R key / gamepad Y: snap back to spawn with the
    // rotor still spooled but the collective dropped, and forget the
    // pre-reset crash record (see play-mode-vehicle.onPlayModeReset).
    this.onPlayModeReset = () => {
      this.chaseZoom = 1;
      this.chaseYaw = 0;
      this._lastCollisionAt = null;
      this.state.collective = 0;
      if (!this.chassisBody) return;
      this.chassisBody.setTranslation(this.data.spawnPosition, true);
      this.chassisBody.setRotation(this.spawnQuat, true);
      this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const obj = this.el.object3D;
      obj.position.set(
        this.data.spawnPosition.x,
        this.data.spawnPosition.y,
        this.data.spawnPosition.z
      );
      obj.quaternion.set(
        this.spawnQuat.x,
        this.spawnQuat.y,
        this.spawnQuat.z,
        this.spawnQuat.w
      );
    };
    this.el.sceneEl.addEventListener('play-mode-reset', this.onPlayModeReset);

    // Boot physics, then build. Stop can land while the Rapier WASM is
    // still loading — bail instead of building a ghost body.
    await this.system.activate();
    if (!this.el.isConnected || !this.system.active) return;
    this.buildHelicopter();
  },

  buildHelicopter: function () {
    const data = this.data;
    const world = this.system.world;
    // The Rapier module instance the physics system loaded (exposed by
    // play-mode-physics.activate) — no second import of the WASM chunk.
    const R = this.system.RAPIER;

    // Spawn orientation: entity -Z (nose) faces world yaw direction.
    const yawRad = (data.spawnYaw * Math.PI) / 180;
    const spawnQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, yawRad, 0)
    );
    this.spawnQuat = spawnQuat;

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(
        data.spawnPosition.x,
        data.spawnPosition.y,
        data.spawnPosition.z
      )
      .setRotation(spawnQuat)
      // Arcade aerodynamics: linear damping caps top speed / fall rate,
      // angular damping steadies rotation (the flight model adds its
      // own tilt-rate damper on top).
      .setLinearDamping(0.35)
      .setAngularDamping(2.0)
      .setCanSleep(false);
    const chassisBody = world.createRigidBody(bodyDesc);
    const chassisCollider = world.createCollider(
      R.ColliderDesc.cuboid(
        COLLIDER_HALF.x,
        COLLIDER_HALF.y,
        COLLIDER_HALF.z
      ).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      chassisBody
    );
    this.chassisBody = chassisBody;
    this.system.colliderTags.set(chassisCollider.handle, 'chassis');
    this.system.registerSync(chassisBody, this.el);
    this.system.setChassisContactListener(chassisCollider.handle, (info) =>
      this.onChassisContact(info)
    );

    // Fly the model inside the physics after-step hook so forces land
    // deterministically once per sub-step.
    this._afterStep = (dt) => this.flightStep(dt);
    this.system.onAfterStep(this._afterStep);

    this.cameraEl = document.querySelector(this.data.cameraSelector) || null;

    // Let listeners (FlyModeControls panel) know the helicopter exists.
    this.el.emit('heli-built', {}, true);
  },

  /** Collapse keyboard booleans + analog overrides into -1..1 axes. */
  readInputAxes: function () {
    const i = this.input;
    return {
      collective:
        i.collectiveAxis !== 0
          ? i.collectiveAxis
          : (i.collUp ? 1 : 0) - (i.collDown ? 1 : 0),
      pitch:
        i.pitchAxis !== 0
          ? i.pitchAxis
          : (i.pitchFwd ? 1 : 0) - (i.pitchBack ? 1 : 0),
      roll:
        i.rollAxis !== 0
          ? i.rollAxis
          : (i.rollRight ? 1 : 0) - (i.rollLeft ? 1 : 0),
      yaw:
        i.yawAxis !== 0
          ? i.yawAxis
          : (i.yawLeft ? 1 : 0) - (i.yawRight ? 1 : 0),
      assist: i.assist || i.padAssist
    };
  },

  flightStep: function (dt) {
    const body = this.chassisBody;
    if (!body) return;
    const axes = this.readInputAxes();
    const params = {
      liftPower: this.data.liftPower,
      agility: this.data.agility,
      yawRate: this.data.yawRate,
      stability: this.data.stability
    };
    stepHeliState(this.state, axes, dt, params);
    const { force, torque } = computeHeliForces(
      this.state,
      axes,
      {
        mass: body.mass(),
        rotation: body.rotation(),
        angvel: body.angvel(),
        linvel: body.linvel()
      },
      params
    );
    body.resetForces(true);
    body.addForce(force, true);
    body.resetTorques(true);
    body.addTorque(torque, true);
  },

  /**
   * Chassis-impact handler — identical de-dupe scheme to
   * play-mode-vehicle.onChassisContact (one marker per incident).
   */
  onChassisContact: function (info) {
    if (!this.chassisBody) return;
    const sceneEl = this.el.sceneEl;
    const timer = sceneEl.components['scene-timer'];
    const simMs = timer ? timer.simulationTime || 0 : 0;
    const t = this.chassisBody.translation();
    if (this._lastCollisionAt != null) {
      const dtMs = Math.abs(simMs - this._lastCollisionAt.simMs);
      const dx = t.x - this._lastCollisionAt.x;
      const dz = t.z - this._lastCollisionAt.z;
      const distSq = dx * dx + dz * dz;
      if (dtMs < 1000 && distSq < 1.5 * 1.5) return;
    }
    this._lastCollisionAt = { simMs, x: t.x, y: t.y, z: t.z };
    sceneEl.emit(
      'play-mode-collision',
      {
        simulationTime: simMs,
        position: { x: t.x, y: t.y, z: t.z },
        otherTag: info.otherTag
      },
      false
    );
  },

  tick: function (time, deltaMs) {
    if (!this.chassisBody) return;
    this._lastDeltaMs = deltaMs;

    // Spin the rotors on the child mesh: idle + collective-proportional.
    const meshEl = this.el.querySelector('[helicopter-mesh]');
    const meshComp = meshEl && meshEl.components['helicopter-mesh'];
    if (meshComp) {
      meshComp.rotorSpeed =
        this.state.spool *
        (ROTOR_VISUAL_IDLE +
          this.state.collective * (ROTOR_VISUAL_MAX - ROTOR_VISUAL_IDLE));
    }

    if (this.cameraEl) this.updateCamera();
  },

  cycleCameraMode: function () {
    const order = ['chase', 'fpv', 'top-down'];
    const i = order.indexOf(this.data.cameraMode);
    const next = order[(i + 1) % order.length];
    this._cameraSmoothed = false;
    this.chaseZoom = 1;
    this.chaseYaw = 0;
    this.el.setAttribute('play-mode-helicopter', 'cameraMode', next);
  },

  updateCamera: function () {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    const camObj = this.cameraEl.object3D;
    const mode = this.data.cameraMode;

    const heliPos = this._heliPos || (this._heliPos = new THREE.Vector3());
    const camWorld = this._camWorld || (this._camWorld = new THREE.Vector3());
    const lookAt = this._lookAt || (this._lookAt = new THREE.Vector3());
    const worldUp =
      this._worldUp || (this._worldUp = new THREE.Vector3(0, 1, 0));
    heliPos.set(t.x, t.y, t.z);

    if (mode !== 'chase') this._cameraSmoothed = false;

    if (mode === 'top-down') {
      camWorld.set(t.x, t.y + this.data.cameraHeight, t.z);
      lookAt.copy(heliPos);
    } else {
      // Horizontal heading = body -Z (the nose) projected onto the
      // world XZ plane so body pitch/roll doesn't tilt the camera.
      const q = this._quat || (this._quat = new THREE.Quaternion());
      q.set(r.x, r.y, r.z, r.w);
      const headingH = this._headingH || (this._headingH = new THREE.Vector3());
      headingH.set(0, 0, -1).applyQuaternion(q);
      headingH.y = 0;
      if (headingH.lengthSq() < 1e-4) {
        headingH.set(0, 0, -1);
      } else {
        headingH.normalize();
      }

      if (mode === 'chase') {
        // Longer leash than the car: helicopters cover more sky.
        const distance = 11 * this.chaseZoom;
        const height = 4 * this.chaseZoom;
        const yawCos = Math.cos(this.chaseYaw);
        const yawSin = Math.sin(this.chaseYaw);
        const ox = headingH.x * yawCos - headingH.z * yawSin;
        const oz = headingH.x * yawSin + headingH.z * yawCos;
        camWorld.set(
          heliPos.x - ox * distance,
          heliPos.y + height,
          heliPos.z - oz * distance
        );
        lookAt.set(heliPos.x, heliPos.y + 1.2, heliPos.z);

        const sCam =
          this._smoothedCamPos || (this._smoothedCamPos = new THREE.Vector3());
        const sLook =
          this._smoothedLookAt || (this._smoothedLookAt = new THREE.Vector3());
        if (!this._cameraSmoothed) {
          sCam.copy(camWorld);
          sLook.copy(lookAt);
          this._cameraSmoothed = true;
        } else {
          const dt = Math.min((this._lastDeltaMs || 16) / 1000, 0.1);
          const tPos = 1 - Math.exp(-3 * dt);
          const tLook = 1 - Math.exp(-6 * dt);
          sCam.lerp(camWorld, tPos);
          sLook.lerp(lookAt, tLook);
        }
        camWorld.copy(sCam);
        lookAt.copy(sLook);
      } else {
        // fpv: cockpit — just behind the nose glass at eye height,
        // looking ahead along the horizontal heading.
        camWorld.set(
          heliPos.x + headingH.x * 0.9,
          heliPos.y + 0.35,
          heliPos.z + headingH.z * 0.9
        );
        lookAt.set(
          heliPos.x + headingH.x * 12,
          heliPos.y + 0.35,
          heliPos.z + headingH.z * 12
        );
      }
    }

    // World -> camera-parent-local conversion (rig may be moved) — see
    // play-mode-vehicle.updateCamera for the full rationale.
    if (camObj.parent) camObj.parent.updateMatrixWorld();
    const localPos = this._localPos || (this._localPos = new THREE.Vector3());
    localPos.copy(camWorld);
    if (camObj.parent) camObj.parent.worldToLocal(localPos);
    camObj.position.copy(localPos);

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
    if (this._wheelTarget) {
      this._wheelTarget.removeEventListener('wheel', this.onChaseWheel);
    }
    window.removeEventListener('pointerdown', this.onChasePointerDown);
    window.removeEventListener('pointermove', this.onChasePointerMove);
    window.removeEventListener('pointerup', this.onChasePointerUp);
    window.removeEventListener('pointercancel', this.onChasePointerUp);
    if (this.onPlayModeReset) {
      this.el.sceneEl.removeEventListener(
        'play-mode-reset',
        this.onPlayModeReset
      );
    }
    if (this.system && this._afterStep) {
      this.system.offAfterStep(this._afterStep);
      this._afterStep = null;
    }
    if (this.system) this.system.clearChassisContactListener();
    if (this.system && this.chassisBody) {
      this.system.unregisterSync(this.chassisBody);
      if (this.system.world) {
        this.system.world.removeRigidBody(this.chassisBody);
      }
      this.chassisBody = null;
    }
  }
});

// ---------------------------------------------------------------------
// Component: fly-mode (scene-level bootstrap) — the flying counterpart
// of drive-mode. Attach once to the scene.
// ---------------------------------------------------------------------
AFRAME.registerComponent('fly-mode', {
  init: function () {
    this.onPlayStart = this.onPlayStart.bind(this);
    this.onPlayStop = this.onPlayStop.bind(this);
    this.onPlayModeStart = this.onPlayModeStart.bind(this);
    this.onPlayModeStop = this.onPlayModeStop.bind(this);
    this.cleanup = null;
    const mgr = this.el.systems['mode-manager'];
    if (mgr) {
      mgr.registerMode('fly', {
        enter: this.onPlayStart,
        exit: this.onPlayStop
      });
      mgr.registerPlayableCheck(
        'fly-controls',
        () => !!this.el.querySelector('[fly-controls]')
      );
    }
    this.el.addEventListener('play-mode-start', this.onPlayModeStart);
    this.el.addEventListener('play-mode-stop', this.onPlayModeStop);
  },

  remove: function () {
    const mgr = this.el.systems['mode-manager'];
    if (mgr) {
      mgr.registerMode('fly', { enter: () => {}, exit: () => {} });
      mgr.registerPlayableCheck('fly-controls', () => false);
    }
    this.el.removeEventListener('play-mode-start', this.onPlayModeStart);
    this.el.removeEventListener('play-mode-stop', this.onPlayModeStop);
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  },

  onPlayModeStart: function () {
    const mgr = this.el.systems['mode-manager'];
    if (!mgr || !this.el.querySelector('[fly-controls]')) return;
    // One player rig per session: when a driveable vehicle is also in
    // the scene, drive-mode claims the play session (camera, gamepad,
    // contact-listener slot) and the helicopter stays parked scenery.
    if (this.el.querySelector('[drive-controls]')) return;
    const cameraEl = document.getElementById('camera');
    this._savedCameraPose = cameraEl
      ? {
          position: cameraEl.object3D.position.clone(),
          rotation: cameraEl.object3D.rotation.clone()
        }
      : null;
    mgr.setMode('fly');
  },

  onPlayModeStop: function () {
    const mgr = this.el.systems['mode-manager'];
    if (!mgr || mgr.getMode() !== 'fly') return;
    mgr.setMode('viewer');
    const cameraEl = document.getElementById('camera');
    if (cameraEl && this._savedCameraPose) {
      cameraEl.object3D.position.copy(this._savedCameraPose.position);
      cameraEl.object3D.rotation.copy(this._savedCameraPose.rotation);
      this._savedCameraPose = null;
    }
  },

  onPlayStart: function () {
    const sceneEl = this.el;
    const flyEntity = sceneEl.querySelector('[fly-controls]');
    if (!flyEntity) return;
    sceneEl.systems['mode-manager'].activateSceneCamera();
    sceneEl.emit('fly-mode-start', {}, false);

    const wp = new THREE.Vector3();
    flyEntity.object3D.getWorldPosition(wp);
    const spawnPos = { x: wp.x, y: Math.max(wp.y, 0) + SPAWN_LIFT, z: wp.z };

    const wq = new THREE.Quaternion();
    flyEntity.object3D.getWorldQuaternion(wq);
    const e = new THREE.Euler().setFromQuaternion(wq, 'YXZ');
    const spawnYawDeg = (e.y * 180) / Math.PI;

    const fcAttrs = flyEntity.getAttribute('fly-controls');

    // Hide the parked source helicopter while flying; restored on stop.
    const prevVisible = flyEntity.object3D.visible;
    flyEntity.object3D.visible = false;

    const parts = [
      `spawnPosition: ${spawnPos.x} ${spawnPos.y} ${spawnPos.z}`,
      `spawnYaw: ${spawnYawDeg}`,
      'cameraSelector: #camera'
    ];
    if (fcAttrs) {
      parts.push(`liftPower: ${fcAttrs.liftPower}`);
      parts.push(`agility: ${fcAttrs.agility}`);
      parts.push(`yawRate: ${fcAttrs.yawRate}`);
      parts.push(`stability: ${fcAttrs.stability}`);
    }

    const heli = document.createElement('a-entity');
    heli.setAttribute('id', 'play-mode-player-heli');
    heli.setAttribute('data-no-transform', '');
    heli.setAttribute('play-mode-helicopter', parts.join('; '));

    // Visual: fresh procedural helicopter-mesh child, copying the
    // source entity's mesh config (colors) so editor customization
    // carries into the flight. No wrapper rotation needed — the mesh's
    // nose (-Z) matches the rig's forward convention.
    const mesh = document.createElement('a-entity');
    const meshData = flyEntity.getAttribute('helicopter-mesh');
    mesh.setAttribute('helicopter-mesh', meshData || '');
    heli.appendChild(mesh);
    sceneEl.appendChild(heli);

    const physics = sceneEl.systems['play-mode-physics'];
    const myToken = (this._activationToken = {});
    physics.activate().then(() => {
      if (this._activationToken !== myToken) return;
      // Big flat ground plane — helicopters outrun the car's 200m pad
      // quickly, so give the sky sandbox a wider floor.
      physics.addStaticCuboid(
        { x: 0, y: -0.05, z: 0 },
        { x: 1000, y: 0.05, z: 1000 },
        undefined,
        'ground'
      );
      seedSegmentColliders(sceneEl);
      this._obstacleListeners = seedObstacleColliders(sceneEl, [
        flyEntity,
        heli
      ]);
    });

    this.cleanup = () => {
      this._activationToken = null;
      if (heli && heli.parentNode) heli.parentNode.removeChild(heli);
      flyEntity.object3D.visible = prevVisible;
      if (this._obstacleListeners) {
        for (const { el: el2, fn } of this._obstacleListeners) {
          el2.removeEventListener('model-loaded', fn);
        }
        this._obstacleListeners = null;
      }
      physics.deactivate();
    };
  },

  onPlayStop: function () {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
      this.el.emit('fly-mode-stop', {}, false);
    }
    this.el.systems['mode-manager'].activateEditorCamera();
  }
});
