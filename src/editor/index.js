import { createRoot } from 'react-dom/client';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import MainWrapper from './components/MainWrapper';
import { AuthProvider, GeoProvider } from './contexts';
import Events from './lib/Events';
import { AssetsLoader } from './lib/assetsLoader';
import { initCameras } from './lib/cameras';
import { createEntity } from './lib/entity';
import { History } from './lib/history';
import { Shortcuts } from './lib/shortcuts';
import { Viewport } from './lib/viewport';
import { firebaseConfig } from './services/firebase.js';
import './style/index.scss';
import ReactGA from 'react-ga4';
import posthog from 'posthog-js';

function Inspector() {
  this.assetsLoader = new AssetsLoader();
  this.exporters = { gltf: new GLTFExporter() };
  this.history = new History();
  this.isFirstOpen = true;
  this.modules = {};
  this.on = Events.on;
  this.opened = false;

  // Wait for stuff.
  const doInit = () => {
    if (!AFRAME.scenes.length) {
      setTimeout(() => {
        doInit();
      }, 100);
      return;
    }

    this.sceneEl = AFRAME.scenes[0];
    if (this.sceneEl.hasLoaded) {
      this.init();
      return;
    }
    this.sceneEl.addEventListener('loaded', this.init.bind(this), {
      once: true
    });
  };
  doInit();
}

Inspector.prototype = {
  init: function () {
    // Wait for camera.
    if (!this.sceneEl.camera) {
      this.sceneEl.addEventListener(
        'camera-set-active',
        () => {
          this.init();
        },
        { once: true }
      );
      return;
    }

    this.container = document.querySelector('.a-canvas');
    initCameras(this);
    this.initUI();
  },

  initUI: function () {
    Shortcuts.init(this);
    this.initEvents();

    this.selected = null;

    // Init React.
    const div = document.createElement('div');
    div.id = 'aframeInspector';
    div.setAttribute('data-aframe-inspector', 'app');
    document.body.appendChild(div);
    const root = createRoot(div);
    root.render(
      <AuthProvider>
        <GeoProvider>
          <MainWrapper />
        </GeoProvider>
      </AuthProvider>
    );

    this.scene = this.sceneEl.object3D;
    this.helpers = {};
    this.sceneHelpers = new THREE.Scene();
    this.sceneHelpers.userData.source = 'INSPECTOR';
    this.sceneHelpers.visible = true;
    this.inspectorActive = false;
    this.debugUndoRedo = false;

    this.viewport = new Viewport(this);

    this.sceneEl.object3D.traverse((node) => {
      this.addHelper(node);
    });

    this.scene.add(this.sceneHelpers);
    this.open();
  },

  removeObject: function (object) {
    // Remove just the helper as the object will be deleted by A-Frame
    this.removeHelpers(object);
    Events.emit('objectremove', object);
  },

  addHelper: (function () {
    return function (object) {
      let helper;

      if (object instanceof THREE.Camera) {
        this.cameraHelper = helper = new THREE.CameraHelper(object);
      } else if (object instanceof THREE.PointLight) {
        helper = new THREE.PointLightHelper(object, 1);
      } else if (object instanceof THREE.DirectionalLight) {
        helper = new THREE.DirectionalLightHelper(object, 1);
      } else if (object instanceof THREE.SpotLight) {
        helper = new THREE.SpotLightHelper(object, 1);
      } else if (object instanceof THREE.HemisphereLight) {
        helper = new THREE.HemisphereLightHelper(object, 1);
      } else if (object instanceof THREE.SkinnedMesh) {
        helper = new THREE.SkeletonHelper(object);
      } else {
        // no helper for this object type
        return;
      }

      helper.visible = false;
      this.sceneHelpers.add(helper);
      this.helpers[object.uuid] = helper;
      // SkeletonHelper doesn't have an update method
      if (helper.update) {
        helper.update();
      }
    };
  })(),

  removeHelpers: function (object) {
    object.traverse((node) => {
      const helper = this.helpers[node.uuid];
      if (helper) {
        this.sceneHelpers.remove(helper);
        helper.dispose();
        delete this.helpers[node.uuid];
        Events.emit('helperremove', this.helpers[node.uuid]);
      }
    });
  },

  selectEntity: function (entity, emit) {
    this.selectedEntity = entity;
    if (entity) {
      this.select(entity.object3D);
    } else {
      this.select(null);
    }

    if (entity && emit === undefined) {
      Events.emit('entityselect', entity);
    }

    // Update helper visibilities.
    for (let id in this.helpers) {
      this.helpers[id].visible = false;
    }

    if (entity === this.sceneEl) {
      return;
    }

    if (entity) {
      entity.object3D.traverse((node) => {
        if (this.helpers[node.uuid]) {
          this.helpers[node.uuid].visible = true;
        }
      });
    }
  },

  initEvents: function () {
    window.addEventListener('keydown', (evt) => {
      // Alt + Ctrl + i: Shorcut to toggle the inspector
      var shortcutPressed =
        evt.keyCode === 73 &&
        ((evt.ctrlKey && evt.altKey) || evt.getModifierState('AltGraph'));
      if (shortcutPressed) {
        this.toggle();
      }
    });

    Events.on('entityselect', (entity) => {
      this.selectEntity(entity, false);
    });

    Events.on('hidecursor', () => {
      // Disable raycaster before pausing the cursor entity to properly clear the current intersection,
      // having back the move cursor and so we have the correct pointer cursor when we enable
      // it again and hover to the previous hovered entity.
      this.cursor.setAttribute('raycaster', 'enabled', false);
      this.cursor.pause();
      this.selectEntity(null);
    });
    Events.on('showcursor', () => {
      this.cursor.play();
      this.cursor.setAttribute('raycaster', 'enabled', true);
    });

    Events.on('inspectortoggle', (active) => {
      this.inspectorActive = active;
      this.sceneHelpers.visible = this.inspectorActive;
    });

    Events.on('entitycreate', (definition) => {
      createEntity(definition, (entity) => {
        this.selectEntity(entity);
      });
    });

    this.sceneEl.addEventListener('newScene', () => {
      this.history.clear();
    });

    document.addEventListener('child-detached', (event) => {
      var entity = event.detail.el;
      AFRAME.INSPECTOR.removeObject(entity.object3D);
    });
  },

  execute: function (cmd, optionalName) {
    this.history.execute(cmd, optionalName);
  },

  undo: function () {
    this.history.undo();
  },

  redo: function () {
    this.history.redo();
  },

  selectById: function (id) {
    if (id === this.camera.id) {
      this.select(this.camera);
      return;
    }
    this.select(this.scene.getObjectById(id, true));
  },

  /**
   * Change to select object.
   */
  select: function (object3D) {
    if (this.selected === object3D) {
      return;
    }
    this.selected = object3D;
    Events.emit('objectselect', object3D);
  },

  deselect: function () {
    this.select(null);
  },

  /**
   * Toggle the editor
   */
  toggle: function () {
    if (this.opened) {
      this.close();
    } else {
      this.open();
    }
  },
  /**
   * Prevent pause elements with data-no-pause attribute while open inspector
   */
  playNoPauseElements: function () {
    const noPauseElements = document.querySelectorAll(
      'a-entity[data-no-pause]'
    );
    noPauseElements.forEach((elem) => {
      elem.play();
    });
  },
  /**
   * Open the editor UI
   */
  open: function (focusEl) {
    this.opened = true;
    Events.emit('inspectortoggle', true);

    if (this.sceneEl.hasAttribute('embedded')) {
      // Remove embedded styles, but keep track of it.
      this.sceneEl.removeAttribute('embedded');
      this.sceneEl.setAttribute('aframe-inspector-removed-embedded');
    }

    document.body.classList.add('aframe-inspector-opened');
    this.sceneEl.resize();
    this.sceneEl.pause();
    this.sceneEl.exitVR();

    Shortcuts.enable();

    // Trick scene to run the cursor tick.
    this.sceneEl.isPlaying = true;
    this.cursor.play();

    // emit play event on elements with data-no-pause attribute
    this.playNoPauseElements();

    if (
      !focusEl &&
      this.isFirstOpen &&
      AFRAME.utils.getUrlParameter('inspector')
    ) {
      // Focus entity with URL parameter on first open.
      focusEl = document.getElementById(
        AFRAME.utils.getUrlParameter('inspector')
      );
    }
    if (focusEl) {
      this.selectEntity(focusEl);
      Events.emit('objectfocus', focusEl.object3D);
    }
    this.isFirstOpen = false;
  },

  /**
   * Closes the editor and gives the control back to the scene
   * @return {[type]} [description]
   */
  close: function () {
    this.opened = false;
    Events.emit('inspectortoggle', false);

    // Untrick scene when we enabled this to run the cursor tick.
    this.sceneEl.isPlaying = false;

    this.sceneEl.play();
    this.cursor.pause();

    if (this.sceneEl.hasAttribute('aframe-inspector-removed-embedded')) {
      this.sceneEl.setAttribute('embedded', '');
      this.sceneEl.removeAttribute('aframe-inspector-removed-embedded');
    }
    document.body.classList.remove('aframe-inspector-opened');
    this.sceneEl.resize();
    Shortcuts.disable();
    document.activeElement.blur();

    // quick solution to change 3d tiles camera
    const tilesElem = document.querySelector('a-entity[loader-3dtiles]');
    if (tilesElem) {
      tilesElem.emit('cameraChange', AFRAME.scenes[0].camera);
    }
  }
};

ReactGA.initialize(firebaseConfig.measurementId);
const inspector = (AFRAME.INSPECTOR = new Inspector());

posthog.init('phc_Yclai3qykyFi8AEFOrZsh6aS78SSooLzpDz9wQ9YAH9', {
  api_host: 'https://us.i.posthog.com',
  person_profiles: 'identified_only' // or 'always' to create profiles for anonymous users as well
});

export { inspector };
