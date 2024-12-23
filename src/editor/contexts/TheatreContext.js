import { createContext, useContext, useEffect, useState } from 'react';
import { getProject } from '@theatre/core';
import studio from '@theatre/studio';

export const TheatreContext = createContext();

export function useTheatre() {
  return useContext(TheatreContext);
}

export function TheatreProvider({ children }) {
  const [project, setProject] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [controlledEntities, setControlledEntities] = useState(new Set());

  useEffect(() => {
    // Initialize Theatre.js
    studio.initialize();

    // Create a project
    const proj = getProject('3DStreet Animation');
    const mainSheet = proj.sheet('Main Sheet');

    setProject(proj);
    setSheet(mainSheet);

    console.log('[theatre] project', proj);
    console.log('[theatre] sheet', mainSheet);

    return () => {
      // Cleanup if needed
    };
  }, []);

  const createValidObjectId = (entity) => {
    // Get entity name or mixin as base
    const baseName =
      entity.getDOMAttribute('data-layer-name') ||
      entity.getDOMAttribute('mixin') ||
      'unnamed';

    // Clean up the name to be valid for Theatre.js
    const cleanName = baseName
      .replace(/[^a-zA-Z0-9]/g, '_') // Replace non-alphanumeric with underscore
      .replace(/^[^a-zA-Z]/, 'obj_$&') // Ensure starts with letter
      .replace(/_{2,}/g, '_'); // Remove duplicate underscores

    // Add a unique suffix using timestamp
    const uniqueName = `${cleanName}_${Date.now()}`;

    console.log(
      '[theatre] Created object ID:',
      uniqueName,
      'for entity:',
      entity
    );
    return uniqueName;
  };

  const addEntityToTheatre = (entity) => {
    if (!sheet || !entity) {
      console.warn('[theatre] Cannot add entity - sheet or entity missing', {
        sheet,
        entity
      });
      return;
    }

    if (controlledEntities.has(entity.id)) {
      console.log('[theatre] Entity already controlled:', entity.id);
      return;
    }

    console.log('[theatre] Adding entity to control:', entity);

    // Generate valid object ID
    const objectId = createValidObjectId(entity);

    try {
      // Get current transform values
      const position = entity.object3D.position;
      const rotation = entity.object3D.rotation;
      const material = entity.getAttribute('material');

      // Create a new object for the entity
      const entityObj = sheet.object(objectId, {
        position: {
          x: position.x,
          y: position.y,
          z: position.z
        },
        rotation: {
          x: rotation.x,
          y: rotation.y,
          z: rotation.z
        },
        ...(material ? { opacity: material.opacity || 1 } : {})
      });

      console.log('[theatre] Created object:', objectId, entityObj);

      // Subscribe to changes
      entityObj.onValuesChange((values) => {
        const { position, rotation, opacity } = values;

        // Update position
        if (position) {
          entity.object3D.position.set(position.x, position.y, position.z);
        }

        // Update rotation
        if (rotation) {
          entity.object3D.rotation.set(rotation.x, rotation.y, rotation.z);
        }

        // Update opacity if material exists
        if (opacity !== undefined && entity.getAttribute('material')) {
          entity.setAttribute('material', 'opacity', opacity);
        }
      });

      // Add to controlled entities set
      setControlledEntities((prev) => new Set(prev).add(entity.id));

      console.log('[theatre] Successfully added entity to control');
    } catch (error) {
      console.error('[theatre] Error adding entity to control:', error);
    }
  };

  const removeEntityFromTheatre = (entityId) => {
    if (!sheet || !controlledEntities.has(entityId)) return;

    // Remove object from sheet
    setControlledEntities((prev) => {
      const next = new Set(prev);
      next.delete(entityId);
      return next;
    });
  };

  return (
    <TheatreContext.Provider
      value={{
        project,
        sheet,
        controlledEntities,
        addEntityToTheatre,
        removeEntityFromTheatre
      }}
    >
      {children}
    </TheatreContext.Provider>
  );
}
