/* global AFRAME */
AFRAME.registerComponent('auto-intersection', {
  schema: {
    // selectors of street elements for create intersection
    northStreet: { type: 'selector' },
    southStreet: { type: 'selector' },
    westStreet: { type: 'selector' },
    eastStreet: { type: 'selector' }
  },
  update: function () {
    const el = this.el;
    // cardinal order in the intersection component schema
    this.cardinalOrder = ['east', 'west', 'north', 'south'];

    const intersectionProps = (this.intersectionProps =
      this.calculateDataForIntersection());
    el.setAttribute('intersection', intersectionProps);
    this.alignStreetsToIntersection();
  },
  alignStreetsToIntersection: function () {
    const dimensions = this.dimensions;
    const interDimensions = this.intersectionProps.dimensions.split(' ');
    const data = this.data;
    const interElPos = this.el.getAttribute('position');
    let newPos;
    for (const streetDirection of this.cardinalOrder) {
      // streetDirection = east, west, north, south
      if (dimensions[streetDirection].total) {
        const streetEl = data[streetDirection + 'Street'];
        const length = streetEl.getAttribute('street').length;

        switch (streetDirection) {
          case 'north':
            newPos = {
              x: interElPos.x,
              z: interElPos.z - interDimensions[1] / 2 - length / 2
            };
            break;
          case 'south':
            newPos = {
              x: interElPos.x,
              z: interElPos.z + interDimensions[1] / 2 + length / 2
            };
            break;
          case 'west':
            newPos = {
              x: interElPos.x - interDimensions[0] / 2 - length / 2,
              z: interElPos.z
            };
            break;
          case 'east':
            newPos = {
              x: interElPos.x + interDimensions[0] / 2 + length / 2,
              z: interElPos.z
            };
            break;
        }
        streetEl.setAttribute('position', newPos);
      }
    }
  },
  // calculate all properties in string format for the intersection component
  calculateDataForIntersection() {
    const data = this.data;
    const cardinalOrder = this.cardinalOrder;

    // dimensions of the left, right sidewalk pedestrian parts of the street
    // (with sidewalk segment types) and total street width
    const dimensions = (this.dimensions = {
      north: {},
      east: {},
      south: {},
      west: {}
    });
    cardinalOrder.forEach((cardinalDir) => {
      const sideStreetEl = data[cardinalDir + 'Street'];
      const streetParent = sideStreetEl
        ? sideStreetEl.querySelector('.street-parent')
        : null;
      if (streetParent) {
        dimensions[cardinalDir] = this.getStreetWidths(streetParent);
      }
    });

    // get dimensions of sidewalks at corners
    let curbSizes = {
      northeast: [
        dimensions['north']['right'] || 0,
        dimensions['east']['right'] || 0
      ],
      southeast: [
        dimensions['south']['right'] || 0,
        dimensions['east']['left'] || 0
      ],
      southwest: [
        dimensions['south']['left'] || 0,
        dimensions['west']['left'] || 0
      ],
      northwest: [
        dimensions['north']['left'] || 0,
        dimensions['west']['right'] || 0
      ]
    };
    function getCurbValue(curbSizes) {
      if (curbSizes[0] > 0 && curbSizes[1] > 0) {
        return curbSizes.join(' ');
      } else {
        return '0 0';
      }
    }
    // string values of curbs for the intersection component
    const InterNortheastcurb = getCurbValue(curbSizes['northeast']);
    const InterSouthwestcurb = getCurbValue(curbSizes['southwest']);
    const InterSoutheastcurb = getCurbValue(curbSizes['southeast']);
    const InterNorthwestcurb = getCurbValue(curbSizes['northwest']);

    // get sidewalk values (string) for the intersection component
    const interSidewalk = [
      !data['eastStreet']
        ? curbSizes['northeast'][0] || curbSizes['southeast'][0]
        : 0,
      !data['westStreet']
        ? curbSizes['northwest'][0] || curbSizes['southwest'][0]
        : 0,
      !data['northStreet']
        ? curbSizes['northwest'][1] || curbSizes['northeast'][1]
        : 0,
      !data['southStreet']
        ? curbSizes['southeast'][1] || curbSizes['southwest'][1]
        : 0
    ].join(' ');

    // get dimensions (string) for the intersection component
    // assume that width of north street == width of south street. Same for west-east
    const interDimensions = [
      dimensions['north'].total || dimensions['south'].total,
      dimensions['west'].total || dimensions['east'].total
    ].join(' ');

    // get data for stopsignals, trafficsignal, crosswalk
    const interStreetProps = cardinalOrder
      .map((side) => {
        if (data[side + 'Street']) {
          return '1';
        } else {
          return '0';
        }
      }, [])
      .join(' ');

    return {
      dimensions: interDimensions,
      sidewalk: interSidewalk,
      northeastcurb: InterNortheastcurb,
      southwestcurb: InterSouthwestcurb,
      southeastcurb: InterSoutheastcurb,
      northwestcurb: InterNorthwestcurb,
      stopsign: interStreetProps,
      trafficsignal: interStreetProps,
      crosswalk: interStreetProps
    };
  },
  /*
   * calculate left, right sidewalk pedestrian parts of the street (with sidewalk segment types)
   * and total street width
   */
  getStreetWidths: function (streetParent) {
    const sectionsWidths = this.getSectionsWidth(streetParent);
    const leftSidewalkWidth =
      sectionsWidths[0].type === 'sidewalk' ? sectionsWidths[0].width : 0;
    const lastSection = sectionsWidths[sectionsWidths.length - 1];
    const rightSidewalkWidth =
      lastSection.type === 'sidewalk' ? lastSection.width : 0;
    const streetWidth = sectionsWidths.reduce(
      (totalWidth, section) => section.width + totalWidth,
      0
    );
    return {
      left: leftSidewalkWidth.toFixed(3),
      right: rightSidewalkWidth.toFixed(3),
      total: streetWidth.toFixed(3)
    };
  },
  /*
   * calculate width of street sections (segments of the same type following each other)
   */
  getSectionsWidth: function (streetParentEl) {
    // sidewalk segment types
    const sidewalkTypes = [
      'sidewalk',
      'sidewalk-wayfinding',
      'sidewalk-bench',
      'sidewalk-bike-rack',
      'sidewalk-tree',
      'utilities',
      'sidewalk-lamp',
      'outdoor-dining',
      'bikeshare'
    ];

    // one section is the summed value of the widths of sidewalk or 'drive-lane' segments
    // ('drive-lane' here is an all other segments types).
    // If there is a sidewalk in the middle of the street, it will also be taken into account as section
    const streetSections = [];
    let currentType = null;
    let currentWidth = 0;

    for (const segmentParentEl of streetParentEl.children) {
      const segmentType = segmentParentEl.getAttribute('data-type');
      const segmentVariant = segmentParentEl.getAttribute('data-variant');
      const segmentWidth = parseFloat(
        segmentParentEl.getAttribute('data-width')
      );

      if (!segmentType) continue;
      let sectionType =
        sidewalkTypes.includes(segmentType) ||
        segmentVariant.includes('sidewalk')
          ? 'sidewalk'
          : 'drive-lane';

      if (sectionType !== currentType) {
        if (currentType !== null) {
          streetSections.push({ type: currentType, width: currentWidth });
        }
        currentType = sectionType;
        currentWidth = segmentWidth;
      } else {
        currentWidth += segmentWidth;
      }
    }
    // Add the last accumulated segment
    if (currentType !== null) {
      streetSections.push({ type: currentType, width: currentWidth });
    }

    return streetSections;
  }
});
