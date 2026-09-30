/* global AFRAME */
// A center the user has set for a group, in the group's own local frame so it
// travels with the group when the group turns. When `pinned`, the group rotates
// about `pin` and its handles sit there instead of at the middle of its members.
// Nothing in the editor writes it yet: scenes that carry one keep it, and it is
// read by src/editor/lib/groups/groupBounds.js.
AFRAME.registerComponent('group-center', {
  schema: {
    pinned: { type: 'boolean', default: false },
    pin: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }
  }
});
