/* global AFRAME */
const { SVGLoader } = require('../lib/SVGLoader.js');

AFRAME.registerComponent('svg-extruder', {
  schema: {
    svgString: { type: 'string' },
    depth: { type: 'number', default: 4 },
    bevelEnabled: { type: 'boolean', default: false },
    bevelThickness: { type: 'number', default: 1 },
    bevelSize: { type: 'number', default: 1 },
    bevelOffset: { type: 'number', default: 1 },
    bevelSegments: { type: 'number', default: 1 },
    topElement: { type: 'boolean', default: false },
    topColor: { type: 'color', default: 'white' },
    topSrc: { type: 'string', default: '#grass-texture' },
    color: { type: 'color', default: 'grey' },
    src: { type: 'string', default: '' },
    lineColor: { type: 'color', default: 'black' }
  },
  init: function () {
    const el = this.el;
    this.loader = new SVGLoader();

    el.removeAttribute('material');
    el.setAttribute('shadow', 'cast: true; receive: true');
  },
  createTopEntity: function (topGeometryArray) {
    const data = this.data;
    let topElement = this.el.children[0];
    // remove existing topElement. It could be getting from loaded JSON
    if (!topElement) {
      topElement = document.createElement('a-entity');
      topElement.classList.add('topElement');
      this.el.appendChild(topElement);
    }

    // merge shape geometries into one mergedGeometry
    const mergedGeometry = this.mergedGeometryFromArray(topGeometryArray);

    mergedGeometry.translate(0, 0.15, 0);

    // create a mesh with the shape geometry
    const mergedShapeMesh = new THREE.Mesh(
      mergedGeometry,
      this.materialFromSrc(data.topSrc, data.topColor)
    );

    if (topElement.getObject3D('mesh')) {
      topElement.removeObject3D('mesh');
    }
    topElement.setObject3D('mesh', mergedShapeMesh);

    // topElement.setAttribute('material', `src:${data.src};roughness:1;repeat: 0.01 0.01`);
  },
  materialFromSrc: function (imgSrc, color) {
    let texture = null;
    // create material with texture from img element with id imgSrc
    const textureImg = imgSrc !== '' ? document.querySelector(imgSrc) : null;
    if (textureImg) {
      // create texture from img element
      texture = new THREE.Texture(textureImg);

      texture.encoding = THREE.sRGBEncoding;

      // set repeat property for texture
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(0.01, 0.01);
    }

    const material = new THREE.MeshStandardMaterial({
      color: color,
      map: texture,
      roughness: 1
    });
    if (material.map) material.map.needsUpdate = true;
    return material;
  },
  mergedGeometryFromArray: function (geometryArray) {
    // Merge array of extruded geometries into the mergedGeometry
    const mergedGeometry =
      THREE.BufferGeometryUtils.mergeGeometries(geometryArray);

    mergedGeometry.computeBoundingBox();
    mergedGeometry.computeVertexNormals();
    mergedGeometry.center();
    mergedGeometry.rotateX(Math.PI / 2);
    mergedGeometry.scale(0.05, 0.05, 0.05);

    return mergedGeometry;
  },
  extrudeFromSVG: function (svgString) {
    const data = this.data;
    const el = this.el;
    const svgData = this.loader.parse(svgString);

    const extrudeSettings = {
      depth: data.depth,
      bevelEnabled: data.bevelEnabled,
      bevelThickness: data.bevelThickness,
      bevelSize: data.bevelSize,
      bevelOffset: data.bevelOffset,
      bevelSegments: data.bevelSegments
    };

    const extrudedGeometryArray = [];
    const topGeometryArray = [];

    svgData.paths.forEach((path) => {
      const shapes = SVGLoader.createShapes(path);

      shapes.forEach((shape) => {
        const topGeometry = new THREE.ExtrudeGeometry(shape, {
          depth: 1,
          bevelEnabled: false
        });
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        topGeometryArray.push(topGeometry);
        extrudedGeometryArray.push(geometry);
      });
    });

    const mergedGeometry = this.mergedGeometryFromArray(extrudedGeometryArray);

    const stokeMaterial = new THREE.LineBasicMaterial({
      color: data.lineColor
    });

    // create edges geometries and line segments from mergedGeometry
    const linesGeometry = new THREE.EdgesGeometry(mergedGeometry);
    const lines = new THREE.LineSegments(linesGeometry, stokeMaterial);

    el.setObject3D('lines', lines);

    // Finally, create a mesh with the merged geometry
    const mergedMesh = new THREE.Mesh(
      mergedGeometry,
      this.materialFromSrc(data.src, data.color)
    );

    // remove existing mesh from entity
    if (el.getObject3D('mesh')) {
      el.removeObject3D('mesh');
    }
    el.setObject3D('mesh', mergedMesh);

    // el.setAttribute('material', `src:${data.src};roughness:1;repeat: 0.1 0.1`);

    const topElement = this.el.children[0];
    if (data.topElement) {
      // create entity from shapes for top level of extruded geometry
      this.createTopEntity(topGeometryArray);
    } else if (topElement) {
      el.removeChild(topElement);
    }
  },
  update: function (oldData) {
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    // if (Object.keys(oldData).length === 0) { return; }

    const svgString = this.data.svgString;
    if (svgString) this.extrudeFromSVG(svgString);
  }
});
