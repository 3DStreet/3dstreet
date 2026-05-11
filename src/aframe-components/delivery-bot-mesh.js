/* global AFRAME, THREE */

/**
 * delivery-bot-mesh
 * =================
 *
 * Procedural visual for a generic sidewalk delivery bot. No GLB
 * download, no brand. The body is a small handful of `<a-entity>`
 * children built in `init()`; the antenna is a real-time
 * spring-damper that lags behind the chassis under acceleration so
 * the bot looks alive without keyframe animation.
 *
 * The antenna model: an inverted pendulum whose tip wants to point
 * straight up (`+Y`). When the chassis accelerates, the tip
 * experiences a pseudo-force in the OPPOSITE direction (Newton, in
 * the non-inertial frame of the chassis). A 2-D spring-damper in
 * entity-local (x, z) integrates that force and pulls the tip back
 * to vertical with critical-ish damping. A thin cylinder is
 * regenerated each tick to draw the line from antenna base to tip.
 *
 * Local axes: +Z is forward (matches catalog mesh convention so the
 * existing -90° wrapper rotation in `drive-mode.onPlayStart` works
 * unchanged); +Y up; +X right.
 */
AFRAME.registerComponent('delivery-bot-mesh', {
  schema: {
    bodyColor: { type: 'color', default: '#ececec' },
    accentColor: { type: 'color', default: '#1f6fb8' },
    antennaColor: { type: 'color', default: '#ffa726' },
    antennaLength: { type: 'number', default: 1.0 },
    // Spring constant. Higher = snappier return to vertical.
    stiffness: { type: 'number', default: 18 },
    // Damping. 2*sqrt(k) is critical; values below feel lively.
    damping: { type: 'number', default: 3.0 },
    // How strongly chassis acceleration deflects the tip.
    sensitivity: { type: 'number', default: 3.0 }
  },

  init: function () {
    this._buildBody();
    this._buildAntenna();
    this._lastWorldPos = new THREE.Vector3();
    this._lastWorldVel = new THREE.Vector3();
    this._curWorldVel = new THREE.Vector3();
    // Vector2 used as (x, z) since antenna only tilts in horizontal plane.
    this._tipXZ = new THREE.Vector2();
    this._tipVel = new THREE.Vector2();
    this._haveLastPos = false;
  },

  _buildBody: function () {
    const d = this.data;
    const root = this.el;

    // Main body box
    const body = document.createElement('a-entity');
    body.setAttribute(
      'geometry',
      'primitive: box; width: 0.55; height: 0.34; depth: 1.2'
    );
    body.setAttribute(
      'material',
      `color: ${d.bodyColor}; metalness: 0.05; roughness: 0.7`
    );
    body.setAttribute('position', '0 0.17 0');
    body.setAttribute('shadow', 'cast: true; receive: true');
    root.appendChild(body);

    // Lid (accent color, inset)
    const lid = document.createElement('a-entity');
    lid.setAttribute(
      'geometry',
      'primitive: box; width: 0.48; height: 0.04; depth: 1.1'
    );
    lid.setAttribute(
      'material',
      `color: ${d.accentColor}; metalness: 0.2; roughness: 0.4`
    );
    lid.setAttribute('position', '0 0.36 0');
    root.appendChild(lid);

    // Front sensor band (faces +Z forward)
    const face = document.createElement('a-entity');
    face.setAttribute(
      'geometry',
      'primitive: box; width: 0.5; height: 0.08; depth: 0.03'
    );
    face.setAttribute('material', 'color: #1a1a1a; metalness: 0; roughness: 1');
    face.setAttribute('position', '0 0.22 0.6');
    root.appendChild(face);

    // Eyes
    for (const x of [-0.13, 0.13]) {
      const eye = document.createElement('a-entity');
      eye.setAttribute(
        'geometry',
        'primitive: sphere; radius: 0.03; segmentsWidth: 12; segmentsHeight: 8'
      );
      eye.setAttribute(
        'material',
        `color: ${d.accentColor}; emissive: ${d.accentColor}; emissiveIntensity: 0.6; shader: flat`
      );
      eye.setAttribute('position', `${x} 0.22 0.62`);
      root.appendChild(eye);
    }

    // Tail light (at -Z back)
    const tail = document.createElement('a-entity');
    tail.setAttribute(
      'geometry',
      'primitive: box; width: 0.4; height: 0.03; depth: 0.02'
    );
    tail.setAttribute(
      'material',
      'color: #cc3333; emissive: #cc3333; emissiveIntensity: 0.4; shader: flat'
    );
    tail.setAttribute('position', '0 0.22 -0.6');
    root.appendChild(tail);

    // Side dot stripe — little accent details
    for (const z of [-0.4, 0, 0.4]) {
      for (const side of [-1, 1]) {
        const dot = document.createElement('a-entity');
        dot.setAttribute(
          'geometry',
          'primitive: sphere; radius: 0.018; segmentsWidth: 8; segmentsHeight: 6'
        );
        dot.setAttribute('material', `color: ${d.accentColor}; shader: flat`);
        dot.setAttribute('position', `${side * 0.275} 0.15 ${z}`);
        root.appendChild(dot);
      }
    }
  },

  _buildAntenna: function () {
    const d = this.data;
    // Mount Y (top of lid) — captured here so tick() can use it.
    this._mountY = 0.38;

    const mount = document.createElement('a-entity');
    mount.setAttribute(
      'geometry',
      'primitive: cone; radiusBottom: 0.03; radiusTop: 0.015; height: 0.06; segmentsRadial: 8'
    );
    mount.setAttribute('material', `color: ${d.accentColor}; shader: flat`);
    mount.setAttribute('position', `0 ${this._mountY + 0.03} 0`);
    this.el.appendChild(mount);

    // Line from mount to tip — thin cylinder, regenerated each tick.
    const line = document.createElement('a-entity');
    line.setAttribute('material', `color: ${d.antennaColor}; shader: flat`);
    this.el.appendChild(line);
    this._line = line;

    // Tip ball
    const ball = document.createElement('a-entity');
    ball.setAttribute(
      'geometry',
      'primitive: sphere; radius: 0.045; segmentsWidth: 12; segmentsHeight: 8'
    );
    ball.setAttribute(
      'material',
      `color: ${d.antennaColor}; emissive: ${d.antennaColor}; emissiveIntensity: 0.5; shader: flat`
    );
    this.el.appendChild(ball);
    this._ball = ball;
  },

  tick: function (time, deltaMs) {
    if (deltaMs <= 0 || deltaMs > 100) return; // skip first frame & huge stalls
    const dt = Math.min(deltaMs / 1000, 0.05);
    const d = this.data;

    // World position of the antenna mount (entity-local 0, mountY, 0).
    this.el.object3D.updateMatrixWorld();
    const worldMount = this._tmpV1 || (this._tmpV1 = new THREE.Vector3());
    worldMount
      .set(0, this._mountY, 0)
      .applyMatrix4(this.el.object3D.matrixWorld);

    if (!this._haveLastPos) {
      this._lastWorldPos.copy(worldMount);
      this._haveLastPos = true;
      return;
    }

    // World velocity and acceleration (finite differences).
    this._curWorldVel.copy(worldMount).sub(this._lastWorldPos).divideScalar(dt);
    const worldAccel = this._tmpV2 || (this._tmpV2 = new THREE.Vector3());
    worldAccel.copy(this._curWorldVel).sub(this._lastWorldVel).divideScalar(dt);
    this._lastWorldPos.copy(worldMount);
    this._lastWorldVel.copy(this._curWorldVel);

    // Convert world acceleration to ENTITY-LOCAL frame (axes only,
    // not translation). matrixWorld rows 0/4/8 carry the basis
    // vectors; dotting worldAccel against them yields the local
    // components.
    const e = this.el.object3D.matrixWorld.elements;
    const lax = worldAccel.x * e[0] + worldAccel.y * e[1] + worldAccel.z * e[2];
    const laz =
      worldAccel.x * e[8] + worldAccel.y * e[9] + worldAccel.z * e[10];

    // Spring-damper integration (semi-implicit Euler). Pseudo-force
    // on tip = -accel_local * sensitivity.
    const k = d.stiffness;
    const c = d.damping;
    const s = d.sensitivity;
    const ax = -k * this._tipXZ.x - c * this._tipVel.x - s * lax;
    const az = -k * this._tipXZ.y - c * this._tipVel.y - s * laz;
    this._tipVel.x += ax * dt;
    this._tipVel.y += az * dt;
    this._tipXZ.x += this._tipVel.x * dt;
    this._tipXZ.y += this._tipVel.y * dt;

    // Clamp tip excursion — keeps the antenna from whipping wildly
    // on a sudden crash. Bleeds outward velocity at the boundary.
    const maxOff = 0.35;
    if (this._tipXZ.lengthSq() > maxOff * maxOff) {
      const len = this._tipXZ.length();
      const radialDot =
        (this._tipVel.x * this._tipXZ.x + this._tipVel.y * this._tipXZ.y) / len;
      this._tipXZ.setLength(maxOff);
      if (radialDot > 0) {
        this._tipVel.x -= (this._tipXZ.x / maxOff) * radialDot;
        this._tipVel.y -= (this._tipXZ.y / maxOff) * radialDot;
      }
    }

    // Project to 3-D local pose: tip stays at antennaLength on Y,
    // displaces in X/Z.
    const tipX = this._tipXZ.x;
    const tipY = this._mountY + d.antennaLength;
    const tipZ = this._tipXZ.y;

    this._ball.object3D.position.set(tipX, tipY, tipZ);

    // Line: cylinder primitive recreated each tick. Cheap enough
    // because there's only one.
    const dx = tipX;
    const dy = tipY - this._mountY;
    const dz = tipZ;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length > 1e-4) {
      this._line.setAttribute(
        'geometry',
        `primitive: cylinder; radius: 0.008; height: ${length}; segmentsRadial: 6`
      );
      this._line.object3D.position.set(
        dx * 0.5,
        this._mountY + dy * 0.5,
        dz * 0.5
      );
      const up = this._tmpUp || (this._tmpUp = new THREE.Vector3(0, 1, 0));
      const dir = this._tmpDir || (this._tmpDir = new THREE.Vector3());
      dir.set(dx, dy, dz).normalize();
      this._line.object3D.quaternion.setFromUnitVectors(up, dir);
    }
  }
});
