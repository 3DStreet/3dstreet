/**
 * AIChatTools.js
 * A utility module that implements the functions for AI Chat operations
 * This modularizes the function implementations from AIChatPanel.js
 */

import { Parser } from 'expr-eval';
import Events from '../../lib/Events.js';
import * as THREE from 'three';
import { Schema } from 'firebase/vertexai';
import useStore from '@/store';

// Define the function declarations for entity operations
export const entityTools = {
  functionDeclarations: [
    {
      name: 'updateProjectInfo',
      description: 'Update project information stored in the global state',
      parameters: Schema.object({
        properties: {
          property: Schema.string({
            description:
              'The project info property to update (description, projectArea, currentCondition, problemStatement, proposedSolutions, or title)'
          }),
          value: Schema.string({
            description: 'The new value to set for the property'
          })
        },
        required: ['property', 'value']
      })
    },
    {
      name: 'entityCreateMixin',
      description:
        'Create a new entity in the A-Frame scene with specified components and transforms',
      parameters: Schema.object({
        properties: {
          mixin: Schema.string({
            description:
              'The mixin id value for the new entity (e.g., "box-truck-rig")'
          }),
          position: Schema.string({
            description:
              'Position as space-separated x y z values (e.g., "0 1.5 -3") default 0 0 0'
          }),
          rotation: Schema.string({
            description:
              'Rotation as space-separated x y z values in degrees (e.g., "0 45 0") default 0 0 0'
          }),
          scale: Schema.string({
            description:
              'Scale as space-separated x y z values (e.g., "2 2 2") default 1 1 1'
          })
        },
        optionalProperties: ['position', 'rotation', 'scale']
      })
    },
    {
      name: 'entityUpdate',
      description:
        'Update an entity in the A-Frame scene with new properties or components',
      parameters: Schema.object({
        properties: {
          entityId: Schema.string({
            description: 'The ID of the entity to update'
          }),
          component: Schema.string({
            description:
              'The component to update (e.g., position, rotation, mixin)'
          }),
          property: Schema.string({
            description:
              'The property to update within the component (optional)'
          }),
          value: Schema.string({
            description: 'The new value to set'
          }),
          expressionForValue: Schema.string({
            description:
              'Mathematical expression to evaluate for the value (e.g., "5 - 2"). Use this instead of value when calculation is needed.'
          })
        },
        optionalProperties: ['value', 'expressionForValue', 'property']
      })
    },
    {
      name: 'managedStreetCreate',
      description:
        'Create a new managed street with specified segments and properties',
      parameters: Schema.object({
        properties: {
          name: Schema.string({
            description: 'Name of the street configuration'
          }),
          length: Schema.string({
            description: 'Length of the street in meters (default: 60)'
          }),
          position: Schema.string({
            description:
              'Position as space-separated x y z values (e.g., "0 0 0")'
          }),
          segments: Schema.array({
            description: 'Array of segment definitions for the street',
            items: Schema.object({
              properties: {
                name: Schema.string({
                  description: 'Display name of the segment'
                }),
                type: Schema.string({
                  description:
                    'Type of segment (e.g., "drive-lane", "bike-lane", "sidewalk", "parking-lane", "divider", "grass", "rail", "bus-lane")'
                }),
                surface: Schema.string({
                  description:
                    'Surface material (e.g., "asphalt", "concrete", "grass", "sidewalk", "gravel", "sand", "hatched", "planting-strip", "none", "solid")'
                }),
                color: Schema.string({
                  description: 'Hex color code (e.g., "#ffffff")'
                }),
                level: Schema.number({
                  description: 'Vertical offset (-1, 0, 1, 2)'
                }),
                width: Schema.number({
                  description: 'Width in meters'
                }),
                direction: Schema.string({
                  description:
                    'Traffic direction ("none", "inbound", "outbound")'
                }),
                generated: Schema.object({
                  description: 'Optional generated content',
                  properties: {
                    clones: Schema.array({
                      description:
                        'Clones configuration for repeated 3D models',
                      items: Schema.object({
                        properties: {
                          mode: Schema.string({
                            description:
                              'Clone mode ("random", "fixed", "single")'
                          }),
                          modelsArray: Schema.string({
                            description: 'Comma-separated list of model names'
                          }),
                          spacing: Schema.number({
                            description: 'Distance between models in meters'
                          }),
                          count: Schema.number({
                            description: 'Number of models (for random mode)'
                          }),
                          facing: Schema.number({
                            description: 'Rotation in degrees'
                          }),
                          randomFacing: Schema.boolean({
                            description: 'Random rotation'
                          }),
                          cycleOffset: Schema.number({
                            description: 'Offset in the repeating pattern (0-1)'
                          })
                        },
                        optionalProperties: [
                          'count',
                          'facing',
                          'randomFacing',
                          'cycleOffset'
                        ]
                      })
                    }),
                    stencil: Schema.array({
                      description: 'Stencil configuration for road markings',
                      items: Schema.object({
                        properties: {
                          modelsArray: Schema.string({
                            description: 'Stencil model names'
                          }),
                          spacing: Schema.number({
                            description: 'Distance between stencils'
                          }),
                          padding: Schema.number({
                            description: 'Edge padding'
                          }),
                          cycleOffset: Schema.number({
                            description: 'Pattern offset (0-1)'
                          }),
                          direction: Schema.string({
                            description: 'Stencil orientation'
                          }),
                          stencilHeight: Schema.number({
                            description: 'Height of stencil'
                          })
                        },
                        optionalProperties: [
                          'padding',
                          'cycleOffset',
                          'direction',
                          'stencilHeight'
                        ]
                      })
                    }),
                    pedestrians: Schema.array({
                      description: 'Pedestrian configuration',
                      items: Schema.object({
                        properties: {
                          density: Schema.string({
                            description:
                              'Pedestrian density ("normal", "dense")'
                          })
                        }
                      })
                    }),
                    striping: Schema.array({
                      description: 'Striping configuration for lane markings',
                      items: Schema.object({
                        properties: {
                          striping: Schema.string({
                            description: 'Stripe pattern type'
                          }),
                          side: Schema.string({
                            description: 'Side of segment ("left", "right")'
                          })
                        },
                        optionalProperties: ['side']
                      })
                    })
                  },
                  optionalProperties: [
                    'clones',
                    'stencil',
                    'pedestrians',
                    'striping'
                  ]
                })
              },
              optionalProperties: ['name', 'generated']
            })
          })
        },
        optionalProperties: ['name', 'length', 'position']
      })
    },
    {
      name: 'managedStreetUpdate',
      description:
        'Update segments in an existing managed street (use entityUpdate for updating street properties)',
      parameters: Schema.object({
        properties: {
          entityId: Schema.string({
            description: 'The ID of the managed street entity to update'
          }),
          operation: Schema.string({
            description:
              'Operation to perform ("add-segment", "update-segment", "remove-segment")'
          }),
          segmentIndex: Schema.number({
            description:
              'Index of the segment to update or remove (for update-segment and remove-segment operations)'
          }),
          segment: Schema.object({
            description:
              'Segment definition for add-segment or update-segment operations',
            properties: {
              name: Schema.string({
                description: 'Display name of the segment'
              }),
              type: Schema.string({
                description:
                  'Type of segment (e.g., "drive-lane", "bike-lane", "sidewalk")'
              }),
              surface: Schema.string({
                description:
                  'Surface material (e.g., "asphalt", "concrete", "grass")'
              }),
              color: Schema.string({
                description: 'Hex color code (e.g., "#ffffff")'
              }),
              level: Schema.number({
                description: 'Vertical offset (-1, 0, 1, 2)'
              }),
              width: Schema.number({
                description: 'Width in meters'
              }),
              direction: Schema.string({
                description: 'Traffic direction ("none", "inbound", "outbound")'
              }),
              generated: Schema.object({
                description: 'Optional generated content',
                properties: {}
              })
            },
            optionalProperties: [
              'name',
              'type',
              'surface',
              'color',
              'level',
              'width',
              'direction',
              'generated'
            ]
          })
        },
        optionalProperties: ['segmentIndex', 'segment']
      })
    },
    {
      name: 'takeSnapshot',
      description:
        'Take a snapshot of the current camera view and include it in the chat',
      parameters: Schema.object({
        properties: {
          caption: Schema.string({
            description: 'Optional caption to display with the snapshot'
          }),
          focusEntityId: Schema.string({
            description:
              'Optional entity ID to focus on before taking the snapshot'
          }),
          type: Schema.string({
            description:
              'Optional type of snapshot view: "focus" (default), "birdseye", "straightOn", or "closeup"',
            enum: ['focus', 'birdseye', 'straightOn', 'closeup']
          })
        },
        optionalProperties: ['caption', 'focusEntityId', 'type']
      })
    },
    {
      name: 'setLatLon',
      description:
        'Set the latitude and longitude for the scene, which will trigger elevation calculation',
      parameters: Schema.object({
        properties: {
          latitude: Schema.number({
            description: 'Latitude in decimal degrees (e.g., 37.7637072)'
          }),
          longitude: Schema.number({
            description: 'Longitude in decimal degrees (e.g., -122.4151768)'
          })
        }
      })
    }
  ]
};

/**
 * Evaluates a mathematical expression safely
 * @param {string} expression - The mathematical expression to evaluate
 * @returns {number} The result of the evaluation
 */
export function evaluateExpression(expression) {
  try {
    const parser = new Parser();
    const cleanExpr = expression.trim();
    if (!/^[-+0-9\s()*/%.]*$/.test(cleanExpr)) {
      throw new Error('Invalid expression: contains forbidden characters');
    }
    return parser.evaluate(cleanExpr);
  } catch (error) {
    console.error('Error evaluating expression:', error);
    throw error;
  }
}

/**
 * Executes an entity update command
 * @param {Object} command - The command object with command and payload properties
 */
export function executeUpdateCommand(command) {
  if (command.command && command.payload) {
    const updateCommandPayload = {
      entity: document.getElementById(command.payload.entityId),
      component: command.payload.component,
      property: command.payload.property,
      value: command.payload.value
    };
    AFRAME.INSPECTOR.execute(command.command, updateCommandPayload);
  }
}

/**
 * Collection of functions to handle AI function calls
 */
const AIChatTools = {
  /**
   * Handles updateProjectInfo function call
   * @param {Object} args - The function arguments
   * @returns {string} Result message
   */
  updateProjectInfo: (args) => {
    try {
      const { property, value } = args;

      // Validate the property
      const validProperties = [
        'description',
        'projectArea',
        'currentCondition',
        'problemStatement',
        'proposedSolutions'
      ];

      // Special case for title which is handled separately in the store
      if (property === 'title') {
        useStore.getState().setSceneTitle(value);
        // Emit the historychanged event to trigger autosave
        Events.emit('historychanged', true);
        return `Updated scene title to: ${value}`;
      }

      if (!validProperties.includes(property)) {
        throw new Error(
          `Invalid property: ${property}. Must be one of: ${validProperties.join(', ')} or title`
        );
      }

      // Update the project info in the Zustand store
      const updatedInfo = {};
      updatedInfo[property] = value;
      useStore.getState().setProjectInfo(updatedInfo);

      return `Updated project ${property} to: ${value}`;
    } catch (error) {
      console.error('Error updating project info:', error);
      throw error;
    }
  },
  /**
   * Handles entityUpdate function call
   * @param {Object} args - The function arguments
   * @returns {string} Result message
   */
  entityUpdate: (args) => {
    // Extract fields with appropriate fallbacks
    const entityId = args.entityId;
    const component = args.component;
    const property = args.property || null;

    // Create the command payload
    const payload = {
      entityId: entityId,
      component: component
    };

    // Add property if specified (important for position.x, position.y, etc.)
    if (property) {
      payload.property = property;
    }

    // Set the value - either from direct value or expression
    if (args.expressionForValue) {
      try {
        // Simple numeric expression evaluation
        const expr = args.expressionForValue.trim();
        // Simple safety check - only allow basic math
        if (!/^[-+0-9\s()*/%.]*$/.test(expr)) {
          throw new Error('Invalid expression: contains forbidden characters');
        }

        payload.value = evaluateExpression(expr);
      } catch (error) {
        throw new Error(
          `Failed to evaluate expression "${args.expressionForValue}": ${error.message}`
        );
      }
    } else if (args.value) {
      payload.value = args.value;
    } else {
      throw new Error('Either value or expressionForValue must be provided');
    }

    // Execute the command
    const commandData = {
      command: 'entityupdate',
      payload
    };

    executeUpdateCommand(commandData);
    return 'Entity updated successfully';
  },

  /**
   * Handles entityCreateMixin function call
   * @param {Object} args - The function arguments
   * @returns {string} Result message
   */
  entityCreateMixin: (args) => {
    const newCommandPayload = {
      mixin: args.mixin,
      components: {
        position: args.position || '0 0 0',
        rotation: args.rotation || '0 0 0',
        scale: args.scale || '1 1 1'
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', newCommandPayload);
    return 'Entity created successfully';
  },

  /**
   * Handles managedStreetCreate function call
   * @param {Object} args - The function arguments
   * @returns {string} Result message
   */
  managedStreetCreate: (args) => {
    // Create a new managed street entity with proper structure
    const streetData = {
      name: args.name || 'New Managed Street',
      length: parseFloat(args.length || '60'),
      segments: []
    };

    // Ensure each segment has all required properties
    if (args.segments && Array.isArray(args.segments)) {
      streetData.segments = args.segments.map((segment) => {
        // Ensure all required properties are present with defaults if missing
        return {
          name: segment.name || `${segment.type || 'segment'} • default`,
          type: segment.type || 'drive-lane',
          width: typeof segment.width === 'number' ? segment.width : 3,
          level: typeof segment.level === 'number' ? segment.level : 0,
          direction: segment.direction || 'none',
          color: segment.color || '#888888',
          surface: segment.surface || 'asphalt',
          // Include generated content if provided
          ...(segment.generated ? { generated: segment.generated } : {})
        };
      });
    }

    // Calculate total width for proper alignment
    const totalWidth = streetData.segments.reduce(
      (sum, segment) => sum + segment.width,
      0
    );
    streetData.width = totalWidth;

    // Generate a unique ID for the new entity
    const uniqueId =
      'managed-street-' + Math.random().toString(36).substr(2, 9);

    // Create the entity definition for AFRAME.INSPECTOR.execute
    const definition = {
      id: uniqueId,
      parent: '#street-container', // This ensures it's added to the street-container
      components: {
        position: args.position || '0 0.01 0', // Default position slightly above ground
        'managed-street': {
          sourceType: 'json-blob',
          sourceValue: JSON.stringify(streetData),
          showVehicles: true,
          showStriping: true,
          synchronize: true
        },
        'data-layer-name': streetData.name || 'New Managed Street'
      }
    };

    // Use AFRAME.INSPECTOR.execute to create the entity
    AFRAME.INSPECTOR.execute('entitycreate', definition);
    return 'Managed street created successfully';
  },

  /**
   * Handles managedStreetUpdate function call
   * @param {Object} args - The function arguments
   * @returns {string} Result message
   */
  managedStreetUpdate: (args) => {
    const entityId = args.entityId;
    const operation = args.operation;
    const entity = document.getElementById(entityId);

    if (!entity) {
      throw new Error(`Entity with ID ${entityId} not found`);
    }

    // Get all segment entities (direct children with street-segment component)
    const segmentEntities = Array.from(entity.children).filter((child) =>
      child.hasAttribute('street-segment')
    );

    if (operation === 'add-segment') {
      // Add a new segment
      const segment = args.segment;
      const segmentIndex = args.segmentIndex;

      if (!segment || !segment.type) {
        throw new Error('Segment must have at least a type property');
      }

      // Create a new segment entity
      const segmentEl = document.createElement('a-entity');

      // Set default values for any missing properties
      const segmentData = {
        type: segment.type,
        width: typeof segment.width === 'number' ? segment.width : 3,
        length: entity.components['managed-street'].data.length || 60,
        level: typeof segment.level === 'number' ? segment.level : 0,
        direction: segment.direction || 'none',
        color: segment.color || '#888888',
        surface: segment.surface || 'asphalt'
      };

      // Set the segment component with properties
      segmentEl.setAttribute('street-segment', segmentData);

      // Set the layer name for the segment
      const layerName = segment.name || `${segment.type} • default`;
      segmentEl.setAttribute('data-layer-name', layerName);

      // Add the segment to the managed street entity at the specified index or at the end if no index
      if (segmentIndex !== undefined) {
        // Validate the segment index
        if (segmentIndex < 0 || segmentIndex > segmentEntities.length) {
          throw new Error(
            `Invalid segmentIndex: ${segmentIndex}. Must be between 0 and ${segmentEntities.length}`
          );
        }

        // If we have a valid index, insert at that position
        if (segmentIndex < segmentEntities.length) {
          // Insert before the segment at the specified index
          entity.insertBefore(segmentEl, segmentEntities[segmentIndex]);
        } else {
          // If the index is equal to the length, append to the end
          entity.appendChild(segmentEl);
        }
      } else {
        // Default behavior: append to the end
        entity.appendChild(segmentEl);
      }

      // If segment has generated content, add it after the segment is loaded
      if (segment.generated) {
        segmentEl.addEventListener('loaded', () => {
          segmentEl.components[
            'street-segment'
          ].generateComponentsFromSegmentObject(segment);
        });
      }
    } else if (operation === 'update-segment') {
      // Update an existing segment
      const segmentIndex = args.segmentIndex;
      const segment = args.segment;

      if (segmentIndex === undefined || !segment) {
        throw new Error(
          'segmentIndex and segment are required for update-segment operation'
        );
      }

      if (segmentIndex < 0 || segmentIndex >= segmentEntities.length) {
        throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
      }

      // Get the segment entity to update
      const segmentEl = segmentEntities[segmentIndex];

      // Get current segment data
      const currentData = segmentEl.getAttribute('street-segment');

      // Update only the properties that were provided
      const updatedData = { ...currentData };

      // Update properties
      Object.keys(segment).forEach((key) => {
        if (key !== 'generated') {
          // Handle generated separately
          updatedData[key] = segment[key];
        }
      });

      // Update the street-segment component
      segmentEl.setAttribute('street-segment', updatedData);

      // Update the layer name if provided
      if (segment.name) {
        segmentEl.setAttribute('data-layer-name', segment.name);
      }

      // If generated content is provided, update it
      if (segment.generated) {
        // Check if we need to remove any generated components
        // This handles the case where clones: [] is provided to remove clones
        const generatedTypes = [
          'clones',
          'stencil',
          'pedestrians',
          'striping',
          'rail'
        ];

        generatedTypes.forEach((type) => {
          // If the type exists in segment.generated and is an empty array, remove those components
          if (
            Array.isArray(segment.generated[type]) &&
            segment.generated[type].length === 0
          ) {
            // Find all components of this type on the segment
            Object.keys(segmentEl.components).forEach((componentName) => {
              if (componentName.startsWith(`street-generated-${type}`)) {
                // Remove the component
                segmentEl.removeAttribute(componentName);
              }
            });
          } else if (segment.generated[type] === null) {
            // If the type is explicitly set to null, also remove those components
            // Find all components of this type on the segment
            Object.keys(segmentEl.components).forEach((componentName) => {
              if (componentName.startsWith(`street-generated-${type}`)) {
                // Remove the component
                segmentEl.removeAttribute(componentName);
              }
            });
          }
        });

        // Only call generateComponentsFromSegmentObject if there are non-empty arrays
        // or if the generated object has properties other than those we explicitly handled
        const hasNonEmptyArrays = generatedTypes.some(
          (type) =>
            Array.isArray(segment.generated[type]) &&
            segment.generated[type].length > 0
        );

        const hasOtherProperties = Object.keys(segment.generated).some(
          (key) => !generatedTypes.includes(key)
        );

        if (hasNonEmptyArrays || hasOtherProperties) {
          // We need to wait for the next tick to ensure the segment component is updated
          setTimeout(() => {
            segmentEl.components[
              'street-segment'
            ].generateComponentsFromSegmentObject({
              ...updatedData,
              generated: segment.generated
            });
          }, 0);
        }
      }
    } else if (operation === 'remove-segment') {
      // Remove a segment
      const segmentIndex = args.segmentIndex;

      if (segmentIndex === undefined) {
        throw new Error(
          'segmentIndex is required for remove-segment operation'
        );
      }

      if (segmentIndex < 0 || segmentIndex >= segmentEntities.length) {
        throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
      }

      // Get the segment entity to remove
      const segmentEl = segmentEntities[segmentIndex];

      // Remove the segment from the parent
      entity.removeChild(segmentEl);
    } else {
      throw new Error(`Unknown operation: ${operation}`);
    }

    // Trigger a refresh of the managed street
    // This will update the alignment and other properties
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: entity,
      component: 'street-align',
      property: 'refresh',
      value: true
    });

    return 'Managed street updated successfully';
  },

  /**
   * Handles takeSnapshot function call
   * @param {Object} args - The function arguments
   * @returns {Promise<Object>} Promise resolving to snapshot data
   */
  takeSnapshot: async (args) => {
    // Get the caption if provided
    const caption = args.caption || 'Snapshot of the current view';
    // Get the focusEntityId if provided
    const focusEntityId = args.focusEntityId;
    // Get the snapshot type if provided (defaults to 'focus')
    const snapshotType = args.type || 'focus';

    // Get the screenshot element
    const screenshotEl = document.getElementById('screenshot');
    if (!screenshotEl) {
      throw new Error('Screenshot element not found');
    }

    // Make sure the screenshot element is playing
    if (!screenshotEl.isPlaying) {
      screenshotEl.play();
    }

    // Create a canvas to capture the screenshot
    let screenshotCanvas = document.querySelector('#screenshotCanvas');
    if (!screenshotCanvas) {
      screenshotCanvas = document.createElement('canvas');
      screenshotCanvas.id = 'screenshotCanvas';
      screenshotCanvas.hidden = true;
      document.body.appendChild(screenshotCanvas);
    }

    // Get the camera from A-Frame
    const cameraEl = document.querySelector('[camera]');
    if (!cameraEl) {
      throw new Error('Camera element not found');
    }

    // Position the camera based on the snapshot type
    if (snapshotType !== 'focus') {
      // Find the street entity to use as a reference point
      const streetEntity = document.querySelector('[managed-street]');
      if (!streetEntity) {
        throw new Error('Street entity not found. Cannot position camera.');
      }

      // Create a temporary target entity for camera positioning
      let targetEntity = document.querySelector('#temp-camera-target');
      if (!targetEntity) {
        targetEntity = document.createElement('a-entity');
        targetEntity.id = 'temp-camera-target';
        document.querySelector('a-scene').appendChild(targetEntity);
      }

      // Get street position
      const streetPosition = new THREE.Vector3();
      streetEntity.object3D.getWorldPosition(streetPosition);

      // Position the target entity based on snapshot type
      switch (snapshotType) {
        case 'birdseye':
          // Position target at street level, we'll look down at it from above
          targetEntity.setAttribute('position', {
            x: streetPosition.x,
            y: streetPosition.y,
            z: streetPosition.z
          });
          // Add focus-camera-pose component with relative position above
          targetEntity.setAttribute('focus-camera-pose', {
            relativePosition: { x: 0, y: 50, z: 0 }
          });
          break;

        case 'straightOn':
          // Position target at street level
          targetEntity.setAttribute('position', {
            x: streetPosition.x,
            y: streetPosition.y,
            z: streetPosition.z
          });
          // Add focus-camera-pose component with relative position in front
          targetEntity.setAttribute('focus-camera-pose', {
            relativePosition: { x: 0, y: 1.6, z: 20 }
          });
          break;

        case 'closeup':
          // Position target at street level
          targetEntity.setAttribute('position', {
            x: streetPosition.x,
            y: streetPosition.y,
            z: streetPosition.z
          });
          // Add focus-camera-pose component with relative position for closeup
          targetEntity.setAttribute('focus-camera-pose', {
            relativePosition: { x: 3, y: 1.2, z: 5 }
          });
          break;
      }

      // Use the proper event system to focus on the target entity
      if (typeof Events !== 'undefined' && Events.emit) {
        Events.emit('objectfocus', targetEntity.object3D);

        // Wait for the focus animation to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        throw new Error('Events system not available');
      }
    } else if (focusEntityId) {
      // If a focusEntityId is provided and type is 'focus', focus the camera on that entity
      const focusEntity = document.getElementById(focusEntityId);
      if (!focusEntity) {
        throw new Error(`Entity with ID ${focusEntityId} not found`);
      }

      // Get the camera from A-Frame
      const cameraEl = document.querySelector('[camera]');
      if (!cameraEl) {
        throw new Error('Camera element not found');
      }

      // Use Events.emit('objectfocus') to focus on the entity, which is the proper way in A-Frame
      // This will trigger the focus-animation component if it exists
      if (typeof Events !== 'undefined' && Events.emit) {
        Events.emit('objectfocus', focusEntity.object3D);

        // Wait a bit for the focus animation to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        // Fallback if Events is not available
        // Focus the camera on the entity manually
        const entityPosition = new THREE.Vector3();
        focusEntity.object3D.getWorldPosition(entityPosition);

        // Get the camera object
        const camera = cameraEl.object3D;
        const cameraWorldPosition = new THREE.Vector3();
        camera.getWorldPosition(cameraWorldPosition);

        // Calculate a position that's a bit away from the entity
        const direction = new THREE.Vector3()
          .subVectors(cameraWorldPosition, entityPosition)
          .normalize()
          .multiplyScalar(5); // 5 units away

        // Set the camera position to look at the entity
        camera.position.copy(entityPosition).add(direction);
        camera.lookAt(entityPosition);

        // Wait a bit for the camera to update
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return new Promise((resolve, reject) => {
      // Define the function to take the actual snapshot
      const takeActualSnapshot = () => {
        try {
          // Render the scene to the canvas
          const renderer = AFRAME.scenes[0].renderer;

          // Hide helpers if inspector is open
          const inspector = AFRAME.INSPECTOR;
          if (inspector && inspector.opened) {
            inspector.sceneHelpers.visible = false;
          }

          // Get the scene and camera from A-Frame
          const scene = AFRAME.scenes[0].object3D;
          const camera = AFRAME.scenes[0].camera;

          // Render one frame to ensure the scene is up-to-date
          renderer.render(scene, camera);

          // Set canvas dimensions to match the renderer
          screenshotCanvas.width = renderer.domElement.width;
          screenshotCanvas.height = renderer.domElement.height;

          // Draw the rendered frame to the canvas
          const ctx = screenshotCanvas.getContext('2d');
          ctx.drawImage(renderer.domElement, 0, 0);

          // Try to get the scene title if available
          let sceneTitle;
          try {
            // Try multiple methods to get the scene title
            // 1. Check if it's stored on the scene element
            if (typeof window.AFRAME !== 'undefined') {
              const sceneEl = window.AFRAME.scenes[0].sceneEl;
              if (sceneEl && sceneEl.getAttribute('data-scene-title')) {
                sceneTitle = sceneEl.getAttribute('data-scene-title');
              }

              // 2. Check if it's in a global variable
              if (
                !sceneTitle &&
                typeof window.STREET !== 'undefined' &&
                window.STREET.sceneTitle
              ) {
                sceneTitle = window.STREET.sceneTitle;
              }
            }
          } catch (e) {
            console.warn('Could not get scene title:', e);
          }

          if (sceneTitle) {
            ctx.font = '30px Lato';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.strokeText(
              sceneTitle,
              screenshotCanvas.width / 2,
              screenshotCanvas.height - 43
            );
            ctx.fillText(
              sceneTitle,
              screenshotCanvas.width / 2,
              screenshotCanvas.height - 43
            );
          }

          // Add 3DStreet logo if available
          const logoImg = document.querySelector('#screenshot-img');
          if (logoImg) {
            ctx.drawImage(logoImg, 0, 0, 135, 43, 40, 30, 270, 86);
          }

          // Get the image data as a data URL
          const imageData = screenshotCanvas.toDataURL('image/png');

          // Show helpers again if they were hidden
          if (inspector && inspector.opened) {
            inspector.sceneHelpers.visible = true;
          }

          // Return the snapshot data
          resolve({
            caption,
            imageData
          });
        } catch (error) {
          reject(error);
        }
      };

      // Wait a short time to ensure the scene is ready
      setTimeout(takeActualSnapshot, 100);
    });
  },

  /**
   * Executes a function call
   * @param {string} functionName - The name of the function to call
   * @param {Object} args - The function arguments
   * @returns {Promise<any>} Promise resolving to the function result
   */
  /**
   * Handles setLatLon function call
   * @param {Object} args - The function arguments (latitude, longitude)
   * @returns {Promise<string>} Result message
   */
  setLatLon: async (args, currentUser) => {
    const { latitude, longitude } = args;

    if (isNaN(latitude) || isNaN(longitude)) {
      return 'Error: Invalid latitude or longitude values';
    }

    try {
      // Check if user is authenticated
      if (!currentUser) {
        throw new Error('You need to sign in to set location');
      }

      if (!currentUser.isPro) {
        // Trigger checkout flow for non-pro users
        // const useStore = (await import('@/store')).default;
        // useStore.getState().startCheckout('geo'); // don't do this for now
        throw new Error('Setting location requires a Pro subscription');
      }

      // Import the httpsCallable and functions from firebase
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../services/firebase.js');
      const { roundCoord } = await import('../../../../src/utils.js');

      // Round coordinates to reasonable precision
      const lat = roundCoord(parseFloat(latitude));
      const lng = roundCoord(parseFloat(longitude));

      // Request elevation data from the cloud function
      const getGeoidHeight = httpsCallable(functions, 'getGeoidHeight');
      const result = await getGeoidHeight({ lat, lon: lng });
      const data = result.data;

      if (data) {
        console.log(`Setting location - latitude: ${lat}, longitude: ${lng}`);
        console.log(`Elevation data: ${JSON.stringify(data)}`);

        // Get the reference layers element
        const geoLayer = document.getElementById('reference-layers');

        // Update or add the street-geo component
        AFRAME.INSPECTOR.execute(
          geoLayer.hasAttribute('street-geo') ? 'entityupdate' : 'componentadd',
          {
            entity: geoLayer,
            component: 'street-geo',
            value: {
              latitude: lat,
              longitude: lng,
              ellipsoidalHeight: data.ellipsoidalHeight,
              orthometricHeight: data.orthometricHeight,
              geoidHeight: data.geoidHeight
            }
          }
        );

        // Select the geo layer in the inspector
        setTimeout(() => {
          AFRAME.INSPECTOR.selectEntity(geoLayer);
        }, 0);

        return `Successfully set location to latitude: ${lat}, longitude: ${lng} with elevation data: ellipsoidal height ${data.ellipsoidalHeight}m, orthometric height ${data.orthometricHeight}m`;
      } else {
        throw new Error('Failed to retrieve elevation data');
      }
    } catch (error) {
      console.error('Error setting lat/lon:', error);
      throw error;
    }
  },

  executeFunction: async (functionName, args, currentUser) => {
    if (!AIChatTools[functionName]) {
      throw new Error(`Unknown function: ${functionName}`);
    }

    return await AIChatTools[functionName](args, currentUser);
  }
};

export default AIChatTools;
