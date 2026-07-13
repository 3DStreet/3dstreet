import { TransformControls } from './TransformControls.js';
// eslint-disable-next-line no-unused-vars
import EditorControls from './EditorControls.js';
import { MeasureLineControls } from './MeasureLineControls.js';
import InfiniteGridHelper from './InfiniteGridHelper.js';

import { copyCameraPosition } from './cameras';
import { initRaycaster } from './raycaster';
import Events from './Events';
import { isBatched, syncBatchedSubtree } from '../../batch-models';
import useStore from '@/store';
// variables used by OrientedBoxHelper
const auxEuler = new THREE.Euler();
const auxPosition = new THREE.Vector3();
const auxLocalPosition = new THREE.Vector3();
const origin = new THREE.Vector3();
const auxScale = new THREE.Vector3();
const auxQuaternion = new THREE.Quaternion();
const identityQuaternion = new THREE.Quaternion();
const auxMatrix = new THREE.Matrix4();
const tempBox3 = new THREE.Box3();
const auxLocalBbox = new THREE.Box3();
const tempVector3Size = new THREE.Vector3();
const tempVector3Center = new THREE.Vector3();

class OrientedBoxHelper extends THREE.BoxHelper {
  constructor(object, color = 0xffff00, fill = false) {
    super(object, color);
    this.material.linewidth = 3;
    if (fill) {
      // Mesh with BoxGeometry and Semi-transparent Material
      const boxFillGeometry = new THREE.BoxGeometry(1, 1, 1);
      const boxFillMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        depthTest: false
      });
      const boxFill = new THREE.Mesh(boxFillGeometry, boxFillMaterial);
      this.boxFill = boxFill;
      this.add(boxFill);
    }
  }

  update() {
    // Bounding box is created axis-aligned AABB.
    // If there's any rotation the box will have the wrong size.
    // It undoes the local entity rotation and then restores so box has the expected size.
    // We also undo the parent world rotation.

    // tempBox3 is module-level and shared across all helper instances; reset it so
    // that if we skip both bbox branches below (e.g. a detached object with no
    // parent) we don't reuse the previous helper's box left over in it.
    tempBox3.makeEmpty();

    // Skip the position/rotation zeroing for splat entities as it interferes with
    // how Spark's SplatMesh handles matrix updates
    const isSplatEntity = this.object?.el?.hasAttribute('splat');

    // this.object.parent is null when the tracked object has been detached from
    // the scene graph (deleted/undo'd) while still hovered or selected; the
    // parent-relative rezeroing below would then throw on matrixWorld.
    const hasParent = this.object?.parent != null;

    if (this.object !== undefined && hasParent && !isSplatEntity) {
      auxEuler.copy(this.object.rotation);
      auxLocalPosition.copy(this.object.position);
      this.object.rotation.set(0, 0, 0);
      this.object.position.set(0, 0, 0);

      this.object.parent.matrixWorld.decompose(
        auxPosition,
        auxQuaternion,
        auxScale
      );
      auxMatrix.compose(origin, identityQuaternion, auxScale);
      this.object.parent.matrixWorld.copy(auxMatrix);
      tempBox3.setFromObject(this.object);

      // Batched entities have their original mesh tree stripped at batch time, so
      // setFromObject finds no geometry under them. batch-models stashes a per-entity-local
      // AABB — apply the entity's now-zeroed-rotation matrixWorld and union it in.
      const cachedBbox = this.object._batchLocalBbox;
      if (cachedBbox) {
        this.object.updateWorldMatrix(false, false);
        auxLocalBbox.copy(cachedBbox).applyMatrix4(this.object.matrixWorld);
        tempBox3.union(auxLocalBbox);
      }

      if (!this.object.el?.getObject3D('mesh') && !cachedBbox) {
        // For a group of several models to include the group origin.
        tempBox3.expandByPoint(this.object.position);
      }

      if (this.boxFill) {
        tempBox3.getSize(tempVector3Size);
        tempBox3.getCenter(tempVector3Center);
        this.boxFill.position.copy(tempVector3Center);
        this.boxFill.scale.copy(tempVector3Size);
      }
    } else if (this.object !== undefined && isSplatEntity) {
      const splatComponent = this.object.el.components['splat'];
      const splatBox = splatComponent?.getBoundingBox?.();
      if (splatBox) {
        tempBox3.copy(splatBox);
        // Transform the box to world space
        tempBox3.applyMatrix4(this.object.matrixWorld);
      } else {
        tempBox3.setFromObject(this.object);
      }
    }

    if (!tempBox3.isEmpty()) {
      const min = tempBox3.min;
      const max = tempBox3.max;

      const position = this.geometry.attributes.position;
      const array = position.array;

      array[0] = max.x;
      array[1] = max.y;
      array[2] = max.z;
      array[3] = min.x;
      array[4] = max.y;
      array[5] = max.z;
      array[6] = min.x;
      array[7] = min.y;
      array[8] = max.z;
      array[9] = max.x;
      array[10] = min.y;
      array[11] = max.z;
      array[12] = max.x;
      array[13] = max.y;
      array[14] = min.z;
      array[15] = min.x;
      array[16] = max.y;
      array[17] = min.z;
      array[18] = min.x;
      array[19] = min.y;
      array[20] = min.z;
      array[21] = max.x;
      array[22] = min.y;
      array[23] = min.z;

      position.needsUpdate = true;

      this.geometry.computeBoundingSphere();
    }

    // Restore rotations (skip for splat entities since we didn't modify them).
    if (this.object !== undefined && hasParent && !isSplatEntity) {
      this.object.parent.matrixWorld.compose(
        auxPosition,
        auxQuaternion,
        auxScale
      );
      this.object.rotation.copy(auxEuler);
      this.object.position.copy(auxLocalPosition);
    }

    // Update helper position for all objects
    if (this.object !== undefined) {
      this.object.getWorldQuaternion(this.quaternion);
      this.object.getWorldPosition(this.position);
      this.updateMatrix();
    }
  }

  dispose() {
    super.dispose();
    if (this.boxFill) {
      this.boxFill.geometry.dispose();
      this.boxFill.material.dispose();
    }
  }
}

/**
 * Transform controls stuff mostly.
 */
export function Viewport(inspector) {
  // Initialize raycaster and picking in differentpmodule.
  const mouseCursor = initRaycaster(inspector);
  const sceneEl = inspector.sceneEl;

  sceneEl.addEventListener('camera-set-active', (event) => {
    // If we're in edit mode, save the newly active camera and activate when exiting.
    if (inspector.opened) {
      inspector.cameras.original = event.detail.cameraEl;
    }
  });

  // Helpers.
  const sceneHelpers = inspector.sceneHelpers;
  const grid = new InfiniteGridHelper(1, 10, new THREE.Color(0xffffff), 500);
  grid.visible = true;
  sceneHelpers.add(grid);

  // Origin indicator with RGB axis cylinders
  const originIndicator = new THREE.Group();

  // Create cylinder geometry for axes (1m length, thin radius)
  const axisGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 8);

  // X-axis (red) - points in +X direction
  const xAxisMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  const xAxis = new THREE.Mesh(axisGeometry, xAxisMaterial);
  xAxis.rotation.z = -Math.PI / 2; // Rotate to point along X axis
  xAxis.position.x = 0.5; // Move half length to start at origin
  originIndicator.add(xAxis);

  // Y-axis (green) - points in +Y direction
  const yAxisMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  const yAxis = new THREE.Mesh(axisGeometry, yAxisMaterial);
  yAxis.position.y = 0.5; // Move half length to start at origin
  originIndicator.add(yAxis);

  // Z-axis (blue) - points in +Z direction
  const zAxisMaterial = new THREE.MeshBasicMaterial({
    color: 0x0000ff,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  const zAxis = new THREE.Mesh(axisGeometry, zAxisMaterial);
  zAxis.rotation.x = Math.PI / 2; // Rotate to point along Z axis
  zAxis.position.z = 0.5; // Move half length to start at origin
  originIndicator.add(zAxis);

  originIndicator.visible = true;
  sceneHelpers.add(originIndicator);

  const selectionBox = new OrientedBoxHelper(undefined, 0x1faaf2);
  selectionBox.material.depthTest = false;
  selectionBox.material.transparent = true;
  selectionBox.visible = false;
  sceneHelpers.add(selectionBox);

  // hoverBox BoxHelper version
  const hoverBox = new OrientedBoxHelper(undefined, 0xff0000, true);
  hoverBox.material.depthTest = false;
  hoverBox.material.transparent = true;
  hoverBox.visible = false;
  sceneHelpers.add(hoverBox);

  Events.on('raycastermouseenter', (el) => {
    // update hoverBox to match el.object3D bounding box
    if (el === inspector.selectedEntity) return;
    hoverBox.visible = true;
    hoverBox.setFromObject(el.object3D);
  });

  Events.on('raycastermouseleave', (el) => {
    hoverBox.visible = false;
  });

  function updateHelpers(object) {
    object.traverse((node) => {
      if (inspector.helpers[node.uuid] && inspector.helpers[node.uuid].update) {
        inspector.helpers[node.uuid].update();
      }
    });

    // Force an update of the measure line controls -- needed after undo/redo to update control points
    if (
      object.el &&
      object.el.components &&
      object.el.components['measure-line']
    ) {
      if (measureLineControls.object === object.el) {
        measureLineControls.update();
      }
    }
  }

  const camera = inspector.camera;
  const transformControls = new TransformControls(camera, inspector.container);
  transformControls.size = 0.75;

  const measureLineControls = new MeasureLineControls(
    camera,
    inspector.container
  );
  measureLineControls.visible = false;
  measureLineControls.enabled = true;

  // Pose snapshot taken on the gizmo's mouseDown, BEFORE TransformControls
  // mutates the object. The undo command can't capture this itself:
  // getAttribute('position') returns the live object3D values, which are
  // already post-mutation by the time objectChange fires (#1663).
  let transformPreDragValues = null;

  transformControls.addEventListener('objectChange', () => {
    const object = transformControls.object;
    if (object === undefined) {
      return;
    }

    const mode = transformControls.mode;

    // Trim to 3 decimals.
    if (mode === 'translate') {
      object.position.set(
        parseFloat(object.position.x.toFixed(3)),
        parseFloat(object.position.y.toFixed(3)),
        parseFloat(object.position.z.toFixed(3))
      );
    } else if (mode === 'rotate') {
      object.rotation.set(
        parseFloat(object.rotation.x.toFixed(3)),
        parseFloat(object.rotation.y.toFixed(3)),
        parseFloat(object.rotation.z.toFixed(3))
      );
    } else if (mode === 'scale') {
      object.scale.set(
        parseFloat(object.scale.x.toFixed(3)),
        parseFloat(object.scale.y.toFixed(3)),
        parseFloat(object.scale.z.toFixed(3))
      );
    }

    // The entityupdate command below fires componentchanged, which the scene-level
    // batch-models listener catches — but A-Frame throttles componentchanged to 200ms,
    // so during a continuous drag a batched-descendant slot would only catch up at
    // ~5Hz. Push the slot directly here for smooth per-frame updates.
    syncBatchedSubtree(object.el);

    selectionBox.setFromObject(object);

    updateHelpers(object);

    // Emit update event for watcher.
    let component;
    let value;
    if (mode === 'translate') {
      component = 'position';
      value = `${object.position.x} ${object.position.y} ${object.position.z}`;
    } else if (mode === 'rotate') {
      component = 'rotation';
      const d = THREE.MathUtils.radToDeg;
      value = `${d(object.rotation.x)} ${d(object.rotation.y)} ${d(
        object.rotation.z
      )}`;
    } else if (mode === 'scale') {
      component = 'scale';
      value = `${object.scale.x} ${object.scale.y} ${object.scale.z}`;
    }

    inspector.execute('entityupdate', {
      component: component,
      entity: transformControls.object.el,
      value: value,
      oldValue: transformPreDragValues?.[component]
    });
  });

  transformControls.addEventListener('mouseDown', () => {
    const object = transformControls.object;
    if (object) {
      const d = THREE.MathUtils.radToDeg;
      transformPreDragValues = {
        position: `${object.position.x} ${object.position.y} ${object.position.z}`,
        rotation: `${d(object.rotation.x)} ${d(object.rotation.y)} ${d(
          object.rotation.z
        )}`,
        scale: `${object.scale.x} ${object.scale.y} ${object.scale.z}`
      };
    }
    controls.enabled = false;
    hoverBox.visible = false; // if we start to move a group with a child hovered at the same time
  });

  transformControls.addEventListener('mouseUp', () => {
    controls.enabled = true;
  });

  measureLineControls.addEventListener('mouseDown', () => {
    controls.enabled = false;
  });

  measureLineControls.addEventListener('mouseUp', () => {
    controls.enabled = true;
  });

  measureLineControls.addEventListener('objectChange', (evt) => {
    if (!measureLineControls.object) return;

    const entity = measureLineControls.object;
    const measureLine = entity.components['measure-line'];
    if (!measureLine) return;

    // Update the measure-line component data
    const startPoint = measureLineControls.handles.start.position;
    const endPoint = measureLineControls.handles.end.position;

    // Instead of sending two separate updates, send a single update with both properties
    inspector.execute('entityupdate', {
      component: 'measure-line',
      entity: entity,
      value: {
        start: `${startPoint.x} ${startPoint.y} ${startPoint.z}`,
        end: `${endPoint.x} ${endPoint.y} ${endPoint.z}`
      }
    });
  });

  sceneHelpers.add(transformControls.getHelper());
  sceneHelpers.add(measureLineControls);

  Events.on('entityupdate', (detail) => {
    const object = detail.entity.object3D;
    if (inspector.selected === object) {
      selectionBox.setFromObject(inspector.selected);
      hoverBox.visible = false;
    }
  });

  // Controls need to be added *after* main logic.
  const controls = new THREE.EditorControls(camera, inspector.container);
  inspector.controls = controls; // used by ActionBar zoom/reset buttons
  controls.center.set(0, 1.6, 0);
  controls.rotationSpeed = 0.0035;
  controls.zoomSpeed = 0.05;
  controls.setAspectRatio(sceneEl.canvas.width / sceneEl.canvas.height);
  controls.addEventListener('change', () => {
    Events.emit('camerachanged');
  });

  sceneEl.addEventListener('newScene', (event) => {
    // Check if there's a snapshot camera state passed with the event
    const snapshotCameraState = event.detail?.snapshotCameraState;
    controls.newSceneCameraZoom(snapshotCameraState);
  });

  Events.on('cameratoggle', (data) => {
    controls.setCamera(data.camera);
    transformControls.camera = data.camera;
    measureLineControls.camera = data.camera;
    updateAspectRatio();
  });

  function disableControls() {
    mouseCursor.disable();
    transformControls.enabled = false;
    controls.enabled = false;
  }

  function enableControls() {
    mouseCursor.enable();
    transformControls.enabled = true;
    controls.enabled = true;
  }
  enableControls();

  Events.on('inspectorcleared', () => {
    controls.center.set(0, 0, 0);
  });

  Events.on('transformmodechange', (mode) => {
    transformControls.setMode(mode);
    // Restrict rotation to the Y axis only.
    if (mode === 'rotate') {
      transformControls.showX = false;
      transformControls.showY = true;
      transformControls.showZ = false;
    } else {
      transformControls.showX = true;
      transformControls.showY = true;
      transformControls.showZ = true;
    }

    // If there's a selected entity, reattach the appropriate controls
    if (
      inspector.selectedEntity &&
      inspector.cursor.isPlaying &&
      !inspector.selectedEntity.hasAttribute('data-no-transform')
    ) {
      if (inspector.selectedEntity.components['measure-line']) {
        transformControls.detach();
        measureLineControls.attach(inspector.selectedEntity);
      } else {
        measureLineControls.detach();
        transformControls.attach(inspector.selectedEntity.object3D);
      }
    }
  });

  Events.on('translationsnapchanged', (dist) => {
    transformControls.setTranslationSnap(dist);
  });

  Events.on('rotationsnapchanged', (dist) => {
    transformControls.setRotationSnap(dist);
  });

  Events.on('transformspacechanged', (space) => {
    transformControls.setSpace(space);
  });

  Events.on('objectselect', (object) => {
    hoverBox.visible = false;
    selectionBox.visible = false;
    transformControls.detach();
    measureLineControls.detach();

    if (object && object.el) {
      if (object.el.getObject3D('mesh') || isBatched(object.el)) {
        // Batched entities have no mesh tree but OrientedBoxHelper falls back to the
        // cached _batchLocalBbox, so we can size the selection immediately.
        selectionBox.setFromObject(object);
        selectionBox.visible = true;
      } else if (object.el.hasAttribute('gltf-model')) {
        const listener = (event) => {
          if (event.target !== object.el) return; // we got an event for a child, ignore
          object.el.removeEventListener('model-loaded', listener);
          // Some models have a wrong bounding box if we don't wait a bit
          setTimeout(() => {
            if (object.parent === null) return; // entity was detached before timeout fired
            selectionBox.setFromObject(object);
            selectionBox.visible = true;
          }, 20);
        };
        object.el.addEventListener('model-loaded', listener);
      } else if (!object.el.isScene && object.el.id !== 'street-container') {
        selectionBox.setFromObject(object);
        selectionBox.visible = true;
      }

      if (
        inspector.cursor.isPlaying &&
        !object.el.hasAttribute('data-no-transform')
      ) {
        if (object.el.components['measure-line']) {
          measureLineControls.attach(object.el);
        } else {
          transformControls.attach(object);
        }
      }
    }
  });

  Events.on('objectfocus', (object) => {
    controls.focus(object);
  });

  // Restore the camera to a snapshot's captured pose (#1605).
  Events.on('cameraposefocus', (cameraState) => {
    controls.focusCameraState(cameraState);
  });

  Events.on('geometrychanged', (object) => {
    if (object !== null) {
      selectionBox.setFromObject(object);
    }
  });

  Events.on('entityupdate', (detail) => {
    const object = detail.entity.object3D;
    if (object instanceof THREE.PerspectiveCamera) {
      object.updateProjectionMatrix();
    }

    updateHelpers(object);
  });

  function updateAspectRatio() {
    if (!inspector.opened) return;
    // Modifying aspect for perspective camera is done by aframe a-scene.resize function
    // when the perspective camera is the active camera, so we actually do it a second time here,
    // but we need to modify it ourself when we switch from ortho camera to perspective camera (updateAspectRatio() is called in cameratoggle handler).
    const camera = inspector.camera;
    const aspect =
      inspector.container.offsetWidth / inspector.container.offsetHeight;
    if (camera.isPerspectiveCamera) {
      camera.aspect = aspect;
    } else if (camera.isOrthographicCamera) {
      const frustumSize = camera.top - camera.bottom;
      camera.left = (-frustumSize * aspect) / 2;
      camera.right = (frustumSize * aspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
    }

    controls.setAspectRatio(aspect); // for zoom in/out to work correctly for orthographic camera
    camera.updateProjectionMatrix();

    const cameraHelper = inspector.helpers[camera.uuid];
    if (cameraHelper) cameraHelper.update();
  }

  inspector.sceneEl.addEventListener('rendererresize', updateAspectRatio);

  Events.on('gridvisibilitychanged', (showGrid) => {
    grid.visible = showGrid;
    originIndicator.visible = showGrid;
  });

  Events.on('togglegrid', () => {
    grid.visible = !grid.visible;
    originIndicator.visible = grid.visible;
  });

  // Current editor camera pose in the cameraState shape used by saved
  // vantages, so the Viewer can pick up exactly where the editor camera
  // was looking (the WYSIWYG View/Play handoff).
  function getEditorCameraPose() {
    const cam = inspector.camera;
    if (!cam) return null;
    cam.updateMatrixWorld();
    const position = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const euler = new THREE.Euler().setFromRotationMatrix(
      cam.matrixWorld,
      'YXZ'
    );
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
      rotationOrder: 'YXZ',
      zoom: cam.isPerspectiveCamera ? cam.fov : 60
    };
  }

  useStore.subscribe(
    (state) => state.isInspectorEnabled,
    (isEnabled) => {
      const modeManager = AFRAME.scenes[0].systems['mode-manager'];
      if (isEnabled) {
        modeManager?.setMode('editor');
        enableControls();
        AFRAME.scenes[0].camera = inspector.camera;
        Array.prototype.slice
          .call(document.querySelectorAll('.a-enter-vr,.rs-base'))
          .forEach((element) => {
            element.style.display = 'none';
          });
        if (inspector.config.copyCameraPosition) {
          copyCameraPosition(
            inspector.cameras.original.object3D,
            inspector.cameras.perspective,
            controls
          );
        }
      } else {
        disableControls();
        inspector.cameras.original.setAttribute('camera', 'active', 'true');
        AFRAME.scenes[0].camera =
          inspector.cameras.original.getObject3D('camera');
        Array.prototype.slice
          .call(document.querySelectorAll('.a-enter-vr,.rs-base'))
          .forEach((element) => {
            element.style.display = 'block';
          });
        // Hand the scene over to the Viewer's locomotion mode at the
        // requested vantage: the scene's saved start view when arriving
        // without an editing session, otherwise the current editor
        // camera pose so entering the Viewer doesn't jump the view.
        if (modeManager) {
          const vantage =
            useStore.getState().viewerVantage === 'saved'
              ? AFRAME.scenes[0].viewerVantageCameraState ||
                getEditorCameraPose()
              : getEditorCameraPose();
          modeManager.setMode('locomotion');
          if (vantage) modeManager.applyViewerVantage(vantage);
        }
      }
    }
  );
}
