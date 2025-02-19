// a-frame component to measure distances
// 2 vec3 values are required: start and end

// Import CSS2D Object for labels
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Up vector is Y axis (0,1,0) - default cylinder orientation
const up = new THREE.Vector3(0, 1, 0);

AFRAME.registerComponent('measure-line', {
  schema: {
    start: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    end: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }
  },
  createOrUpdateHelper: function () {
    // Calculate length for cylinder height
    const start = this.data.start;
    const end = this.data.end;
    const length = this.calculateLength();

    // Create cylinder geometry with calculated length as height
    const geometry = new THREE.CylinderGeometry(
      this.radius,
      this.radius,
      length,
      8 // More segments for smoother cylinder
    );

    // Create or update mesh
    if (!this.mesh) {
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.5,
        depthTest: false
      });
      this.mesh = new THREE.Mesh(geometry, material);
      this.el.setObject3D('helper', this.mesh);
    } else {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    }

    // Set position to midpoint
    this.mesh.position.set(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      (start.z + end.z) / 2
    );

    // Calculate rotation
    // Note: Cylinder's default orientation is along Y-axis
    this.direction
      .set(end.x - start.x, end.y - start.y, end.z - start.z)
      .normalize();

    // Create quaternion from direction
    this.tmpQuaternion.setFromUnitVectors(up, this.direction);

    // Apply rotation
    this.mesh.setRotationFromQuaternion(this.tmpQuaternion);

    // Update label position and content
    this.labelObject.position.copy(this.mesh.position);
    this.labelDiv.textContent = `${length.toFixed(2)}m`;
  },
  calculateLength: function () {
    const start = this.data.start;
    const end = this.data.end;
    // calculate the length of the line segment
    // use the Pythagorean theorem
    const xDiff = end.x - start.x;
    const yDiff = end.y - start.y;
    const zDiff = end.z - start.z;
    const length = Math.sqrt(xDiff * xDiff + yDiff * yDiff + zDiff * zDiff);
    return length;
  },
  init: function () {
    this.tmpQuaternion = new THREE.Quaternion();
    this.direction = new THREE.Vector3();
    // initialize helper cylinder geometry
    this.radius = 0.05;
    this.color = 0xffff00;

    // Create label div
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label';
    labelDiv.style.color = '#FFF';
    labelDiv.style.fontFamily = 'sans-serif';
    labelDiv.style.padding = '2px';
    labelDiv.style.backgroundColor = 'rgba(0, 0, 0, .6)';
    this.labelDiv = labelDiv;

    // Create CSS2D object
    this.labelObject = new CSS2DObject(labelDiv);
    this.el.object3D.add(this.labelObject);
  },
  update: function (oldData) {
    // update the location of the helper cylinder
    this.createOrUpdateHelper();
  },
  remove: function () {
    // remove the helper cylinder
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.labelDiv.remove();
  }
});
