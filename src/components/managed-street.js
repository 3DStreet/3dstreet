/* global AFRAME */
// Orientation - default model orientation is "outbound" (away from camera)
import {
  STREETPLAN_MATERIAL_MAPPING,
  STREETPLAN_OBJECT_MAPPING
} from './street-mapping-streetplan.js';
const { segmentVariants } = require('../segments-variants.js');
const streetmixUtils = require('../tested/streetmix-utils');
const streetmixParsersTested = require('../tested/aframe-streetmix-parsers-tested');

// Streetplan Helper function to parse O-Tags string into array
function parseOTags(tags) {
  if (!tags || tags === '-') return [];
  return tags.split('", "').map((t) => t.replace(/"/g, '').trim());
}

// Streetplan Helper function to create clone configuration
function createCloneConfig(name, tags) {
  if (!name || name === '-') return null;

  const model = STREETPLAN_OBJECT_MAPPING[name.toLowerCase()];
  if (!model) return null;

  return {
    mode: 'fixed', // default to fixed mode
    modelsArray: model,
    spacing: 15 // default spacing
  };
}

AFRAME.registerComponent('managed-street', {
  schema: {
    length: {
      type: 'number',
      default: 60
    },
    sourceType: {
      type: 'string',
      oneOf: ['streetmix-url', 'streetplan-url', 'json-blob']
    },
    sourceValue: {
      type: 'string'
    },
    synchronize: {
      type: 'boolean',
      default: false
    }
  },
  init: function () {
    this.managedEntities = [];
    this.pendingEntities = [];
    this.actualWidth = 0;
    // Bind the method to preserve context
    this.refreshFromSource = this.refreshFromSource.bind(this);
    this.onSegmentWidthChanged = this.onSegmentWidthChanged.bind(this);

    if (!this.el.hasAttribute('street-align')) {
      this.el.setAttribute('street-align', '');
    }
    if (!this.el.hasAttribute('street-ground')) {
      this.el.setAttribute('street-ground', '');
    }
    if (!this.el.hasAttribute('street-label')) {
      this.el.setAttribute('street-label', '');
    }

    this.setupEventDispatcher();

    setTimeout(() => {
      this.attachListenersToExistingSegments();
    }, 0);
  },
  attachListenersToExistingSegments: function () {
    const segments = this.el.querySelectorAll('[street-segment]');
    segments.forEach((segment) => {
      console.log('Attaching width change listener to existing segment');
      segment.addEventListener(
        'segment-width-changed',
        this.onSegmentWidthChanged
      );
    });
  },
  /**
   * Inserts a new street segment at the specified index
   * @param {number} index - The index at which to insert the new segment
   * @param {string} type - The segment type (e.g., 'drive-lane', 'bike-lane')
   * @param {Object} [segmentObject] - Optional configuration object for the segment
   * @returns {Element} The created segment element
   */
  insertSegment: function (index, type, segmentObject = null) {
    // Validate index
    if (index < 0 || index > this.managedEntities.length) {
      console.error('[managed-street] Invalid index for insertion:', index);
      return;
    }

    // Create new segment entity
    const segmentEl = document.createElement('a-entity');

    // Get default properties for this segment type from STREET.types
    const defaultProps = window.STREET.types[type] || {};

    // Set up basic segment properties, merging defaults with any provided custom properties
    const segmentProps = {
      type: type,
      width: segmentObject?.width || defaultProps.width || 3,
      length: this.data.length,
      level: segmentObject?.level ?? defaultProps.level ?? 0,
      direction:
        segmentObject?.direction || defaultProps.direction || 'outbound',
      color:
        segmentObject?.color ||
        defaultProps.color ||
        window.STREET.colors.white,
      surface: segmentObject?.surface || defaultProps.surface || 'asphalt'
    };

    // Set the segment component with properties
    segmentEl.setAttribute('street-segment', segmentProps);

    // Set the layer name for the segment
    const layerName = segmentObject?.name || `${type} • default`;
    segmentEl.setAttribute('data-layer-name', layerName);

    // If custom segment object is provided, wait for segment to load then generate its components
    if (segmentObject) {
      segmentEl.addEventListener('loaded', () => {
        // Use the generateComponentsFromSegmentObject method from street-segment component
        const streetSegmentComponent = segmentEl.components['street-segment'];
        if (streetSegmentComponent) {
          streetSegmentComponent.generateComponentsFromSegmentObject(
            segmentObject
          );
        }
      });
    }

    // Insert the segment at the specified index in the DOM
    const referenceNode = this.managedEntities[index] ?? null;
    this.el.insertBefore(segmentEl, referenceNode);

    // Wait for the segment to be fully loaded
    segmentEl.addEventListener('loaded', () => {
      // Refresh the managed entities list
      this.refreshManagedEntities();

      // Update the total width
      const totalWidth = this.managedEntities.reduce((sum, segment) => {
        return sum + (segment.getAttribute('street-segment').width || 0);
      }, 0);
      this.actualWidth = totalWidth;

      // If we have a previous segment, check if we need to add stripe separators
      // TODO: Check striping here in the future
    });

    return segmentEl;
  },
  setupEventDispatcher: function () {
    // Remove if existing mutation observer
    if (this.observer) {
      this.observer.disconnect();
    }

    // Mutation observer for add/remove
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const addedSegments = Array.from(mutation.addedNodes).filter(
            (node) => node.hasAttribute && node.hasAttribute('street-segment')
          );
          const removedSegments = Array.from(mutation.removedNodes).filter(
            (node) => node.hasAttribute && node.hasAttribute('street-segment')
          );

          // Add listeners to new segments
          addedSegments.forEach((segment) => {
            segment.addEventListener(
              'segment-width-changed',
              this.onSegmentWidthChanged
            );
          });

          // Remove listeners from removed segments
          removedSegments.forEach((segment) => {
            segment.removeEventListener(
              'segment-width-changed',
              this.onSegmentWidthChanged
            );
          });

          if (addedSegments.length || removedSegments.length) {
            this.el.emit('segments-changed', {
              changeType: 'structure',
              added: addedSegments,
              removed: removedSegments
            });
          }
        }
      });
    });

    observer.observe(this.el, { childList: true });
  },
  onSegmentWidthChanged: function (event) {
    console.log('segment width changed handler called', event);
    this.el.emit('segments-changed', {
      changeType: 'property',
      property: 'width',
      segment: event.target,
      oldValue: event.detail.oldWidth,
      newValue: event.detail.newWidth
    });
    this.refreshManagedEntities();
  },
  update: function (oldData) {
    const data = this.data;
    const dataDiff = AFRAME.utils.diff(oldData, data);

    if (data.synchronize) {
      this.el.setAttribute('managed-street', 'synchronize', false);
      this.refreshFromSource();
    }

    const dataDiffKeys = Object.keys(dataDiff);

    if (dataDiffKeys.includes('length')) {
      this.refreshManagedEntities();
      this.applyLength();
      // Emit segments-changed event when length changes
      this.el.emit('segments-changed', {
        changeType: 'property',
        property: 'length',
        oldValue: oldData.length,
        newValue: data.length
      });
    }

    this.setupEventDispatcher();
  },
  refreshFromSource: function () {
    const data = this.data;
    if (data.sourceType === 'streetmix-url') {
      this.loadAndParseStreetmixURL(data.sourceValue);
    } else if (data.sourceType === 'streetplan-url') {
      this.loadAndParseStreetplanURL(data.sourceValue);
    } else if (data.sourceType === 'json-blob') {
      // if data.sourceValue is a string convert string to object for parsing but keep string for saving
      if (typeof data.sourceValue === 'string') {
        const streetObjectFromBlob = JSON.parse(data.sourceValue);
        this.parseStreetObject(streetObjectFromBlob);
      } else {
        console.log(
          '[managed-street]: ERROR parsing json-blob, sourceValue must be a string'
        );
      }
    }
  },
  applyLength: function () {
    const data = this.data;
    const segmentEls = this.managedEntities;
    const streetLength = data.length;

    segmentEls.forEach((segmentEl) => {
      segmentEl.setAttribute('street-segment', 'length', streetLength);
    });
  },
  refreshManagedEntities: function () {
    // create a list again of the managed entities
    this.managedEntities = Array.from(
      this.el.querySelectorAll('[street-segment]')
    );
    // calculate actual width
    this.actualWidth = this.managedEntities.reduce((sum, segment) => {
      return sum + (segment.getAttribute('street-segment')?.width || 0);
    }, 0);
  },
  parseStreetObject: function (streetObject) {
    // reset and delete all existing entities
    this.remove();

    // given an object streetObject, create child entities with 'street-segment' component
    this.el.setAttribute(
      'data-layer-name',
      'Managed Street • ' + streetObject.name
    );
    this.el.setAttribute('managed-street', 'length', streetObject.length);

    for (let i = 0; i < streetObject.segments.length; i++) {
      const segment = streetObject.segments[i];
      const previousSegment = streetObject.segments[i - 1];
      const segmentEl = document.createElement('a-entity');
      this.el.appendChild(segmentEl);

      segmentEl.setAttribute('street-segment', {
        type: segment.type, // this is the base type, it won't load its defaults since we are changing more than just the type value
        width: segment.width,
        length: streetObject.length,
        level: segment.level,
        direction: segment.direction,
        color: segment.color || window.STREET.types[segment.type]?.color,
        surface: segment.surface || window.STREET.types[segment.type]?.surface // no error handling for segmentPreset not found
      });
      segmentEl.setAttribute('data-layer-name', segment.name);
      // wait for street-segment to be loaded, then generate components from segment object
      segmentEl.addEventListener('loaded', () => {
        if (!segment.generated?.striping) {
          const stripingVariant = this.getStripingFromSegments(
            previousSegment,
            segment
          );
          if (stripingVariant) {
            // Only add striping if variant is not null
            if (!segment.generated) {
              segment.generated = {};
            }
            segment.generated.striping = [
              {
                striping: stripingVariant,
                length: streetObject.length,
                segmentWidth: segment.width
              }
            ];
          }
        }
        segmentEl.components[
          'street-segment'
        ].generateComponentsFromSegmentObject(segment);
      });
    }
  },
  loadAndParseStreetplanURL: async function (streetplanURL) {
    console.log(
      '[managed-street] loader',
      'sourceType: `streetplan-url`, loading from',
      streetplanURL
    );

    try {
      const response = await fetch(streetplanURL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const streetplanData = await response.json();
      const boulevard = streetplanData.project['My Street']['Boulevard Alt 1'];

      const streetLength =
        parseFloat(streetplanData.project['My Street'].LengthMiles) *
          5280 *
          0.3048 || 100; // Convert miles to meters
      // Convert StreetPlan format to managed-street format
      const streetObject = {
        name: streetplanData.project.ProjectName,
        width: 0, // Will be calculated from segments
        length: streetLength,
        segments: []
      };

      // Process streetplan segments
      const segments = boulevard.segments;
      for (const segmentKey in segments) {
        const segment = segments[segmentKey];

        // Skip Buildings and Setback segments
        if (segment.Type === 'Buildings' || segment.Type === 'Setback') {
          continue;
        }

        const segmentWidth = parseFloat(segment.width) * 0.3048; // Convert feet to meters
        streetObject.width += segmentWidth;

        // Convert streetplan segment type based on your schema
        let segmentType = 'drive-lane'; // Default type
        let segmentDirection = 'inbound';

        // convert from streetplan type to managed street default type
        switch (segment.Type) {
          case 'BikesPaths':
            segmentType = 'bike-lane';
            break;
          case 'Walkways':
            segmentType = 'sidewalk';
            break;
          case 'Transit':
            segmentType = 'bus-lane';
            break;
          case 'Median/Buffer':
            segmentType = 'divider';
            break;
          case 'Curbside':
            segmentType = 'divider';
            break;
          case 'Gutter':
            segmentType = 'parking-lane';
            break;
          case 'Furniture':
            segmentType = 'sidewalk-tree';
            break;
          // Add more type mappings as needed
        }

        // Determine direction based on segment data
        if (segment.Direction === 'Coming') {
          segmentDirection = 'inbound';
        } else if (segment.Direction === 'Going') {
          segmentDirection = 'outbound';
        }

        // Map the material using the STREETPLAN_MATERIAL_MAPPING, fallback to 'asphalt' if not found
        const material = segment.Material?.toLowerCase() || '';
        const mappedSurface =
          STREETPLAN_MATERIAL_MAPPING[material]?.surface || 'asphalt';
        const mappedColor = STREETPLAN_MATERIAL_MAPPING[material]?.color;

        // Map the O-Tags to clone configurations
        const generated = {};
        const clones = [];
        // Process O1, O2, O3 configurations
        ['O1', 'O2', 'O3'].forEach((prefix) => {
          const name = segment[`${prefix}-Name`];
          const tags = parseOTags(segment[`${prefix}-Tags`]);
          const cloneConfig = createCloneConfig(name, tags);
          if (cloneConfig) {
            clones.push(cloneConfig);
          }
        });
        if (clones.length > 0) {
          generated.clones = clones;
        }

        streetObject.segments.push({
          type: segmentType,
          width: segmentWidth,
          name: segment.title,
          level: parseFloat(segment.MaterialH) === 0.5 ? 1 : 0,
          direction: segmentDirection,
          color: mappedColor || window.STREET.types[segmentType]?.color,
          surface: mappedSurface,
          generated: clones.length > 0 ? generated : undefined
        });
      }

      // Parse the street object
      this.parseStreetObject(streetObject);
    } catch (error) {
      console.error('[managed-street] loader', 'Loading Error:', error);
      STREET.notify.warningMessage(
        'Error loading StreetPlan data: ' + error.message
      );
    }
  },

  getStripingFromSegments: function (previousSegment, currentSegment) {
    if (!previousSegment || !currentSegment) {
      return null;
    }

    // Valid lane types that should have striping
    const validLaneTypes = [
      'drive-lane',
      'bus-lane',
      'bike-lane',
      'parking-lane'
    ];

    // Only add striping between valid lane types
    if (
      !validLaneTypes.includes(previousSegment.type) ||
      !validLaneTypes.includes(currentSegment.type)
    ) {
      return null;
    }

    // Default to solid line
    let variantString = 'solid-stripe';

    // Check for opposite directions
    if (
      previousSegment.direction !== currentSegment.direction &&
      previousSegment.direction !== 'none' &&
      currentSegment.direction !== 'none'
    ) {
      variantString = 'solid-doubleyellow';

      // Special case for bike lanes
      if (
        currentSegment.type === 'bike-lane' &&
        previousSegment.type === 'bike-lane'
      ) {
        variantString = 'short-dashed-stripe-yellow';
      }
    } else {
      // Same direction cases
      if (currentSegment.type === previousSegment.type) {
        variantString = 'dashed-stripe';
      }

      // Drive lane and turn lane combination would go here if needed
    }

    // Special case for parking lanes - use dashed line between parking and drive lanes
    if (
      currentSegment.type === 'parking-lane' ||
      previousSegment.type === 'parking-lane'
    ) {
      variantString = 'solid-stripe';
    }

    return variantString;
  },
  loadAndParseStreetmixURL: async function (streetmixURL) {
    const data = this.data;
    const streetmixAPIURL = streetmixUtils.streetmixUserToAPI(streetmixURL);
    console.log(
      '[managed-street] loader',
      'sourceType: `streetmix-url`, setting `streetmixAPIURL` to',
      streetmixAPIURL
    );

    try {
      console.log('[managed-street] loader', 'GET ' + streetmixAPIURL);
      const response = await fetch(streetmixAPIURL);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const streetmixResponseObject = await response.json();
      this.refreshManagedEntities();
      this.remove();

      // convert units of measurement if necessary
      const streetData = streetmixUtils.convertStreetValues(
        streetmixResponseObject.data.street
      );
      const streetmixSegments = streetData.segments;

      const streetmixName = streetmixResponseObject.name;

      this.el.setAttribute('data-layer-name', 'Street • ' + streetmixName);
      // const streetWidth = streetmixSegments.reduce(
      //   (streetWidth, segmentData) => streetWidth + segmentData.width,
      //   0
      // );

      const segmentEls = parseStreetmixSegments(streetmixSegments, data.length);
      this.el.append(...segmentEls);

      this.pendingEntities = segmentEls;
      // for each pending entity Listen for loaded event
      for (const entity of this.pendingEntities) {
        entity.addEventListener(
          'loaded',
          () => {
            this.onEntityLoaded(entity);
          },
          { once: true }
        );
      }

      // Set up a promise that resolves when all entities are loaded
      this.allLoadedPromise = new Promise((resolve) => {
        this.resolveAllLoaded = resolve;
      });

      // When all entities are loaded, do something with them
      this.allLoadedPromise.then(() => {
        this.refreshManagedEntities();
        AFRAME.INSPECTOR.selectEntity(this.el);
      });
    } catch (error) {
      console.error('[managed-street] loader', 'Loading Error:', error);
    }
  },
  onEntityLoaded: function (entity) {
    // Remove from pending set
    const index = this.pendingEntities.indexOf(entity);
    if (index > -1) {
      this.pendingEntities.splice(index, 1);
    }
    this.managedEntities.push(entity);
    // If no more pending entities, resolve the promise
    if (this.pendingEntities.length === 0) {
      this.resolveAllLoaded();
    }
  },
  remove: function () {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.managedEntities.forEach(
      (entity) => entity.parentNode && entity.remove()
    );
    this.managedEntities.length = 0; // Clear the array
  }
});

// Helper functions for Streetmix to A-Frame conversion

function getSeparatorMixinId(previousSegment, currentSegment) {
  if (previousSegment === undefined || currentSegment === undefined) {
    return null;
  }
  // Helper function to check if a segment type is "lane-ish"
  function isLaneIsh(typeString) {
    return (
      typeString.slice(typeString.length - 4) === 'lane' ||
      typeString === 'light-rail' ||
      typeString === 'streetcar' ||
      typeString === 'flex-zone'
    );
  }

  // If either segment is not lane-ish and not a divider, return null
  if (
    (!isLaneIsh(previousSegment.type) && previousSegment.type !== 'divider') ||
    (!isLaneIsh(currentSegment.type) && currentSegment.type !== 'divider')
  ) {
    return null;
  }

  // Default to solid line
  let variantString = 'solid-stripe';

  // Handle divider cases
  if (previousSegment.type === 'divider' || currentSegment.type === 'divider') {
    return variantString;
  }

  // Get directions from variant strings
  const prevDirection = previousSegment.variantString.split('|')[0];
  const currDirection = currentSegment.variantString.split('|')[0];

  // Check for opposite directions
  if (prevDirection !== currDirection) {
    variantString = 'solid-doubleyellow';

    // Special case for bike lanes
    if (
      currentSegment.type === 'bike-lane' &&
      previousSegment.type === 'bike-lane'
    ) {
      variantString = 'short-dashed-stripe-yellow';
    }

    // Special case for flex zones
    if (
      currentSegment.type === 'flex-zone' ||
      previousSegment.type === 'flex-zone'
    ) {
      variantString = 'solid';
    }
  } else {
    // Same direction cases
    if (currentSegment.type === previousSegment.type) {
      variantString = 'dashed-stripe';
    }

    // Drive lane and turn lane combination
    if (
      (currentSegment.type === 'drive-lane' &&
        previousSegment.type === 'turn-lane') ||
      (previousSegment.type === 'drive-lane' &&
        currentSegment.type === 'turn-lane')
    ) {
      variantString = 'dashed-stripe';
    }
  }

  // Special cases for shared turn lanes
  const prevVariant = previousSegment.variantString.split('|')[1];
  const currVariant = currentSegment.variantString.split('|')[1];

  if (currentSegment.type === 'turn-lane' && currVariant === 'shared') {
    variantString = 'solid-dashed-yellow';
  } else if (previousSegment.type === 'turn-lane' && prevVariant === 'shared') {
    variantString = 'solid-dashed-yellow';
  }

  // Special case for parking lanes
  if (
    currentSegment.type === 'parking-lane' ||
    previousSegment.type === 'parking-lane'
  ) {
    variantString = 'solid-stripe';
  }

  return variantString;
}

function getRandomIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getSegmentColor(variant) {
  if (variant === 'red' || variant === 'colored') {
    return window.STREET.colors.red;
  }
  if (variant === 'blue') {
    return window.STREET.colors.blue;
  }
  if (variant === 'green' || variant === 'grass') {
    return window.STREET.colors.green;
  }
  return window.STREET.colors.white;
}

// show warning message if segment or variantString are not supported
function supportCheck(segmentType, segmentVariantString) {
  if (segmentType === 'separator') return;
  // variants supported in 3DStreet
  const supportedVariants = segmentVariants[segmentType];
  if (!supportedVariants) {
    STREET.notify.warningMessage(
      `The '${segmentType}' segment type is not yet supported in 3DStreet`
    );
    console.log(
      `The '${segmentType}' segment type is not yet supported in 3DStreet`
    );
  } else if (!supportedVariants.includes(segmentVariantString)) {
    STREET.notify.warningMessage(
      `The '${segmentVariantString}' variant of segment '${segmentType}' is not yet supported in 3DStreet`
    );
    console.log(
      `The '${segmentVariantString}' variant of segment '${segmentType}' is not yet supported in 3DStreet`
    );
  }
}

// OLD: takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
// NEW: takes a `segments` (array) from streetmix and return an element and its children which represent the 3D street scene
function parseStreetmixSegments(segments, length) {
  // create and center offset to center the street around global x position of 0
  const segmentEls = [];

  let cumulativeWidthInMeters = 0;
  for (let i = 0; i < segments.length; i++) {
    let segmentColor = null;
    const segmentParentEl = document.createElement('a-entity');
    segmentParentEl.classList.add('segment-parent-' + i);

    const segmentWidthInMeters = segments[i].width;
    // console.log('Type: ' + segments[i].type + '; Width: ' + segmentWidthInFeet + 'ft / ' + segmentWidthInMeters + 'm');

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    const segmentPositionX =
      cumulativeWidthInMeters - 0.5 * segmentWidthInMeters;

    // get variantString
    const variantList = segments[i].variantString
      ? segments[i].variantString.split('|')
      : '';

    // show warning message if segment or variantString are not supported
    supportCheck(segments[i].type, segments[i].variantString);

    // elevation property from streetmix segment
    const elevation = segments[i].elevation;

    const direction =
      variantList[0] === 'inbound' || variantList[1] === 'inbound'
        ? 'inbound'
        : 'outbound';

    // the A-Frame mixin ID is often identical to the corresponding streetmix segment "type" by design, let's start with that
    let segmentPreset = segments[i].type;

    // look at segment type and variant(s) to determine specific cases
    if (segments[i].type === 'drive-lane' && variantList[1] === 'sharrow') {
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `modelsArray: sharrow; length: ${length}; cycleOffset: 0.2; spacing: 15; direction: ${direction}`
      );
    } else if (
      segments[i].type === 'bike-lane' ||
      segments[i].type === 'scooter'
    ) {
      segmentPreset = 'bike-lane'; // use bike lane road material
      // get the mixin id for a bike lane
      segmentColor = getSegmentColor(variantList[1]);
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `modelsArray: bike-arrow; length: ${length}; cycleOffset: 0.3; spacing: 20; direction: ${direction};`
      );
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random;
        modelsArray: cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-dutch, cyclist-kid${segments[i].type === 'scooter' ? 'ElectricScooter_1' : ''};
        length: ${length};
        spacing: 2.03;
        direction: ${direction};
        count: ${getRandomIntInclusive(2, 5)};`
      );
    } else if (
      segments[i].type === 'light-rail' ||
      segments[i].type === 'streetcar'
    ) {
      segmentPreset = 'rail';
      // get the color for a bus lane
      segmentColor = getSegmentColor(variantList[1]);
      // get the mixin id for the vehicle (is it a trolley or a tram?)
      const objectMixinId =
        segments[i].type === 'streetcar' ? 'trolley' : 'tram';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; modelsArray: ${objectMixinId}; length: ${length}; spacing: 20; direction: ${direction}; count: 1;`
      );
      segmentParentEl.setAttribute(
        'street-generated-rail',
        `length: ${length}; gauge: ${segments[i].type === 'streetcar' ? 1067 : 1435};`
      );
    } else if (segments[i].type === 'turn-lane') {
      segmentPreset = 'drive-lane'; // use normal drive lane road material
      if (variantList[1] !== 'shared') {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `mode: random;
           modelsArray: sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike;
            length: ${length};
            spacing: 7.3;
            direction: ${direction};
            count: ${getRandomIntInclusive(2, 4)};`
        );
      }
      let markerMixinId = variantList[1]; // set the mixin of the road markings to match the current variant name
      // Fix streetmix inbound turn lane orientation (change left to right) per: https://github.com/streetmix/streetmix/issues/683
      if (variantList[0] === 'inbound') {
        markerMixinId = markerMixinId.replace(/left|right/g, function (m) {
          return m === 'left' ? 'right' : 'left';
        });
      }
      if (variantList[1] === 'shared') {
        markerMixinId = 'left';
      }
      if (variantList[1] === 'left-right-straight') {
        markerMixinId = 'all';
      }
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `modelsArray: ${markerMixinId}; length: ${length}; cycleOffset: 0.4; spacing: 20; direction: ${direction};`
      );
      if (variantList[1] === 'shared') {
        segmentParentEl.setAttribute(
          'street-generated-stencil__2',
          `modelsArray: ${markerMixinId}; length: ${length}; cycleOffset: 0.6; spacing: 20; direction: ${direction}; facing: 180;`
        );
      }
    } else if (segments[i].type === 'divider' && variantList[0] === 'bollard') {
      segmentPreset = 'divider';
      // make some bollards
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: bollard; spacing: 4; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'flowers') {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: dividers-flowers; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planting-strip'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: dividers-planting-strip; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planter-box'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: dividers-planter-box; spacing: 2.45; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'palm-tree'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: palm-tree; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'big-tree'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: tree3; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'bush') {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: dividers-bush; spacing: 2.25; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'dome') {
      segmentPreset = 'divider';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: dividers-dome; spacing: 2.25; length: ${length}`
      );
    } else if (segments[i].type === 'divider') {
      segmentPreset = 'divider';
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'barricade'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: temporary-barricade; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'traffic-cone'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: temporary-traffic-cone; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-plastic'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: jersey-barrier-plastic; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-concrete'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: temporary-jersey-barrier-concrete; spacing: 2.93; length: ${length}`
      );
    } else if (
      segments[i].type === 'bus-lane' ||
      segments[i].type === 'brt-lane'
    ) {
      segmentPreset = 'bus-lane';
      // get the color for a bus lane
      segmentColor = getSegmentColor(variantList[1]);
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; modelsArray: bus; length: ${length}; spacing: 15; direction: ${direction}; count: 1;`
      );
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `modelsArray: word-only, word-taxi, word-bus; length: ${length}; spacing: 40; padding: 10; direction: ${direction}`
      );
    } else if (segments[i].type === 'drive-lane') {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random;
          modelsArray: sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike;
          length: ${length};
          spacing: 7.3;
          direction: ${direction};
          count: ${getRandomIntInclusive(2, 4)};`
      );
    } else if (segments[i].type === 'food-truck') {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; modelsArray: food-trailer-rig; length: ${length}; spacing: 7; direction: ${direction}; count: 2;`
      );
    } else if (segments[i].type === 'flex-zone') {
      segmentPreset = 'parking-lane';
      const objectMixinId =
        variantList[0] === 'taxi' ? 'sedan-taxi-rig' : 'sedan-rig';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; modelsArray: ${objectMixinId}; length: ${length}; spacing: 6; direction: ${direction}; count: 4;`
      );
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `modelsArray: word-loading-small, word-only-small; length: ${length}; spacing: 40; padding: 10; direction: ${direction}`
      );
    } else if (segments[i].type === 'sidewalk' && variantList[0] !== 'empty') {
      segmentParentEl.setAttribute(
        'street-generated-pedestrians',
        `segmentWidth: ${segmentWidthInMeters}; density: ${variantList[0]}; length: ${length};`
      );
    } else if (segments[i].type === 'sidewalk-wayfinding') {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; modelsArray: wayfinding; length: ${length};`
      );
    } else if (segments[i].type === 'sidewalk-bench') {
      const rotationCloneY = variantList[0] === 'right' ? -90 : 90;
      if (variantList[0] === 'center') {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `modelsArray: bench_orientation_center; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.1`
        );
      } else {
        // `right` or `left` bench
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `modelsArray: bench; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.1`
        );
      }
    } else if (segments[i].type === 'sidewalk-bike-rack') {
      const rotationCloneY = variantList[1] === 'sidewalk-parallel' ? 90 : 0;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: bikerack; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.2`
      );
    } else if (segments[i].type === 'magic-carpet') {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; modelsArray: magic-carpet;
        length: ${length};
        positionY: 1.2;`
      );
      segmentParentEl.setAttribute(
        'street-generated-clones__2',
        `mode: single; modelsArray: Character_1_M;
        length: ${length};
        positionY: 1.2;`
      );
    } else if (segments[i].type === 'outdoor-dining') {
      segmentPreset = variantList[1] === 'road' ? 'drive-lane' : 'sidewalk';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; modelsArray: outdoor_dining; length: ${length}; spacing: 3; count: 5;`
      );
    } else if (segments[i].type === 'parklet') {
      segmentPreset = 'drive-lane';
      const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; modelsArray: parklet; length: ${length}; spacing: 5.5; count: 3; facing: ${rotationCloneY};`
      );
    } else if (segments[i].type === 'bikeshare') {
      const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; modelsArray: bikeshare; length: ${length}; facing: ${rotationCloneY}; justify: middle;`
      );
    } else if (segments[i].type === 'utilities') {
      const rotationCloneY = variantList[0] === 'right' ? 180 : 0;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: utility_pole; length: ${length}; cycleOffset: 0.25; facing: ${rotationCloneY}`
      );
    } else if (segments[i].type === 'sidewalk-tree') {
      const objectMixinId =
        variantList[0] === 'palm-tree' ? 'palm-tree' : 'tree3';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: ${objectMixinId}; length: ${length}; randomFacing: true;`
      );
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      (variantList[1] === 'modern' || variantList[1] === 'pride')
    ) {
      if (variantList[0] === 'both') {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `modelsArray: lamp-modern-double; length: ${length}; cycleOffset: 0.4;`
        );
      } else {
        const rotationCloneY = variantList[0] === 'right' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `modelsArray: lamp-modern; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.4;`
        );
      }
      // Add the pride flags to the lamp posts
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'right' || variantList[0] === 'both')
      ) {
        segmentParentEl.setAttribute(
          'street-generated-clones__2',
          `modelsArray: pride-flag; length: ${length}; cycleOffset: 0.4; positionX: 0.409; positionY: 5;`
        );
      }
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'left' || variantList[0] === 'both')
      ) {
        segmentParentEl.setAttribute(
          'street-generated-clones__2',
          `modelsArray: pride-flag; length: ${length}; facing: 180; cycleOffset: 0.4; positionX: -0.409; positionY: 5;`
        );
      }
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      variantList[1] === 'traditional'
    ) {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `modelsArray: lamp-traditional; length: ${length};`
      );
    } else if (segments[i].type === 'transit-shelter') {
      const rotationBusStopY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; modelsArray: bus-stop; length: ${length}; facing: ${rotationBusStopY};`
      );
    } else if (segments[i].type === 'brt-station') {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; modelsArray: brt-station; length: ${length};`
      );
    } else if (segments[i].type === 'parking-lane') {
      segmentPreset = 'parking-lane';
      let parkingMixin = 'stencils parking-t';
      let carStep = 6;

      const rotationVars = {
        // markings rotation
        outbound: 90,
        inbound: 90,
        sideways: 0,
        'angled-front-left': 30,
        'angled-front-right': -30,
        'angled-rear-left': -30,
        'angled-rear-right': 30
      };
      let markingsRotZ = rotationVars[variantList[0]];
      let markingLength;

      // calculate position X and rotation Z for T-markings
      let markingPosX = segmentWidthInMeters / 2;
      if (markingsRotZ === 90 && variantList[1] === 'right') {
        markingsRotZ = -90;
        markingPosX = -markingPosX + 0.75;
      } else {
        markingPosX = markingPosX - 0.75;
      }

      if (variantList[0] === 'sideways' || variantList[0].includes('angled')) {
        carStep = 3;
        markingLength = segmentWidthInMeters;
        markingPosX = 0;
        parkingMixin = 'solid-stripe';
        if (variantList[1] === 'right') {
          // make sure cars face the right way on right side
          markingsRotZ = markingsRotZ + 180;
        }
      }
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; 
         modelsArray: sedan-rig, self-driving-waymo-car, suv-rig;
          length: ${length};
          spacing: ${carStep};
          count: ${getRandomIntInclusive(6, 8)};
          facing: ${markingsRotZ - 90};`
      );
      if (variantList[1] === 'left') {
        segmentParentEl.setAttribute(
          'street-generated-stencil',
          `modelsArray: ${parkingMixin}; length: ${length}; cycleOffset: 1; spacing: ${carStep}; positionX: ${markingPosX}; facing: ${markingsRotZ + 90}; stencilHeight: ${markingLength};`
        );
      } else {
        segmentParentEl.setAttribute(
          'street-generated-stencil',
          `modelsArray: ${parkingMixin}; length: ${length}; cycleOffset: 1; spacing: ${carStep}; positionX: ${markingPosX}; facing: ${markingsRotZ + 90}; stencilHeight: ${markingLength};`
        );
      }
    }

    // if this thing is a sidewalk, make segmentPreset sidewalk
    if (streetmixParsersTested.isSidewalk(segments[i].type)) {
      segmentPreset = 'sidewalk';
    }

    // add new object
    segmentParentEl.setAttribute('street-segment', 'type', segmentPreset);
    segmentParentEl.setAttribute(
      'street-segment',
      'width',
      segmentWidthInMeters
    );
    segmentParentEl.setAttribute('street-segment', 'length', length);
    segmentParentEl.setAttribute('street-segment', 'level', elevation);
    segmentParentEl.setAttribute('street-segment', 'direction', direction);
    segmentParentEl.setAttribute(
      // find default color for segmentPreset
      'street-segment',
      'color',
      segmentColor ?? window.STREET.types[segmentPreset]?.color // no error handling for segmentPreset not found
    );
    segmentParentEl.setAttribute(
      // find default surface type for segmentPreset
      'street-segment',
      'surface',
      window.STREET.types[segmentPreset]?.surface // no error handling for segmentPreset not found
    );

    let currentSegment = segments[i];
    let previousSegment = segments[i - 1];
    let separatorMixinId = getSeparatorMixinId(previousSegment, currentSegment);

    if (separatorMixinId) {
      segmentParentEl.setAttribute(
        'street-generated-striping',
        `striping: ${separatorMixinId}; length: ${length}; segmentWidth: ${segmentWidthInMeters};`
      );
      // if previous segment is turn lane and shared, then facing should be 180
      if (
        previousSegment &&
        previousSegment.type === 'turn-lane' &&
        previousSegment.variantString.split('|')[1] === 'shared'
      ) {
        segmentParentEl.setAttribute(
          'street-generated-striping',
          'facing',
          180
        );
      }
    }
    segmentParentEl.setAttribute('position', segmentPositionX + ' 0 0');
    segmentParentEl.setAttribute(
      'data-layer-name',
      '' + segments[i].type + ' • ' + variantList[0]
    );
    segmentEls.push(segmentParentEl);
  }
  return segmentEls;
}
