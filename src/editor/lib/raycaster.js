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

  mouseCursor.addEventListener('click', handleClick);
  mouseCursor.addEventListener('mouseenter', onMouseEnter);
  mouseCursor.addEventListener('mouseleave', onMouseLeave);
  inspector.container.addEventListener('mousedown', onMouseDown);
  inspector.container.addEventListener('mouseup', onMouseUp);

  inspector.sceneEl.canvas.addEventListener('mouseleave', () => {
    setTimeout(() => {
      Events.emit('raycastermouseleave', null);
    });
  });

  const onDownPosition = new THREE.Vector2();
  const onUpPosition = new THREE.Vector2();

  function onMouseEnter() {
    Events.emit(
      'raycastermouseenter',
      mouseCursor.components.cursor.intersectedEl
    );
  }

  function onMouseLeave() {
    Events.emit(
      'raycastermouseleave',
      mouseCursor.components.cursor.intersectedEl
    );
  }

  function handleClick(evt) {
    // Check to make sure not dragging.
    if (onDownPosition.distanceTo(onUpPosition) === 0) {
      inspector.selectEntity(evt.detail.intersectedEl);
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

  return {
    el: mouseCursor,
    enable: () => {
      mouseCursor.setAttribute('raycaster', 'enabled', true);
      inspector.container.addEventListener('mousedown', onMouseDown);
      inspector.container.addEventListener('mouseup', onMouseUp);
    },
    disable: () => {
      mouseCursor.setAttribute('raycaster', 'enabled', false);
      inspector.container.removeEventListener('mousedown', onMouseDown);
      inspector.container.removeEventListener('mouseup', onMouseUp);
    }
  };
}

function getMousePosition(dom, x, y) {
  const rect = dom.getBoundingClientRect();
  return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
}
