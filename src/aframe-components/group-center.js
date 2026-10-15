/* global AFRAME */
// A center the user has set for a group, in the group's own local frame so it
// travels with the group when the group turns. When `pinned`, the group rotates
// about `pin` and its handles sit there instead of at the middle of its members.
// A scene may pin a group's center this way; the editor reads it
// (src/editor/lib/groups/groupBounds.js) and keeps it, but has no control that
// sets it.
AFRAME.registerComponent('group-center', {
  schema: {
    pinned: { type: 'boolean', default: false },
    pin: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }
  }
});
