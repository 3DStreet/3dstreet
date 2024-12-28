import * as THREE from 'three';

/* global AFRAME */
AFRAME.registerComponent('intersection', {
  schema: {
    dimensions: { type: 'string', default: '20 20' },
    // cardinal direction order for sidewalk, stopsign, crosswalk, and trafficsignal: west, east, north, south
    sidewalk: { type: 'string', default: '0 0 0 0' },
    northeastcurb: { type: 'string', default: '4 4 1' },
    southwestcurb: { type: 'string', default: '4 4 1' },
    southeastcurb: { type: 'string', default: '4 4 1' },
    northwestcurb: { type: 'string', default: '4 4 1' },
    stopsign: { type: 'string', default: '0 0 0 0' },
    trafficsignal: { type: 'string', default: '1 1 1 1' },
    crosswalk: { type: 'string', default: '1 1 1 1' }
  },
  update: function () {
    var data = this.data;
    var el = this.el;
    const directionOrder = ['west', 'east', 'north', 'south'];

    // remove all child nodes if exists
    while (el.firstChild) {
      el.removeChild(el.lastChild);
    }
    const dimensionsArray = data.dimensions.split(' ').map((i) => Number(i));
    const sidewalkArray = data.sidewalk.split(' ').map((i) => Number(i));
    const northeastcurbArray = data.northeastcurb
      .split(' ')
      .map((i) => Number(i));
    const southwestcurbArray = data.southwestcurb
      .split(' ')
      .map((i) => Number(i));
    const southeastcurbArray = data.southeastcurb
      .split(' ')
      .map((i) => Number(i));
    const northwestcurbArray = data.northwestcurb
      .split(' ')
      .map((i) => Number(i));
    const stopsignArray = data.stopsign.split(' ').map((i) => Number(i));
    const trafficsignalArray = data.trafficsignal
      .split(' ')
      .map((i) => Number(i));
    const crosswalklArray = data.crosswalk.split(' ').map((i) => Number(i));

    const intersectWidth = dimensionsArray[0];
    const intersectDepth = dimensionsArray[1];

    this.el.setAttribute(
      'geometry',
      `primitive:box; width: ${intersectWidth}; height: ${intersectDepth}; depth:0.2`
    );
    this.el.setAttribute(
      'material',
      'src: #asphalt-texture; repeat:5 5; roughness:1'
    );
    this.el.setAttribute('shadow', '');

    // Create the texture for sidewalk that will be re-used
    const sidewalkTexture = new THREE.TextureLoader().load(
      document.getElementById('seamless-sidewalk').src
    );
    sidewalkTexture.wrapS = THREE.RepeatWrapping;
    sidewalkTexture.wrapT = THREE.RepeatWrapping;
    sidewalkTexture.repeat.set(0.5, 0.5); // Scale the texture to repeat twice every meter

    this.sidewalkMaterial = new THREE.MeshStandardMaterial({
      map: sidewalkTexture,
      roughness: 0.8, // Same roughness as sidewalk mixin in src/assets.js
      color: 0xcccccc // Darkens the texture to match existing sidewalk
    });
    this.curbGeoms = [];

    const createSidewalkElem = ({
      length,
      width,
      radius,
      positionVec,
      scaleVec = { x: 1, y: 1, z: 1 },
      rotationVec,
      displayName
    }) => {
      const sd = document.createElement('a-entity');
      // Radius should not be greater than any side
      const boundedRadius = Math.min(radius, length, width);

      const points = [];
      points.push(new THREE.Vector2(0, 0));
      points.push(new THREE.Vector2(length, 0));
      // Only if a radius is set, create the arc
      if (radius > 0) {
        const arc = new THREE.EllipseCurve(
          length - boundedRadius,
          width - boundedRadius,
          boundedRadius,
          boundedRadius,
          0,
          Math.PI / 2
        );
        points.push(...arc.getSpacedPoints());
      } else {
        points.push(new THREE.Vector2(length, width));
      }
      points.push(new THREE.Vector2(0, width));

      // Create new shape out of the points:
      const curbShape = new THREE.Shape(points);
      const curbGeom = new THREE.ExtrudeGeometry(curbShape, {
        depth: 0.4, // Match existing sidewalk thickness
        bevelEnabled: false
      });
      this.curbGeoms.push(curbGeom); // Need to remove manually later since it is 3js component

      const mesh = new THREE.Mesh(curbGeom, this.sidewalkMaterial);
      mesh.scale.setX(scaleVec.x);
      mesh.scale.setY(scaleVec.y);
      mesh.scale.setZ(scaleVec.z);

      sd.setAttribute('position', positionVec);
      sd.setAttribute('rotation', rotationVec);
      sd.classList.add('autocreated');
      sd.setAttribute('data-layer-name', 'Sidewalk • ' + displayName);
      sd.setAttribute('data-no-transform', '');
      sd.setAttribute('data-ignore-raycaster', '');
      sd.object3D.add(mesh);
      el.appendChild(sd);
    };

    // describe sidewalk parameters
    const sidewalkParams = {
      west: {
        positionVec: {
          x: -intersectWidth / 2,
          y: -intersectDepth / 2,
          z: 0.1
        },
        width: intersectDepth,
        length: sidewalkArray[0],
        displayName: 'West'
      },
      east: {
        positionVec: {
          x: intersectWidth / 2,
          y: -intersectDepth / 2,
          z: 0.1
        },
        scaleVec: { x: -1, y: 1, z: 1 },
        width: intersectDepth,
        length: sidewalkArray[1],
        displayName: 'East'
      },
      north: {
        positionVec: {
          x: -intersectWidth / 2,
          y: intersectDepth / 2,
          z: 0.1
        },
        scaleVec: { x: 1, y: -1, z: 1 },
        width: sidewalkArray[2],
        length: intersectWidth,
        displayName: 'North'
      },
      south: {
        positionVec: {
          x: -intersectWidth / 2,
          y: -intersectDepth / 2,
          z: 0.1
        },
        width: sidewalkArray[3],
        length: intersectWidth,
        displayName: 'South'
      }
    };

    // create sidewalks if they are given in sidewalkArray
    const selectedSidewalks = Object.keys(sidewalkParams).filter(
      (el, ind) => sidewalkArray[ind]
    );

    selectedSidewalks.forEach((sidewalkName, ind) => {
      const params = sidewalkParams[sidewalkName];
      createSidewalkElem(params);
    });

    // describe curb parameters
    const curbParams = {
      northeast: {
        positionVec: {
          x: intersectWidth / 2,
          y: intersectDepth / 2,
          z: 0.1
        },
        scaleVec: { x: -1, y: -1, z: 1 },
        length: northeastcurbArray[0],
        width: northeastcurbArray[1],
        radius: northeastcurbArray[2],
        displayName: 'Northeast'
      },
      southwest: {
        positionVec: {
          x: -intersectWidth / 2,
          y: -intersectDepth / 2,
          z: 0.1
        },
        scaleVec: { x: 1, y: 1, z: 1 },
        length: southwestcurbArray[0],
        width: southwestcurbArray[1],
        radius: southwestcurbArray[2],
        displayName: 'Southwest'
      },
      southeast: {
        positionVec: {
          x: intersectWidth / 2,
          y: -intersectDepth / 2,
          z: 0.1
        },
        scaleVec: { x: -1, y: 1, z: 1 },
        length: southeastcurbArray[0],
        width: southeastcurbArray[1],
        radius: southeastcurbArray[2],
        displayName: 'Southeast'
      },
      northwest: {
        positionVec: {
          x: -intersectWidth / 2,
          y: intersectDepth / 2,
          z: 0.1
        },
        scaleVec: { x: 1, y: -1, z: 1 },
        length: northwestcurbArray[0],
        width: northwestcurbArray[1],
        radius: northwestcurbArray[2],
        displayName: 'Northwest'
      }
    };

    // create curbs if they are given
    for (const [curbName, params] of Object.entries(curbParams)) {
      if (data[`${curbName}curb`] !== '0 0 0') {
        createSidewalkElem(params);
      }
    }

    // describe stop signs parameters
    const stopsigns = {
      west: {
        position: {
          x: -intersectWidth / 2,
          y: -intersectDepth / 3,
          z: 0.1
        },
        rotation: { x: 0, y: -90, z: -90 }
      },
      east: {
        position: {
          x: intersectWidth / 2,
          y: intersectDepth / 3,
          z: 0.1
        },
        rotation: { x: 0, y: 90, z: 90 }
      },
      north: {
        position: {
          x: -intersectWidth / 3,
          y: intersectDepth / 2,
          z: 0.1
        },
        rotation: { x: -90, y: 90, z: 90 }
      },
      south: {
        position: {
          x: intersectWidth / 3,
          y: -intersectDepth / 2,
          z: 0.1
        },
        rotation: { x: 90, y: -90, z: -90 }
      }
    };

    function createStopSign(direction) {
      const stopSignEl = document.createElement('a-entity');
      const params = stopsigns[direction];
      stopSignEl.setAttribute('position', params['position']);
      stopSignEl.setAttribute('rotation', params['rotation']);
      stopSignEl.setAttribute('mixin', 'stop_sign');
      stopSignEl.classList.add('autocreated');
      stopSignEl.setAttribute('data-layer-name', 'Traffic Control • Stop Sign');
      stopSignEl.setAttribute('data-no-transform');
      stopSignEl.setAttribute('data-ignore-raycaster');
      return stopSignEl;
    }

    // create stop signals
    directionOrder.forEach((direction, index) => {
      if (stopsignArray[index]) {
        const stopSignEl = createStopSign(direction);
        el.appendChild(stopSignEl);
      }
    });

    // describe traffic signals parameters
    const trafficSignals = {
      west: {
        left: {
          position: {
            x: -intersectWidth / 2,
            y: -intersectDepth / 3,
            z: 0.3
          },
          rotation: { x: 210, y: 90, z: 90 }
        },
        right: {
          position: {
            x: -intersectWidth / 2,
            y: intersectDepth / 3,
            z: 0.3
          },
          rotation: { x: 0, y: 90, z: 90 }
        }
      },
      east: {
        left: {
          position: {
            x: intersectWidth / 2,
            y: intersectDepth / 3,
            z: 0.3
          },
          rotation: { x: 210, y: 90, z: 90 }
        },
        right: {
          position: {
            x: intersectWidth / 2,
            y: -intersectDepth / 3,
            z: 0.3
          },
          rotation: { x: 180, y: 90, z: 90 }
        }
      },
      north: {
        left: {
          position: {
            x: -intersectWidth / 3,
            y: intersectDepth / 2,
            z: 0.1
          },
          rotation: { x: 120, y: 90, z: 90 }
        },
        right: {
          position: {
            x: intersectWidth / 3,
            y: intersectDepth / 2,
            z: 0.1
          },
          rotation: { x: 90, y: 90, z: 90 }
        }
      },
      south: {
        left: {
          position: {
            x: intersectWidth / 3,
            y: -intersectDepth / 2,
            z: 0.1
          },
          rotation: { x: -60, y: 90, z: 90 }
        },
        right: {
          position: {
            x: -intersectWidth / 3,
            y: -intersectDepth / 2,
            z: 0.1
          },
          rotation: { x: -90, y: 90, z: 90 }
        }
      }
    };

    function createTrafficSignals(direction) {
      const params = trafficSignals[direction];
      ['left', 'right'].forEach((side) => {
        const trafficSignalEl = document.createElement('a-entity');
        trafficSignalEl.setAttribute('position', params[side].position);
        trafficSignalEl.setAttribute('rotation', params[side].rotation);
        trafficSignalEl.setAttribute('mixin', `signal_${side}`);
        trafficSignalEl.setAttribute('data-no-transform', '');
        trafficSignalEl.setAttribute('data-ignore-raycaster', '');
        trafficSignalEl.classList.add('autocreated');
        trafficSignalEl.setAttribute(
          'data-layer-name',
          'Traffic Control • Signal ' + direction + ' ' + side
        );
        el.appendChild(trafficSignalEl);
      });
    }

    // create traffic signals
    directionOrder.forEach((direction, index) => {
      if (trafficsignalArray[index]) {
        createTrafficSignals(direction);
      }
    });

    if (crosswalklArray[0]) {
      const cw1 = document.createElement('a-entity');
      cw1.setAttribute('position', { x: -intersectWidth / 2 + 2, z: 0.11 });
      cw1.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw1.setAttribute('scale', { y: intersectDepth / 12 });
      cw1.setAttribute('mixin', 'markings crosswalk-zebra');
      cw1.setAttribute('data-layer-name', 'Crosswalk • West');
      cw1.setAttribute('data-no-transform', '');
      cw1.setAttribute('data-ignore-raycaster', '');
      cw1.classList.add('autocreated');
      el.appendChild(cw1);
    }
    if (crosswalklArray[1]) {
      const cw2 = document.createElement('a-entity');
      cw2.setAttribute('position', { x: intersectWidth / 2 - 2, z: 0.11 });
      cw2.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw2.setAttribute('scale', { y: intersectDepth / 12 });
      cw2.setAttribute('mixin', 'markings crosswalk-zebra');
      cw2.setAttribute('data-layer-name', 'Crosswalk • East');
      cw2.setAttribute('data-no-transform', '');
      cw2.setAttribute('data-ignore-raycaster', '');
      cw2.classList.add('autocreated');
      el.appendChild(cw2);
    }
    if (crosswalklArray[2]) {
      const cw3 = document.createElement('a-entity');
      cw3.setAttribute('position', { y: intersectDepth / 2 - 2, z: 0.11 });
      cw3.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw3.setAttribute('scale', { y: intersectWidth / 12 });
      cw3.setAttribute('mixin', 'markings crosswalk-zebra');
      cw3.setAttribute('data-layer-name', 'Crosswalk • North');
      cw3.setAttribute('data-no-transform', '');
      cw3.setAttribute('data-ignore-raycaster', '');
      cw3.classList.add('autocreated');
      el.appendChild(cw3);
    }
    if (crosswalklArray[3]) {
      const cw4 = document.createElement('a-entity');
      cw4.setAttribute('position', { y: -intersectDepth / 2 + 2, z: 0.11 });
      cw4.setAttribute('data-layer-name', 'Crosswalk • South');
      cw4.setAttribute('data-no-transform', '');
      cw4.setAttribute('data-ignore-raycaster', '');
      cw4.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw4.setAttribute('scale', { y: intersectWidth / 12 });
      cw4.setAttribute('mixin', 'markings crosswalk-zebra');
      cw4.classList.add('autocreated');
      el.appendChild(cw4);
    }
  },
  remove() {
    // Remove the 3js entities
    this.curbGeoms.forEach((c) => c.dispose());
    this.sidewalkMaterial.dispose();
  }
});
