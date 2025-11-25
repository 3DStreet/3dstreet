import './instrument';
import '../styles/tailwind.css';
import { createRoot } from 'react-dom/client';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import MainWrapper from './components/MainWrapper';
import { ARControls, VisibilityToggle } from './components/viewport/ARControls';
import { AuthProvider, GeoProvider } from './contexts';
import Events from './lib/Events';
import { AssetsLoader } from './lib/assetsLoader';
import { initCameras } from './lib/cameras';
import { Config } from './lib/config';
import { History } from './lib/history';
import { Shortcuts } from './lib/shortcuts';
import { Viewport } from './lib/viewport';
import './style/index.scss';
import posthog from 'posthog-js';
import { commandsByType } from './lib/commands/index.js';
import useStore from '@/store';
import { initializeLocationSync } from './lib/location-sync';
import { Gallery, galleryServiceV2, galleryMigration } from '@shared/gallery';
import { auth } from '@shared/services/firebase';

// Helper function to check if viewer mode is requested via URL parameter
function isViewerModeRequested() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('viewer') === 'true';
}

function Inspector(configOverrides) {
  this.assetsLoader = new AssetsLoader();
  this.exporters = { gltf: new GLTFExporter() };
  this.config = new Config(configOverrides);
  this.history = new History();
  this.isFirstOpen = true;
  this.modules = {};
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

    // Initialize location sync
    initializeLocationSync();

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

    // Mount AR Controls to the AR overlay div
    const arControlsContainer = document.getElementById('react-ar-controls');
    if (arControlsContainer) {
      const arRoot = createRoot(arControlsContainer);
      arRoot.render(<ARControls />);
    }

    // Mount Visibility Toggle to the AR overlay div
    const visibilityToggleContainer = document.getElementById(
      'react-visibility-toggle'
    );
    if (visibilityToggleContainer) {
      const visibilityRoot = createRoot(visibilityToggleContainer);
      visibilityRoot.render(<VisibilityToggle />);
    }

    // Mount Gallery component
    this.mountGallery();

    this.scene = this.sceneEl.object3D;
    this.helpers = {};
    this.sceneHelpers = new THREE.Scene();
    this.sceneHelpers.userData.source = 'INSPECTOR';

    this.viewport = new Viewport(this);

    this.sceneEl.object3D.traverse((node) => {
      this.addHelper(node);
    });

    this.scene.add(this.sceneHelpers);
    this.open();

    // If viewer mode is requested, switch to it after initialization is complete
    if (isViewerModeRequested()) {
      useStore.getState().setIsInspectorEnabled(false);
    }
  },

  mountGallery: function () {
    // Initialize gallery service V2 with migration support
    const initGalleryWithMigration = async () => {
      try {
        // Initialize V2 service
        await galleryServiceV2.init();
        console.log('Editor gallery service V2 initialized');

        // Check for migration if user is authenticated
        const handleAuthChange = async () => {
          const user = auth.currentUser;
          if (user) {
            const needsMigration = await galleryMigration.isMigrationNeeded(
              user.uid
            );
            if (needsMigration) {
              console.log(
                'Gallery migration needed for editor user. User can migrate from the gallery UI.'
              );
              // The migration UI is handled by the Gallery component itself
            }
          }
        };

        // Check migration now
        await handleAuthChange();

        // Listen for auth changes
        auth.onAuthStateChanged(handleAuthChange);
      } catch (error) {
        console.error('Failed to initialize gallery:', error);
      }
    };

    initGalleryWithMigration();

    // Create mount point for gallery
    const galleryRoot = document.createElement('div');
    galleryRoot.id = 'editor-gallery-root';
    document.body.appendChild(galleryRoot);

    // Gallery action handlers
    const handleCopyParams = (item) => {
      if (!item.metadata) {
        console.log('No parameters available for this image');
        return;
      }
      const params = JSON.stringify(item.metadata, null, 2);
      navigator.clipboard
        .writeText(params)
        .then(() => console.log('Parameters copied to clipboard!'))
        .catch((err) => console.error('Failed to copy parameters:', err));
    };

    const handleCopyImage = (item) => {
      if (!item.imageDataBlob || !(item.imageDataBlob instanceof Blob)) {
        console.log('Image data is not available for copying.');
        return;
      }

      try {
        const clipboardItem = new ClipboardItem({
          [item.imageDataBlob.type || 'image/png']: item.imageDataBlob
        });
        navigator.clipboard
          .write([clipboardItem])
          .then(() => console.log('Image copied to clipboard!'))
          .catch((err) => {
            console.error('Clipboard API error:', err);
            console.log(
              'Failed to copy image. Your browser might not support this feature.'
            );
          });
      } catch (error) {
        console.error('Error using ClipboardItem:', error);
        console.log(
          'Failed to copy image. Your browser might not support this feature.'
        );
      }
    };

    // Handlers for opening generator app with gallery items
    const openGeneratorWithItem = async (item, tabName) => {
      try {
        // Convert blob to data URL for cross-app communication
        let dataUrl;
        if (item.imageDataBlob instanceof Blob) {
          dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(item.imageDataBlob);
          });
        } else if (item.objectURL) {
          // Fallback: try to fetch blob URL and convert
          const response = await fetch(item.objectURL);
          const blob = await response.blob();
          dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } else {
          throw new Error('No valid image data available');
        }

        // Save item data to localStorage for cross-window communication
        const galleryItemData = {
          imageDataUrl: dataUrl,
          id: item.id,
          metadata: item.metadata,
          timestamp: Date.now(),
          targetTab: tabName
        };

        localStorage.setItem(
          'pendingGalleryItem',
          JSON.stringify(galleryItemData)
        );

        // Open generator in new window with appropriate hash
        const generatorUrl = `/generator/#${tabName}`;
        window.open(generatorUrl, '_blank');

        console.log(`Opening generator ${tabName} tab with gallery item`);
      } catch (error) {
        console.error('Failed to open generator with gallery item:', error);
      }
    };

    const handleUseForInpaint = (item) => {
      openGeneratorWithItem(item, 'inpaint');
    };

    const handleUseForOutpaint = (item) => {
      openGeneratorWithItem(item, 'outpaint');
    };

    const handleUseForGenerator = (item) => {
      openGeneratorWithItem(item, 'generator');
    };

    const handleUseForVideo = (item) => {
      openGeneratorWithItem(item, 'video');
    };

    const handleNotification = (message, type) => {
      console.log(`[${type}] ${message}`);
    };

    // Mount the React gallery component
    const root = createRoot(galleryRoot);
    root.render(
      <Gallery
        mode="sidebar"
        onCopyParams={handleCopyParams}
        onCopyImage={handleCopyImage}
        onUseForInpaint={handleUseForInpaint}
        onUseForOutpaint={handleUseForOutpaint}
        onUseForGenerator={handleUseForGenerator}
        onUseForVideo={handleUseForVideo}
        onNotification={handleNotification}
      />
    );
  },

  removeObject: function (object) {
    // Remove just the helper as the object will be deleted by A-Frame
    this.removeHelpers(object);
    Events.emit('objectremove', object);
  },

  addHelper: function (object) {
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
  },

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

    if (emit === undefined) {
      Events.emit('entityselect', entity);
    }

    // Update helper visibilities.
    for (const id in this.helpers) {
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
    // Remove inspector component to properly unregister keydown listener when the inspector is loaded via a script tag,
    // otherwise the listener will be registered twice and we can't toggle the inspector from viewer mode with the shortcut.
    this.sceneEl.removeAttribute('inspector');
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

    this.sceneEl.addEventListener('newScene', () => {
      this.history.clear();
    });

    document.addEventListener('child-detached', (event) => {
      const entity = event.detail.el;
      AFRAME.INSPECTOR.removeObject(entity.object3D);
    });
  },

  execute: function (cmdName, payload, optionalName, callback = undefined) {
    const Cmd = commandsByType.get(cmdName);
    if (!Cmd) {
      console.error(`Command ${cmdName} not found`);
      return;
    }
    return this.history.execute(new Cmd(this, payload, callback), optionalName);
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
    const object = this.scene.getObjectById(id);
    if (object) {
      this.select(object);
    }
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
    this.inspectorActive = true;
    this.sceneHelpers.visible = true;

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
   */
  close: function () {
    this.opened = false;
    this.inspectorActive = false;
    this.sceneHelpers.visible = false;

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
  }
};

const inspector = (AFRAME.INSPECTOR = new Inspector(
  window.AFRAME_INSPECTOR_CONFIG
));
posthog.init('phc_Yclai3qykyFi8AEFOrZsh6aS78SSooLzpDz9wQ9YAH9', {
  api_host: 'https://us.i.posthog.com',
  person_profiles: 'identified_only' // or 'always' to create profiles for anonymous users as well
});

// A-Frame canvas needs to be outside of a-scene for posthog recording to work
const sceneLoaded = () => {
  const canvas = document.querySelector('canvas.a-canvas');
  if (canvas) {
    document.body.appendChild(canvas);
  }
};
document.addEventListener('DOMContentLoaded', () => {
  const scene = document.querySelector('a-scene');
  if (scene.hasLoaded) {
    sceneLoaded();
  } else {
    scene.addEventListener('loaded', sceneLoaded);
  }
});

export { inspector };
