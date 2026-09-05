/* global AFRAME, THREE */
const {
  seedSegmentColliders,
  seedObstacleColliders
} = require('./scene-colliders.js');
const { attachTilesColliders } = require('./tiles-colliders.js');

/**
 * fly-mode
 * ========
 *
 * GTA / Battlefield-style helicopter flying for play mode — the
 * eager, scene-level half. Two pieces:
 *
 *   1. `fly-controls` component — editor-time marker + tunables. Tag
 *      an entity with it (the "Flyable Helicopter" layer card does)
 *      and Play spawns the player helicopter at its pose. Inert at
 *      edit time apart from a forward-direction cone.
 *
 *   2. `fly-mode` scene component — the play-mode-start bootstrap,
 *      mirroring `drive-mode`. Registers the 'fly' control mode +
 *      'fly-controls' playable check, spawns/tears down the player
 *      helicopter, and seeds the same street/obstacle colliders the
 *      car uses (shared `scene-colliders.js`) so you can land on
 *      sidewalks and crash into buildings.
 *
 * The rig itself (`play-mode-helicopter` component + flight model +
 * procedural audio, ~23 KB minified) is a lazy webpack chunk loaded on
 * first Play, in parallel with the Rapier WASM — the core bundle sits
 * at its 4 MiB budget. Only this file and `helicopter-mesh.js` (needed
 * at edit time) load eagerly.
 *
 * If the scene also contains a [drive-controls] entity, drive mode
 * wins the play session and fly-mode stays idle (one player rig per
 * session — they'd otherwise fight over the camera, gamepad, and the
 * single chassis-contact listener slot).
 */

let rigLoadPromise = null;
/** Lazy-load the player rig module (registers `play-mode-helicopter`). */
function loadRig() {
  if (!rigLoadPromise) {
    rigLoadPromise = import(
      /* webpackChunkName: "fly-mode-rig" */ './play-mode-helicopter.js'
    )
      .then((mod) => mod.default || mod)
      .catch((err) => {
        rigLoadPromise = null;
        throw err;
      });
  }
  return rigLoadPromise;
}

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
    // Max rotor thrust, in multiples of gravity. The vertical-speed
    // servo spends the headroom above 1.0 on climbing and on braking
    // descents — below ~1.2 the helicopter gets sluggish to arrest.
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

    // Hide the parked source helicopter while flying; restored on stop.
    const prevVisible = flyEntity.object3D.visible;
    flyEntity.object3D.visible = false;

    const physics = sceneEl.systems['play-mode-physics'];
    const myToken = (this._activationToken = {});
    let heli = null;
    // Rig chunk + Rapier WASM load in parallel; a Stop before either
    // resolves invalidates the token and nothing is spawned.
    Promise.all([loadRig(), physics.activate()]).then(([rig]) => {
      if (this._activationToken !== myToken) return;

      const wp = new THREE.Vector3();
      flyEntity.object3D.getWorldPosition(wp);
      const spawnPos = {
        x: wp.x,
        y: Math.max(wp.y, 0) + rig.SPAWN_LIFT,
        z: wp.z
      };

      const wq = new THREE.Quaternion();
      flyEntity.object3D.getWorldQuaternion(wq);
      const e = new THREE.Euler().setFromQuaternion(wq, 'YXZ');
      const spawnYawDeg = (e.y * 180) / Math.PI;

      const fcAttrs = flyEntity.getAttribute('fly-controls');
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

      heli = document.createElement('a-entity');
      heli.setAttribute('id', 'play-mode-player-heli');
      heli.setAttribute('data-no-transform', '');
      heli.setAttribute('play-mode-helicopter', parts.join('; '));

      // Visual: fresh procedural helicopter-mesh child, copying the
      // source entity's mesh config (colors) so editor customization
      // carries into the flight. No wrapper rotation needed — the
      // mesh's nose (-Z) matches the rig's forward convention.
      const mesh = document.createElement('a-entity');
      const meshData = flyEntity.getAttribute('helicopter-mesh');
      mesh.setAttribute('helicopter-mesh', meshData || '');
      heli.appendChild(mesh);
      sceneEl.appendChild(heli);

      // Google 3D Tiles get real trimesh colliders (terrain +
      // photogrammetry buildings). When a tileset is present the flat
      // ground pad would sit ABOVE tile terrain that dips below y=0,
      // so it drops to a deep safety net that only catches falls
      // through tile holes.
      this._tilesColliders = attachTilesColliders(sceneEl);
      const padY = this._tilesColliders ? -250 : -0.05;
      // Big flat ground plane — helicopters outrun the car's 200m pad
      // quickly, so give the sky sandbox a wider floor.
      physics.addStaticCuboid(
        { x: 0, y: padY, z: 0 },
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
      if (this._tilesColliders) {
        this._tilesColliders.dispose();
        this._tilesColliders = null;
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
