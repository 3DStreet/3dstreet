/* global AFRAME */

/**
 * collision-marker
 * ================
 *
 * Visual marker dropped by play-mode at a chassis-collision site.
 * Renders three nested transparent spheres so the marker has signal
 * at every viewing distance:
 *
 *   - r=0.15 m  @ opacity 0.9  — exact impact point, visible up close
 *   - r=0.50 m  @ opacity 0.4  — short-range visual area
 *   - r=1.50 m  @ opacity 0.15 — long-range glow so you can spot it
 *                                from across the scene
 *
 * The component is just a renderer — it doesn't listen for anything.
 * Spawning happens in play-mode's collision listener via createEntity.
 *
 * The entity is a normal scene-graph entity (placed under the scene
 * root with a stable id) so json-utils serializes it like any other
 * layer. It shows up in the SceneGraph panel, persists into the saved
 * scene, and survives replays.
 */
AFRAME.registerComponent('collision-marker', {
  schema: {
    color: { type: 'color', default: '#ff3a3a' },
    // Recorded simulation time (ms) of the collision. Stored on the
    // component so it survives serialize / load and can be shown in
    // the SceneGraph layer name.
    timeMs: { type: 'number', default: 0 }
  },

  init: function () {
    this._build();
  },

  update: function (oldData) {
    if (!oldData || Object.keys(oldData).length === 0) return;
    if (oldData.color !== this.data.color) {
      this.el.querySelectorAll('[data-collision-marker-vis]').forEach((c) => {
        if (c.parentNode) c.parentNode.removeChild(c);
      });
      this._build();
    }
  },

  _build: function () {
    const layers = [
      { radius: 0.15, opacity: 0.9 },
      { radius: 0.5, opacity: 0.4 },
      { radius: 1.5, opacity: 0.15 }
    ];
    for (const { radius, opacity } of layers) {
      const sphere = document.createElement('a-entity');
      // Marked autocreated so json-utils doesn't bloat the saved scene
      // with three child entities per crash. The marker itself (the
      // parent <a-entity collision-marker="...">) is the persistent
      // record; its sphere visuals get rebuilt from `_build()` on load.
      sphere.classList.add('autocreated');
      sphere.setAttribute('data-aframe-inspector', 'autocreated');
      sphere.setAttribute('data-no-transform', '');
      sphere.setAttribute('data-collision-marker-vis', '');
      sphere.setAttribute(
        'geometry',
        `primitive: sphere; radius: ${radius}; segmentsWidth: 16; segmentsHeight: 12`
      );
      sphere.setAttribute(
        'material',
        `color: ${this.data.color}; opacity: ${opacity}; transparent: true; shader: flat; depthWrite: false`
      );
      this.el.appendChild(sphere);
    }
  }
});
