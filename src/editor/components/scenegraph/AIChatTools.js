/**
 * AIChatTools.js
 * A utility module that implements the functions for AI Chat operations
 * This modularizes the function implementations from AIChatPanel.js
 */

import { Parser } from 'expr-eval';
import Events from '../../lib/Events.js';
import * as THREE from 'three';

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

    // If a focusEntityId is provided, focus the camera on that entity
    if (focusEntityId) {
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
  executeFunction: async (functionName, args) => {
    if (!AIChatTools[functionName]) {
      throw new Error(`Unknown function: ${functionName}`);
    }

    return await AIChatTools[functionName](args);
  }
};

export default AIChatTools;
