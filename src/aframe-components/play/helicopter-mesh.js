/* global AFRAME */

/**
 * helicopter-mesh
 * ===============
 *
 * Procedural helicopter visual — no GLB download, no trademarked
 * livery. The silhouette and proportions follow a medium twin-engine
 * SAR helicopter in the Eurocopter MH-65 Dolphin class at real scale:
 * ~12 m fuselage, ~12 m four-blade main rotor, ~4 m tall, shrouded
 * tail fan (fenestron) in a swept fin, tricycle wheeled gear, and the
 * search-and-rescue orange body with a white boom band and dark
 * radome nose. Built from spheres / cylinders / cones / tori / boxes
 * in `init()` so it reads as smooth rather than blocky.
 *
 * Local axes: -Z is forward (nose direction — matches A-Frame's
 * default forward and the `fly-controls` cone marker; note this
 * differs from the catalog +Z convention delivery-bot-mesh follows,
 * so no wrapper rotation is needed anywhere in the fly pipeline).
 * +Y up; origin at the fuselage center. Wheels touch local y ≈ -1.8,
 * the main-rotor hub sits at y = +2.1; nose tip at z ≈ -4.6, fenestron
 * shroud ends at z ≈ +8.2. `play-mode-helicopter`'s COLLIDER_HALF /
 * SPAWN_LIFT and the layer-panel click box are sized to these numbers.
 *
 * Rotor animation: `play-mode-helicopter` pokes `this.rotorSpeed`
 * (rad/s) directly each frame — a property write, not setAttribute,
 * since it changes every tick. tick() integrates the angles onto the
 * rotor groups and swaps blades for translucent "blur discs" above a
 * speed threshold. At edit time rotorSpeed stays 0 and the blades
 * hold still.
 */

const BLUR_THRESHOLD = 18; // rad/s above which blades become a blur disc
const TAIL_ROTOR_RATIO = 4.6; // fenestron spins this much faster
const MAIN_BLADES = 4;
const FAN_BLADES = 10;
const MAIN_ROTOR_RADIUS = 5.95; // m — ~11.9 m disc
const HUB_Y = 2.1;

AFRAME.registerComponent('helicopter-mesh', {
  schema: {
    bodyColor: { type: 'color', default: '#f4551f' },
    accentColor: { type: 'color', default: '#f4f4f2' },
    glassColor: { type: 'color', default: '#7fb6d2' },
    rotorColor: { type: 'color', default: '#242424' }
  },

  init: function () {
    this._spawned = [];
    // rad/s, poked by play-mode-helicopter while flying.
    this.rotorSpeed = 0;
    // Small cyclic-input disc tilt (radians), also poked while flying —
    // the blade-flapping look that makes stick input read on the frame.
    this.rotorTiltX = 0;
    this.rotorTiltZ = 0;
    this._mainAngle = 0;
    this._tailAngle = 0;
    this._blurVisible = false;
    this._buildFuselage();
    this._buildTail();
    this._buildGear();
    this._buildMainRotor();
    this._buildFenestron();
  },

  // Append a procedurally-generated child tagged so json-utils skips it
  // on save and the SceneGraph doesn't list it (same pattern as
  // delivery-bot-mesh).
  _spawn: function (parent, child) {
    child.classList.add('autocreated');
    child.setAttribute('data-aframe-inspector', 'autocreated');
    child.setAttribute('data-no-transform', '');
    parent.appendChild(child);
    this._spawned.push(child);
    return child;
  },

  /**
   * Generic primitive spawner. `opts`: { geometry, material, position,
   * rotation, scale, shadow (default true) }.
   */
  _prim: function (parent, opts) {
    const el = document.createElement('a-entity');
    el.setAttribute('geometry', opts.geometry);
    el.setAttribute('material', opts.material);
    if (opts.position) el.setAttribute('position', opts.position);
    if (opts.rotation) el.setAttribute('rotation', opts.rotation);
    if (opts.scale) el.setAttribute('scale', opts.scale);
    if (opts.shadow !== false) {
      el.setAttribute('shadow', 'cast: true; receive: false');
    }
    return this._spawn(parent, el);
  },

  _paint: function () {
    return `color: ${this.data.bodyColor}; metalness: 0.15; roughness: 0.45`;
  },

  _dark: function () {
    return `color: ${this.data.rotorColor}; metalness: 0.3; roughness: 0.4`;
  },

  remove: function () {
    if (!this._spawned) return;
    for (const c of this._spawned) {
      if (c.parentNode) c.parentNode.removeChild(c);
    }
    this._spawned.length = 0;
  },

  _buildFuselage: function () {
    const d = this.data;
    const root = this.el;
    const paint = this._paint();

    // Main body: a long ellipsoid (2.0 m wide, 1.7 m tall, 5.8 m long).
    this._prim(root, {
      geometry:
        'primitive: sphere; radius: 1; segmentsWidth: 32; segmentsHeight: 20',
      material: paint,
      position: '0 0 -0.9',
      scale: '1.0 0.86 2.9'
    });
    // Flattened lower ellipsoid so the underside is a broad belly, not
    // a pure egg.
    this._prim(root, {
      geometry:
        'primitive: sphere; radius: 1; segmentsWidth: 28; segmentsHeight: 18',
      material: paint,
      position: '0 -0.42 -0.9',
      scale: '0.88 0.5 2.3'
    });

    // Dark radome nose.
    this._prim(root, {
      geometry:
        'primitive: sphere; radius: 0.5; segmentsWidth: 24; segmentsHeight: 16',
      material: `color: #101010; metalness: 0.4; roughness: 0.3`,
      position: '0 -0.2 -3.95',
      scale: '1.25 1.0 1.5',
      shadow: false
    });

    // Cockpit canopy: a glass bubble over the front-top of the body.
    this._prim(root, {
      geometry:
        'primitive: sphere; radius: 1; segmentsWidth: 28; segmentsHeight: 18',
      material: `color: ${d.glassColor}; metalness: 0.2; roughness: 0.05; opacity: 0.6; transparent: true`,
      position: '0 0.42 -2.35',
      scale: '0.92 0.62 1.35'
    });
    // Cabin door windows (flat dark-glass strips flush with the sides).
    for (const side of [-1, 1]) {
      this._prim(root, {
        geometry: 'primitive: box; width: 0.04; height: 0.5; depth: 1.7',
        material: `color: ${d.glassColor}; shader: flat; opacity: 0.85; transparent: true`,
        position: `${side * 0.99} 0.22 -0.5`,
        shadow: false
      });
    }

    // Engine deck: a rounded cowl running along the roof, blended
    // into the cabin by a wide flat ellipsoid, plus the raised rotor
    // pylon and mast.
    this._prim(root, {
      geometry:
        'primitive: cylinder; radius: 0.72; height: 3.6; segmentsRadial: 24',
      material: paint,
      position: '0 0.92 0.4',
      rotation: '90 0 0'
    });
    this._prim(root, {
      geometry:
        'primitive: sphere; radius: 1; segmentsWidth: 28; segmentsHeight: 18',
      material: paint,
      position: '0 0.55 0.2',
      scale: '0.8 0.5 1.7'
    });
    this._prim(root, {
      geometry: 'primitive: box; width: 0.9; height: 0.45; depth: 1.4',
      material: paint,
      position: '0 1.45 0'
    });
    this._prim(root, {
      geometry:
        'primitive: cylinder; radius: 0.12; height: 0.5; segmentsRadial: 12',
      material: 'color: #9a9ea3; metalness: 0.6; roughness: 0.35',
      position: `0 ${HUB_Y - 0.25} 0`
    });
    // Twin exhausts poking out the back of the cowl.
    for (const side of [-1, 1]) {
      this._prim(root, {
        geometry:
          'primitive: cylinder; radius: 0.2; height: 0.6; segmentsRadial: 14',
        material: this._dark(),
        position: `${side * 0.42} 1.05 2.35`,
        rotation: '90 0 0',
        shadow: false
      });
    }
    // Sensor turret under the nose (port side).
    this._prim(root, {
      geometry:
        'primitive: sphere; radius: 0.22; segmentsWidth: 14; segmentsHeight: 10',
      material: this._dark(),
      position: '-0.45 -0.78 -3.05',
      shadow: false
    });
  },

  _buildTail: function () {
    const d = this.data;
    const root = this.el;
    const paint = this._paint();

    // Tapered tail boom (cone lying along +Z, narrow end aft).
    this._prim(root, {
      geometry:
        'primitive: cone; radiusBottom: 0.6; radiusTop: 0.33; height: 6; segmentsRadial: 20',
      material: paint,
      position: '0 0.25 4.0',
      rotation: '90 0 0'
    });
    // White identification band around the boom.
    this._prim(root, {
      geometry:
        'primitive: cylinder; radius: 0.56; height: 0.8; segmentsRadial: 20',
      material: `color: ${d.accentColor}; metalness: 0.15; roughness: 0.45`,
      position: '0 0.25 2.9',
      rotation: '90 0 0'
    });
    // Horizontal stabilizer with end plates.
    this._prim(root, {
      geometry: 'primitive: box; width: 2.8; height: 0.08; depth: 0.75',
      material: paint,
      position: '0 0.5 5.6'
    });
    for (const side of [-1, 1]) {
      this._prim(root, {
        geometry: 'primitive: box; width: 0.06; height: 0.8; depth: 0.7',
        material: paint,
        position: `${side * 1.4} 0.5 5.6`
      });
    }
    // Fenestron shroud: a ring with its axis along X.
    this._prim(root, {
      geometry:
        'primitive: torus; radius: 0.7; radiusTubular: 0.2; segmentsRadial: 12; segmentsTubular: 28',
      material: paint,
      position: '0 0.55 7.35',
      rotation: '0 90 0'
    });
    // Swept upper fin above the shroud, small ventral fin below.
    this._prim(root, {
      geometry: 'primitive: box; width: 0.3; height: 1.6; depth: 1.3',
      material: paint,
      position: '0 2.05 7.65',
      rotation: '28 0 0'
    });
    this._prim(root, {
      geometry: 'primitive: box; width: 0.3; height: 0.6; depth: 0.7',
      material: paint,
      position: '0 -0.55 7.5'
    });
  },

  _buildGear: function () {
    const root = this.el;
    const strut = 'color: #9a9ea3; metalness: 0.6; roughness: 0.35';
    const tyre = this._dark();
    // Twin nose wheel.
    this._prim(root, {
      geometry:
        'primitive: cylinder; radius: 0.06; height: 1.0; segmentsRadial: 10',
      material: strut,
      position: '0 -1.25 -3.1'
    });
    for (const side of [-1, 1]) {
      this._prim(root, {
        geometry:
          'primitive: cylinder; radius: 0.22; height: 0.16; segmentsRadial: 18',
        material: tyre,
        position: `${side * 0.16} -1.55 -3.1`,
        rotation: '0 0 90'
      });
    }
    // Main gear: fairing, strut, wheel on each side.
    for (const side of [-1, 1]) {
      this._prim(root, {
        geometry: 'primitive: box; width: 0.5; height: 0.4; depth: 0.9',
        material: this._paint(),
        position: `${side * 0.65} -0.5 1.3`
      });
      this._prim(root, {
        geometry:
          'primitive: cylinder; radius: 0.07; height: 0.9; segmentsRadial: 10',
        material: strut,
        position: `${side * 0.85} -1.15 1.3`
      });
      this._prim(root, {
        geometry:
          'primitive: cylinder; radius: 0.3; height: 0.24; segmentsRadial: 18',
        material: tyre,
        position: `${side * 1.02} -1.5 1.3`,
        rotation: '0 0 90'
      });
    }
  },

  _buildMainRotor: function () {
    const d = this.data;
    // Group entity so tick() can spin it around Y as one unit.
    const group = document.createElement('a-entity');
    group.setAttribute('position', `0 ${HUB_Y} 0`);
    this._spawn(this.el, group);
    this._mainRotor = group;

    // Hub cap (painted like the body on the real aircraft).
    this._prim(group, {
      geometry:
        'primitive: cylinder; radius: 0.3; height: 0.24; segmentsRadial: 16',
      material: this._paint()
    });

    // Four blades radiating from the hub.
    this._blades = [];
    const bladeLen = MAIN_ROTOR_RADIUS - 0.35;
    for (let i = 0; i < MAIN_BLADES; i++) {
      const a = (i * 2 * Math.PI) / MAIN_BLADES;
      const r = 0.35 + bladeLen / 2;
      const blade = this._prim(group, {
        geometry: `primitive: box; width: 0.32; height: 0.05; depth: ${bladeLen}`,
        material: `color: ${d.rotorColor}; metalness: 0.1; roughness: 0.8`,
        position: `${-Math.sin(a) * r} 0 ${-Math.cos(a) * r}`,
        rotation: `0 ${(a * 180) / Math.PI} 0`
      });
      this._blades.push(blade);
    }

    // Blur disc shown at speed instead of discrete blades.
    const blur = this._prim(group, {
      geometry: `primitive: cylinder; radius: ${MAIN_ROTOR_RADIUS}; height: 0.02; segmentsRadial: 36`,
      material: `color: ${d.rotorColor}; opacity: 0.18; transparent: true; shader: flat; side: double`,
      shadow: false
    });
    blur.setAttribute('visible', 'false');
    this._mainBlur = blur;
  },

  _buildFenestron: function () {
    const d = this.data;
    // Fan group inside the shroud; spins around local X.
    const group = document.createElement('a-entity');
    group.setAttribute('position', '0 0.55 7.35');
    this._spawn(this.el, group);
    this._tailRotor = group;

    this._prim(group, {
      geometry:
        'primitive: cylinder; radius: 0.1; height: 0.3; segmentsRadial: 10',
      material: this._dark(),
      rotation: '0 0 90'
    });

    this._tailBlades = [];
    for (let i = 0; i < FAN_BLADES; i++) {
      const blade = this._prim(group, {
        geometry: 'primitive: box; width: 0.05; height: 0.95; depth: 0.1',
        material: 'color: #d8dadc; metalness: 0.3; roughness: 0.5',
        rotation: `${(i * 180) / FAN_BLADES} 0 0`,
        shadow: false
      });
      this._tailBlades.push(blade);
    }

    const blur = this._prim(group, {
      geometry:
        'primitive: cylinder; radius: 0.48; height: 0.2; segmentsRadial: 20',
      material: `color: ${d.rotorColor}; opacity: 0.25; transparent: true; shader: flat; side: double`,
      // Cylinder axis is Y; rotate so the disc plane is Y-Z (spin axis X).
      rotation: '0 0 90',
      shadow: false
    });
    blur.setAttribute('visible', 'false');
    this._tailBlur = blur;
  },

  _setBlur: function (on) {
    if (on === this._blurVisible) return;
    this._blurVisible = on;
    // setAttribute (not raw object3D.visible) per the mesh-batching
    // rule; only called on threshold crossings so it stays cheap.
    this._mainBlur.setAttribute('visible', on ? 'true' : 'false');
    this._tailBlur.setAttribute('visible', on ? 'true' : 'false');
    for (const b of this._blades) {
      b.setAttribute('visible', on ? 'false' : 'true');
    }
    for (const b of this._tailBlades) {
      b.setAttribute('visible', on ? 'false' : 'true');
    }
  },

  tick: function (time, deltaMs) {
    const speed = this.rotorSpeed || 0;
    if (speed === 0 && this._mainAngle === 0) return;
    const dt = Math.min((deltaMs || 16) / 1000, 0.1);
    this._mainAngle += speed * dt;
    this._tailAngle += speed * TAIL_ROTOR_RATIO * dt;
    if (this._mainRotor) {
      // YXZ: spin around the mast first, then apply the small cyclic
      // tilt so the whole disc leans rather than wobbling per-blade.
      this._mainRotor.object3D.rotation.order = 'YXZ';
      this._mainRotor.object3D.rotation.set(
        this.rotorTiltX || 0,
        this._mainAngle,
        this.rotorTiltZ || 0
      );
    }
    if (this._tailRotor) {
      this._tailRotor.object3D.rotation.set(this._tailAngle, 0, 0);
    }
    this._setBlur(speed > BLUR_THRESHOLD);
  }
});
