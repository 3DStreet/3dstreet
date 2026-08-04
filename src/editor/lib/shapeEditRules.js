// Editor policy for editing an existing shape's vertices: what separations and
// ring shapes an edit is allowed to produce, and when a plane pick is usable.
//
// These are EDITOR rules, not model rules — the `shape` component never reads
// them, and a shape loaded from a saved scene is not held to them. Ring
// simplicity is different: the component enforces that itself, because a
// crossing ring has no interior to fill or measure regardless of how it got
// that way (see polygonMath's ringSelfIntersects).

// Metres. An edited or inserted vertex must sit at least this far from EVERY
// other vertex, not only its two ring neighbours: two handles at one screen
// point means whichever loses the hit test can never be grabbed again, and that
// trap does not care about ring adjacency.
//
// Deliberately a separate constant from the draw tool's
// MIN_DRAW_VERTEX_SPACING, which happens to hold the same number but expresses
// a DIFFERENT rule — the draw tool measures a candidate against the previous
// vertex only. Sharing one constant would mean tuning either rule silently
// retunes the other.
export const MIN_EDIT_VERTEX_SEPARATION = 0.05;
