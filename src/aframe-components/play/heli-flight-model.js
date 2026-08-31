/**
 * heli-flight-model
 * =================
 *
 * Pure arcade helicopter flight model — the math behind
 * `play-mode-helicopter`, kept free of A-Frame/Rapier/THREE imports so
 * it can be unit-tested in Node (see test/core/heli-flight-model.test.js)
 * and stays deterministic: every output is a pure function of
 * (state, input, body snapshot, params, dt).
 *
 * Design target is "GTA / Battlefield medium complexity": more than a
 * toy up/down translator, far less than a real sim. The pieces:
 *
 *   - Collective (throttle lever): a MIN_COLLECTIVE..1 value ramped by
 *     held input. Rotor thrust = mass * g * liftPower * collective,
 *     applied along BODY-UP — so tilting the helicopter vectors its
 *     thrust and pitch/roll naturally translate into horizontal
 *     flight, exactly like the games. Hover sits at collective =
 *     1/liftPower. Holding the lever below zero is ACTIVE DOWN-THRUST
 *     (GTA descend key): the playtest complaint was that cutting lift
 *     and waiting on gravity made returning to the ground feel like a
 *     balloon, so S keeps ramping past 0 into a powered dive.
 *   - Drag is split by axis: horizontal drag caps cruise speed, but
 *     vertical drag is ~4x weaker so climbs and especially descents
 *     read as heavy, not floaty. (An earlier build used Rapier's
 *     isotropic linearDamping, which braked falls as hard as cruise —
 *     the "gravity feels light" playtest note.)
 *   - Rotor spool: thrust fades in over `spoolTime` seconds after
 *     start so takeoff has a wind-up instead of an instant jump.
 *   - Cyclic (pitch/roll): ATTITUDE-COMMAND, the way the games do it —
 *     stick deflection commands a target tilt (up to MAX_PITCH_TILT /
 *     MAX_ROLL_TILT), and a
 *     spring torque drives body-up toward that commanded attitude.
 *     Full deflection therefore settles at a bounded bank instead of
 *     tumbling end-over-end (which is what raw torque + faded leveling
 *     produced). With zero input the commanded attitude is level, so
 *     the same spring IS the auto-level; `stability` scales the
 *     return-to-level strength, `agility` the command-tracking
 *     strength. Conventions (A-Frame body frame, forward = -Z):
 *       pitch +1 = nose down (fly forward), roll +1 = roll right.
 *   - Pedals (yaw): rate-command torque about body-up;
 *     yaw +1 = nose left = +Y torque when level.
 *   - Hover assist (Space / gamepad B): temporarily boosts leveling,
 *     brakes horizontal + vertical velocity, and eases the collective
 *     toward the exact hover value — a panic button that parks the
 *     helicopter in a stable hover.
 *
 * All torque constants are mass-scaled (torque = mass * K * input);
 * with the fixed collider proportions used by play-mode-helicopter the
 * body's moments of inertia are also proportional to mass, so handling
 * is independent of the collider density Rapier picks.
 */

const GRAVITY = 9.81;

// Tunables that are NOT user-facing levers (the user-facing ones —
// liftPower / agility / yawRate / stability — arrive via params).
const COLLECTIVE_RATE = 1.1; // collective travel per second of held W/S
const MIN_COLLECTIVE = -0.4; // lever floor: powered-descent down-thrust
const SPOOL_TIME = 1.6; // seconds from Play to full available thrust
const ASSIST_COLLECTIVE_EASE = 4; // 1/s — how fast assist trims to hover
const HORIZ_DRAG = 0.35; // 1/s — caps cruise speed
const VERT_DRAG = 0.08; // 1/s — falls and climbs stay heavy
const MAX_ROLL_TILT = 0.55; // rad (~31°) — commanded roll at full stick
// Pitch commands much deeper than roll: at ~57° nose-down the thrust
// vector is mostly horizontal, so full forward stick trades the climb
// for real forward speed instead of riding ever higher.
const MAX_PITCH_TILT = 1.0; // rad (~57°) — commanded pitch at full stick
const K_CMD = 14; // mass-scaled spring toward the commanded attitude
const K_LEVEL = 12; // mass-scaled spring back to level (no input)
const K_YAW = 5; // mass-scaled pedal yaw torque
const K_TILT_DAMP = 1.6; // mass-scaled tilt-rate damper
const ASSIST_LEVEL_BOOST = 2.5; // leveling multiplier while assist held
const ASSIST_HORIZ_BRAKE = 1.2; // 1/s — horizontal velocity brake under assist
// Strong: assist is the panic button, and powered dives now reach
// ~30 m/s — it should visibly arrest one within a couple of seconds.
const ASSIST_VERT_BRAKE = 1.6; // 1/s — vertical velocity brake under assist

const DEFAULT_PARAMS = {
  liftPower: 2.2, // thrust at full collective, in multiples of gravity
  agility: 1, // scales cyclic (pitch/roll) torques
  yawRate: 1, // scales yaw torque
  stability: 1 // scales the auto-level spring
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rotate vector v = {x,y,z} by quaternion q = {x,y,z,w}. */
function applyQuat(q, v) {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  // v' = v + w * t + cross(q.xyz, t)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  };
}

/** Fresh mutable flight state for one play session. */
function createHeliState() {
  return {
    collective: 0, // 0..1 rotor thrust lever
    spool: 0 // 0..1 rotor wind-up since Play started
  };
}

/**
 * Advance collective + spool by one physics sub-step.
 *
 * @param {Object} state — from createHeliState(), mutated in place
 * @param {Object} input — { collective: -1..1 (rate), assist: bool }
 * @param {number} dt — sub-step seconds
 * @param {Object} params — { liftPower } (others ignored here)
 */
function stepHeliState(state, input, dt, params) {
  const p = params || DEFAULT_PARAMS;
  state.spool = Math.min(1, state.spool + dt / SPOOL_TIME);
  state.collective = clamp(
    state.collective + (input.collective || 0) * COLLECTIVE_RATE * dt,
    MIN_COLLECTIVE,
    1
  );
  // Assist trims toward exact hover thrust — but only once the player
  // has stopped commanding the lever, so held W under assist still climbs.
  if (input.assist && !input.collective) {
    const hover = 1 / (p.liftPower || DEFAULT_PARAMS.liftPower);
    const t = Math.min(1, ASSIST_COLLECTIVE_EASE * dt);
    state.collective += (clamp(hover, 0, 1) - state.collective) * t;
  }
  return state;
}

/**
 * Compute the world-frame force + torque to apply for this sub-step.
 * Gravity is NOT included — the physics world applies it.
 *
 * @param {Object} state — { collective, spool }
 * @param {Object} input — { pitch, roll, yaw: -1..1, assist: bool }
 *   (pitch +1 = nose down, roll +1 = right, yaw +1 = nose left)
 * @param {Object} body — snapshot { mass, rotation: {x,y,z,w},
 *   angvel: {x,y,z}, linvel: {x,y,z} }
 * @param {Object} params — { liftPower, agility, yawRate, stability }
 * @returns {{ force: {x,y,z}, torque: {x,y,z} }} world-frame
 */
function computeHeliForces(state, input, body, params) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const m = body.mass;
  const q = body.rotation;

  // --- Rotor thrust along body-up. Squared spool for a soft wind-up. ---
  const up = applyQuat(q, { x: 0, y: 1, z: 0 });
  const spoolEase = state.spool * state.spool;
  const thrust = m * GRAVITY * p.liftPower * state.collective * spoolEase;
  const force = { x: up.x * thrust, y: up.y * thrust, z: up.z * thrust };

  // --- Yaw: rate-command torque about body-up (world frame). ---
  const pitch = clamp(input.pitch || 0, -1, 1);
  const roll = clamp(input.roll || 0, -1, 1);
  const yaw = clamp(input.yaw || 0, -1, 1);
  const yawK = yaw * K_YAW * p.yawRate * m;
  const torque = { x: up.x * yawK, y: up.y * yawK, z: up.z * yawK };

  // --- Attitude command: build the commanded up-vector by tilting
  //     world-up toward the horizontal heading (pitch) and toward the
  //     right vector (roll), capped at MAX_PITCH_TILT / MAX_ROLL_TILT;
  //     then spring
  //     body-up toward it along (up x desiredUp). With zero input
  //     desiredUp == worldUp and this IS the auto-level. Because the
  //     command is a bounded attitude (not a raw torque), a held stick
  //     settles at the commanded max bank instead of tumbling. ---
  // Horizontal heading (nose = body -Z projected onto XZ).
  const fwd = applyQuat(q, { x: 0, y: 0, z: -1 });
  let hx = fwd.x;
  let hz = fwd.z;
  const hLen = Math.sqrt(hx * hx + hz * hz);
  if (hLen > 1e-4) {
    hx /= hLen;
    hz /= hLen;
  } else {
    // Nose pointing straight up/down — take heading from body-up's
    // horizontal component instead (it points opposite the nose dive).
    const uLen = Math.sqrt(up.x * up.x + up.z * up.z);
    if (uLen > 1e-4) {
      hx = up.x / uLen;
      hz = up.z / uLen;
    } else {
      hx = 0;
      hz = -1;
    }
  }
  // right = heading x worldUp (horizontal, unit).
  const rx = -hz;
  const rz = hx;
  const pitchTilt = Math.tan(pitch * MAX_PITCH_TILT);
  const rollTilt = Math.tan(roll * MAX_ROLL_TILT);
  let dux = hx * pitchTilt + rx * rollTilt;
  let duy = 1;
  let duz = hz * pitchTilt + rz * rollTilt;
  const duLen = Math.sqrt(dux * dux + duy * duy + duz * duz);
  dux /= duLen;
  duy /= duLen;
  duz /= duLen;

  const cyclicMag = Math.min(1, Math.abs(pitch) + Math.abs(roll));
  // No-input part is the stability lever (assist forces at least full
  // strength and boosts it); command-tracking part is the agility lever.
  const levelStab = input.assist
    ? Math.max(p.stability, 1) * ASSIST_LEVEL_BOOST
    : p.stability;
  const springK =
    m * (K_LEVEL * levelStab * (1 - cyclicMag) + K_CMD * p.agility * cyclicMag);
  if (springK > 0) {
    // cross(up, desiredUp)
    torque.x += (up.y * duz - up.z * duy) * springK;
    torque.y += (up.z * dux - up.x * duz) * springK;
    torque.z += (up.x * duy - up.y * dux) * springK;
  }

  // --- Tilt-rate damper: bleed angular velocity that is NOT around
  //     body-up (leave commanded yaw rotation alone). ---
  const av = body.angvel;
  const avDotUp = av.x * up.x + av.y * up.y + av.z * up.z;
  const kd = K_TILT_DAMP * m * (input.assist ? 2 : 1);
  torque.x += -(av.x - up.x * avDotUp) * kd;
  torque.y += -(av.y - up.y * avDotUp) * kd;
  torque.z += -(av.z - up.z * avDotUp) * kd;

  // --- Aerodynamic drag, split by axis (see header): strong enough
  //     horizontally to cap cruise speed, weak vertically so descents
  //     and climbs feel heavy. Replaces Rapier's isotropic
  //     linearDamping (the rig sets that to 0). ---
  const lv = body.linvel;
  force.x += -lv.x * m * HORIZ_DRAG;
  force.z += -lv.z * m * HORIZ_DRAG;
  force.y += -lv.y * m * VERT_DRAG;

  // --- Hover assist: brake horizontal + vertical drift. ---
  if (input.assist) {
    force.x += -lv.x * m * ASSIST_HORIZ_BRAKE;
    force.z += -lv.z * m * ASSIST_HORIZ_BRAKE;
    force.y += -lv.y * m * ASSIST_VERT_BRAKE;
  }

  return { force, torque };
}

module.exports = {
  GRAVITY,
  COLLECTIVE_RATE,
  MIN_COLLECTIVE,
  SPOOL_TIME,
  HORIZ_DRAG,
  VERT_DRAG,
  DEFAULT_PARAMS,
  createHeliState,
  stepHeliState,
  computeHeliForces,
  applyQuat
};
