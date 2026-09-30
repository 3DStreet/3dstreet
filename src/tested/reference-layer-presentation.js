/**
 * A presentation factor for the reference map layers (Google 3D Tiles, the 2D
 * basemap, OSM buildings), applied on top of each layer's own opacity.
 *
 * The editor lowers it while a group is open for editing, so the map recedes
 * like everything else outside the group, and puts it back to 1 afterwards.
 * It is presentation state only: a layer's `opacity` component value, which
 * is what the scene saves, is never changed. Each layer reads the factor when
 * it is created and subscribes to changes, and multiplies it into the
 * opacity it applies through `applyReferenceLayerOpacity`
 * (transparent-layering.js), so tile materials stay the layer's own.
 */

let factor = 1;
const listeners = new Set();

/** The current factor, 1 when nothing is being de-emphasised. */
export function getPresentationFactor() {
  return factor;
}

/** Set the factor and tell every subscribed layer. */
export function setPresentationFactor(value) {
  if (value === factor) return;
  factor = value;
  for (const listener of [...listeners]) {
    try {
      listener(factor);
    } catch (error) {
      // One failing layer must not leave the others at the old opacity.
      console.error('[reference-layer-presentation] a layer failed:', error);
    }
  }
}

/**
 * Call `listener(factor)` whenever the factor changes. Returns a function
 * that unsubscribes; a layer calls it when it is removed.
 */
export function subscribePresentationFactor(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
