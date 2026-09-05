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
 *   - Vertical: VELOCITY-COMMAND, not a thrust lever. Held W/S commands
 *     a target climb/descent rate (MAX_CLIMB_RATE / MAX_DESCENT_RATE)
 *     and a first-order servo picks the rotor thrust that tracks it;
 *     release the key and the command returns to a whisper of sink
 *     (IDLE_SINK_RATE), so the helicopter settles toward hover on its
 *     own instead of continuing whatever the lever last said. This
 *     replaces the original latching collective lever — playtesting
 *     (with kids) showed releasing W after a climb left the lever
 *     pinned at 100% and the helicopter accelerating skyward forever,
 *     and the only way to hold altitude was to hand-fly the lever,
 *     which produced constant overshoot oscillation. The gentle idle
 *     sink (instead of a perfect hold) doubles as ground handling: at
 *     rest the servo asks for slightly less than gravity, so the
 *     helicopter stays planted on its skids rather than turning
 *     weightless. Hover assist (Space) commands an EXACT zero-sink
 *     hold on top of its braking/leveling boosts.
 *     Thrust is applied along BODY-UP — tilting vectors it, so
 *     pitch/roll translate into horizontal flight like the games — and
 *     is bank-compensated (divided by up·Y, clamped) so cruising at
 *     full forward tilt doesn't cost altitude. Max thrust is
 *     mass * g * liftPower; an (almost) inverted rotor produces none.
 *   - Rotor spool: thrust fades in over `spoolTime` seconds after
 *     start so takeoff has a wind-up instead of an instant jump.
 *   - Cyclic (pitch/roll): ATTITUDE-COMMAND, the way the games do it —
 *     stick deflection commands a target tilt (up to MAX_PITCH_TILT /
 *     MAX_ROLL_TILT), and a spring torque drives body-up toward that
 *     commanded attitude. Full deflection therefore settles at a
 *     bounded bank instead of tumbling end-over-end. With zero input
 *     the commanded attitude is level, so the same spring IS the
 *     auto-level; `stability` scales the return-to-level strength,
 *     `agility` the command-tracking strength. The commanded tilt is
 *     deliberately modest (~24° pitch — a real helicopter's brisk
 *     cruise, not a 57° cartoon dive); forward SPEED comes from the
 *     bank-compensated thrust vector plus a cyclic drive force
 *     (K_CYCLIC_DRIVE, the rotor "pulling" the airframe where the
 *     stick points) against a lowered horizontal drag.
 *     Conventions (A-Frame body frame, forward = -Z):
 *       pitch +1 = nose down (fly forward), roll +1 = roll right.
 *   - Drag is split by axis: horizontal drag caps cruise speed
 *     (~55 m/s ≈ 200 km/h at full forward stick — a medium twin like
 *     the MH-65 Dolphin cruises ~75 m/s for real; the arcade cap keeps
 *     street-scale scenes readable), vertical drag is weak — falls
 *     with a dead rotor stay heavy; powered vertical motion is
 *     governed by the velocity servo, not drag.
 *   - Pedals (yaw): rate-command torque about body-up;
 *     yaw +1 = nose left = +Y torque when level.
 *   - Hover assist (Space / gamepad B): boosts leveling, brakes
 *     horizontal + vertical velocity, and commands a zero-sink hover —
 *     a panic button that parks the helicopter in a stable hover.
 *
 * All torque constants are mass-scaled (torque = mass * K * input);
 * with the fixed collider proportions used by play-mode-helicopter the
 * body's moments of inertia are also proportional to mass, so handling
 * is independent of the collider density Rapier picks.
 */

const GRAVITY = 9.81;

// Tunables that are NOT user-facing levers (the user-facing ones —
// liftPower / agility / yawRate / stability — arrive via params).
// Vertical rates are arcade-scaled to match the ~55 m/s cruise —
// playtest: "vertical speed is like a snail compared to forward".
// Reachable within ~2 s: liftPower 2.2 leaves ~12 m/s^2 of climb
// headroom above hover, and a zero-thrust descent pulls a full g.
const MAX_CLIMB_RATE = 20; // m/s commanded at full up collective
const MAX_DESCENT_RATE = 22; // m/s commanded at full down collective
// Expo curve on the collective stick: rate = sign(c) * |c|^EXPO * max.
// Squared, so half trigger asks for a quarter of the rate (~5 m/s
// down) — playtest: the fast rates are right for crossing the map but
// a pad landing needs a gentle sink, and analog users want the fine
// end of the trigger to be fine. Keyboard (always ±1) is unaffected.
const COLLECTIVE_EXPO = 2;
// Ground-proximity descent taper ("approach mode"): the commanded
// DESCENT rate is scaled by height above whatever is below (the rig
// raycasts against static colliders — street, obstacles, 3D tiles —
// and passes `input.heightAboveGround`). Full rate at/above
// APPROACH_TOP, easing (quadratically, so the last meters are the
// slowest) to APPROACH_MIN_SINK at the surface. This is what makes a
// keyboard landing survivable now that full-stick descent is 22 m/s:
// hold S from altitude and the helicopter flares itself as the ground
// comes up. Climb, idle sink and hover assist are never tapered.
const APPROACH_TOP = 30; // m — above this, no taper
const APPROACH_MIN_SINK = 4; // m/s commanded at full stick on the surface
// Commanded sink with the lever released: big enough to settle onto
// the ground (and to read as "heavier than air"), small enough that a
// hover only drifts down a couple of meters while you look around.
const IDLE_SINK_RATE = 0.4; // m/s
const K_VY = 2.2; // 1/s — vertical-speed servo gain (first-order, no overshoot)
// Bank compensation floor: thrust is divided by up·Y down to this, so
// banks up to ~60° hold altitude; past that you trade lift for turn.
const MIN_TILT_COMP_Y = 0.5;
const SPOOL_TIME = 1.6; // seconds from Play to full available thrust
const HORIZ_DRAG = 0.145; // 1/s — caps cruise speed (~55 m/s full stick)
const VERT_DRAG = 0.06; // 1/s — dead-rotor falls stay heavy
const MAX_ROLL_TILT = 0.55; // rad (~31°) — commanded roll at full stick
const MAX_PITCH_TILT = 0.42; // rad (~24°) — commanded pitch at full stick
// Horizontal accel the rotor adds along the commanded tilt direction,
// m/s^2 at full stick — on top of the tilted-thrust component, so full
// forward pulls ~8 m/s^2 without needing a nose-down caricature.
// Sideways (roll) gets half of it: the airframe is built to go
// forward, so a full-roll slide shouldn't outrun a full-pitch cruise.
const K_CYCLIC_DRIVE = 3.6;
const ROLL_DRIVE_FRAC = 0.5;
const K_CMD = 14; // mass-scaled spring toward the commanded attitude
const K_LEVEL = 12; // mass-scaled spring back to level (no input)
const K_YAW = 5; // mass-scaled pedal yaw torque
const K_TILT_DAMP = 1.6; // mass-scaled tilt-rate damper
const ASSIST_LEVEL_BOOST = 2.5; // leveling multiplier while assist held
const ASSIST_HORIZ_BRAKE = 1.2; // 1/s — horizontal velocity brake under assist
// Extra vertical brake on top of the servo: assist is the panic
// button — it should visibly arrest a dive within a couple of seconds.
const ASSIST_VERT_BRAKE = 1.6; // 1/s — vertical velocity brake under assist

const DEFAULT_PARAMS = {
  liftPower: 2.2, // max rotor thrust, in multiples of gravity
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
    // Smoothed 0..1 rotor-work fraction, for visuals/audio/telemetry
    // only (play-mode-helicopter feeds it from thrustFrac each step —
    // the force math never reads it).
    collective: 0,
    spool: 0 // 0..1 rotor wind-up since Play started
  };
}

/**
 * Advance the rotor spool by one physics sub-step. (The old collective
 * lever ramp lived here; vertical control is now a velocity command
 * resolved directly in computeHeliForces.)
 *
 * @param {Object} state — from createHeliState(), mutated in place
 * @param {Object} input — unused (kept for call-site symmetry)
 * @param {number} dt — sub-step seconds
 * @param {Object} params — unused
 */
function stepHeliState(state, input, dt, params) {
  state.spool = Math.min(1, state.spool + dt / SPOOL_TIME);
  return state;
}

/**
 * Compute the world-frame force + torque to apply for this sub-step.
 * Gravity is NOT included — the physics world applies it.
 *
 * @param {Object} state — { spool }
 * @param {Object} input — { collective, pitch, roll, yaw: -1..1,
 *   assist: bool, heightAboveGround?: m } (collective +1 = climb,
 *   pitch +1 = nose down, roll +1 = right, yaw +1 = nose left;
 *   heightAboveGround drives the descent taper, omit for none)
 * @param {Object} body — snapshot { mass, rotation: {x,y,z,w},
 *   angvel: {x,y,z}, linvel: {x,y,z} }
 * @param {Object} params — { liftPower, agility, yawRate, stability }
 * @returns {{ force: {x,y,z}, torque: {x,y,z}, thrustFrac: number,
 *   descentScale: number }} world-frame; thrustFrac is the 0..1
 *   fraction of max thrust in use (for rotor visuals / audio),
 *   descentScale the 0..1 approach taper applied to a descent command
 *   (1 = none; for the HUD).
 */
/**
 * Descent-command scale (0..1) for a given height above ground.
 * 1 at/above APPROACH_TOP; APPROACH_MIN_SINK / MAX_DESCENT_RATE on the
 * surface; quadratic in between. Non-finite / undefined height (no
 * surface below within range) means no taper.
 */
function descentScale(heightAboveGround) {
  if (
    heightAboveGround === undefined ||
    heightAboveGround === null ||
    !Number.isFinite(heightAboveGround)
  ) {
    return 1;
  }
  const f = clamp(heightAboveGround / APPROACH_TOP, 0, 1);
  const minScale = APPROACH_MIN_SINK / MAX_DESCENT_RATE;
  return minScale + (1 - minScale) * f * f;
}

function computeHeliForces(state, input, body, params) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const m = body.mass;
  const q = body.rotation;
  const lv = body.linvel;

  const up = applyQuat(q, { x: 0, y: 1, z: 0 });
  const spoolEase = state.spool * state.spool;

  // --- Vertical-speed servo -> rotor thrust along body-up. ---
  const collIn = clamp(input.collective || 0, -1, 1);
  const collExpo = Math.sign(collIn) * Math.abs(collIn) ** COLLECTIVE_EXPO;
  const approach = descentScale(input.heightAboveGround);
  let vyCmd =
    collIn >= 0
      ? collExpo * MAX_CLIMB_RATE
      : collExpo * MAX_DESCENT_RATE * approach;
  if (collIn === 0 && !input.assist) vyCmd = -IDLE_SINK_RATE;
  const maxAccel = GRAVITY * p.liftPower;
  let thrustAccel = 0;
  if (up.y > 0.05) {
    const comp = 1 / Math.max(up.y, MIN_TILT_COMP_Y);
    thrustAccel = clamp((GRAVITY + K_VY * (vyCmd - lv.y)) * comp, 0, maxAccel);
  }
  const thrustFrac = (thrustAccel / maxAccel) * spoolEase;
  const thrust = m * thrustAccel * spoolEase;
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

  // --- Cyclic drive: the rotor pulls the airframe along the stick's
  //     horizontal direction (on top of the tilted-thrust component)
  //     so full forward reaches real speed at a modest visual pitch.
  //     Gated on an upright, spooled rotor. ---
  if (up.y > 0.1) {
    const driveK = m * K_CYCLIC_DRIVE * spoolEase;
    const rollDrive = roll * ROLL_DRIVE_FRAC;
    force.x += (hx * pitch + rx * rollDrive) * driveK;
    force.z += (hz * pitch + rz * rollDrive) * driveK;
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
  //     horizontally to cap cruise speed, weak vertically so
  //     dead-rotor falls stay heavy (powered vertical motion is the
  //     servo's job). Replaces Rapier's isotropic linearDamping (the
  //     rig sets that to 0). ---
  force.x += -lv.x * m * HORIZ_DRAG;
  force.z += -lv.z * m * HORIZ_DRAG;
  force.y += -lv.y * m * VERT_DRAG;

  // --- Hover assist: brake horizontal + vertical drift. ---
  if (input.assist) {
    force.x += -lv.x * m * ASSIST_HORIZ_BRAKE;
    force.z += -lv.z * m * ASSIST_HORIZ_BRAKE;
    force.y += -lv.y * m * ASSIST_VERT_BRAKE;
  }

  return { force, torque, thrustFrac, descentScale: approach };
}

module.exports = {
  GRAVITY,
  MAX_CLIMB_RATE,
  MAX_DESCENT_RATE,
  COLLECTIVE_EXPO,
  APPROACH_TOP,
  APPROACH_MIN_SINK,
  IDLE_SINK_RATE,
  K_VY,
  SPOOL_TIME,
  HORIZ_DRAG,
  VERT_DRAG,
  MAX_PITCH_TILT,
  MAX_ROLL_TILT,
  K_CYCLIC_DRIVE,
  DEFAULT_PARAMS,
  createHeliState,
  stepHeliState,
  computeHeliForces,
  descentScale,
  applyQuat
};
