/* global AFRAME, THREE */

/**
 * race-target
 * ===========
 *
 * Place one of these in a scene and play-mode treats the player car
 * crossing into its volume as a race finish. On crossing:
 *   - Emits scene event `race-finish` with the simulation time.
 *   - Pauses play (via play-mode.pause()).
 *   - Fires a blue info toast.
 *
 * Detection is a per-tick AABB overlap test against the player chassis
 * world position. No Rapier sensor needed — keeping it visual + a
 * deterministic geometric test avoids polluting physics for a feature
 * the rest of the simulation doesn't care about.
 *
 * Visual: a translucent plane (the "ribbon") with two side posts.
 * Sized via `width` / `height`; rotated by the entity's own rotation.
 */
AFRAME.registerComponent('race-target', {
  schema: {
    width: { type: 'number', default: 6 },
    height: { type: 'number', default: 4 },
    color: { type: 'color', default: '#2196f3' }
  },

  init: function () {
    this._buildVisual();
    this._reset = this._reset.bind(this);
    this.el.sceneEl.addEventListener('play-mode-start', this._reset);
    this.el.sceneEl.addEventListener('play-mode-reset', this._reset);
    this.crossed = false;
  },

  update: function (oldData) {
    if (
      oldData &&
      (oldData.width !== this.data.width ||
        oldData.height !== this.data.height ||
        oldData.color !== this.data.color)
    ) {
      this.el.querySelectorAll('[data-race-target-vis]').forEach((c) => {
        if (c.parentNode) c.parentNode.removeChild(c);
      });
      this._buildVisual();
    }
  },

  remove: function () {
    this.el.sceneEl.removeEventListener('play-mode-start', this._reset);
    this.el.sceneEl.removeEventListener('play-mode-reset', this._reset);
  },

  _reset: function () {
    this.crossed = false;
  },

  _buildVisual: function () {
    const { width, height, color } = this.data;
    const spawn = (child) => {
      child.classList.add('autocreated');
      child.setAttribute('data-aframe-inspector', 'autocreated');
      child.setAttribute('data-no-transform', '');
      child.setAttribute('data-race-target-vis', '');
      this.el.appendChild(child);
    };
    const ribbon = document.createElement('a-entity');
    ribbon.setAttribute(
      'geometry',
      `primitive: plane; width: ${width}; height: ${height}`
    );
    ribbon.setAttribute(
      'material',
      `color: ${color}; opacity: 0.45; transparent: true; side: double; shader: flat`
    );
    ribbon.setAttribute('position', `0 ${height / 2} 0`);
    spawn(ribbon);
    // Side posts so the ribbon reads as a "gate" from any angle.
    for (const sign of [-1, 1]) {
      const post = document.createElement('a-entity');
      post.setAttribute(
        'geometry',
        `primitive: cylinder; radius: 0.1; height: ${height + 0.2}`
      );
      post.setAttribute('material', `color: ${color}; shader: flat`);
      post.setAttribute('position', `${(sign * width) / 2} ${height / 2} 0`);
      spawn(post);
    }
  },

  tick: function () {
    if (this.crossed) return;
    const playMode = this.el.sceneEl.systems['play-mode'];
    if (!playMode || !playMode.isPlaying || playMode.isPaused) return;
    const chassis = document.getElementById('play-mode-player-car');
    if (!chassis) return;

    // World-space AABB centered on this entity's origin, sized
    // (width × height × 1.5m thickness so a fast car can't tunnel
    // through in one frame). Tested against the chassis WORLD
    // position transformed into the entity's local frame so the
    // entity's rotation is respected.
    const obj = this.el.object3D;
    obj.updateMatrixWorld();
    const inv = this._inv || (this._inv = new THREE.Matrix4());
    inv.copy(obj.matrixWorld).invert();
    const cp = this._cp || (this._cp = new THREE.Vector3());
    chassis.object3D.getWorldPosition(cp);
    cp.applyMatrix4(inv);
    const halfW = this.data.width / 2;
    const halfH = this.data.height / 2;
    if (
      Math.abs(cp.x) < halfW &&
      cp.y > -0.5 &&
      cp.y < halfH * 2 &&
      Math.abs(cp.z) < 0.75
    ) {
      this.crossed = true;
      const timer = this.el.sceneEl.components['scene-timer'];
      const simMs = timer ? timer.simulationTime || 0 : 0;
      this.el.sceneEl.emit('race-finish', { simulationTime: simMs }, false);
    }
  }
});
