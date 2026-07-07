import Events from './Events';

export function initRaycaster(inspector) {
  // Use cursor="rayOrigin: mouse".
  const mouseCursor = document.createElement('a-entity');
  mouseCursor.setAttribute('id', 'aframeInspectorMouseCursor');
  mouseCursor.setAttribute('raycaster', {
    interval: 100,
    objects:
      'a-scene :not([data-aframe-inspector]):not([data-ignore-raycaster])'
  });
  mouseCursor.setAttribute('cursor', 'rayOrigin', 'mouse');
  mouseCursor.setAttribute('data-aframe-inspector', 'true');

  // Only visible objects.
  const raycaster = mouseCursor.components.raycaster;
  const refreshObjects = raycaster.refreshObjects;
  const overrideRefresh = () => {
    refreshObjects.call(raycaster);
    const objects = raycaster.objects;
    raycaster.objects = objects.filter((node) => {
      while (node) {
        if (!node.visible) {
          return false;
        }
        node = node.parent;
      }
      return true;
    });
  };
  raycaster.refreshObjects = overrideRefresh;

  inspector.sceneEl.appendChild(mouseCursor);
  inspector.cursor = mouseCursor;

  function getBatchedIntersectedEl() {
    // BatchedMeshes are hosted on a dedicated batch-models-root a-entity via setObject3D,
    // so A-Frame's raycaster keeps the intersection (it has .el). The closest intersection
    // may be a BatchedMesh — remap it to the real entity via _batchIdToEl[batchId].
    const intersections = mouseCursor.components.raycaster.intersections;
    if (!intersections || intersections.length === 0) return undefined;
    const closest = intersections[0];
    if (!closest.object?.isBatchedMesh) return undefined;
    const map = closest.object._batchIdToEl;
    return map ? map[closest.batchId] || null : null;
  }

  function getIntersectedEl() {
    const batched = getBatchedIntersectedEl();
    let intersectedEl =
      batched !== undefined
        ? batched
        : mouseCursor.components.cursor.intersectedEl;
    // The user needs to click on the street-segment first to then select a car or pedestrian.
    if (
      intersectedEl !== null &&
      intersectedEl.parentElement?.hasAttribute('street-segment')
    ) {
      // If the street-segment is already selected, return the intersected el.
      // If a child of the same street-segment is already selected, return the intersected el.
      if (
        inspector.selectedEntity === intersectedEl.parentElement ||
        inspector.selectedEntity?.parentElement === intersectedEl.parentElement
      ) {
        return intersectedEl;
      }
      // Otherwise, return the street-segment.
      return intersectedEl.parentElement;
    }
    return intersectedEl;
  }

  // Poll the raycaster's closest intersection each check and fire hover events when the
  // RESOLVED entity changes. Cursor-based mouseenter/mouseleave compare `el` references
  // and miss transitions within a BatchedMesh (both hits have the same batchRootEl).
  let lastHoveredEl = null;
  const origCheckIntersections = raycaster.checkIntersections.bind(raycaster);
  raycaster.checkIntersections = function () {
    origCheckIntersections();
    const resolved = getIntersectedEl();
    if (resolved !== lastHoveredEl) {
      if (lastHoveredEl) Events.emit('raycastermouseleave', lastHoveredEl);
      if (resolved) Events.emit('raycastermouseenter', resolved);
      lastHoveredEl = resolved;
    }
  };

  mouseCursor.addEventListener('click', handleClick);
  inspector.container.addEventListener('mousedown', onMouseDown);
  inspector.container.addEventListener('mouseup', onMouseUp);
  inspector.container.addEventListener('dblclick', onDoubleClick);

  inspector.sceneEl.canvas.addEventListener('mouseleave', () => {
    setTimeout(() => {
      Events.emit('raycastermouseleave', null);
    });
  });

  const onDownPosition = new THREE.Vector2();
  const onUpPosition = new THREE.Vector2();

  function handleClick(evt) {
    // Check to make sure not dragging.
    if (onDownPosition.distanceTo(onUpPosition) === 0) {
      inspector.selectEntity(getIntersectedEl());
      // Force the cursor component to trigger again an intersection to show hover box on the original intersected el inside the street-segment.
      mouseCursor.components.cursor.clearCurrentIntersection(false);
    }
  }

  function onMouseDown(event) {
    if (event instanceof CustomEvent) {
      return;
    }
    event.preventDefault();
    const array = getMousePosition(
      inspector.container,
      event.clientX,
      event.clientY
    );
    onDownPosition.fromArray(array);
  }

  function onMouseUp(event) {
    if (event instanceof CustomEvent) {
      return;
    }
    event.preventDefault();
    const array = getMousePosition(
      inspector.container,
      event.clientX,
      event.clientY
    );
    onUpPosition.fromArray(array);
  }

  /**
   * Focus on double click.
   */
  function onDoubleClick(event) {
    const intersectedEl = getIntersectedEl();
    if (!intersectedEl) {
      return;
    }
    Events.emit('objectfocus', intersectedEl.object3D);
  }

  return {
    el: mouseCursor,
    enable: () => {
      mouseCursor.setAttribute('raycaster', 'enabled', true);
      inspector.container.addEventListener('mousedown', onMouseDown);
      inspector.container.addEventListener('mouseup', onMouseUp);
      inspector.container.addEventListener('dblclick', onDoubleClick);
    },
    disable: () => {
      mouseCursor.setAttribute('raycaster', 'enabled', false);
      inspector.container.removeEventListener('mousedown', onMouseDown);
      inspector.container.removeEventListener('mouseup', onMouseUp);
      inspector.container.removeEventListener('dblclick', onDoubleClick);
    }
  };
}

function getMousePosition(dom, x, y) {
  const rect = dom.getBoundingClientRect();
  return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
}
