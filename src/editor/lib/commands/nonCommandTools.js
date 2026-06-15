/**
 * Tool definitions that are NOT a thin wrapper over a single command class.
 * Read-only tools (takeSnapshot), composite mutations (managedStreetCreate
 * fans out into one entitycreate; managedStreetUpdate dispatches to
 * segmentadd/segmentupdate/segmentremove), and meta operations that we
 * deliberately keep outside the undo history (setLatLon — see comment).
 *
 * Each entry has the same shape as a command's `static llmTool` plus a
 * `handler(args, currentUser)`. The registry combines these with the
 * auto-generated command tools so consumers (Vertex AI today, MCP next)
 * see one unified list.
 */

import * as THREE from 'three';
import Events from '../Events.js';
import { GEO_SOURCES } from '@shared/constants/geoSources.js';

/**
 * Compose a managed-street entity from a flat segments array and create it
 * via a single entitycreate command.
 */
async function managedStreetCreateHandler(args) {
  const streetData = {
    name: args.name || 'New Managed Street',
    length: parseFloat(args.length || '60'),
    segments: []
  };

  if (args.segments && Array.isArray(args.segments)) {
    streetData.segments = args.segments.map((segment) => ({
      name: segment.name || `${segment.type || 'segment'} • default`,
      type: segment.type || 'drive-lane',
      width: typeof segment.width === 'number' ? segment.width : 3,
      level: typeof segment.level === 'number' ? segment.level : 0,
      direction: segment.direction || 'none',
      color: segment.color || '#888888',
      surface: segment.surface || 'asphalt',
      ...(segment.generated ? { generated: segment.generated } : {})
    }));
  }

  streetData.width = streetData.segments.reduce(
    (sum, segment) => sum + segment.width,
    0
  );

  const uniqueId = 'managed-street-' + Math.random().toString(36).slice(2, 11);

  const definition = {
    id: uniqueId,
    parent: '#street-container',
    components: {
      position: args.position || '0 0.01 0',
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

  AFRAME.INSPECTOR.execute('entitycreate', definition);
  return 'Managed street created successfully';
}

/**
 * Dispatch to the appropriate segment command so each mutation is its own
 * undoable history entry.
 */
async function managedStreetUpdateHandler(args) {
  const { entityId, operation, segmentIndex, segment } = args;
  const entity = document.getElementById(entityId);

  if (!entity) {
    throw new Error(`Entity with ID ${entityId} not found`);
  }

  const segmentEntities = Array.from(entity.children).filter((child) =>
    child.hasAttribute('street-segment')
  );

  if (operation === 'add-segment') {
    if (!segment || !segment.type) {
      throw new Error('Segment must have at least a type property');
    }
    if (
      segmentIndex !== undefined &&
      (segmentIndex < 0 || segmentIndex > segmentEntities.length)
    ) {
      throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
    }
    const label = segment.name || `${segment.type} • default`;
    // segmentadd takes streetId (string), not the resolved element, because
    // its execute() runs on redo too — the parent DOM may have been recreated
    // since construction, so it looks up by id at execute time. update/remove
    // already hold the segment element and don't need that.
    AFRAME.INSPECTOR.execute(
      'segmentadd',
      { streetId: entityId, segment, segmentIndex },
      `Add ${label}`
    );
    return `Added segment: ${label}`;
  }

  if (operation === 'update-segment') {
    if (segmentIndex === undefined || !segment) {
      throw new Error(
        'segmentIndex and segment are required for update-segment operation'
      );
    }
    if (segmentIndex < 0 || segmentIndex >= segmentEntities.length) {
      throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
    }
    const segmentEl = segmentEntities[segmentIndex];
    const label =
      segment.name ||
      segmentEl.getAttribute('data-layer-name') ||
      `segment ${segmentIndex}`;
    AFRAME.INSPECTOR.execute(
      'segmentupdate',
      { entity: segmentEl, segment },
      `Update ${label}`
    );
    return `Updated segment: ${label}`;
  }

  if (operation === 'remove-segment') {
    if (segmentIndex === undefined) {
      throw new Error('segmentIndex is required for remove-segment operation');
    }
    if (segmentIndex < 0 || segmentIndex >= segmentEntities.length) {
      throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
    }
    const segmentEl = segmentEntities[segmentIndex];
    const label =
      segmentEl.getAttribute('data-layer-name') || `segment ${segmentIndex}`;
    AFRAME.INSPECTOR.execute(
      'segmentremove',
      { entity: segmentEl },
      `Remove ${label}`
    );
    return `Removed segment: ${label}`;
  }

  throw new Error(`Unknown operation: ${operation}`);
}

async function takeSnapshotHandler(args) {
  const caption = args.caption || 'Snapshot of the current view';
  const focusEntityId = args.focusEntityId;
  const snapshotType = args.type || 'focus';

  const screenshotEl = document.getElementById('screenshot');
  if (!screenshotEl) {
    throw new Error('Screenshot element not found');
  }
  if (!screenshotEl.isPlaying) {
    screenshotEl.play();
  }

  let screenshotCanvas = document.querySelector('#screenshotCanvas');
  if (!screenshotCanvas) {
    screenshotCanvas = document.createElement('canvas');
    screenshotCanvas.id = 'screenshotCanvas';
    screenshotCanvas.hidden = true;
    document.body.appendChild(screenshotCanvas);
  }

  const cameraEl = document.querySelector('[camera]');
  if (!cameraEl) {
    throw new Error('Camera element not found');
  }

  if (snapshotType !== 'focus') {
    const streetEntity = document.querySelector('[managed-street]');
    if (!streetEntity) {
      throw new Error('Street entity not found. Cannot position camera.');
    }

    let targetEntity = document.querySelector('#temp-camera-target');
    if (!targetEntity) {
      targetEntity = document.createElement('a-entity');
      targetEntity.id = 'temp-camera-target';
      document.querySelector('a-scene').appendChild(targetEntity);
    }

    const streetPosition = new THREE.Vector3();
    streetEntity.object3D.getWorldPosition(streetPosition);

    switch (snapshotType) {
      case 'birdseye':
        targetEntity.setAttribute('position', {
          x: streetPosition.x,
          y: streetPosition.y,
          z: streetPosition.z
        });
        targetEntity.setAttribute('focus-camera-pose', {
          relativePosition: { x: 0, y: 50, z: 0 }
        });
        break;
      case 'straightOn':
        targetEntity.setAttribute('position', {
          x: streetPosition.x,
          y: streetPosition.y,
          z: streetPosition.z
        });
        targetEntity.setAttribute('focus-camera-pose', {
          relativePosition: { x: 0, y: 1.6, z: 20 }
        });
        break;
      case 'closeup':
        targetEntity.setAttribute('position', {
          x: streetPosition.x,
          y: streetPosition.y,
          z: streetPosition.z
        });
        targetEntity.setAttribute('focus-camera-pose', {
          relativePosition: { x: 3, y: 1.2, z: 5 }
        });
        break;
    }

    if (typeof Events !== 'undefined' && Events.emit) {
      Events.emit('objectfocus', targetEntity.object3D);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      throw new Error('Events system not available');
    }
  } else if (focusEntityId) {
    const focusEntity = document.getElementById(focusEntityId);
    if (!focusEntity) {
      throw new Error(`Entity with ID ${focusEntityId} not found`);
    }

    if (typeof Events !== 'undefined' && Events.emit) {
      Events.emit('objectfocus', focusEntity.object3D);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      const entityPosition = new THREE.Vector3();
      focusEntity.object3D.getWorldPosition(entityPosition);

      const camera = cameraEl.object3D;
      const cameraWorldPosition = new THREE.Vector3();
      camera.getWorldPosition(cameraWorldPosition);

      const direction = new THREE.Vector3()
        .subVectors(cameraWorldPosition, entityPosition)
        .normalize()
        .multiplyScalar(5);

      camera.position.copy(entityPosition).add(direction);
      camera.lookAt(entityPosition);

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return new Promise((resolve, reject) => {
    const takeActualSnapshot = () => {
      try {
        const renderer = AFRAME.scenes[0].renderer;

        const inspector = AFRAME.INSPECTOR;
        if (inspector && inspector.opened) {
          inspector.sceneHelpers.visible = false;
        }

        const scene = AFRAME.scenes[0].object3D;
        const camera = AFRAME.scenes[0].camera;
        renderer.render(scene, camera);

        screenshotCanvas.width = renderer.domElement.width;
        screenshotCanvas.height = renderer.domElement.height;

        const ctx = screenshotCanvas.getContext('2d');
        ctx.drawImage(renderer.domElement, 0, 0);

        let sceneTitle;
        try {
          if (typeof window.AFRAME !== 'undefined') {
            const sceneEl = window.AFRAME.scenes[0].sceneEl;
            if (sceneEl && sceneEl.getAttribute('data-scene-title')) {
              sceneTitle = sceneEl.getAttribute('data-scene-title');
            }
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

        const logoImg = document.querySelector('#screenshot-img');
        if (logoImg) {
          ctx.drawImage(logoImg, 0, 0, 135, 43, 40, 30, 270, 86);
        }

        const imageData = screenshotCanvas.toDataURL('image/png');

        if (inspector && inspector.opened) {
          inspector.sceneHelpers.visible = true;
        }

        resolve({ caption, imageData });
      } catch (error) {
        reject(error);
      }
    };

    setTimeout(takeActualSnapshot, 100);
  });
}

// NOT routed through INSPECTOR.execute by design. Wrapping this as a command
// would require capturing pre/post lat/lon/elevation, and undo would fire two
// extra elevation HTTP roundtrips per toggle. Leave uninstrumented until we
// have a concrete need for undoable geolocation.
async function setLatLonHandler(args, currentUser) {
  const { latitude, longitude } = args;

  if (!currentUser) {
    throw new Error('You need to sign in to set location');
  }

  const { setSceneLocation } = await import('../utils.js');
  const result = await setSceneLocation(latitude, longitude, {
    source: GEO_SOURCES.AI_ASSISTANT
  });

  if (result.success) {
    const data = result.data;
    return `Successfully set location to latitude: ${data.latitude}, longitude: ${data.longitude} with elevation data: ellipsoidal height ${data.ellipsoidalHeight}m, orthometric height ${data.orthometricHeight}m`;
  }
  return result.message;
}

const segmentSchema = {
  type: 'object',
  description: 'Segment definition',
  properties: {
    name: { type: 'string', description: 'Display name of the segment' },
    type: {
      type: 'string',
      description:
        'Type of segment. Valid values: "drive-lane", "bike-lane", "sidewalk", "parking-lane", "divider", "grass", "rail", "bus-lane", "building". Use "building" with `variant` + `side` for building-flanked streets — the segment auto-tiles building models edge-to-edge with no need to supply `generated`.'
    },
    surface: {
      type: 'string',
      description:
        'Surface material (e.g., "asphalt", "concrete", "grass", "sidewalk", "gravel", "sand", "hatched", "planting-strip", "none", "solid"). Optional for building segments — the variant supplies a sensible default.'
    },
    color: { type: 'string', description: 'Hex color code (e.g., "#ffffff")' },
    level: { type: 'number', description: 'Vertical offset (-1, 0, 1, 2)' },
    width: { type: 'number', description: 'Width in meters' },
    direction: {
      type: 'string',
      description: 'Traffic direction ("none", "inbound", "outbound")'
    },
    variant: {
      type: 'string',
      description:
        'Variant preset for `type: "building"` segments. Valid values: "brownstone" (urban mixed-use SM3D blocks), "suburban" (detached single-family houses), "arcade" (arched street-front buildings), "water" (seawall), "grass" (fenced grass strip), "parking" (fenced parking lot), "sp-mixeduse" (StreetPlan mixed-use), "sp-residential" (StreetPlan single-family/townhouse), "sp-big-box" (StreetPlan big-box stores), "custom" (preserve existing settings). Setting variant on a building segment auto-fits the model array; do NOT pass `generated.clones` for buildings unless you want full control. Only meaningful when `type: "building"`.'
    },
    side: {
      type: 'string',
      description:
        'Side of the street the segment sits on. Required for `type: "building"` (controls which direction the buildings face — "left" rotates them to face right toward the street, "right" rotates them to face left). Valid values: "left", "right".',
      enum: ['left', 'right']
    },
    generated: {
      type: 'object',
      description: 'Optional generated content',
      properties: {
        clones: {
          type: 'array',
          description: 'Clones configuration for repeated 3D models',
          items: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                description: 'Clone mode ("random", "fixed", "single")'
              },
              modelsArray: {
                type: 'string',
                description: 'Comma-separated list of model names'
              },
              spacing: {
                type: 'number',
                description: 'Distance between models in meters'
              },
              count: {
                type: 'number',
                description: 'Number of models (for random mode)'
              },
              facing: { type: 'number', description: 'Rotation in degrees' },
              randomFacing: { type: 'boolean', description: 'Random rotation' },
              cycleOffset: {
                type: 'number',
                description: 'Offset in the repeating pattern (0-1)'
              }
            },
            required: ['mode', 'modelsArray', 'spacing']
          }
        },
        stencil: {
          type: 'array',
          description: 'Stencil configuration for road markings',
          items: {
            type: 'object',
            properties: {
              modelsArray: {
                type: 'string',
                description: 'Stencil model names'
              },
              spacing: {
                type: 'number',
                description: 'Distance between stencils'
              },
              padding: { type: 'number', description: 'Edge padding' },
              cycleOffset: {
                type: 'number',
                description: 'Pattern offset (0-1)'
              },
              direction: {
                type: 'string',
                description: 'Stencil orientation'
              },
              stencilHeight: {
                type: 'number',
                description: 'Height of stencil'
              }
            },
            required: ['modelsArray', 'spacing']
          }
        },
        pedestrians: {
          type: 'array',
          description: 'Pedestrian configuration',
          items: {
            type: 'object',
            properties: {
              density: {
                type: 'string',
                description: 'Pedestrian density ("normal", "dense")'
              }
            },
            required: ['density']
          }
        },
        striping: {
          type: 'array',
          description: 'Striping configuration for lane markings',
          items: {
            type: 'object',
            properties: {
              striping: { type: 'string', description: 'Stripe pattern type' },
              side: {
                type: 'string',
                description: 'Side of segment ("left", "right")'
              }
            },
            required: ['striping']
          }
        }
      }
    }
  },
  required: ['type', 'surface', 'color', 'level', 'width', 'direction']
};

// For update-segment, every field is optional — the caller patches only what
// it wants to change. Reusing the create schema's `required` list forces the
// LLM to fabricate values for fields it doesn't intend to touch.
const segmentUpdateSchema = {
  ...segmentSchema,
  required: []
};

export const nonCommandTools = [
  {
    name: 'managedStreetCreate',
    description:
      'Create a new managed street with specified segments and properties',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the street configuration'
        },
        length: {
          type: 'string',
          description: 'Length of the street in meters (default: 60)'
        },
        position: {
          type: 'string',
          description:
            'Position as space-separated x y z values (e.g., "0 0 0")'
        },
        segments: {
          type: 'array',
          description: 'Array of segment definitions for the street',
          items: segmentSchema
        }
      },
      required: ['segments']
    },
    handler: managedStreetCreateHandler
  },
  {
    name: 'managedStreetUpdate',
    description:
      'Update segments in an existing managed street (use entityUpdate for updating street properties)',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the managed street entity to update'
        },
        operation: {
          type: 'string',
          description:
            'Operation to perform ("add-segment", "update-segment", "remove-segment")'
        },
        segmentIndex: {
          type: 'number',
          description:
            'Index of the segment to update or remove (for update-segment and remove-segment operations)'
        },
        segment: {
          ...segmentUpdateSchema,
          description:
            'Segment definition. For add-segment, "type" is required; other fields fall back to defaults if omitted. For update-segment, supply only the fields you want to change — omitted fields are left untouched.'
        }
      },
      required: ['entityId', 'operation']
    },
    handler: managedStreetUpdateHandler
  },
  {
    name: 'takeSnapshot',
    description:
      'Take a snapshot of the current camera view and include it in the chat',
    inputSchema: {
      type: 'object',
      properties: {
        caption: {
          type: 'string',
          description: 'Optional caption to display with the snapshot'
        },
        focusEntityId: {
          type: 'string',
          description:
            'Optional entity ID to focus on before taking the snapshot'
        },
        type: {
          type: 'string',
          description:
            'Optional type of snapshot view: "focus" (default), "birdseye", "straightOn", or "closeup"',
          enum: ['focus', 'birdseye', 'straightOn', 'closeup']
        }
      },
      required: []
    },
    handler: takeSnapshotHandler
  },
  {
    name: 'setLatLon',
    description:
      'Set the latitude and longitude for the scene, which will trigger elevation calculation',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Latitude in decimal degrees (e.g., 37.7637072)'
        },
        longitude: {
          type: 'number',
          description: 'Longitude in decimal degrees (e.g., -122.4151768)'
        }
      },
      required: ['latitude', 'longitude']
    },
    handler: setLatLonHandler
  }
];
