/**
 * Per-device properties-panel preferences (#1981, #1979), backed by
 * localStorage: which named sections are collapsed, and whether the
 * position row shows three.js coordinates or the geolocated readout.
 * These are presentation preferences only — never part of the scene JSON.
 * localStorage can be unavailable (private windows, blocked site data),
 * so every access is guarded and the in-memory cache carries the session.
 */

const COLLAPSE_KEY = '3dstreet-panel-collapsed-sections';
const POSITION_DISPLAY_KEY = '3dstreet-position-display';

let collapsedSections = null; // { [sectionKey]: true }

function loadCollapsedSections() {
  if (collapsedSections) return collapsedSections;
  try {
    collapsedSections = JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {};
  } catch {
    collapsedSections = {};
  }
  return collapsedSections;
}

function persistCollapsedSections() {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedSections));
  } catch {
    // Preference survives in memory for the session only.
  }
}

/**
 * Whether the section is collapsed. Sections the user never touched have no
 * entry and fall back to `fallback` (expanded unless the caller says
 * otherwise).
 */
export function isSectionCollapsed(sectionKey, fallback = false) {
  const prefs = loadCollapsedSections();
  return sectionKey in prefs ? !!prefs[sectionKey] : fallback;
}

export function setSectionCollapsed(sectionKey, collapsed) {
  const prefs = loadCollapsedSections();
  // Store the boolean explicitly either way: some sections (the advanced
  // component list) default to collapsed, so "expanded" is a real choice too.
  prefs[sectionKey] = !!collapsed;
  persistCollapsedSections();
}

// Shift-click collapse/expand-all (#1981): every mounted section in the
// current view subscribes; the clicked section broadcasts its new state.
const collapseAllListeners = new Set();

export function onCollapseAll(listener) {
  collapseAllListeners.add(listener);
  return () => collapseAllListeners.delete(listener);
}

export function broadcastCollapseAll(collapsed) {
  collapseAllListeners.forEach((listener) => listener(collapsed));
}

/** 'position' (three.js coords, default) or 'geoloc' (read-only lat/lon). */
export function getPositionDisplayMode() {
  try {
    return localStorage.getItem(POSITION_DISPLAY_KEY) === 'geoloc'
      ? 'geoloc'
      : 'position';
  } catch {
    return 'position';
  }
}

export function setPositionDisplayMode(mode) {
  try {
    if (mode === 'geoloc') {
      localStorage.setItem(POSITION_DISPLAY_KEY, mode);
    } else {
      localStorage.removeItem(POSITION_DISPLAY_KEY);
    }
  } catch {
    // Ignore: the toggle still works for the current render tree.
  }
}
