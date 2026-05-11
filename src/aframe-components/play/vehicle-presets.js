/**
 * Vehicle presets
 * ===============
 *
 * Small library of driveable-vehicle configurations. Each entry
 * bundles physics (chassis size, engine, brake, steering, wheels)
 * with a visual (a catalog mixin or a procedural component).
 *
 * Used in two places:
 *   - `createLayerFunctions.js` quick-spawn entries in the layers
 *     panel: "Driveable Tuk-tuk", "Driveable Delivery Robot",
 *     "Driveable Taxi", each pre-populated from one of these.
 *   - `drive-controls` schema has a `preset` field; switching it in
 *     the property panel re-applies the whole bundle (resizes the
 *     chassis box, swaps the mesh, updates physics tuning).
 *
 * `meshComponent` is the name of a registered procedural mesh
 * component (e.g. `delivery-bot-mesh`). It and `meshMixin` are
 * mutually exclusive — exactly one of them is set per preset.
 * Procedural components are listed in PROCEDURAL_MESH_COMPONENTS
 * so the drive-controls preset switcher knows which attributes to
 * strip when changing presets.
 */

// Wheel layouts (chassis frame, fractions of chassisSize).
//   Chassis frame: x=length, y=height, z=width. Forward is -X.
//   Per wheel: xFrac/yFrac/zFrac are multiplied by chassisSize.{x,y,z}
//     at build time so resizing the chassis auto-scales the wheelbase
//     and track.
//   steered: indices of wheels that respond to the steer input.
//   driven: indices of wheels that receive engine force.
//   Brakes apply to all wheels.
const WHEEL_LAYOUTS = {
  'four-wheel': {
    positions: [
      { xFrac: -0.40625, yFrac: -0.375, zFrac: -0.5625 }, // front-left
      { xFrac: -0.40625, yFrac: -0.375, zFrac: 0.5625 }, // front-right
      { xFrac: 0.40625, yFrac: -0.375, zFrac: -0.5625 }, // rear-left
      { xFrac: 0.40625, yFrac: -0.375, zFrac: 0.5625 } // rear-right
    ],
    // Matches the historic hardcoded behavior: FWD + front-steered.
    steered: [0, 1],
    driven: [0, 1]
  },
  'tuk-tuk-front': {
    // 1 front (centerline) + 2 rear. Classic tuk-tuk geometry.
    // Rear-wheel-drive, front-wheel-steered.
    positions: [
      { xFrac: -0.40625, yFrac: -0.375, zFrac: 0 }, // front-center
      { xFrac: 0.40625, yFrac: -0.375, zFrac: -0.5625 }, // rear-left
      { xFrac: 0.40625, yFrac: -0.375, zFrac: 0.5625 } // rear-right
    ],
    steered: [0],
    driven: [1, 2]
  }
};

const VEHICLE_PRESETS = {
  'tuk-tuk': {
    label: 'Tuk-tuk',
    // ENTITY frame: x=width, y=height, z=length.
    vehicleSize: { x: 0.8, y: 0.4, z: 1.6 },
    accelerateForce: 2.0,
    brakeForce: 0.05,
    steerAngle: 0.131, // ≈ Math.PI / 24
    wheelRadius: 0, // 0 = auto-fit from vehicleSize.y
    wheelWidth: 0,
    wheelLayout: 'tuk-tuk-front',
    // Per-preset Y offset (meters) applied to the cloned mesh wrapper
    // on the play-mode chassis. Catalog glTFs differ in where their
    // origin sits relative to the wheels, so each preset gets its own
    // nudge. Negative = drop the mesh.
    meshYOffset: -0.25,
    meshMixin: 'tuk-tuk',
    meshComponent: null,
    placeholderColor: '#bf7d2e'
  },
  'delivery-bot': {
    label: 'Delivery Robot',
    // Real-life delivery-bot size (~Starship/Serve). Wheel radius
    // 10cm < 15cm standard curb means the bot cannot mount sidewalks
    // — matches reality (real bots use ADA curb ramps).
    vehicleSize: { x: 0.55, y: 0.45, z: 0.7 },
    accelerateForce: 0.5,
    brakeForce: 0.05,
    steerAngle: 0.16,
    wheelRadius: 0.1,
    wheelWidth: 0.06,
    wheelLayout: 'four-wheel',
    meshYOffset: 0,
    meshMixin: '',
    meshComponent: 'delivery-bot-mesh',
    placeholderColor: '#ececec'
  },
  taxi: {
    label: 'Taxi',
    // Toyota-Camry-ish full-size sedan. Wheel radius 32cm and the
    // raycast vehicle's per-wheel suspension means standard 15cm
    // curbs are mountable with momentum.
    vehicleSize: { x: 1.85, y: 1.45, z: 4.8 },
    accelerateForce: 8.0,
    brakeForce: 0.12,
    steerAngle: 0.13,
    wheelRadius: 0.32,
    wheelWidth: 0.22,
    wheelLayout: 'four-wheel',
    meshYOffset: 0,
    meshMixin: 'sedan-taxi-rig',
    meshComponent: null,
    placeholderColor: '#f4c842'
  }
};

// Names of registered procedural mesh components (those that build
// their geometry in init() rather than loading a glTF via mixin).
// Keep in sync with the components you register elsewhere.
const PROCEDURAL_MESH_COMPONENTS = ['delivery-bot-mesh'];

const PRESET_NAMES = Object.keys(VEHICLE_PRESETS);
const WHEEL_LAYOUT_NAMES = Object.keys(WHEEL_LAYOUTS);

module.exports = {
  VEHICLE_PRESETS,
  PROCEDURAL_MESH_COMPONENTS,
  PRESET_NAMES,
  WHEEL_LAYOUTS,
  WHEEL_LAYOUT_NAMES
};
