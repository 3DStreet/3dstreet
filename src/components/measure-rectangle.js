// a-frame component to measure distances
// 2 vec3 values are required: start and end

// Import CSS2D Object for labels
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import useStore from '../store.js';

// Up vector is Y axis (0,1,0) - default cylinder orientation
const up = new THREE.Vector3(0, 1, 0);

AFRAME.registerComponent('measure-rectangle', {
  schema: {
    start: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // baseline
    end: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // baseline
    sections: { type: 'array' }
  },
  // Add a new method to create rectangles based on sections
  createRectangles: function () {
    if (!this.rectangles) this.rectangles = [];

    // Clear previous rectangles
    this.rectangles.forEach((rect) => {
      if (rect.mesh) {
        this.el.object3D.remove(rect.mesh);
        rect.mesh.geometry.dispose();
        rect.mesh.material.dispose();
      }
    });
    this.rectangles = [];

    const start = this.data.start;
    const end = this.data.end;
    const baselineLength = this.calculateLength();

    // Create direction vector for the baseline
    const baselineDir = new THREE.Vector3(
      end.x - start.x,
      end.y - start.y,
      end.z - start.z
    ).normalize();

    // Get perpendicular vector (up from the baseline)
    // Using cross product with a temporary vector to get perpendicular direction
    const tempVec = new THREE.Vector3(0, 1, 0);
    if (Math.abs(baselineDir.dot(tempVec)) > 0.9) {
      tempVec.set(1, 0, 0); // Use X axis if baseline is close to Y axis
    }
    const upVector = new THREE.Vector3()
      .crossVectors(baselineDir, tempVec)
      .normalize();

    // Create a rectangle for each section
    this.data.sections.forEach((height, index) => {
      // Create rectangle geometry
      const rectGeometry = new THREE.PlaneGeometry(baselineLength, height);
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthTest: false
      });

      const rectMesh = new THREE.Mesh(rectGeometry, material);

      // Position rectangle at midpoint of baseline and half its height up
      const midpoint = new THREE.Vector3(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        (start.z + end.z) / 2
      );

      // Position the rectangle at the correct height
      const offset = height / 2;
      midpoint.addScaledVector(upVector, offset);
      rectMesh.position.copy(midpoint);

      // Orient rectangle correctly
      // We need to create a custom rotation to align the plane
      // First, set the correct normal (perpendicular to baseline and up)
      const normalVector = new THREE.Vector3()
        .crossVectors(baselineDir, upVector)
        .normalize();

      // Create a rotation matrix from these vectors
      const rotationMatrix = new THREE.Matrix4();
      rotationMatrix.makeBasis(baselineDir, upVector, normalVector);

      // Apply rotation
      rectMesh.rotation.setFromRotationMatrix(rotationMatrix);

      // Add to scene
      this.el.object3D.add(rectMesh);

      // Store reference
      this.rectangles.push({ mesh: rectMesh, height: height });
    });
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
    if (this.units === 'metric') {
      this.labelDiv.textContent = `${length.toFixed(2)}m`;
    } else if (this.units === 'imperial') {
      const feet = length * 3.28084;
      this.labelDiv.textContent = `${feet.toFixed(2)}ft`;
    }
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
    // Get initial units preference from store
    this.units = useStore.getState().unitsPreference || 'metric';

    // Subscribe to units preference changes
    useStore.subscribe((state) => {
      if (this.units !== state.unitsPreference) {
        this.units = state.unitsPreference;
        this.createOrUpdateHelper();
      }
    });
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
    // Create/update rectangles
    this.createRectangles();
  },
  remove: function () {
    // remove the helper cylinder
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.labelDiv.remove();
    // Remove rectangles
    if (this.rectangles) {
      this.rectangles.forEach((rect) => {
        if (rect.mesh) {
          rect.mesh.geometry.dispose();
          rect.mesh.material.dispose();
        }
      });
    }
  }
});
