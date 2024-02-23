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

    el.addEventListener('materialtextureloaded', () => {
      // fix texture properties to correctly show texture for extruded mesh
      const extrudedMesh = el.getObject3D('mesh');
      if (extrudedMesh && extrudedMesh.material) {
        const texture = extrudedMesh.material.map;        
        texture.wraps = texture.wrapt = THREE.repeatwrapping;
        texture.repeat.set( 1 / 100, 1 / 100 );
        texture.offset.set( 0.1, 0.5 );
      }
    });

    if (svgString) {
      this.extrudeFromSVG(svgString);
      el.setAttribute('material', 'src:#grass-texture;repeat:5 5;roughness:1'); 
      el.setAttribute('scale', '0.05 0.05 0.05');
      el.setAttribute('shadow', 'cast: true; receive: true');
    }
  },
  extrudeFromSVG: function (svgString) {
    const depth = this.data.depth;
    const el = this.el;
    const svgData = this.loader.parse(svgString);
    const fillMaterial = new THREE.MeshStandardMaterial({ color: "#F3FBFB" });
    const stokeMaterial = new THREE.LineBasicMaterial({
      color: "#00A5E6",
    });

    const extrudeSettings = {
      depth: depth,
      bevelEnabled: false
    };

    //svgGroup.scale.y *= -1;
    let shapeIndex = 0;

    const shapeGeometryArray = [];

    svgData.paths.forEach((path) => {
      const shapes = SVGLoader.createShapes(path);

      shapes.forEach((shape) => {
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        shapeGeometryArray.push(geometry);

        const linesGeometry = new THREE.EdgesGeometry(geometry);
        const lines = new THREE.LineSegments(linesGeometry, stokeMaterial);
        
        el.setObject3D('lines' + shapeIndex, lines);
        lines.name = 'lines' + shapeIndex;
        shapeIndex += 1;
      });
    });

    // Merge array of extruded geometries into the mergedGeometry
    const mergedGeometry = 
      THREE.BufferGeometryUtils.mergeBufferGeometries(shapeGeometryArray);

    mergedGeometry.computeVertexNormals();

    // Finally, create a mesh with the merged geometry
    const mergedMesh = new THREE.Mesh(mergedGeometry, fillMaterial);

    // remove existing mesh from entity
    el.removeObject3D('mesh');
    
    el.setObject3D('mesh', mergedMesh);

    const box = new THREE.Box3().setFromObject(mergedMesh);
    const size = box.getSize(new THREE.Vector3());

    const zOffset = size.y / -2;
    const xOffset = size.x / -2;

    // Offset all of extruded elements, to center them
    el.object3D.children.forEach((item) => {
      item.position.x = xOffset;
      item.position.y = zOffset;
    });

    el.object3D.rotateX(Math.PI / 2);

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