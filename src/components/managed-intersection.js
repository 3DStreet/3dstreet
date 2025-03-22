/* global AFRAME */
import { CROSSWALKS } from './intersection.js';

/**
 * Managed Intersection component
 * Allows for dynamic control of intersection elements like curbs, sidewalks, and crosswalks
 */
AFRAME.registerComponent('managed-intersection', {
  schema: {
    dimensions: { type: 'vec2', default: { x: 20, y: 20 } }, // width and depth
    sourceType: {
      type: 'string',
      oneOf: ['json-blob'], // Could add more source types later like 'intersection-plan' or URL-based sources
      default: 'json-blob'
    },
    sourceValue: {
      type: 'string',
      default: '{}'
    },
    synchronize: {
      type: 'boolean',
      default: false
    }
  },

  init: function () {
    this.managedEntities = {
      sidewalks: [],
      curbs: [],
      crosswalks: [],
      trafficElements: []
    };

    // Create a mapping to track which entities belong to which directions
    this.directionMap = {
      north: {
        sidewalk: null,
        crosswalk: null,
        trafficSignal: null,
        stopSign: null
      },
      south: {
        sidewalk: null,
        crosswalk: null,
        trafficSignal: null,
        stopSign: null
      },
      east: {
        sidewalk: null,
        crosswalk: null,
        trafficSignal: null,
        stopSign: null
      },
      west: {
        sidewalk: null,
        crosswalk: null,
        trafficSignal: null,
        stopSign: null
      }
    };

    this.pendingEntities = [];

    // Bind methods to preserve context
    this.refreshFromSource = this.refreshFromSource.bind(this);
    this.setupEventDispatcher = this.setupEventDispatcher.bind(this);
    this.refreshManagedEntities = this.refreshManagedEntities.bind(this);

    // Create the base intersection surface
    this.createIntersectionSurface();

    // Setup mutation observer
    this.setupEventDispatcher();

    // Initialize from source if provided
    if (this.data.sourceValue && this.data.sourceValue !== '{}') {
      setTimeout(() => {
        this.refreshFromSource();
      }, 0);
    }
  },

  /**
   * Create the base intersection surface
   */
  createIntersectionSurface: function () {
    const intersectWidth = this.data.dimensions.x;
    const intersectDepth = this.data.dimensions.y;

    // Create main intersection surface
    this.el.setAttribute(
      'geometry',
      `primitive:box; width: ${intersectWidth}; height: ${intersectDepth}; depth:0.2`
    );
    this.el.setAttribute(
      'material',
      'src: #asphalt-texture; repeat:5 5; roughness:1'
    );
    this.el.setAttribute('shadow', '');
  },

  /**
   * Setup the mutation observer to track changes to child entities
   */
  setupEventDispatcher: function () {
    // Remove if existing mutation observer
    if (this.observer) {
      this.observer.disconnect();
    }

    // Mutation observer for add/remove
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const addedNodes = Array.from(mutation.addedNodes);
          const removedNodes = Array.from(mutation.removedNodes);

          if (addedNodes.length || removedNodes.length) {
            this.refreshManagedEntities();
            // Emit event for external listeners
            this.el.emit('intersection-changed', {
              el: this.el,
              managedEntities: this.managedEntities
            });
          }
        }
      });
    });

    // Start observing
    observer.observe(this.el, {
      childList: true,
      subtree: false
    });

    this.observer = observer;
  },

  /**
   * Update component when data changes
   */
  update: function (oldData) {
    // If dimensions changed, recreate the intersection surface
    if (
      oldData.dimensions &&
      (oldData.dimensions.x !== this.data.dimensions.x ||
        oldData.dimensions.y !== this.data.dimensions.y)
    ) {
      this.createIntersectionSurface();
    }

    // If sourceValue changed and not first init, refresh from source
    if (oldData.sourceValue !== this.data.sourceValue && oldData.sourceValue) {
      this.refreshFromSource();
    }
  },

  /**
   * Parse source data and apply it to the intersection
   */
  refreshFromSource: function () {
    if (!this.data.sourceValue) return;

    try {
      const sourceData = JSON.parse(this.data.sourceValue);

      // Clear existing entities if needed
      if (this.data.synchronize) {
        this.clearAllEntities();
      }

      // Apply the configuration
      this.applyIntersectionConfig(sourceData);
    } catch (error) {
      console.error(
        '[managed-intersection] Error parsing source value:',
        error
      );
    }
  },

  /**
   * Clear all managed entities
   */
  clearAllEntities: function () {
    // Get all children that we want to remove
    const entitiesToRemove = [];

    // Add all tracked entities to removal list
    Object.values(this.managedEntities).forEach((entityList) => {
      entityList.forEach((entity) => entitiesToRemove.push(entity));
    });

    // Remove all these entities
    entitiesToRemove.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });

    // Reset tracking collections
    this.managedEntities = {
      sidewalks: [],
      curbs: [],
      crosswalks: [],
      trafficElements: []
    };

    // Reset direction map
    Object.keys(this.directionMap).forEach((direction) => {
      this.directionMap[direction] = {
        sidewalk: null,
        crosswalk: null,
        trafficSignal: null,
        stopSign: null
      };
    });
  },

  /**
   * Apply intersection configuration from parsed source
   */
  applyIntersectionConfig: function (config) {
    const { dimensions, sidewalks, curbs, crosswalks, trafficElements } =
      config;

    // Update dimensions if provided
    if (dimensions && Array.isArray(dimensions) && dimensions.length === 2) {
      this.el.setAttribute('managed-intersection', {
        dimensions: { x: dimensions[0], y: dimensions[1] }
      });
    }

    // Add sidewalks
    if (sidewalks) {
      sidewalks.forEach((sidewalkConfig) => {
        this.addSidewalk(sidewalkConfig);
      });
    }

    // Add curbs
    if (curbs) {
      curbs.forEach((curbConfig) => {
        this.addCurb(curbConfig);
      });
    }

    // Add crosswalks
    if (crosswalks) {
      crosswalks.forEach((crosswalkConfig) => {
        this.addCrosswalk(crosswalkConfig);
      });
    }

    // Add traffic elements (signals and signs)
    if (trafficElements) {
      trafficElements.forEach((elementConfig) => {
        this.addTrafficElement(elementConfig);
      });
    }

    // Refresh entity tracking
    this.refreshManagedEntities();
  },

  /**
   * Add a sidewalk element to the intersection
   */
  addSidewalk: function (config) {
    const { direction, width = 3, length } = config;
    console.log(length);
    // Get intersection dimensions
    const intersectWidth = this.data.dimensions.x;
    const intersectDepth = this.data.dimensions.y;

    const sidewalkEntity = document.createElement('a-entity');
    sidewalkEntity.classList.add('intersection-sidewalk');
    sidewalkEntity.setAttribute('data-direction', direction);
    sidewalkEntity.setAttribute('data-layer-name', `Sidewalk • ${direction}`);

    // Create appropriate geometry based on direction
    // This is simplified, actual implementation would need more geometry calculations
    // like in the original intersection component

    let position, rotation;
    switch (direction.toLowerCase()) {
      case 'west':
        position = { x: -intersectWidth / 2 - width / 2, y: 0, z: 0.3 };
        rotation = { x: 0, y: 0, z: 0 };
        sidewalkEntity.setAttribute(
          'geometry',
          `primitive: box; width: ${width}; height: ${intersectDepth}; depth: 0.4`
        );
        break;
      case 'east':
        position = { x: intersectWidth / 2 + width / 2, y: 0, z: 0.3 };
        rotation = { x: 0, y: 0, z: 0 };
        sidewalkEntity.setAttribute(
          'geometry',
          `primitive: box; width: ${width}; height: ${intersectDepth}; depth: 0.4`
        );
        break;
      case 'north':
        position = { x: 0, y: intersectDepth / 2 + width / 2, z: 0.3 };
        rotation = { x: 0, y: 0, z: 0 };
        sidewalkEntity.setAttribute(
          'geometry',
          `primitive: box; width: ${intersectWidth}; height: ${width}; depth: 0.4`
        );
        break;
      case 'south':
        position = { x: 0, y: -intersectDepth / 2 - width / 2, z: 0.3 };
        rotation = { x: 0, y: 0, z: 0 };
        sidewalkEntity.setAttribute(
          'geometry',
          `primitive: box; width: ${intersectWidth}; height: ${width}; depth: 0.4`
        );
        break;
    }

    sidewalkEntity.setAttribute('position', position);
    sidewalkEntity.setAttribute('rotation', rotation);

    // Add material
    sidewalkEntity.setAttribute(
      'material',
      'src: #seamless-sidewalk; repeat: 2 2; roughness: 0.8; color: #cccccc'
    );

    // Add to scene
    this.el.appendChild(sidewalkEntity);

    // Track in direction map
    if (this.directionMap[direction.toLowerCase()]) {
      this.directionMap[direction.toLowerCase()].sidewalk = sidewalkEntity;
    }

    return sidewalkEntity;
  },

  /**
   * Add a curb to the intersection
   */
  addCurb: function (config) {
    const { corner, radius = 4, type = 'standard' } = config;

    // Get intersection dimensions
    const intersectWidth = this.data.dimensions.x;
    const intersectDepth = this.data.dimensions.y;

    const curbEntity = document.createElement('a-entity');
    curbEntity.classList.add('intersection-curb');
    curbEntity.setAttribute('data-corner', corner);
    curbEntity.setAttribute('data-layer-name', `Curb • ${corner}`);

    // TODO: Implement proper curb geometry creation
    // This would use THREE.js geometry creation similar to the intersection component
    // For now, we'll use a placeholder

    let position;
    switch (corner.toLowerCase()) {
      case 'northwest':
        position = { x: -intersectWidth / 2, y: intersectDepth / 2, z: 0.1 };
        break;
      case 'northeast':
        position = { x: intersectWidth / 2, y: intersectDepth / 2, z: 0.1 };
        break;
      case 'southwest':
        position = { x: -intersectWidth / 2, y: -intersectDepth / 2, z: 0.1 };
        break;
      case 'southeast':
        position = { x: intersectWidth / 2, y: -intersectDepth / 2, z: 0.1 };
        break;
    }

    curbEntity.setAttribute('position', position);
    curbEntity.setAttribute('data-curb-radius', radius);
    curbEntity.setAttribute('data-curb-type', type);

    // Create a placeholder
    curbEntity.setAttribute(
      'text',
      `value: ${corner} curb (radius:${radius}); align:center;`
    );

    // Add to scene
    this.el.appendChild(curbEntity);

    return curbEntity;
  },

  /**
   * Add a crosswalk to the intersection
   */
  addCrosswalk: function (config) {
    const { direction, type = 'crosswalk-zebra' } = config;

    // Get intersection dimensions
    const intersectWidth = this.data.dimensions.x;
    const intersectDepth = this.data.dimensions.y;

    const crosswalkEntity = document.createElement('a-entity');
    crosswalkEntity.classList.add('intersection-crosswalk');
    crosswalkEntity.setAttribute('data-direction', direction);
    crosswalkEntity.setAttribute('data-crosswalk-type', type);
    crosswalkEntity.setAttribute('data-layer-name', `Crosswalk • ${direction}`);

    // Set position and orientation based on direction
    let position, rotation, mixinId;
    switch (direction.toLowerCase()) {
      case 'west':
        position = { x: -intersectWidth / 2, y: 0, z: 0.1 };
        rotation = { x: 0, y: 0, z: 90 };
        mixinId = `mixin-crosswalk-${CROSSWALKS[type]}`;
        break;
      case 'east':
        position = { x: intersectWidth / 2, y: 0, z: 0.1 };
        rotation = { x: 0, y: 0, z: 90 };
        mixinId = `mixin-crosswalk-${CROSSWALKS[type]}`;
        break;
      case 'north':
        position = { x: 0, y: intersectDepth / 2, z: 0.1 };
        rotation = { x: 0, y: 0, z: 0 };
        mixinId = `mixin-crosswalk-${CROSSWALKS[type]}`;
        break;
      case 'south':
        position = { x: 0, y: -intersectDepth / 2, z: 0.1 };
        rotation = { x: 0, y: 0, z: 0 };
        mixinId = `mixin-crosswalk-${CROSSWALKS[type]}`;
        break;
    }

    crosswalkEntity.setAttribute('position', position);
    crosswalkEntity.setAttribute('rotation', rotation);

    // Use a mixin for the crosswalk type if available
    if (document.querySelector(`#${mixinId}`)) {
      crosswalkEntity.setAttribute('mixin', mixinId);
    } else {
      // Fallback to a basic plane
      crosswalkEntity.setAttribute(
        'geometry',
        'primitive: plane; width: 4; height: 2'
      );
      crosswalkEntity.setAttribute(
        'material',
        'color: white; src: #crosswalk-texture'
      );
    }

    // Add to scene
    this.el.appendChild(crosswalkEntity);

    // Track in direction map
    if (this.directionMap[direction.toLowerCase()]) {
      this.directionMap[direction.toLowerCase()].crosswalk = crosswalkEntity;
    }

    return crosswalkEntity;
  },

  /**
   * Add a traffic element (signal or sign) to the intersection
   */
  addTrafficElement: function (config) {
    const { direction, type } = config;

    // Get intersection dimensions
    const intersectWidth = this.data.dimensions.x;
    const intersectDepth = this.data.dimensions.y;

    const trafficEntity = document.createElement('a-entity');
    trafficEntity.classList.add('intersection-traffic-element');
    trafficEntity.setAttribute('data-direction', direction);
    trafficEntity.setAttribute('data-element-type', type);
    trafficEntity.setAttribute(
      'data-layer-name',
      `Traffic ${type} • ${direction}`
    );

    // Set position based on direction
    let position;
    switch (direction.toLowerCase()) {
      case 'west':
        position = { x: -intersectWidth / 2 - 2, y: -2, z: 0 };
        break;
      case 'east':
        position = { x: intersectWidth / 2 + 2, y: 2, z: 0 };
        break;
      case 'north':
        position = { x: 2, y: intersectDepth / 2 + 2, z: 0 };
        break;
      case 'south':
        position = { x: -2, y: -intersectDepth / 2 - 2, z: 0 };
        break;
    }

    trafficEntity.setAttribute('position', position);

    // Set appropriate model or primitive based on type
    if (type === 'trafficSignal') {
      // TODO: Replace with actual traffic signal model
      trafficEntity.setAttribute(
        'geometry',
        'primitive: box; width: 0.5; height: 1.5; depth: 0.5'
      );
      trafficEntity.setAttribute('material', 'color: #333');
    } else if (type === 'stopSign') {
      // TODO: Replace with actual stop sign model
      trafficEntity.setAttribute(
        'geometry',
        'primitive: cylinder; radius: 0.5; height: 0.1'
      );
      trafficEntity.setAttribute('material', 'color: #c00');
      trafficEntity.setAttribute(
        'text',
        'value: STOP; align: center; width: 2; color: white; zOffset: 0.06'
      );
    }

    // Add to scene
    this.el.appendChild(trafficEntity);

    // Track in direction map
    if (this.directionMap[direction.toLowerCase()]) {
      this.directionMap[direction.toLowerCase()][type] = trafficEntity;
    }

    return trafficEntity;
  },

  /**
   * Update an element's properties
   */
  updateElement: function (elementType, direction, properties) {
    // Find the element to update
    let targetElement = null;

    if (
      this.directionMap[direction] &&
      this.directionMap[direction][elementType]
    ) {
      targetElement = this.directionMap[direction][elementType];
    }

    if (!targetElement) {
      console.warn(
        `[managed-intersection] Element not found: ${elementType} at ${direction}`
      );
      return false;
    }

    // Apply properties
    Object.keys(properties).forEach((propKey) => {
      const propValue = properties[propKey];
      targetElement.setAttribute(propKey, propValue);
    });

    return true;
  },

  /**
   * Remove a specific element
   */
  removeElement: function (elementType, direction) {
    // Find the element to remove
    let targetElement = null;

    if (
      this.directionMap[direction] &&
      this.directionMap[direction][elementType]
    ) {
      targetElement = this.directionMap[direction][elementType];
      this.directionMap[direction][elementType] = null;
    }

    if (!targetElement) {
      console.warn(
        `[managed-intersection] Element not found: ${elementType} at ${direction}`
      );
      return false;
    }

    // Remove from parent
    if (targetElement.parentNode) {
      targetElement.parentNode.removeChild(targetElement);
    }

    // Refresh tracking
    this.refreshManagedEntities();

    return true;
  },

  /**
   * Refresh the internal tracking of managed entities
   */
  refreshManagedEntities: function () {
    // Reset collections
    this.managedEntities = {
      sidewalks: [],
      curbs: [],
      crosswalks: [],
      trafficElements: []
    };

    // Query and categorize all child elements
    const children = this.el.querySelectorAll('a-entity');

    children.forEach((child) => {
      if (child.classList.contains('intersection-sidewalk')) {
        this.managedEntities.sidewalks.push(child);
      } else if (child.classList.contains('intersection-curb')) {
        this.managedEntities.curbs.push(child);
      } else if (child.classList.contains('intersection-crosswalk')) {
        this.managedEntities.crosswalks.push(child);
      } else if (child.classList.contains('intersection-traffic-element')) {
        this.managedEntities.trafficElements.push(child);
      }
    });

    // Update direction map
    this.updateDirectionMap();
  },

  /**
   * Update the direction map based on current entities
   */
  updateDirectionMap: function () {
    // Reset direction map
    Object.keys(this.directionMap).forEach((direction) => {
      this.directionMap[direction] = {
        sidewalk: null,
        crosswalk: null,
        trafficSignal: null,
        stopSign: null
      };
    });

    // Update sidewalks
    this.managedEntities.sidewalks.forEach((sidewalk) => {
      const direction = sidewalk.getAttribute('data-direction').toLowerCase();
      if (this.directionMap[direction]) {
        this.directionMap[direction].sidewalk = sidewalk;
      }
    });

    // Update crosswalks
    this.managedEntities.crosswalks.forEach((crosswalk) => {
      const direction = crosswalk.getAttribute('data-direction').toLowerCase();
      if (this.directionMap[direction]) {
        this.directionMap[direction].crosswalk = crosswalk;
      }
    });

    // Update traffic elements
    this.managedEntities.trafficElements.forEach((element) => {
      const direction = element.getAttribute('data-direction').toLowerCase();
      const type = element.getAttribute('data-element-type');
      if (this.directionMap[direction]) {
        this.directionMap[direction][type] = element;
      }
    });
  },

  /**
   * Export current intersection configuration as JSON
   */
  exportConfiguration: function () {
    const intersectWidth = this.data.dimensions.x;
    const intersectDepth = this.data.dimensions.y;

    const config = {
      dimensions: [intersectWidth, intersectDepth], // These are the curb-to-curb dimensions
      sidewalks: [],
      curbs: [],
      crosswalks: [],
      trafficElements: []
    };

    // Export sidewalks
    this.managedEntities.sidewalks.forEach((sidewalk) => {
      const direction = sidewalk.getAttribute('data-direction');
      // Calculate correct width and length based on the direction
      let width, length;

      // Get the width from the data attribute or geometry
      width = parseFloat(sidewalk.getAttribute('data-sidewalk-width')) || 3;

      // For length, we need to use the appropriate intersection dimension based on direction
      if (
        direction.toLowerCase() === 'north' ||
        direction.toLowerCase() === 'south'
      ) {
        length = intersectWidth; // Use intersection width for north/south sidewalks
      } else {
        length = intersectDepth; // Use intersection depth for east/west sidewalks
      }

      config.sidewalks.push({
        direction: direction,
        width: width,
        length: length
      });
    });

    // Export curbs
    this.managedEntities.curbs.forEach((curb) => {
      config.curbs.push({
        corner: curb.getAttribute('data-corner'),
        radius: parseFloat(curb.getAttribute('data-curb-radius')) || 4,
        type: curb.getAttribute('data-curb-type') || 'standard'
      });
    });

    // Export crosswalks
    this.managedEntities.crosswalks.forEach((crosswalk) => {
      config.crosswalks.push({
        direction: crosswalk.getAttribute('data-direction'),
        type: crosswalk.getAttribute('data-crosswalk-type') || 'crosswalk-zebra'
      });
    });

    // Export traffic elements
    this.managedEntities.trafficElements.forEach((element) => {
      config.trafficElements.push({
        direction: element.getAttribute('data-direction'),
        type: element.getAttribute('data-element-type')
      });
    });

    return config;
  },

  /**
   * Remove component and clean up resources
   */
  remove: function () {
    // Disconnect observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Clear managed entities
    this.clearAllEntities();
  }
});

/**
 * Usage example:
 *
 * <a-entity managed-intersection="
 *   dimensions: 20 20;
 *   sourceValue: {
 *     'dimensions': [20, 20],
 *     'sidewalks': [
 *       {'direction': 'north', 'width': 3, 'length': 20},
 *       {'direction': 'south', 'width': 3, 'length': 20}
 *     ],
 *     'curbs': [
 *       {'corner': 'northeast', 'radius': 4, 'type': 'standard'}
 *     ],
 *     'crosswalks': [
 *       {'direction': 'east', 'type': 'crosswalk-zebra'}
 *     ],
 *     'trafficElements': [
 *       {'direction': 'west', 'type': 'trafficSignal'}
 *     ]
 *   }"
 * ></a-entity>
 */
