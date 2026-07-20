// Split a managed street's segments into the travelled way (lanes, sidewalks,
// dividers, ...) and its boundaries (adjacent land use flanking the street:
// buildings, waterfront, fences, parking lots — segment type 'boundary').
//
// Boundaries NEVER participate in travelled-way layout. Alignment/centering
// (street-align), the ground slab (street-ground), and the width labels
// (street-label) are computed from the travelled way alone, and boundary
// positions are derived from the travelled way's outer edges. So adding,
// removing, hiding, or showing a boundary can not shift the street — and a
// boundary renders at the street edge regardless of where it sits in the
// segment list (structural ends-only editing rules are tracked in #1751).
// A future centerline mechanism will anchor the travelled way to real-world
// points; boundaries stay edge-derived under that model too.

// 'building' is the deprecated pre-rename type value; saved scenes are
// migrated at load time but cheap to accept everywhere we branch on it.
function isBoundarySegment(segmentEl) {
  const type = segmentEl.getAttribute('street-segment')?.type;
  return type === 'boundary' || type === 'building';
}

function getTravelledWaySegments(streetEl) {
  return Array.from(streetEl.querySelectorAll('[street-segment]')).filter(
    (segmentEl) => !isBoundarySegment(segmentEl)
  );
}

function getBoundarySegments(streetEl) {
  const boundaries = Array.from(
    streetEl.querySelectorAll('[street-segment]')
  ).filter(isBoundarySegment);
  return {
    left: boundaries.filter(
      (segmentEl) => segmentEl.getAttribute('street-segment')?.side === 'left'
    ),
    right: boundaries.filter(
      (segmentEl) => segmentEl.getAttribute('street-segment')?.side !== 'left'
    )
  };
}

export { isBoundarySegment, getTravelledWaySegments, getBoundarySegments };
