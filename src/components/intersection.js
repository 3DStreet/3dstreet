/* global AFRAME */
AFRAME.registerComponent('intersection', {
  schema: {
    dimensions: { type: 'string', default: '20 20' },
    // cardinal direction order for sidewalk, stopsign, crosswalk: west, east, north, south
    sidewalk: { type: 'string', default: '0 0 0 0' },
    northeastcurb: { type: 'string', default: '4 4' },
    southwestcurb: { type: 'string', default: '4 4' },
    southeastcurb: { type: 'string', default: '4 4' },
    northwestcurb: { type: 'string', default: '4 4' },
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

    function createSidewalkElem({
      length,
      width,
      positionVec,
      scaleVec = { x: 1, y: 1, z: 1 },
      rotationVec,
      displayName
    }) {
      const sd = document.createElement('a-entity');
      // every 2 meters repeat sidewalk texture
      const repeatCountInter = [width / 2, parseInt(length / 2)];

      sd.setAttribute(
        'geometry',
        `primitive:box; depth: ${length}; width: ${width}; height: 0.4`
      );
      sd.setAttribute('position', positionVec);
      sd.setAttribute('scale', scaleVec);
      sd.setAttribute('rotation', rotationVec);
      sd.setAttribute('mixin', 'sidewalk');
      sd.classList.add('autocreated');
      sd.setAttribute(
        'material',
        `repeat: ${repeatCountInter[0]} ${repeatCountInter[1]}`
      );
      sd.setAttribute('data-layer-name', 'Sidewalk • ' + displayName);
      el.appendChild(sd);
    }

    // describe sidewalk parameters
    const sidewalkParams = {
      west: {
        positionVec: { x: intersectWidth / 2 - sidewalkArray[0] / 2, z: 0.1 },
        rotationVec: { x: 90, y: 0, z: 0 },
        length: intersectDepth,
        width: sidewalkArray[0],
        displayName: 'West'
      },
      east: {
        positionVec: { x: -intersectWidth / 2 + sidewalkArray[1] / 2, z: 0.1 },
        rotationVec: { x: 90, y: 0, z: 0 },
        length: intersectDepth,
        width: sidewalkArray[1],
        displayName: 'East'
      },
      north: {
        positionVec: {
          // add x offset to avoid sidewalk's element overlap
          x: sidewalkArray[1] / 2 - sidewalkArray[0] / 2,
          y: -intersectDepth / 2 + sidewalkArray[2] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        // minus the width of the crossing sidewalk
        length: intersectWidth - sidewalkArray[1] - sidewalkArray[0],
        width: sidewalkArray[2],
        displayName: 'North'
      },
      south: {
        positionVec: {
          // add x offset to avoid sidewalk's element overlap
          x: sidewalkArray[1] / 2 - sidewalkArray[0] / 2,
          y: intersectDepth / 2 - sidewalkArray[3] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        // minus the width of the crossing sidewalk
        length: intersectWidth - sidewalkArray[1] - sidewalkArray[0],
        width: sidewalkArray[3],
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
          x: intersectWidth / 2 - northeastcurbArray[0] / 2,
          y: intersectDepth / 2 - northeastcurbArray[1] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: northeastcurbArray[0],
        width: northeastcurbArray[1],
        displayName: 'Northeast'
      },
      southwest: {
        positionVec: {
          x: -intersectWidth / 2 + southwestcurbArray[0] / 2,
          y: -intersectDepth / 2 + southwestcurbArray[1] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: southwestcurbArray[0],
        width: southwestcurbArray[1],
        displayName: 'Southwest'
      },
      southeast: {
        positionVec: {
          x: intersectWidth / 2 - southeastcurbArray[0] / 2,
          y: -intersectDepth / 2 + southeastcurbArray[1] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: southeastcurbArray[0],
        width: southeastcurbArray[1],
        displayName: 'Southeast'
      },
      northwest: {
        positionVec: {
          x: -intersectWidth / 2 + northwestcurbArray[0] / 2,
          y: intersectDepth / 2 - northwestcurbArray[1] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: northwestcurbArray[0],
        width: northwestcurbArray[1],
        displayName: 'Northwest'
      }
    };

    // create curbs if they are given
    for (const [curbName, params] of Object.entries(curbParams)) {
      if (data[`${curbName}curb`] !== '0 0') {
        createSidewalkElem(params);
      }
    }

    // describe stop signals parameters
    const stopsignals = {
      west: {
        position: {
          x: intersectWidth / 2,
          y: intersectDepth / 3,
          z: 0.1
        },
        rotation: { x: 0, y: 90, z: 90 }
      },
      east: {
        position: {
          x: -intersectWidth / 2,
          y: -intersectDepth / 3,
          z: 0.1
        },
        rotation: { x: 0, y: -90, z: -90 }
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

    function createStopSignal(direction) {
      const stopSignEl = document.createElement('a-entity');
      const params = stopsignals[direction];
      stopSignEl.setAttribute('position', params['position']);
      stopSignEl.setAttribute('rotation', params['rotation']);
      stopSignEl.setAttribute('mixin', 'stop_sign');
      stopSignEl.classList.add('autocreated');
      stopSignEl.setAttribute('data-layer-name', 'Traffic Control • Stop Sign');
      return stopSignEl;
    }

    // create stop signals
    directionOrder.forEach((direction, index) => {
      if (stopsignArray[index]) {
        const stopSignEl = createStopSignal(direction);
        el.appendChild(stopSignEl);
      }
    });

    // describe traffic signals parameters
    const trafficSignals = {
      west: {
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
      east: {
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
        trafficSignalEl.classList.add('autocreated');
        trafficSignalEl.setAttribute(
          'data-layer-name',
          'Traffic Signal • ' + direction + ' ' + side
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
      cw1.setAttribute('position', { x: intersectWidth / 2 - 2, z: 0.11 });
      cw1.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw1.setAttribute('scale', { y: intersectDepth / 12 });
      cw1.setAttribute('mixin', 'markings crosswalk-zebra');
      cw1.setAttribute('data-layer-name', 'Crosswalk • East');
      cw1.classList.add('autocreated');
      el.appendChild(cw1);
    }
    if (crosswalklArray[1]) {
      const cw2 = document.createElement('a-entity');
      cw2.setAttribute('position', { x: -intersectWidth / 2 + 2, z: 0.11 });
      cw2.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw2.setAttribute('scale', { y: intersectDepth / 12 });
      cw2.setAttribute('mixin', 'markings crosswalk-zebra');
      cw2.setAttribute('data-layer-name', 'Crosswalk • West');
      cw2.classList.add('autocreated');
      el.appendChild(cw2);
    }
    if (crosswalklArray[2]) {
      const cw3 = document.createElement('a-entity');
      cw3.setAttribute('position', { y: -intersectDepth / 2 + 2, z: 0.11 });
      cw3.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw3.setAttribute('scale', { y: intersectWidth / 12 });
      cw3.setAttribute('mixin', 'markings crosswalk-zebra');
      cw3.setAttribute('data-layer-name', 'Crosswalk • Zebra (Continental)');
      cw3.classList.add('autocreated');
      el.appendChild(cw3);
    }
    if (crosswalklArray[3]) {
      const cw4 = document.createElement('a-entity');
      cw4.setAttribute('position', { y: intersectDepth / 2 - 2, z: 0.11 });
      cw4.setAttribute('data-layer-name', 'Crosswalk • Zebra (Continental)');
      cw4.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw4.setAttribute('scale', { y: intersectWidth / 12 });
      cw4.setAttribute('mixin', 'markings crosswalk-zebra');
      cw4.classList.add('autocreated');
      el.appendChild(cw4);
    }
  }
});
