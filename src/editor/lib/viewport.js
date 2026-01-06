/* eslint-disable no-unused-vars */
import TransformControls from './TransformControls.js';
import EditorControls from './EditorControls.js';
import { MeasureLineControls } from './MeasureLineControls.js';
import InfiniteGridHelper from './InfiniteGridHelper.js';

import { copyCameraPosition } from './cameras';
import { initRaycaster } from './raycaster';
import Events from './Events';
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
const tempVector3Size = new THREE.Vector3();
const tempVector3Center = new THREE.Vector3();
const _box = new THREE.Box3();

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

    // Skip the position/rotation zeroing for splat entities as it interferes with
    // how Spark's SplatMesh handles matrix updates
    const isSplatEntity = this.object?.el?.hasAttribute('splat');

    if (this.object !== undefined && !isSplatEntity) {
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
      if (this.boxFill) {
        tempBox3.setFromObject(this.object);
        tempBox3.getSize(tempVector3Size);
        tempBox3.getCenter(tempVector3Center);
        this.boxFill.position.copy(tempVector3Center);
        this.boxFill.scale.copy(tempVector3Size);
      }
    }

    // super.update();
    // This is the super.update code with an additional _box.expandByPoint(this.object.position)
    // for a group of several models to include the group origin.
    if (this.object !== undefined) {
      // For splat entities, use the splat component's getBoundingBox method
      if (isSplatEntity) {
        const splatComponent = this.object.el.components['splat'];
        const splatBox = splatComponent?.getBoundingBox?.();
        if (splatBox) {
          _box.copy(splatBox);
          // Transform the box to world space
          _box.applyMatrix4(this.object.matrixWorld);
        } else {
          _box.setFromObject(this.object);
        }
      } else {
        _box.setFromObject(this.object);
        if (!this.object.el?.getObject3D('mesh')) {
          _box.expandByPoint(this.object.position);
        }
      }
    }

    if (_box.isEmpty()) return;

    const min = _box.min;
    const max = _box.max;

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
    // end of super.update();

    // Restore rotations (skip for splat entities since we didn't modify them).
    if (this.object !== undefined && !isSplatEntity) {
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
  const transformControls = new THREE.TransformControls(
    camera,
    inspector.container
  );
  transformControls.size = 0.75;

  const measureLineControls = new THREE.MeasureLineControls(
    camera,
    inspector.container
  );
  measureLineControls.visible = false;
  measureLineControls.enabled = true;

  // Function to switch between controls based on entity type
  const switchControls = (entity) => {
    if (!entity) {
      transformControls.detach();
      measureLineControls.detach();
      return;
    }

    const object = entity.object3D;
    if (entity.components['measure-line']) {
      transformControls.detach();
      measureLineControls.attach(entity);
    } else {
      measureLineControls.detach();
      transformControls.attach(object);
    }
  };

  transformControls.addEventListener('objectChange', (evt) => {
    const object = transformControls.object;
    if (object === undefined) {
      return;
    }

    selectionBox.setFromObject(object);

    updateHelpers(object);

    // Emit update event for watcher.
    let component;
    let value;
    if (evt.mode === 'translate') {
      component = 'position';
      value = `${object.position.x} ${object.position.y} ${object.position.z}`;
    } else if (evt.mode === 'rotate') {
      component = 'rotation';
      const d = THREE.MathUtils.radToDeg;
      value = `${d(object.rotation.x)} ${d(object.rotation.y)} ${d(
        object.rotation.z
      )}`;
    } else if (evt.mode === 'scale') {
      component = 'scale';
      value = `${object.scale.x} ${object.scale.y} ${object.scale.z}`;
    }

    inspector.execute('entityupdate', {
      component: component,
      entity: transformControls.object.el,
      value: value
    });
  });

  transformControls.addEventListener('mouseDown', () => {
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

  sceneHelpers.add(transformControls);
  sceneHelpers.add(measureLineControls);

  Events.on('entityupdate', (detail) => {
    const object = detail.entity.object3D;
    if (
      inspector.selected === object &&
      inspector.selectedEntity.object3DMap.mesh
    ) {
      selectionBox.setFromObject(inspector.selected);
      hoverBox.visible = false;
    }
  });

  // Controls need to be added *after* main logic.
  const controls = new THREE.EditorControls(camera, inspector.container);
  inspector.controls = controls; // used in ZoomButtons component
  controls.center.set(0, 1.6, 0);
  controls.rotationSpeed = 0.0035;
  controls.zoomSpeed = 0.05;
  controls.setAspectRatio(sceneEl.canvas.width / sceneEl.canvas.height);
  controls.addEventListener('change', () => {
    transformControls.update(true); // true is updateScale
    Events.emit('camerachanged');
  });

  sceneEl.addEventListener('newScene', (event) => {
    // Check if there's a snapshot camera state passed with the event
    const snapshotCameraState = event.detail?.snapshotCameraState;
    controls.newSceneCameraZoom(snapshotCameraState);
  });

  Events.on('cameratoggle', (data) => {
    controls.setCamera(data.camera);
    transformControls.setCamera(data.camera);
    measureLineControls.camera = data.camera;
    updateAspectRatio();
  });

  function disableControls() {
    mouseCursor.disable();
    transformControls.dispose();
    controls.enabled = false;
  }

  function enableControls() {
    mouseCursor.enable();
    transformControls.activate();
    controls.enabled = true;
  }
  enableControls();

  Events.on('inspectorcleared', () => {
    controls.center.set(0, 0, 0);
  });

  Events.on('transformmodechange', (mode) => {
    transformControls.setMode(mode);

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
      if (object.el.getObject3D('mesh')) {
        selectionBox.setFromObject(object);
        selectionBox.visible = true;
      } else if (object.el.hasAttribute('gltf-model')) {
        const listener = (event) => {
          if (event.target !== object.el) return; // we got an event for a child, ignore
          // Some models have a wrong bounding box if we don't wait a bit
          setTimeout(() => {
            selectionBox.setFromObject(object);
            selectionBox.visible = true;
          }, 20);
          object.el.removeEventListener('model-loaded', listener);
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

  Events.on('geometrychanged', (object) => {
    if (object !== null) {
      selectionBox.setFromObject(object);
    }
  });

  Events.on('entityupdate', (detail) => {
    const object = detail.entity.object3D;
    if (inspector.selected === object) {
      // Hack because object3D always has geometry :(
      if (
        object.geometry &&
        ((object.geometry.vertices && object.geometry.vertices.length > 0) ||
          (object.geometry.attributes &&
            object.geometry.attributes.position &&
            object.geometry.attributes.position.array.length))
      ) {
        selectionBox.setFromObject(object);
        hoverBox.visible = false;
      }
    }

    transformControls.update();
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

  useStore.subscribe(
    (state) => state.isInspectorEnabled,
    (isEnabled) => {
      if (isEnabled) {
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
      }
    }
  );
}
