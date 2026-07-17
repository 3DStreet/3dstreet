/**
 * Pure helpers for the street-traffic play-mode component
 * (src/aframe-components/play/street-traffic.js), extracted for unit
 * testing — both feed deterministic, seeded animation so a regression
 * here silently desynchronizes viewers or flips motion direction.
 */

/**
 * Per-lane speed variance: speed stays uniform within a lane (no
 * pass-through) but varies ±10% across lanes so parallel same-type
 * lanes don't move in lockstep. `rng` is a seeded generator
 * returning [0, 1).
 */
export function varyLaneSpeed(baseSpeed, rng) {
  return baseSpeed * (0.9 + 0.2 * rng());
}

/**
 * Motion sign on segment-local Z inferred from an entity's Y rotation
 * in degrees: facing +Z (within 90° of rotY 0) moves +Z (returns 1),
 * facing -Z moves -Z (returns -1). Catalog models are authored
 * forward = +Z.
 */
export function directionFromFacing(rotationY) {
  return Math.cos((rotationY * Math.PI) / 180) >= 0 ? 1 : -1;
}
