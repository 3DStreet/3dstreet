import pickPointOnGroundPlane from '../../../lib/pick-point-on-ground-plane';
import { useState, useCallback } from 'react';

/**
 * Custom hook to manage ruler tool state and functionality
 */
export function useRulerTool(
  changeTransformMode,
  measureLineCounter,
  setMeasureLineCounter
) {
  const [hasRulerClicked, setHasRulerClicked] = useState(false);

  const handleRulerMouseUp = useCallback(
    (e) => {
      const previewMeasureLineEl = fetchOrCreatePreviewMeasureLineEntity();
      const mouseUpPosition = pickPointOnGroundPlane({
        x: e.clientX,
        y: e.clientY,
        canvas: AFRAME.scenes[0].canvas,
        camera: AFRAME.INSPECTOR.camera
      });

      if (!hasRulerClicked) {
        previewMeasureLineEl.setAttribute('visible', true);
        setHasRulerClicked(true);
        previewMeasureLineEl.setAttribute('measure-line', {
          start: mouseUpPosition,
          end: mouseUpPosition
        });
        // Update cursor to red for second point
        fadeInRulerCursorEntity(true);
      } else {
        previewMeasureLineEl.setAttribute('visible', false);
        const startPosition =
          previewMeasureLineEl.getAttribute('measure-line').start;
        setHasRulerClicked(false);

        AFRAME.INSPECTOR.execute('entitycreate', {
          components: {
            'data-layer-name': `Measure Line • ${measureLineCounter}`,
            'measure-line': {
              start: {
                x: startPosition.x,
                y: startPosition.y,
                z: startPosition.z
              },
              end: {
                x: mouseUpPosition.x,
                y: mouseUpPosition.y,
                z: mouseUpPosition.z
              }
            }
          }
        });
        changeTransformMode('translate');
        setMeasureLineCounter((prev) => prev + 1);
      }
    },
    [
      hasRulerClicked,
      measureLineCounter,
      setMeasureLineCounter,
      changeTransformMode
    ]
  );

  const handleRulerMouseMove = useCallback(
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
      if (hasRulerClicked) {
        const previewMeasureLineEl =
          document.getElementById('previewMeasureLine');
        if (previewMeasureLineEl) {
          previewMeasureLineEl.setAttribute('measure-line', { end: position });
        }
      }
    },
    [hasRulerClicked]
  );

  const handleEscapeKey = useCallback(
    (e) => {
      if (e.key === 'Escape' && hasRulerClicked) {
        const previewMeasureLineEl =
          document.getElementById('previewMeasureLine');
        if (previewMeasureLineEl) {
          previewMeasureLineEl.setAttribute('visible', false);
        }
        setHasRulerClicked(false);
        // Reset cursor to green for first point
        fadeInRulerCursorEntity(false);
      }
    },
    [hasRulerClicked]
  );

  const setupRulerListeners = useCallback(
    (isActive) => {
      const canvas = AFRAME.scenes[0].canvas;
      if (isActive) {
        canvas.addEventListener('mousemove', handleRulerMouseMove);
        canvas.addEventListener('mouseup', handleRulerMouseUp);
        window.addEventListener('keydown', handleEscapeKey);
        canvas.style.cursor = 'pointer';
        fadeInRulerCursorEntity(false); // Start with green
      } else {
        canvas.removeEventListener('mousemove', handleRulerMouseMove);
        canvas.removeEventListener('mouseup', handleRulerMouseUp);
        window.removeEventListener('keydown', handleEscapeKey);
        fadeOutRulerCursorEntity();
      }
    },
    [handleRulerMouseMove, handleRulerMouseUp, handleEscapeKey]
  );

  return {
    hasRulerClicked,
    handleRulerMouseUp,
    handleRulerMouseMove,
    handleEscapeKey,
    setupRulerListeners
  };
}

/**
 * Creates and shows the ruler cursor entity with animated rings
 */
export function fadeInRulerCursorEntity(isSecondPoint = false) {
  let rulerCursorEntity = document.getElementById('rulerCursorEntity');
  const color = isSecondPoint ? 'red' : 'green';

  if (!rulerCursorEntity) {
    rulerCursorEntity = document.createElement('a-entity');
    rulerCursorEntity.setAttribute('id', 'rulerCursorEntity');
    rulerCursorEntity.classList.add('hideFromSceneGraph');
    AFRAME.scenes[0].appendChild(rulerCursorEntity);
  }

  // Update the cursor color and content
  rulerCursorEntity.innerHTML = `
      <a-ring class="hideFromSceneGraph" rotation="-90 0 0" material="depthTest: false" radius-inner="0.2" radius-outer="0.3">
        <a-ring class="hideFromSceneGraph" color="${color}" material="depthTest: false" radius-inner="0.4" radius-outer="0.5"
          animation="property: scale; from: 1 1 1; to: 2 2 2; loop: true; dir: alternate"></a-ring>
        <a-ring class="hideFromSceneGraph" color="${color}" material="depthTest: false" radius-inner="0.6" radius-outer="0.7"
          animation="property: scale; from: 1 1 1; to: 3 3 3; loop: true; dir: alternate"></a-ring>
        <a-entity class="hideFromSceneGraph" rotation="90 0 0">
          <a-cylinder class="hideFromSceneGraph" color="${color}" position="0 5.25 0" radius="0.05" height="2.5"></a-cylinder>
          <a-cone class="hideFromSceneGraph" color="${color}" position="0 4 0" radius-top="0.5" radius-bottom="0" height="1"></a-cone>
      </a-ring>`;

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
