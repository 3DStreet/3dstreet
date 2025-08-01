import Events from './Events';
import {
  removeSelectedEntity,
  cloneSelectedEntity,
  cloneEntity
} from './entity';
import { getOS } from './utils';
import useStore from '@/store';

const os = getOS();

function shouldCaptureKeyEvent(event) {
  return (
    event.target.closest('#cameraToolbar') ||
    (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA')
  );
}

export const Shortcuts = {
  enabled: false,
  shortcuts: {
    default: {},
    modules: {}
  },
  onKeyUp: function (event) {
    if (!shouldCaptureKeyEvent(event) || !AFRAME.INSPECTOR.opened) {
      return;
    }

    var keyCode = event.keyCode;

    // esc: unselect entity
    if (keyCode === 27) {
      if (this.inspector.selectedEntity) {
        this.inspector.selectEntity(null);
      }
    }

    // w: translate
    if (keyCode === 87) {
      Events.emit('transformmodechange', 'translate');
    }

    // e: rotate
    if (keyCode === 69) {
      Events.emit('transformmodechange', 'rotate');
    }

    // r: ruler
    if (keyCode === 82) {
      Events.emit('toolchange', 'ruler');
    }

    // h: hand
    if (keyCode === 72) {
      Events.emit('toolchange', 'hand');
    }

    // s: scale
    if (keyCode === 83) {
      Events.emit('transformmodechange', 'scale');
    }

    // o: transform space
    if (keyCode === 79) {
      Events.emit('transformspacechange');
    }

    // g: toggle grid
    if (keyCode === 71) {
      const { isGridVisible, setIsGridVisible } = useStore.getState();
      setIsGridVisible(!isGridVisible);
    }

    // 5: enter viewer mode
    if (keyCode === 53) {
      const { isInspectorEnabled, setIsInspectorEnabled } = useStore.getState();
      setIsInspectorEnabled(!isInspectorEnabled);
    }

    // F5: enter viewer mode
    if (keyCode === 116) {
      event.preventDefault(); // Prevent browser refresh
      const { isInspectorEnabled, setIsInspectorEnabled } = useStore.getState();
      setIsInspectorEnabled(!isInspectorEnabled);
    }

    // backspace & delete: remove selected entity
    if (keyCode === 8 || keyCode === 46) {
      removeSelectedEntity();
    }

    // d: clone selected entity
    if (keyCode === 68) {
      cloneSelectedEntity();
    }

    // f: Focus on selected entity.
    if (keyCode === 70) {
      const selectedEntity = AFRAME.INSPECTOR.selectedEntity;
      if (selectedEntity !== undefined && selectedEntity !== null) {
        Events.emit('objectfocus', selectedEntity.object3D);
      }
    }

    if (keyCode === 49) {
      Events.emit('cameraperspectivetoggle');
    } else if (keyCode === 50) {
      Events.emit('cameraorthographictoggle', 'left');
    } else if (keyCode === 51) {
      Events.emit('cameraorthographictoggle', 'right');
    } else if (keyCode === 52) {
      Events.emit('cameraorthographictoggle', 'top');
    } else if (keyCode === 54) {
      Events.emit('cameraorthographictoggle', 'back');
    } else if (keyCode === 55) {
      Events.emit('cameraorthographictoggle', 'front');
    }

    for (var moduleName in this.shortcuts.modules) {
      var shortcutsModule = this.shortcuts.modules[moduleName];
      if (
        shortcutsModule[keyCode] &&
        (!shortcutsModule[keyCode].mustBeActive ||
          (shortcutsModule[keyCode].mustBeActive &&
            AFRAME.INSPECTOR.modules[moduleName].active))
      ) {
        this.shortcuts.modules[moduleName][keyCode].callback();
      }
    }
  },
  onKeyDown: function (event) {
    if (!shouldCaptureKeyEvent(event) || !AFRAME.INSPECTOR.opened) {
      return;
    }

    if (
      (event.ctrlKey && os !== 'macos') ||
      (event.metaKey && os === 'macos')
    ) {
      // ctrl+z: undo
      // ctrl+shift+z: redo
      if (event.keyCode === 90) {
        event.preventDefault(); // Prevent browser specific hotkeys
        event.stopPropagation();
        if (event.shiftKey) {
          AFRAME.INSPECTOR.redo();
        } else {
          AFRAME.INSPECTOR.undo();
        }
      }

      if (
        AFRAME.INSPECTOR.selectedEntity &&
        document.activeElement.tagName !== 'INPUT'
      ) {
        // c: copy selected entity
        if (event.keyCode === 67) {
          AFRAME.INSPECTOR.entityToCopy = AFRAME.INSPECTOR.selectedEntity;
        }

        // v: paste copied entity
        if (event.keyCode === 86) {
          cloneEntity(AFRAME.INSPECTOR.entityToCopy);
        }
      }
    }

    // 0: toggle sidebars visibility
    if (event.keyCode === 48) {
      Events.emit('togglesidebar', { which: 'all' });
      event.preventDefault();
      event.stopPropagation();
    }
  },
  enable: function () {
    if (this.enabled) {
      this.disable();
    }

    window.addEventListener('keydown', this.onKeyDown, false);
    window.addEventListener('keyup', this.onKeyUp, false);
    this.enabled = true;
  },
  disable: function () {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.enabled = false;
  },
  checkModuleShortcutCollision: function (keyCode, moduleName, mustBeActive) {
    if (
      this.shortcuts.modules[moduleName] &&
      this.shortcuts.modules[moduleName][keyCode]
    ) {
      console.warn(
        'Keycode <%s> already registered as shortcut within the same module',
        keyCode
      );
    }
  },
  registerModuleShortcut: function (
    keyCode,
    callback,
    moduleName,
    mustBeActive
  ) {
    if (this.checkModuleShortcutCollision(keyCode, moduleName, mustBeActive)) {
      return;
    }

    if (!this.shortcuts.modules[moduleName]) {
      this.shortcuts.modules[moduleName] = {};
    }

    if (mustBeActive !== false) {
      mustBeActive = true;
    }

    this.shortcuts.modules[moduleName][keyCode] = {
      callback,
      mustBeActive
    };
  },
  init: function (inspector) {
    this.inspector = inspector;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }
};
