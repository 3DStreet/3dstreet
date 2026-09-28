// One global debug switch for verbose console diagnostics across the app
// (navigation, runtime batching, ...). Per-area flags were too much to
// remember and, once several existed, too much noise (#2043), so every
// verbose log path gates on this single check.
//
// Enable with `?debug=true` on the URL, or persistently across reloads with
//   localStorage.setItem('3dstreet.debug', 'true')
// in the console (remove the key to turn it off). Warnings and errors that
// signal real problems are not gated: they always print.

const STORAGE_KEY = '3dstreet.debug';

const DEBUG_ENABLED = (() => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.location) {
      const param = new URLSearchParams(window.location.search).get('debug');
      if (param === 'true') return true;
      if (param === 'false') return false;
    }
    return window.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch (e) {
    // localStorage can throw in private windows or with blocked site data.
    return false;
  }
})();

export function isDebugEnabled() {
  return DEBUG_ENABLED;
}

// console.log that only prints when debug is on. Callers pass their own
// `[area]` prefix so the console stays greppable.
export function debugLog(...args) {
  if (DEBUG_ENABLED) console.log(...args);
}
