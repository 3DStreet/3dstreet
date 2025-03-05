import pickPointOnGroundPlane from '../../../lib/pick-point-on-ground-plane';
import { useState, useCallback } from 'react';

/**
 * Custom hook to manage rectangle ruler tool state and functionality
 */
export function useRectangleRulerTool(
  changeTransformMode,
  measureLineCounter,
  setMeasureLineCounter
) {
  const [rectangleRulerState, setRectangleRulerState] = useState({
    clickCount: 0,
    firstPoint: null,
    secondPoint: null
  });

  const handleRectangleRulerMouseUp = useCallback(
    (e) => {
      const previewMeasureLineEl = fetchOrCreatePreviewMeasureLineEntity();
      const mouseUpPosition = pickPointOnGroundPlane({
        x: e.clientX,
        y: e.clientY,
        canvas: AFRAME.scenes[0].canvas,
        camera: AFRAME.INSPECTOR.camera
      });

      // First click - set the first point
      if (rectangleRulerState.clickCount === 0) {
        previewMeasureLineEl.setAttribute('visible', true);
        setRectangleRulerState({
          clickCount: 1,
          firstPoint: mouseUpPosition,
          secondPoint: null
        });
        previewMeasureLineEl.setAttribute('measure-line', {
          start: mouseUpPosition,
          end: mouseUpPosition
        });
      } else if (rectangleRulerState.clickCount === 1) {
        // Second click - set the second point and continue showing preview
        setRectangleRulerState({
          clickCount: 2,
          firstPoint: rectangleRulerState.firstPoint,
          secondPoint: mouseUpPosition
        });

        // Create the first measure line
        AFRAME.INSPECTOR.execute('entitycreate', {
          components: {
            'data-layer-name': `Rectangle Line • ${measureLineCounter}`,
            'measure-line': {
              start: {
                x: rectangleRulerState.firstPoint.x,
                y: rectangleRulerState.firstPoint.y,
                z: rectangleRulerState.firstPoint.z
              },
              end: {
                x: mouseUpPosition.x,
                y: mouseUpPosition.y,
                z: mouseUpPosition.z
              }
            }
          }
        });

        // Reset preview line for the second side of rectangle
        previewMeasureLineEl.setAttribute('measure-line', {
          start: mouseUpPosition,
          end: mouseUpPosition
        });

        setMeasureLineCounter((prev) => prev + 1);
      } else if (rectangleRulerState.clickCount === 2) {
        // Third click - complete the rectangle
        previewMeasureLineEl.setAttribute('visible', false);

        // Get points for the rectangle
        const firstPoint = rectangleRulerState.firstPoint;
        const secondPoint = rectangleRulerState.secondPoint;

        // Use the raw mouse position for calculation, but not directly for the rectangle
        const rawMousePosition = mouseUpPosition;

        // Calculate the direction vector of the first line (from first to second point)
        const dx = secondPoint.x - firstPoint.x;
        const dz = secondPoint.z - firstPoint.z;
        const length = Math.sqrt(dx * dx + dz * dz);

        // Create a unit perpendicular vector to the first line (rotate 90 degrees)
        const perpX = -dz / length;
        const perpZ = dx / length;

        // Calculate the projection of the mouse position onto the perpendicular vector
        const mouseToSecondX = rawMousePosition.x - secondPoint.x;
        const mouseToSecondZ = rawMousePosition.z - secondPoint.z;

        // Project to get the width
        const width = mouseToSecondX * perpX + mouseToSecondZ * perpZ;

        // Calculate the ACTUAL third point (perpendicular to the line between points 1 and 2)
        const thirdPoint = {
          x: secondPoint.x + perpX * width,
          y: secondPoint.y,
          z: secondPoint.z + perpZ * width
        };

        // Calculate the fourth point to form a perfect rectangle
        const fourthPoint = {
          x: firstPoint.x + (thirdPoint.x - secondPoint.x),
          y: firstPoint.y,
          z: firstPoint.z + (thirdPoint.z - secondPoint.z)
        };

        // Create the remaining three sides of the rectangle
        // Second side (from second point to third point)
        AFRAME.INSPECTOR.execute('entitycreate', {
          components: {
            'data-layer-name': `Rectangle Line • ${measureLineCounter + 1}`,
            'measure-line': {
              start: {
                x: secondPoint.x,
                y: secondPoint.y,
                z: secondPoint.z
              },
              end: {
                x: thirdPoint.x,
                y: thirdPoint.y,
                z: thirdPoint.z
              }
            }
          }
        });

        // Third side (from third point to fourth point)
        AFRAME.INSPECTOR.execute('entitycreate', {
          components: {
            'data-layer-name': `Rectangle Line • ${measureLineCounter + 2}`,
            'measure-line': {
              start: {
                x: thirdPoint.x,
                y: thirdPoint.y,
                z: thirdPoint.z
              },
              end: {
                x: fourthPoint.x,
                y: fourthPoint.y,
                z: fourthPoint.z
              }
            }
          }
        });

        // Fourth side (from fourth point to first point)
        AFRAME.INSPECTOR.execute('entitycreate', {
          components: {
            'data-layer-name': `Rectangle Line • ${measureLineCounter + 3}`,
            'measure-line': {
              start: {
                x: fourthPoint.x,
                y: fourthPoint.y,
                z: fourthPoint.z
              },
              end: {
                x: firstPoint.x,
                y: firstPoint.y,
                z: firstPoint.z
              }
            }
          }
        });

        // Reset state and switch back to translate mode
        setRectangleRulerState({
          clickCount: 0,
          firstPoint: null,
          secondPoint: null
        });
        changeTransformMode('translate');
        setMeasureLineCounter((prev) => prev + 4);
      }
    },
    [
      rectangleRulerState,
      measureLineCounter,
      setMeasureLineCounter,
      changeTransformMode
    ]
  );

  const handleRectangleRulerMouseMove = useCallback(
    (e) => {
      let rulerCursorEntity = document.getElementById('rulerCursorEntity');
      const position = pickPointOnGroundPlane({
        x: e.clientX,
        y: e.clientY,
        canvas: AFRAME.scenes[0].canvas,
        camera: AFRAME.INSPECTOR.camera
      });

      if (rulerCursorEntity) {
        rulerCursorEntity.object3D.position.copy(position);
      }

      // Update preview line if we're in the process of creating a rectangle
      if (rectangleRulerState.clickCount > 0) {
        const previewMeasureLineEl =
          document.getElementById('previewMeasureLine');
        if (previewMeasureLineEl) {
          if (rectangleRulerState.clickCount === 2) {
            // After second click, we're modifying the width of the rectangle
            // Calculate the projection vector perpendicular to the first line
            const firstPoint = rectangleRulerState.firstPoint;
            const secondPoint = rectangleRulerState.secondPoint;

            // Calculate the direction vector of the first line
            const dx = secondPoint.x - firstPoint.x;
            const dz = secondPoint.z - firstPoint.z;
            const length = Math.sqrt(dx * dx + dz * dz);

            // Create a perpendicular vector (rotate 90 degrees)
            const perpX = -dz / length;
            const perpZ = dx / length;

            // Calculate the projected distance (width) based on cursor position
            const cursorToSecondX = position.x - secondPoint.x;
            const cursorToSecondZ = position.z - secondPoint.z;

            // Project the cursor-to-second-point vector onto the perpendicular vector
            // to get the magnitude of the projection (i.e., the width)
            const projectionMagnitude =
              cursorToSecondX * perpX + cursorToSecondZ * perpZ;

            // Calculate the third point position using the perpendicular vector
            const thirdPoint = {
              x: secondPoint.x + perpX * projectionMagnitude,
              y: secondPoint.y,
              z: secondPoint.z + perpZ * projectionMagnitude
            };

            // Update the preview line to show width
            previewMeasureLineEl.setAttribute('measure-line', {
              start: secondPoint,
              end: thirdPoint
            });
          } else {
            // For the first click, just update the end position of the line
            previewMeasureLineEl.setAttribute('measure-line', {
              end: position
            });
          }
        }
      }
    },
    [rectangleRulerState]
  );

  const handleEscapeKey = useCallback(
    (e) => {
      if (e.key === 'Escape' && rectangleRulerState.clickCount > 0) {
        const previewMeasureLineEl =
          document.getElementById('previewMeasureLine');
        if (previewMeasureLineEl) {
          previewMeasureLineEl.setAttribute('visible', false);
        }
        setRectangleRulerState({
          clickCount: 0,
          firstPoint: null,
          secondPoint: null
        });
      }
    },
    [rectangleRulerState]
  );

  const setupRectangleRulerListeners = useCallback(
    (isActive) => {
      const canvas = AFRAME.scenes[0].canvas;
      if (isActive) {
        canvas.addEventListener('mousemove', handleRectangleRulerMouseMove);
        canvas.addEventListener('mouseup', handleRectangleRulerMouseUp);
        window.addEventListener('keydown', handleEscapeKey);
        canvas.style.cursor = 'pointer';
        fadeInRulerCursorEntity();
      } else {
        canvas.removeEventListener('mousemove', handleRectangleRulerMouseMove);
        canvas.removeEventListener('mouseup', handleRectangleRulerMouseUp);
        window.removeEventListener('keydown', handleEscapeKey);
        fadeOutRulerCursorEntity();
      }
    },
    [
      handleRectangleRulerMouseMove,
      handleRectangleRulerMouseUp,
      handleEscapeKey
    ]
  );

  return {
    rectangleRulerState,
    handleRectangleRulerMouseUp,
    handleRectangleRulerMouseMove,
    handleEscapeKey,
    setupRectangleRulerListeners
  };
}

/**
 * Creates and shows the ruler cursor entity with animated rings
 */
export function fadeInRulerCursorEntity() {
  let rulerCursorEntity = document.getElementById('rulerCursorEntity');
  if (!rulerCursorEntity) {
    rulerCursorEntity = document.createElement('a-entity');
    rulerCursorEntity.setAttribute('id', 'rulerCursorEntity');
    rulerCursorEntity.classList.add('hideFromSceneGraph');
    rulerCursorEntity.innerHTML = `
        <a-ring class="hideFromSceneGraph" rotation="-90 0 0" material="depthTest: false" radius-inner="0.2" radius-outer="0.3">
          <a-ring class="hideFromSceneGraph" color="yellow" material="depthTest: false" radius-inner="0.4" radius-outer="0.5"
            animation="property: scale; from: 1 1 1; to: 2 2 2; loop: true; dir: alternate"></a-ring>
          <a-ring class="hideFromSceneGraph" color="yellow" material="depthTest: false" radius-inner="0.6" radius-outer="0.7"
            animation="property: scale; from: 1 1 1; to: 3 3 3; loop: true; dir: alternate"></a-ring>
          <a-entity class="hideFromSceneGraph" rotation="90 0 0">
            <a-cylinder class="hideFromSceneGraph" color="yellow" position="0 5.25 0" radius="0.05" height="2.5"></a-cylinder>
            <a-cone class="hideFromSceneGraph" color="yellow" position="0 4 0" radius-top="0.5" radius-bottom="0" height="1"></a-cone>
        </a-ring>`;
    AFRAME.scenes[0].appendChild(rulerCursorEntity);
  }
  rulerCursorEntity.setAttribute('visible', true);
}

/**
 * Hides the ruler cursor entity
 */
export function fadeOutRulerCursorEntity() {
  let rulerCursorEntity = document.getElementById('rulerCursorEntity');
  if (rulerCursorEntity) {
    rulerCursorEntity.setAttribute('visible', false);
  }
}

/**
 * Fetches or creates the preview measure line entity used for showing the ruler measurement
 * @returns {HTMLElement} The preview measure line entity
 */
function fetchOrCreatePreviewMeasureLineEntity() {
  let previewMeasureLineEl = document.getElementById('previewMeasureLine');
  if (previewMeasureLineEl) {
    return previewMeasureLineEl;
  }
  // create a new entity with the measure-line component with the same dimensions
  previewMeasureLineEl = document.createElement('a-entity');
  previewMeasureLineEl.setAttribute('id', 'previewMeasureLine');
  previewMeasureLineEl.setAttribute('measure-line', '');
  previewMeasureLineEl.classList.add('hideFromSceneGraph');

  AFRAME.scenes[0].appendChild(previewMeasureLineEl);
  return previewMeasureLineEl;
}
