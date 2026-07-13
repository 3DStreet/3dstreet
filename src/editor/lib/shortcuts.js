import Events from './Events';
import { removeSelectedEntity, cloneSelectedEntity } from './entity';
import {
  copySelectedEntity,
  cutSelectedEntity,
  pasteFromClipboard
} from './clipboard';
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

      if (document.activeElement.tagName !== 'INPUT') {
        // Let the browser handle a native text-selection copy (e.g. text
        // highlighted in a panel) instead of hijacking it for the entity.
        const hasTextSelection = !!window.getSelection()?.toString();

        // c: copy selected entity to clipboard
        if (
          event.keyCode === 67 &&
          AFRAME.INSPECTOR.selectedEntity &&
          !hasTextSelection
        ) {
          event.preventDefault();
          copySelectedEntity();
        }

        // x: cut selected entity (copy + undoable delete)
        if (
          event.keyCode === 88 &&
          AFRAME.INSPECTOR.selectedEntity &&
          !hasTextSelection
        ) {
          event.preventDefault();
          cutSelectedEntity();
        }

        // v: paste entity from clipboard
        if (event.keyCode === 86) {
          event.preventDefault();
          pasteFromClipboard();
        }
      }
    }

    // `: toggle panels visibility
    if (event.keyCode === 192) {
      useStore.getState().togglePanelsVisible();
      event.preventDefault();
      event.stopPropagation();
    }

    // p: enter the Viewer and start playing. Gated to non-input focus +
    // a registered playable capability in the scene (driveable vehicle,
    // playable managed-street, ...). Mirrors the toolbar Play button.
    if (
      event.keyCode === 80 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      document.activeElement.tagName !== 'INPUT' &&
      document.activeElement.tagName !== 'TEXTAREA'
    ) {
      const sceneEl = document.querySelector('a-scene');
      if (sceneEl?.systems?.['mode-manager']?.hasPlayable()) {
        useStore.getState().enterViewerMode('editor');
        sceneEl.systems['play-mode'].start();
        event.preventDefault();
        event.stopPropagation();
      }
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
