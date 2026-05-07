// URL-parameter feature flag for the experimental nav-controls system.
// Read once at startup. Default off. See claude/specs/001-phase-0-plan.md.

export function isExperimentalNav() {
  if (typeof window === 'undefined' || !window.location) return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('nav') === 'experimental';
}
