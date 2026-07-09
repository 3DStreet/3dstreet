/* global AFRAME */
import { removeMember } from '../batch-models';

// Lifecycle hook attached to batchable geometry+material entities (stencils) so batch-models'
// slot cleanup runs from the entity's OWN disconnectedCallback — the same reason gltf-model /
// gltf-part call removeMember() from their remove(): a child-detached listener doesn't reliably
// reach the scene when a managed-street subtree is torn down (the subtree detaches first, then
// street-generated clearEntities removes already-disconnected members whose child-detached never
// bubbles). Unlike gltf entities, a stencil carries no 3dstreet-owned component, so batch-models
// has street-generated-stencil stamp this one on. Without it a removed stencil's BatchedMesh slot
// would stay visible (ghost) and its now-parentless object3D would crash the editor hover box.
// removeMember is a no-op when the entity was never batched, so this is harmless on non-batched
// stencils.
AFRAME.registerComponent('batch-member', {
  remove: function () {
    removeMember(this.el);
  }
});
