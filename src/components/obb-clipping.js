/* global AFRAME */

AFRAME.registerComponent('obb-clipping', {
  schema: {
    size: { default: 0 },
    clippingSourceSelectorString: {
      default: '[street]' // we use string instead of selector as the built-in a-frame selector doesn't support this syntax
    },
    clippingDestinationSelectorString: {
      // empty string means use the same element as the source
      type: 'string'
    },
    minimumColliderDimension: { default: 0.02 }
  },

  init: function () {
    this.tick = AFRAME.utils.throttleTick(this.tick, 250, this);

    this.previousScale = new THREE.Vector3();
    this.previousPosition = new THREE.Vector3();
    this.previousQuaternion = new THREE.Quaternion();
    this.auxEuler = new THREE.Euler();

    this.boundingBox = new THREE.Box3();
    this.boundingBoxSize = new THREE.Vector3();
    this.updateCollider = this.updateCollider.bind(this);

    this.onModelLoaded = this.onModelLoaded.bind(this);
    this.updateBoundingBox = this.updateBoundingBox.bind(this);

    this.el.addEventListener('model-loaded', this.onModelLoaded);
    this.checkTrackedObject();
    this.updateCollider();

    this.fetchElementToClip();

    // Enable local clipping in the renderer
    this.el.sceneEl.renderer.localClippingEnabled = true;
  },

  createPlanesFromOBB: (function () {
    var planeMeshes = [];
    var planeMatrix4 = new THREE.Matrix4();

    var planeNormals = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), // top
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1)
    ];

    const planePositions = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];

    return function (obb) {
      // Get the OBB's center, halfSize, and rotation matrix
      const obbCenter = obb.center;
      const obbHalfSize = obb.halfSize;
      const obbRotation = obb.rotation;

      var clipPlanes = [];
      // Initialize planes
      for (let i = 0; i < 6; i++) {
        clipPlanes.push(new THREE.Plane());
      }

      // Remove rendered planes if any. For testing purposes.
      for (var i = 0; i < planeMeshes.length; i++) {
        this.el.sceneEl.object3D.remove(planeMeshes[i]);
      }

      planePositions[0].set(obbHalfSize.x, 0, 0);
      planePositions[1].set(-obbHalfSize.x, 0, 0);
      planePositions[2].set(0, obbHalfSize.y, 0);
      planePositions[3].set(0, -obbHalfSize.y, 0);
      planePositions[4].set(0, 0, obbHalfSize.z);
      planePositions[5].set(0, 0, -obbHalfSize.z);

      for (let i = 0; i < planeNormals.length; i++) {
        // Rotate the direction vector
        const planeNormal = planeNormals[i];
        const planePosition = planePositions[i];
        clipPlanes[i].setFromNormalAndCoplanarPoint(planeNormal, planePosition);

        // Apply position and rotation of the bounding box to the plane.
        planeMatrix4.identity();

        // Copy the elements of Matrix3 into the upper-left 3x3 part of Matrix4
        planeMatrix4.elements[0] = obbRotation.elements[0];
        planeMatrix4.elements[1] = obbRotation.elements[1];
        planeMatrix4.elements[2] = obbRotation.elements[2];

        planeMatrix4.elements[4] = obbRotation.elements[3];
        planeMatrix4.elements[5] = obbRotation.elements[4];
        planeMatrix4.elements[6] = obbRotation.elements[5];

        planeMatrix4.elements[8] = obbRotation.elements[6];
        planeMatrix4.elements[9] = obbRotation.elements[7];
        planeMatrix4.elements[10] = obbRotation.elements[8];

        planeMatrix4.setPosition(obbCenter);
        clipPlanes[i].applyMatrix4(planeMatrix4);

        // Render planes. For testing purposes.
        // var planeColors = [
        //     0x009B48,
        //     0xB90000,
        //     0x0045AD,
        //     0xFF5900,
        //     0xffffff,
        //     0xFFD500,
        // ];
        // Align the geometry to the plane
        //         var coplanarPoint = new THREE.Vector3();
        //         clipPlanes[i].coplanarPoint(coplanarPoint);
        //         var focalPoint = new THREE.Vector3().copy(coplanarPoint).add(clipPlanes[i].normal);
        //         // Create a basic rectangle geometry
        //         var planeGeometry = new THREE.PlaneGeometry(5, 5);
        //         planeGeometry.lookAt(focalPoint);
        //         planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

        //         // Create mesh with the geometry
        //         var planeMaterial = new THREE.MeshBasicMaterial({side: THREE.DoubleSide, color: planeColors[i]});
        //         var dispPlane = new THREE.Mesh(planeGeometry, planeMaterial);
        //         planeMeshes.push(dispPlane);
        //         this.el.sceneEl.object3D.add(dispPlane);
      }
      return clipPlanes;
    };
  })(),

  fetchElementToClip: function () {
    if (this.data.clippingDestinationSelectorString) {
      // TODO: this route not tested
      this.elementToClip = document.querySelector(
        this.data.clippingDestinationSelectorString
      );
    } else {
      this.elementToClip = this.el;
    }
  },

  applyClippingPlanes: function (clipPlanes) {
    if (!this.elementToClip) {
      this.fetchElementToClip();
    }
    if (this.elementToClip) {
      this.elementToClip.object3D.traverse((obj) => {
        if (obj.type === 'Mesh') {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((material) => {
              material.clippingPlanes = clipPlanes;
              material.clipIntersection = true;
            });
          } else {
            obj.material.clippingPlanes = clipPlanes;
            obj.material.clipIntersection = true;
          }
        }
      });
    }
  },

  removeClippingPlanes: function () {
    this.elementToClip.object3D.traverse((obj) => {
      if (obj.type === 'Mesh') {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((material) => {
            material.clippingPlanes = null;
            material.clipIntersection = false;
          });
        } else {
          obj.material.clippingPlanes = null;
          obj.material.clipIntersection = false;
        }
      }
    });
  },

  remove: function () {
    this.removeClippingPlanes();
  },

  onModelLoaded: function () {
    this.updateCollider();
  },

  updateCollider: function () {
    var el = this.el;
    var boundingBoxSize = this.boundingBoxSize;
    var aabb = (this.aabb = this.aabb || new THREE.OBB());
    this.obb = this.obb || new THREE.OBB();

    // Defer if entity has not yet loaded.
    if (!el.hasLoaded) {
      el.addEventListener('loaded', this.updateCollider);
      return;
    }

    this.updateBoundingBox();
    aabb.halfSize.copy(boundingBoxSize).multiplyScalar(0.5);

    // if (this.el.sceneEl.systems['obb-collider2'].data.showColliders) { // TODO: Make this a component property instead
    //   this.showCollider();
    // }
  },

  showCollider: function () {
    this.updateColliderMesh();
    this.renderColliderMesh.visible = true;
  },

  updateColliderMesh: function () {
    var renderColliderMesh = this.renderColliderMesh;
    var boundingBoxSize = this.boundingBoxSize;
    if (!renderColliderMesh) {
      this.initColliderMesh();
      return;
    }

    // Destroy current geometry.
    renderColliderMesh.geometry.dispose();
    renderColliderMesh.geometry = new THREE.BoxGeometry(
      boundingBoxSize.x,
      boundingBoxSize.y,
      boundingBoxSize.z
    );
  },

  hideCollider: function () {
    if (!this.renderColliderMesh) {
      return;
    }
    this.renderColliderMesh.visible = false;
  },

  initColliderMesh: function () {
    var boundingBoxSize;
    var renderColliderGeometry;
    var renderColliderMesh;

    boundingBoxSize = this.boundingBoxSize;
    renderColliderGeometry = this.renderColliderGeometry =
      new THREE.BoxGeometry(
        boundingBoxSize.x,
        boundingBoxSize.y,
        boundingBoxSize.z
      );
    renderColliderMesh = this.renderColliderMesh = new THREE.Mesh(
      renderColliderGeometry,
      new THREE.MeshLambertMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
    );
    renderColliderMesh.matrixAutoUpdate = false;
    renderColliderMesh.matrixWorldAutoUpdate = false;
    // THREE scene forces matrix world update even if matrixWorldAutoUpdate set to false.
    renderColliderMesh.updateMatrixWorld = function () {
      /* no op */
    };
    this.el.sceneEl.object3D.add(renderColliderMesh);
  },

  updateBoundingBox: (function () {
    var auxPosition = new THREE.Vector3();
    var auxScale = new THREE.Vector3();
    var auxQuaternion = new THREE.Quaternion();
    var identityQuaternion = new THREE.Quaternion();
    var auxMatrix = new THREE.Matrix4();

    return function () {
      var auxEuler = this.auxEuler;
      var boundingBox = this.boundingBox;
      var size = this.data.size;
      var trackedObject3D = this.trackedObject3D;
      if (!trackedObject3D) {
        return;
      }
      var boundingBoxSize = this.boundingBoxSize;
      var minimumColliderDimension = this.data.minimumColliderDimension;

      // user defined size takes precedence.
      if (size) {
        this.boundingBoxSize.x = size;
        this.boundingBoxSize.y = size;
        this.boundingBoxSize.z = size;
        return;
      }

      // Bounding box is created axis-aligned AABB.
      // If there's any rotation the box will have the wrong size.
      // It undoes the local entity rotation and then restores so box has the expected size.
      // We also undo the parent world rotation.
      auxEuler.copy(trackedObject3D.rotation);
      trackedObject3D.rotation.set(0, 0, 0);

      trackedObject3D.parent.matrixWorld.decompose(
        auxPosition,
        auxQuaternion,
        auxScale
      );
      auxMatrix.compose(auxPosition, identityQuaternion, auxScale);
      trackedObject3D.parent.matrixWorld.copy(auxMatrix);

      // Calculate bounding box size.
      boundingBox.setFromObject(trackedObject3D, true);
      boundingBox.getSize(boundingBoxSize);

      // Enforce minimum dimensions.
      boundingBoxSize.x =
        boundingBoxSize.x < minimumColliderDimension
          ? minimumColliderDimension
          : boundingBoxSize.x;
      boundingBoxSize.y =
        boundingBoxSize.y < minimumColliderDimension
          ? minimumColliderDimension
          : boundingBoxSize.y;
      boundingBoxSize.z =
        boundingBoxSize.z < minimumColliderDimension
          ? minimumColliderDimension
          : boundingBoxSize.z;

      // Restore rotations.
      trackedObject3D.parent.matrixWorld.compose(
        auxPosition,
        auxQuaternion,
        auxScale
      );
      this.trackedObject3D.rotation.copy(auxEuler);
    };
  })(),

  checkTrackedObject: function () {
    var trackedElement = document.querySelector(
      this.data.clippingSourceSelectorString
    );
    if (trackedElement) {
      this.trackedObject3D = trackedElement.object3D;
      this.updateCollider();
    }
    // console.log('trackedElement', this.trackedObject3D);
    return this.trackedObject3D;
  },

  tick: (function () {
    var auxPosition = new THREE.Vector3();
    var auxScale = new THREE.Vector3();
    var auxQuaternion = new THREE.Quaternion();
    var auxMatrix = new THREE.Matrix4();

    return function () {
      var obb = this.obb;
      var renderColliderMesh = this.renderColliderMesh;
      var trackedObject3D = this.checkTrackedObject();

      if (!trackedObject3D) {
        return;
      }

      trackedObject3D.updateMatrix();
      trackedObject3D.updateMatrixWorld(true);
      trackedObject3D.matrixWorld.decompose(
        auxPosition,
        auxQuaternion,
        auxScale
      );

      // Recalculate collider if scale has changed.
      if (
        Math.abs(auxScale.x - this.previousScale.x) > 0.0001 ||
        Math.abs(auxScale.y - this.previousScale.y) > 0.0001 ||
        Math.abs(auxScale.z - this.previousScale.z) > 0.0001
      ) {
        this.updateCollider();
        this.applyClippingPlanes(this.createPlanesFromOBB(obb));
      }

      this.previousScale.copy(auxScale);

      // reset scale, keep position and rotation
      auxScale.set(1, 1, 1);
      auxMatrix.compose(auxPosition, auxQuaternion, auxScale);
      // Update OBB visual representation.
      if (renderColliderMesh) {
        renderColliderMesh.matrixWorld.copy(auxMatrix);
      }

      // Reset OBB with AABB and apply entity matrix. applyMatrix4 changes OBB internal state.
      obb.copy(this.aabb);
      obb.applyMatrix4(auxMatrix);

      // If new position or rotation then reapply planes
      if (
        !this.previousPosition.equals(auxPosition) ||
        !this.previousQuaternion.equals(auxQuaternion)
      ) {
        this.applyClippingPlanes(this.createPlanesFromOBB(obb));
      }
      this.previousPosition.copy(auxPosition);
      this.previousQuaternion.copy(auxQuaternion);
    };
  })()
});
