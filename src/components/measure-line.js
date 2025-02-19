// a-frame component to measure distances
// 2 vec3 values are required: start and end
AFRAME.registerComponent('measure-line', {
  schema: {
    start: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    end: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }
  },
  createOrUpdateHelper: function (start, end) {
    // Calculate length for cylinder height
    const length = this.calculateLength(start, end);

    // Create cylinder geometry with calculated length as height
    const geometry = new THREE.CylinderGeometry(
      this.radius,
      this.radius,
      length,
      8 // More segments for smoother cylinder
    );

    const material = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.5,
      depthTest: false
    });

    // Create or update mesh
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geometry, material);
      this.el.setObject3D('helper', this.mesh);
    } else {
      this.mesh.geometry = geometry;
      this.mesh.material = material;
    }

    // Calculate midpoint for position
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      z: (start.z + end.z) / 2
    };

    // Set position to midpoint
    this.mesh.position.set(midpoint.x, midpoint.y, midpoint.z);

    // Calculate rotation
    // Note: Cylinder's default orientation is along Y-axis
    const direction = new THREE.Vector3(
      end.x - start.x,
      end.y - start.y,
      end.z - start.z
    ).normalize();

    // Create quaternion from direction
    const quaternion = new THREE.Quaternion();
    // Up vector is Y axis (0,1,0) - default cylinder orientation
    const up = new THREE.Vector3(0, 1, 0);
    quaternion.setFromUnitVectors(up, direction);

    // Apply rotation
    this.mesh.setRotationFromQuaternion(quaternion);
  },
  calculateLength: function (start, end) {
    // calculate the length of the line segment
    // use the Pythagorean theorem
    const xDiff = end.x - start.x;
    const yDiff = end.y - start.y;
    const zDiff = end.z - start.z;
    const length = Math.sqrt(xDiff * xDiff + yDiff * yDiff + zDiff * zDiff);
    return length;
  },
  init: function () {
    // initialize helper cylinder geometry
    this.radius = 0.05;
    this.color = 0xffff00;
  },
  update: function (oldData) {
    // update the location of the helper cylinder
    console.log(
      'update, length:',
      this.calculateLength(this.data.start, this.data.end)
    );
    this.createOrUpdateHelper(this.data.start, this.data.end);
  },
  remove: function () {
    // remove the helper cylinder
  }
});
