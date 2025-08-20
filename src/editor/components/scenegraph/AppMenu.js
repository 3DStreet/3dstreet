import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import { makeScreenshot, convertToObject } from '@/editor/lib/SceneUtils';
import posthog from 'posthog-js';
import Events from '../../lib/Events.js';
import canvasRecorder from '../../lib/CanvasRecorder';
import { useAuthContext } from '@/editor/contexts';
import { saveBlob } from '../../lib/utils';
import {
  transformUVs,
  addGLBMetadata
} from '../modals/ScreenshotModal/gltfTransforms';
import {
  faCheck,
  faCircle,
  faChevronDown,
  faChevronRight
} from '@fortawesome/free-solid-svg-icons';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { useState, useEffect } from 'react';
import { currentOrthoDir } from '../../lib/cameras.js';

const cameraOptions = [
  {
    value: 'perspective',
    event: 'cameraperspectivetoggle',
    payload: null,
    label: '3D View',
    shortcut: '1'
  },
  {
    value: 'orthotop',
    event: 'cameraorthographictoggle',
    payload: 'top',
    label: 'Plan View',
    shortcut: '4'
  }
];

// Export utility functions
const filterHelpers = (scene, visible) => {
  scene.traverse((o) => {
    if (o.userData.source === 'INSPECTOR') {
      o.visible = visible;
    }
  });
};

const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '-') // Replace all non-word chars with -
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
};

const getSceneName = (scene) => {
  return scene.id || slugify(window.location.host + window.location.pathname);
};

const getMixinCategories = () => {
  const mapping = {};
  const mixinElements = document.querySelectorAll('a-mixin');
  for (let mixinEl of Array.from(mixinElements)) {
    const category = mixinEl.getAttribute('category');
    if (category) {
      mapping[mixinEl.id] = category;
    }
  }
  return mapping;
};

const filterRiggedEntities = (scene, visible) => {
  const mixinToCategory = getMixinCategories();

  scene.traverse((node) => {
    if (node.el && node.el.components) {
      const mixin = node.el.getAttribute('mixin');
      if (mixin) {
        const category = mixinToCategory[mixin];
        if (
          category &&
          (category.includes('people') ||
            category.includes('people-rigged') ||
            category.includes('vehicles') ||
            category.includes('vehicles-transit') ||
            category.includes('cyclists'))
        ) {
          node.visible = visible;
          console.log(
            'Hiding Rigged Entity',
            node.el.id || 'unnamed',
            'category:',
            category
          );
        }
      }
    }
  });
};

const AppMenu = ({ currentUser }) => {
  const {
    setModal,
    isInspectorEnabled,
    setIsInspectorEnabled,
    isGridVisible,
    setIsGridVisible,
    saveScene,
    startCheckout
  } = useStore();
  const { currentUser: authUser } = useAuthContext();
  const [currentCamera, setCurrentCamera] = useState('perspective');

  // Function to get current camera state from the actual camera system
  const getCurrentCameraState = () => {
    if (!AFRAME.INSPECTOR?.camera) return 'perspective';

    const camera = AFRAME.INSPECTOR.camera;
    if (camera.type === 'PerspectiveCamera') {
      return 'perspective';
    } else if (camera.type === 'OrthographicCamera') {
      return `ortho${currentOrthoDir}`;
    }
    return 'perspective';
  };

  useEffect(() => {
    // Initialize with actual camera state
    setCurrentCamera(getCurrentCameraState());

    const handleCameraToggle = (event) => {
      setCurrentCamera(event.value);
    };

    // Also sync when inspector is enabled/disabled
    const handleInspectorToggle = () => {
      // Small delay to ensure camera system has updated
      setTimeout(() => {
        setCurrentCamera(getCurrentCameraState());
      }, 100);
    };

    Events.on('cameratoggle', handleCameraToggle);
    Events.on('inspectortoggle', handleInspectorToggle);

    return () => {
      Events.off('cameratoggle', handleCameraToggle);
      Events.off('inspectortoggle', handleInspectorToggle);
    };
  }, []);

  const handleCameraChange = (option) => {
    // Let the camera system handle the camera change first
    Events.emit(option.event, option.payload);
    // The cameratoggle event will be emitted by the camera system with the proper camera object
  };

  const newHandler = () => {
    posthog.capture('new_scene_clicked');
    setModal('new');
  };

  const showAIChatPanel = () => {
    // Use the global ref to access the AIChatPanel component
    if (
      window.aiChatPanelRef &&
      typeof window.aiChatPanelRef.openPanel === 'function'
    ) {
      window.aiChatPanelRef.openPanel();
    }
  };

  const exportSceneToGLTF = (arReady) => {
    if (authUser?.isPro) {
      try {
        posthog.capture('export_initiated', {
          export_type: arReady ? 'ar_glb' : 'glb',
          scene_id: STREET.utils.getCurrentSceneId()
        });

        const sceneName = getSceneName(AFRAME.scenes[0]);
        let scene = AFRAME.scenes[0].object3D;
        if (arReady) {
          // only export user layers, not geospatial
          scene = document.querySelector('#street-container').object3D;
        }
        posthog.capture('export_scene_to_gltf_clicked', {
          scene_id: STREET.utils.getCurrentSceneId()
        });

        // if AR Ready mode, then remove rigged vehicles and people from the scene
        if (arReady) {
          filterRiggedEntities(scene, false);
        }
        filterHelpers(scene, false);
        // Modified to handle post-processing
        AFRAME.INSPECTOR.exporters.gltf.parse(
          scene,
          async function (buffer) {
            filterHelpers(scene, true);
            filterRiggedEntities(scene, true);

            let finalBuffer = buffer;

            // Post-process GLB if AR Ready option is selected
            if (arReady) {
              try {
                finalBuffer = await transformUVs(buffer);
                console.log('Successfully post-processed GLB file');
              } catch (error) {
                console.warn('Error in GLB post-processing:', error);
                // Fall back to original buffer if post-processing fails
                STREET.notify.warningMessage(
                  'UV transformation skipped - using original export'
                );
              }
            }

            // fetch metadata from scene
            const geoLayer = document.getElementById('reference-layers');
            if (geoLayer && geoLayer.hasAttribute('street-geo')) {
              const metadata = {
                longitude: geoLayer.getAttribute('street-geo').longitude,
                latitude: geoLayer.getAttribute('street-geo').latitude,
                orthometricHeight:
                  geoLayer.getAttribute('street-geo').orthometricHeight,
                geoidHeight: geoLayer.getAttribute('street-geo').geoidHeight,
                ellipsoidalHeight:
                  geoLayer.getAttribute('street-geo').ellipsoidalHeight,
                orientation: 270
              };
              finalBuffer = await addGLBMetadata(finalBuffer, metadata);
              console.log('Successfully added geospatial metadata to GLB file');
            }
            const blob = new Blob([finalBuffer], {
              type: 'application/octet-stream'
            });
            saveBlob(blob, sceneName + '.glb');
          },
          function (error) {
            console.error(error);
            STREET.notify.errorMessage(
              `Error while trying to save glTF file. Error: ${error}`
            );
          },
          { binary: true }
        );
        STREET.notify.successMessage('3DStreet scene exported as glTF file.');
      } catch (error) {
        STREET.notify.errorMessage(
          `Error while trying to save glTF file. Error: ${error}`
        );
        console.error(error);
      }
    } else {
      setModal('payment');
    }
  };

  const exportSceneToJSON = () => {
    posthog.capture('convert_to_json_clicked', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
    convertToObject();
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="DropdownTrigger">
        <img
          src="/ui_assets/3D-St-stacked-128.png"
          alt="3DStreet Logo"
          className="logo-image"
        />
        <AwesomeIcon
          icon={faChevronDown}
          size={12}
          className="dropdown-arrow"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="DropdownContent"
          align="start"
          sideOffset={5}
        >
          {/* File Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              File
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={newHandler}
                >
                  New...
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => setModal('scenes')}
                >
                  Open...
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  disabled={!STREET.utils.getCurrentSceneId()}
                  onClick={() => {
                    if (!currentUser) {
                      setModal('signin');
                      return;
                    }
                    if (currentUser?.uid !== STREET.utils.getAuthorId()) {
                      return;
                    }
                    saveScene(false);
                  }}
                >
                  Save
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => {
                    if (!currentUser) {
                      setModal('signin');
                      return;
                    }
                    saveScene(true, true);
                  }}
                >
                  Save As...
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => {
                    makeScreenshot();
                    setModal('screenshot');
                  }}
                >
                  Share & Download...
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                {/* Export Submenu */}
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className="DropdownSubTrigger">
                    Export
                    <div className="RightSlot">
                      <AwesomeIcon icon={faChevronRight} size={12} />
                    </div>
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className="DropdownSubContent">
                      <DropdownMenu.Item
                        className="DropdownItem"
                        onClick={() => exportSceneToGLTF(false)}
                      >
                        GLB glTF
                        <div className="RightSlot">
                          <span className="pro-badge">Pro</span>
                        </div>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="DropdownItem"
                        onClick={() => exportSceneToGLTF(true)}
                      >
                        AR Ready GLB
                        <div className="RightSlot">
                          <span className="pro-badge">Pro</span>
                        </div>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="DropdownItem"
                        onClick={exportSceneToJSON}
                      >
                        .3dstreet.json
                      </DropdownMenu.Item>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* View Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              View
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.CheckboxItem
                  className="DropdownCheckboxItem"
                  checked={isGridVisible}
                  onCheckedChange={setIsGridVisible}
                >
                  <DropdownMenu.ItemIndicator className="DropdownItemIndicator">
                    <AwesomeIcon icon={faCheck} size={14} />
                  </DropdownMenu.ItemIndicator>
                  Show Grid
                  <div className="RightSlot">G</div>
                </DropdownMenu.CheckboxItem>
                <DropdownMenu.Separator className="DropdownSeparator" />
                {cameraOptions.map((option) => (
                  <DropdownMenu.CheckboxItem
                    key={option.value}
                    className="DropdownCheckboxItem"
                    checked={currentCamera === option.value}
                    onCheckedChange={() => handleCameraChange(option)}
                  >
                    <DropdownMenu.ItemIndicator className="DropdownItemIndicator">
                      <AwesomeIcon icon={faCircle} size={8} />
                    </DropdownMenu.ItemIndicator>
                    {option.label}
                    <div className="RightSlot">{option.shortcut}</div>
                  </DropdownMenu.CheckboxItem>
                ))}
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => AFRAME.INSPECTOR.controls.resetZoom()}
                >
                  Reset Camera View
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* Run Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              Run
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => {
                    setIsInspectorEnabled(!isInspectorEnabled);
                  }}
                >
                  Start Viewer
                  <div className="RightSlot">5</div>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={async () => {
                    if (!authUser) {
                      setModal('signin');
                      return;
                    }

                    if (!authUser.isPro) {
                      startCheckout(null);
                      posthog.capture('recording_feature_paywall_shown');
                      return;
                    }

                    const aframeCanvas =
                      document.querySelector('a-scene').canvas;
                    if (!aframeCanvas) {
                      console.error(
                        'Could not find A-Frame canvas for recording'
                      );
                      return;
                    }

                    const success = await canvasRecorder.startRecording(
                      aframeCanvas,
                      {
                        name:
                          '3DStreet-Recording-' +
                          new Date().toISOString().slice(0, 10)
                      }
                    );

                    if (success) {
                      setIsInspectorEnabled(!isInspectorEnabled);
                    }
                  }}
                >
                  Start and Record{' '}
                  <div className="RightSlot">
                    <span className="pro-badge">Pro</span>
                  </div>
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* Help Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              Help
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() =>
                    window.open('https://www.3dstreet.org/docs/', '_blank')
                  }
                >
                  Documentation
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() =>
                    window.open(
                      'https://www.3dstreet.org/docs/3dstreet-editor/keyboard-shortcuts',
                      '_blank'
                    )
                  }
                >
                  Keyboard Shortcuts
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() =>
                    window.open(
                      'https://www.3dstreet.org/docs/3dstreet-editor/mouse-and-touch-controls',
                      '_blank'
                    )
                  }
                >
                  Mouse and Touch Controls
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={showAIChatPanel}
                >
                  AI Scene Assistant
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default AppMenu;
