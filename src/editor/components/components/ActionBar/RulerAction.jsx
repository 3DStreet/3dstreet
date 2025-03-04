/**
 * Functions for managing the ruler cursor entity in the 3D scene
 */

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
