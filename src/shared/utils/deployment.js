/**
 * Deployment detection.
 *
 * Distinguishes the official 3DStreet deployments from community / self-hosted
 * builds. Anything not on an official host is treated as unofficial: the cloud
 * features (sign-in, saving, AI generation, payments) are wired to 3DStreet's
 * own Firebase project and won't work there, so the UI surfaces a clear notice.
 *
 * Self-hosters who stand up their own backend can declare their own domains via
 * the OFFICIAL_DEPLOYMENT_HOSTNAMES env var (comma-separated) to suppress the
 * notice — see SELF_HOSTING.md.
 */
import { firebaseConfig } from '@shared/services/firebase.js';

// Built-in official hosts. Subdomains of these are also treated as official
// (e.g. staging.3dstreet.app, foo.localhost), so the list stays short.
const BUILTIN_OFFICIAL_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '[::1]',
  '3dstreet.app',
  'dev-3dstreet.web.app',
  'dev-3dstreet.firebaseapp.com',
  'dstreet-305604.web.app',
  'dstreet-305604.firebaseapp.com'
];

function parseEnvHostnames() {
  const raw = process.env.OFFICIAL_DEPLOYMENT_HOSTNAMES;
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The full set of hostnames considered official for this build. Includes the
 * built-ins, anything declared via OFFICIAL_DEPLOYMENT_HOSTNAMES, and the
 * configured Firebase authDomain (each environment trusts its own auth domain).
 *
 * @returns {string[]} Lowercased, de-duplicated hostnames.
 */
export function getOfficialHostnames() {
  const list = [...BUILTIN_OFFICIAL_HOSTNAMES, ...parseEnvHostnames()];
  if (firebaseConfig.authDomain) {
    list.push(firebaseConfig.authDomain.toLowerCase());
  }
  return Array.from(new Set(list.map((host) => host.toLowerCase())));
}

/**
 * Whether the given hostname is an official 3DStreet deployment (exact match,
 * or a subdomain of an official host).
 *
 * @param {string} hostname - e.g. window.location.hostname
 * @returns {boolean}
 */
export function isOfficialHostname(hostname) {
  if (!hostname) {
    return false;
  }
  const host = hostname.toLowerCase();
  return getOfficialHostnames().some(
    (official) => host === official || host.endsWith('.' + official)
  );
}

/**
 * Whether the current page is served from an official 3DStreet deployment.
 * Returns true in non-browser contexts (SSR / tests) so we never warn there.
 *
 * @returns {boolean}
 */
export function isOfficialDeployment() {
  if (typeof window === 'undefined' || !window.location) {
    return true;
  }
  return isOfficialHostname(window.location.hostname);
}
