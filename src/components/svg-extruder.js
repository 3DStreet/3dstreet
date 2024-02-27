/* global AFRAME */
var { SVGLoader } = require('../lib/SVGLoader.js');

AFRAME.registerComponent('svg-extruder', {
  schema: {
    svgString: { type: 'string' },
    depth: { type: 'number', default: 4 }
  },
  init: function () {
    const el = this.el;
    const svgString = this.data.svgString;
    this.loader = new SVGLoader();

    this.stokeMaterial = new THREE.LineBasicMaterial({
      color: '#00A5E6'
    });

    // set scale for extruded svg
    el.setAttribute('shadow', 'cast: true; receive: true');
  },
  extrudeFromSVG: function (svgString) {
    const depth = this.data.depth;
    const el = this.el;
    const svgData = this.loader.parse(svgString);
    const fillMaterial = new THREE.MeshStandardMaterial();

    const extrudeSettings = {
      depth: depth,
      bevelEnabled: false
    };

    const shapeGeometryArray = [];

    svgData.paths.forEach((path) => {
      const shapes = SVGLoader.createShapes(path);

      shapes.forEach((shape) => {
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        shapeGeometryArray.push(geometry);
      });
    });

    // Merge array of extruded geometries into the mergedGeometry
    const mergedGeometry =
      THREE.BufferGeometryUtils.mergeBufferGeometries(shapeGeometryArray);

    mergedGeometry.computeBoundingBox();
    mergedGeometry.computeVertexNormals();
    mergedGeometry.center();
    mergedGeometry.rotateX(Math.PI / 2);
    mergedGeometry.scale(0.05, 0.05, 0.05);

    const linesGeometry = new THREE.EdgesGeometry(mergedGeometry);
    const lines = new THREE.LineSegments(linesGeometry, this.stokeMaterial);

    el.setObject3D('lines', lines);

    // Finally, create a mesh with the merged geometry
    const mergedMesh = new THREE.Mesh(mergedGeometry, fillMaterial);

    // remove existing mesh from entity
    el.removeObject3D('mesh');
    el.setObject3D('mesh', mergedMesh);
  },
  update: function (oldData) {
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    // if (Object.keys(oldData).length === 0) { return; }

    const el = this.el;
    const svgString = this.data.svgString;

    if (svgString) {
      this.extrudeFromSVG(svgString);
      if (!el.getAttribute('material')) {
        // applies the default mixin material grass. If the element's material is not set via setAttribute
        el.setAttribute('material', 'src:#grass-texture;roughness:1;repeat: 0.01 0.01');
      }
    }
  }
});
