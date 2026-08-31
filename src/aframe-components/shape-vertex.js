/* global AFRAME */

// A single vertex of a `shape`. Its native `position` transform is the datum;
// it carries no geometry of its own. On attach/detach it asks the parent
// `shape` to re-derive (the structural trigger). Ongoing position changes are
// observed by the `shape` system's tick, so there is no `update` handler here:
// setting `position` fires the `position` component's update, not this one.
AFRAME.registerComponent('shape-vertex', {
  schema: {},

  init: function () {
    this.notifyShape();
  },

  remove: function () {
    this.notifyShape();
  },

  notifyShape: function () {
    const parentEl = this.el.parentEl;
    const shape = parentEl && parentEl.components && parentEl.components.shape;
    if (shape) {
      shape.requestRederive();
    }
  }
});
