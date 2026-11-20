/**
 * Local Firebase emulator mode (dev only).
 *
 * `npm run start:emulators` builds with FIREBASE_EMULATORS=true, and the app
 * then talks to the Local Emulator Suite started by `npm run emulators`
 * (Auth, Firestore, Storage, Functions) instead of a real Firebase project.
 * The emulators run under a `demo-` project ID, so they need no credentials
 * and can never reach staging or production.
 */

// Must match --project in the `emulators` npm script.
export const EMULATOR_PROJECT_ID = 'demo-3dstreet';
export const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001
};

export function isEmulatorMode() {
  return process.env.FIREBASE_EMULATORS === 'true';
}

/**
 * Origin prefix for the scene JSON endpoint (`/scenes/UUID.json`, served by
 * the getScene function through a hosting rewrite). Production uses the
 * same origin; localhost uses the dev deployment, or the local functions
 * emulator in emulator mode (getScene reads the scene id from the path after
 * the function name, so the same `/scenes/UUID.json` suffix works there).
 */
export function sceneJsonBaseURL() {
  if (isEmulatorMode()) {
    return `http://${EMULATOR_HOST}:${EMULATOR_PORTS.functions}/${EMULATOR_PROJECT_ID}/us-central1/getScene`;
  }
  if (window.location.href.includes('localhost')) {
    return 'https://dev-3dstreet.web.app';
  }
  return '';
}
