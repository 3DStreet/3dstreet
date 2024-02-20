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

    if (svgString) {
      this.extrudeFromSVG(svgString);
    }
  },
  extrudeFromSVG: function (svgString) {
    const depth = this.data.depth;
    const el = this.el;
    const loader = new SVGLoader();
    const svgData = loader.parse(svgString);
    const svgGroup = new THREE.Group();
    const updateMap = [];
    const fillMaterial = new THREE.MeshBasicMaterial({ color: "#F3FBFB" });
    const stokeMaterial = new THREE.LineBasicMaterial({
      color: "#00A5E6",
    });

    svgGroup.scale.y *= -1;
    svgData.paths.forEach((path) => {
      const shapes = SVGLoader.createShapes(path);

      shapes.forEach((shape) => {
        const meshGeometry = new THREE.ExtrudeGeometry(shape, {
          depth: depth,
          bevelEnabled: false,
        });
        const linesGeometry = new THREE.EdgesGeometry(meshGeometry);
        const mesh = new THREE.Mesh(meshGeometry, fillMaterial);
        const lines = new THREE.LineSegments(linesGeometry, stokeMaterial);

        updateMap.push({ shape, mesh, lines });
        svgGroup.add(mesh, lines);
      });
    });

    const box = new THREE.Box3().setFromObject(svgGroup);
    const size = box.getSize(new THREE.Vector3());
    const yOffset = size.y / -2;
    const xOffset = size.x / -2;

    // Offset all of group's elements, to center them
    svgGroup.children.forEach((item) => {
      item.position.x = xOffset;
      item.position.y = yOffset;
    });
    svgGroup.rotateX(-Math.PI / 2);

    el.setObject3D('mesh', svgGroup);
  },
  update: function (oldData) {
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    if (Object.keys(oldData).length === 0) { return; }

    const svgString = this.data.svgString;
    
    if (svgString) {
      this.extrudeFromSVG(svgString);
    }
  }
});
