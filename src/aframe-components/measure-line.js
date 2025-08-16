// a-frame component to measure distances
// 2 vec3 values are required: start and end

// Import CSS2D Object for labels
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import useStore from '../store.js';

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

    // Create or update endpoint spheres
    this.createOrUpdateEndpoints(start, end);

    // Update label position and content
    this.labelObject.position.copy(this.mesh.position);
    if (this.units === 'metric') {
      this.labelDiv.textContent = `${length.toFixed(2)}m`;
    } else if (this.units === 'imperial') {
      const feet = length * 3.28084;
      this.labelDiv.textContent = `${feet.toFixed(2)}ft`;
    }
  },
  createOrUpdateEndpoints: function (start, end) {
    // Create endpoint sphere geometry
    const sphereGeometry = new THREE.SphereGeometry(
      this.endpointRadius,
      16,
      16
    );

    // Create or update start endpoint (green)
    if (!this.startEndpoint) {
      const startMaterial = new THREE.MeshBasicMaterial({
        color: this.startColor,
        transparent: true,
        opacity: 0.8,
        depthTest: false
      });
      this.startEndpoint = new THREE.Mesh(sphereGeometry, startMaterial);
      this.el.setObject3D('startEndpoint', this.startEndpoint);
    }
    this.startEndpoint.position.set(start.x, start.y, start.z);

    // Create or update end endpoint (red)
    if (!this.endEndpoint) {
      const endMaterial = new THREE.MeshBasicMaterial({
        color: this.endColor,
        transparent: true,
        opacity: 0.8,
        depthTest: false
      });
      this.endEndpoint = new THREE.Mesh(sphereGeometry, endMaterial);
      this.el.setObject3D('endEndpoint', this.endEndpoint);
    }
    this.endEndpoint.position.set(end.x, end.y, end.z);
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

    // initialize endpoint sphere geometry
    this.endpointRadius = 0.15;
    this.startColor = 0x00ff00; // Green for start
    this.endColor = 0xff0000; // Red for end

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
    if (this.mesh) {
      this.mesh.material.dispose();
      this.mesh.geometry.dispose();
    }

    // remove the endpoint spheres
    if (this.startEndpoint) {
      this.startEndpoint.material.dispose();
      this.startEndpoint.geometry.dispose();
    }
    if (this.endEndpoint) {
      this.endEndpoint.material.dispose();
      this.endEndpoint.geometry.dispose();
    }

    if (this.labelDiv) {
      this.labelDiv.remove();
    }
  }
});
