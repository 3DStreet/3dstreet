/* global AFRAME */

/**
 * helicopter-mesh
 * ===============
 *
 * Procedural basic-geometry helicopter visual — no GLB, no brand.
 * A generic light utility helicopter (MD500/EC135-ish silhouette)
 * built from boxes, cylinders, and a sphere in `init()`:
 * fuselage + glass nose canopy, engine housing, tail boom with fin
 * and stabilizer, twin landing skids, a two-blade main rotor, and a
 * side-mounted tail rotor.
 *
 * Placeholder quality on purpose (#one-shot): real catalog meshes can
 * replace this later the same way vehicle presets swap `meshMixin` /
 * `meshComponent`.
 *
 * Local axes: -Z is forward (nose direction — matches A-Frame's
 * default forward and the `fly-controls` cone marker; note this
 * differs from the catalog +Z convention delivery-bot-mesh follows,
 * so no wrapper rotation is needed anywhere in the fly pipeline).
 * +Y up; origin at the fuselage center. Skid rails sit at local
 * y = -0.9, the main-rotor hub at y = +1.0.
 *
 * Rotor animation: `play-mode-helicopter` pokes `this.rotorSpeed`
 * (rad/s) directly each frame — a property write, not setAttribute,
 * since it changes every tick. tick() integrates the angles onto the
 * rotor groups and swaps blades for translucent "blur discs" above a
 * speed threshold. At edit time rotorSpeed stays 0 and the blades
 * hold still.
 */

const BLUR_THRESHOLD = 18; // rad/s above which blades become a blur disc
const TAIL_ROTOR_RATIO = 4.6; // tail rotor spins this much faster

AFRAME.registerComponent('helicopter-mesh', {
  schema: {
    bodyColor: { type: 'color', default: '#2e6f9e' },
    accentColor: { type: 'color', default: '#e8eef2' },
    glassColor: { type: 'color', default: '#9fd8ef' },
    rotorColor: { type: 'color', default: '#2b2b2b' }
  },

  init: function () {
    this._spawned = [];
    // rad/s, poked by play-mode-helicopter while flying.
    this.rotorSpeed = 0;
    this._mainAngle = 0;
    this._tailAngle = 0;
    this._blurVisible = false;
    this._buildFuselage();
    this._buildTail();
    this._buildSkids();
    this._buildMainRotor();
    this._buildTailRotor();
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

  _box: function (parent, w, h, d, color, pos, extraMat) {
    const el = document.createElement('a-entity');
    el.setAttribute(
      'geometry',
      `primitive: box; width: ${w}; height: ${h}; depth: ${d}`
    );
    el.setAttribute('material', `color: ${color}; ${extraMat || ''}`);
    el.setAttribute('position', pos);
    el.setAttribute('shadow', 'cast: true; receive: false');
    return this._spawn(parent, el);
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

    // Main cabin box.
    this._box(
      root,
      1.2,
      1.1,
      2.2,
      d.bodyColor,
      '0 0 -0.2',
      'metalness: 0.2; roughness: 0.6'
    );

    // Glass nose canopy — a squashed sphere at the front (-Z).
    const nose = document.createElement('a-entity');
    nose.setAttribute(
      'geometry',
      'primitive: sphere; radius: 0.55; segmentsWidth: 18; segmentsHeight: 12'
    );
    nose.setAttribute(
      'material',
      `color: ${d.glassColor}; metalness: 0.1; roughness: 0.1; opacity: 0.85; transparent: true`
    );
    nose.setAttribute('position', '0 0.05 -1.35');
    nose.setAttribute('scale', '0.95 0.85 1');
    nose.setAttribute('shadow', 'cast: true; receive: false');
    this._spawn(root, nose);

    // Engine housing on the roof.
    this._box(
      root,
      0.8,
      0.35,
      1.2,
      d.accentColor,
      '0 0.7 -0.1',
      'metalness: 0.3; roughness: 0.5'
    );

    // Rotor mast.
    const mast = document.createElement('a-entity');
    mast.setAttribute(
      'geometry',
      'primitive: cylinder; radius: 0.07; height: 0.25; segmentsRadial: 10'
    );
    mast.setAttribute('material', `color: ${d.rotorColor}`);
    mast.setAttribute('position', '0 0.95 0');
    this._spawn(root, mast);

    // Side accent stripes.
    for (const side of [-1, 1]) {
      this._box(
        root,
        0.02,
        0.16,
        2.0,
        d.accentColor,
        `${side * 0.61} 0.1 -0.2`,
        'shader: flat'
      );
    }
  },

  _buildTail: function () {
    const d = this.data;
    const root = this.el;
    // Tail boom stretching back (+Z).
    this._box(
      root,
      0.26,
      0.28,
      2.1,
      d.bodyColor,
      '0 0.25 1.95',
      'metalness: 0.2; roughness: 0.6'
    );
    // Vertical fin.
    this._box(
      root,
      0.06,
      0.85,
      0.45,
      d.bodyColor,
      '0 0.55 2.9',
      'metalness: 0.2; roughness: 0.6'
    );
    // Horizontal stabilizer.
    this._box(root, 1.0, 0.05, 0.32, d.accentColor, '0 0.32 2.45');
  },

  _buildSkids: function () {
    const d = this.data;
    const root = this.el;
    for (const side of [-1, 1]) {
      // Rail.
      this._box(
        root,
        0.09,
        0.09,
        2.7,
        d.rotorColor,
        `${side * 0.62} -0.9 -0.25`,
        'metalness: 0.4; roughness: 0.5'
      );
      // Struts.
      for (const z of [-1.0, 0.6]) {
        this._box(
          root,
          0.07,
          0.42,
          0.07,
          d.rotorColor,
          `${side * 0.62} -0.66 ${z}`
        );
      }
    }
  },

  _buildMainRotor: function () {
    const d = this.data;
    // Group entity so tick() can spin it around Y as one unit.
    const group = document.createElement('a-entity');
    group.setAttribute('position', '0 1.0 0');
    this._spawn(this.el, group);
    this._mainRotor = group;

    // Hub.
    const hub = document.createElement('a-entity');
    hub.setAttribute(
      'geometry',
      'primitive: cylinder; radius: 0.14; height: 0.12; segmentsRadial: 12'
    );
    hub.setAttribute('material', `color: ${d.rotorColor}`);
    this._spawn(group, hub);

    // Two blades, one long box each, crossed at 90°.
    this._blades = [];
    for (const rotY of [0, 90]) {
      const blade = document.createElement('a-entity');
      blade.setAttribute(
        'geometry',
        'primitive: box; width: 0.24; height: 0.035; depth: 4.9'
      );
      blade.setAttribute(
        'material',
        `color: ${d.rotorColor}; metalness: 0.1; roughness: 0.8`
      );
      blade.setAttribute('rotation', `0 ${rotY} 0`);
      blade.setAttribute('shadow', 'cast: true; receive: false');
      this._spawn(group, blade);
      this._blades.push(blade);
    }

    // Blur disc shown at speed instead of discrete blades.
    const blur = document.createElement('a-entity');
    blur.setAttribute(
      'geometry',
      'primitive: cylinder; radius: 2.45; height: 0.02; segmentsRadial: 28'
    );
    blur.setAttribute(
      'material',
      `color: ${d.rotorColor}; opacity: 0.22; transparent: true; shader: flat; side: double`
    );
    blur.setAttribute('visible', 'false');
    this._spawn(group, blur);
    this._mainBlur = blur;
  },

  _buildTailRotor: function () {
    const d = this.data;
    // Group on the right (+X) side of the fin; spins around local X.
    const group = document.createElement('a-entity');
    group.setAttribute('position', '0.12 0.55 2.9');
    this._spawn(this.el, group);
    this._tailRotor = group;

    const hub = document.createElement('a-entity');
    hub.setAttribute(
      'geometry',
      'primitive: cylinder; radius: 0.06; height: 0.1; segmentsRadial: 10'
    );
    hub.setAttribute('material', `color: ${d.rotorColor}`);
    hub.setAttribute('rotation', '0 0 90');
    this._spawn(group, hub);

    this._tailBlades = [];
    for (const rotX of [0, 90]) {
      const blade = document.createElement('a-entity');
      blade.setAttribute(
        'geometry',
        'primitive: box; width: 0.035; height: 1.05; depth: 0.12'
      );
      blade.setAttribute('material', `color: ${d.rotorColor}`);
      blade.setAttribute('rotation', `${rotX} 0 0`);
      this._spawn(group, blade);
      this._tailBlades.push(blade);
    }

    const blur = document.createElement('a-entity');
    blur.setAttribute(
      'geometry',
      'primitive: cylinder; radius: 0.55; height: 0.02; segmentsRadial: 20'
    );
    blur.setAttribute(
      'material',
      `color: ${d.rotorColor}; opacity: 0.22; transparent: true; shader: flat; side: double`
    );
    // Cylinder axis is Y; rotate so the disc plane is Y-Z (spin axis X).
    blur.setAttribute('rotation', '0 0 90');
    blur.setAttribute('visible', 'false');
    this._spawn(group, blur);
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
      this._mainRotor.object3D.rotation.set(0, this._mainAngle, 0);
    }
    if (this._tailRotor) {
      this._tailRotor.object3D.rotation.set(this._tailAngle, 0, 0);
    }
    this._setBlur(speed > BLUR_THRESHOLD);
  }
});
