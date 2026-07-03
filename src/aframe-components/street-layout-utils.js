// Segments that participate in street layout: alignment (street-align),
// ground slab (street-ground), and width labels (street-label).
//
// Building segments hidden by the managed-street `showBuildings` toggle are
// kept in the DOM (so the toggle is non-destructive and they serialize with
// the scene) but must behave as absent for layout — otherwise the street
// stays offset around invisible buildings and the ground/labels span them.
// Non-building segments are always included regardless of visibility so that
// momentarily hiding a lane (e.g. via the scene graph eye icon) does not
// reflow the whole street.
function getLayoutSegments(streetEl) {
  return Array.from(streetEl.querySelectorAll('[street-segment]')).filter(
    (segmentEl) => {
      if (segmentEl.getAttribute('street-segment')?.type !== 'building') {
        return true;
      }
      return segmentEl.getAttribute('visible') !== false;
    }
  );
}

module.exports.getLayoutSegments = getLayoutSegments;
