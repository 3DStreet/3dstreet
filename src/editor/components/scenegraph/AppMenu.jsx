import { Menubar } from 'radix-ui';
import { FormattedMessage, useIntl, defineMessages } from 'react-intl';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import { makeScreenshot, convertToObject } from '@/editor/lib/SceneUtils';
import posthog from 'posthog-js';
import Events from '../../lib/Events.js';
import { useAuthContext } from '@/editor/contexts';
import { saveBlob } from '../../lib/utils';
import { prepareSceneForGltfExport } from '../../lib/prepareGltfExport';
import {
  uploadAndPlaceAsset,
  FILE_PICKER_ACCEPT
} from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import {
  faCheck,
  faCircle,
  faChevronRight
} from '@fortawesome/free-solid-svg-icons';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { useState, useEffect } from 'react';
import { currentOrthoDir } from '../../lib/cameras.js';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { SUPPORTED_LOCALES } from '@/editor/i18n/config';

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

// Static catalog for the camera labels so formatjs can extract them (a dynamic
// `id={`appMenu.view.camera.${value}`}` would be invisible to the extractor).
const cameraMessages = defineMessages({
  perspective: {
    id: 'appMenu.view.camera.perspective',
    defaultMessage: '3D View'
  },
  orthotop: {
    id: 'appMenu.view.camera.orthotop',
    defaultMessage: 'Plan View'
  }
});

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
  const intl = useIntl();
  const {
    setModal,
    isGridVisible,
    setIsGridVisible,
    saveScene,
    setGeojsonImportData,
    setRightPanelTab,
    startCheckout,
    locale,
    setLocale
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
    setRightPanelTab('console');
  };

  const exportSceneToGLTF = (arReady) => {
    if (authUser?.isPro) {
      let restoreExportScene;
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
        // Expand BatchedMeshes into exportable meshes and normalize the pivot property
        // (see prepareGltfExport.js) — restored in BOTH exporter callbacks below.
        restoreExportScene = prepareSceneForGltfExport(scene);
        // Modified to handle post-processing
        AFRAME.INSPECTOR.exporters.gltf.parse(
          scene,
          async function (buffer) {
            restoreExportScene();
            filterHelpers(scene, true);
            filterRiggedEntities(scene, true);

            // Lazy-load the GLB post-processing helpers. They pull in the heavy
            // @gltf-transform/* libraries, which we keep out of the core bundle
            // (loaded only when a user actually exports a GLB) to stay under the
            // webpack entrypoint size budget.
            const { transformUVs, addGLBMetadata } =
              await import('../modals/ScreenshotModal/gltfTransforms');

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
                  intl.formatMessage({
                    id: 'appMenu.export.uvTransformSkipped',
                    defaultMessage:
                      'UV transformation skipped - using original export'
                  })
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
            restoreExportScene();
            filterHelpers(scene, true);
            filterRiggedEntities(scene, true);
            console.error(error);
            STREET.notify.errorMessage(
              intl.formatMessage(
                {
                  id: 'appMenu.export.gltfError',
                  defaultMessage:
                    'Error while trying to save glTF file. Error: {error}'
                },
                { error }
              )
            );
          },
          { binary: true }
        );
        STREET.notify.successMessage(
          intl.formatMessage({
            id: 'appMenu.export.gltfSuccess',
            defaultMessage: '3DStreet scene exported as glTF file.'
          })
        );
      } catch (error) {
        restoreExportScene?.();
        STREET.notify.errorMessage(
          intl.formatMessage(
            {
              id: 'appMenu.export.gltfError',
              defaultMessage:
                'Error while trying to save glTF file. Error: {error}'
            },
            { error }
          )
        );
        console.error(error);
      }
    } else {
      startCheckout('export');
    }
  };

  const exportSceneToJSON = () => {
    posthog.capture('convert_to_json_clicked', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
    convertToObject();
  };

  const importAssetFromPicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_PICKER_ACCEPT;
    input.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (file) await uploadAndPlaceAsset(file);
    };
    input.click();
  };

  // eslint-disable-next-line no-unused-vars
  const importGeoJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json';
    input.multiple = false;

    input.onchange = (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const geojsonData = JSON.parse(e.target.result);

            const createGeoJSONEntity = () => {
              try {
                // Validate GeoJSON structure
                if (
                  !geojsonData.features ||
                  !Array.isArray(geojsonData.features)
                ) {
                  throw new Error(
                    'Invalid GeoJSON: missing or invalid features array'
                  );
                }

                if (geojsonData.features.length === 0) {
                  throw new Error('GeoJSON file contains no features');
                }

                // Check for valid polygon features with proper coordinate validation
                const buildingFeatures = geojsonData.features.filter(
                  (feature) => {
                    // Accept any feature with properties (removed building tag requirement)
                    if (!feature.properties) {
                      return false;
                    }

                    if (
                      !feature.geometry ||
                      (feature.geometry.type !== 'Polygon' &&
                        feature.geometry.type !== 'MultiPolygon')
                    ) {
                      return false;
                    }

                    // Validate coordinates structure
                    if (
                      !feature.geometry.coordinates ||
                      !Array.isArray(feature.geometry.coordinates)
                    ) {
                      return false;
                    }

                    // For Polygon: coordinates should be array of arrays (rings)
                    // For MultiPolygon: coordinates should be array of arrays of arrays
                    try {
                      if (feature.geometry.type === 'Polygon') {
                        const rings = feature.geometry.coordinates;
                        if (!Array.isArray(rings) || rings.length === 0) {
                          return false;
                        }

                        // Check each ring has at least 4 coordinates (closed polygon)
                        for (const ring of rings) {
                          if (!Array.isArray(ring) || ring.length < 4) {
                            return false;
                          }
                          // Check each coordinate is [lon, lat] pair
                          for (const coord of ring) {
                            if (
                              !Array.isArray(coord) ||
                              coord.length < 2 ||
                              typeof coord[0] !== 'number' ||
                              typeof coord[1] !== 'number'
                            ) {
                              return false;
                            }
                          }
                        }
                      } else if (feature.geometry.type === 'MultiPolygon') {
                        const polygons = feature.geometry.coordinates;
                        if (!Array.isArray(polygons) || polygons.length === 0) {
                          return false;
                        }

                        for (const polygon of polygons) {
                          if (!Array.isArray(polygon) || polygon.length === 0) {
                            return false;
                          }

                          for (const ring of polygon) {
                            if (!Array.isArray(ring) || ring.length < 4) {
                              return false;
                            }
                            for (const coord of ring) {
                              if (
                                !Array.isArray(coord) ||
                                coord.length < 2 ||
                                typeof coord[0] !== 'number' ||
                                typeof coord[1] !== 'number'
                              ) {
                                return false;
                              }
                            }
                          }
                        }
                      }
                      return true;
                    } catch (e) {
                      console.warn(
                        'Invalid geometry in feature:',
                        feature.id || 'unnamed',
                        e
                      );
                      return false;
                    }
                  }
                );

                if (buildingFeatures.length === 0) {
                  throw new Error(
                    'No valid polygon features found in GeoJSON. Features should have properties, valid Polygon/MultiPolygon geometry, and proper coordinate arrays.'
                  );
                }

                console.log(
                  `Found ${buildingFeatures.length} valid polygon features out of ${geojsonData.features.length} total features`
                );

                // Create or update the geojson entity
                let osmEntity = document.querySelector('[geojson]');
                if (!osmEntity) {
                  // Create new entity if it doesn't exist
                  osmEntity = document.createElement('a-entity');
                  osmEntity.setAttribute('id', 'imported-geojson');
                  osmEntity.setAttribute(
                    'data-layer-name',
                    'Imported GeoJSON Buildings'
                  );
                  // Rotate -90 degrees on Y axis to align with 3DStreet coordinate system (X+ north)
                  osmEntity.setAttribute('rotation', '0 -90 0');
                  // Add to user layers (street-container) instead of reference layers
                  document
                    .querySelector('#street-container')
                    .appendChild(osmEntity);
                }

                // Create cleaned GeoJSON with only valid building features
                const cleanedGeoJSON = {
                  ...geojsonData,
                  features: buildingFeatures
                };

                // Check GeoJSON data size and warn if large
                const geoJsonString = JSON.stringify(cleanedGeoJSON);
                const sizeKB = new Blob([geoJsonString]).size / 1024;
                console.log(
                  `[GeoJSON Import] Data size: ${Math.round(sizeKB)}KB`
                );

                if (sizeKB > 100) {
                  STREET.notify.warningMessage(
                    intl.formatMessage(
                      {
                        id: 'appMenu.geojson.largeFileWarning',
                        defaultMessage:
                          'GeoJSON file is {sizeKB}KB. Large files may affect performance.'
                      },
                      { sizeKB: Math.round(sizeKB) }
                    )
                  );
                }

                // Set the geojson component with the imported data directly
                // Setting lat/lon to 0,0 triggers automatic center calculation
                console.log(
                  '[GeoJSON Import] Setting geojson component with direct data'
                );
                console.log(
                  '[GeoJSON Import] Entity rotation set to Y:-90° for X+ north alignment'
                );
                osmEntity.setAttribute('geojson', {
                  data: geoJsonString,
                  lat: 0,
                  lon: 0
                });

                // Get the center coordinates from the GeoJSON component after it loads
                // The component calculates center when lat/lon are 0,0
                setTimeout(async () => {
                  console.log(
                    '[GeoJSON Import] Checking for calculated center coordinates...'
                  );
                  const geoJsonComponent = osmEntity.components.geojson;

                  if (geoJsonComponent) {
                    console.log('[GeoJSON Import] Component data:', {
                      lat: geoJsonComponent.data.lat,
                      lon: geoJsonComponent.data.lon
                    });

                    if (
                      geoJsonComponent.data.lat !== 0 &&
                      geoJsonComponent.data.lon !== 0
                    ) {
                      console.log(
                        '[GeoJSON Import] Center coordinates found, opening Geo Modal...'
                      );

                      // Store the coordinates for the Geo Modal to use
                      setGeojsonImportData({
                        lat: geoJsonComponent.data.lat,
                        lon: geoJsonComponent.data.lon,
                        source: 'geojson-import'
                      });

                      // Open the Geo Modal with pre-filled coordinates
                      setModal('geo');
                    } else {
                      console.log(
                        '[GeoJSON Import] No center coordinates calculated yet (still 0,0)'
                      );
                    }
                  } else {
                    console.warn(
                      '[GeoJSON Import] GeoJSON component not found on entity'
                    );
                  }
                }, 100); // Small delay to ensure GeoJSON component has initialized

                STREET.notify.successMessage(
                  intl.formatMessage(
                    {
                      id: 'appMenu.geojson.importSuccess',
                      defaultMessage:
                        'GeoJSON file imported successfully. Found {count} polygon features.'
                    },
                    { count: buildingFeatures.length }
                  )
                );
                posthog.capture('geojson_imported', {
                  scene_id: STREET.utils.getCurrentSceneId(),
                  file_name: file.name,
                  feature_count: geojsonData.features.length,
                  building_count: buildingFeatures.length
                });
              } catch (componentError) {
                console.error('Error creating GeoJSON entity:', componentError);
                STREET.notify.errorMessage(
                  intl.formatMessage(
                    {
                      id: 'appMenu.geojson.loadError',
                      defaultMessage: 'Error loading GeoJSON: {message}'
                    },
                    { message: componentError.message }
                  )
                );
              }
            };

            createGeoJSONEntity();
          } catch (error) {
            console.error('Error parsing GeoJSON file:', error);
            STREET.notify.errorMessage(
              intl.formatMessage({
                id: 'appMenu.geojson.parseError',
                defaultMessage:
                  'Error parsing GeoJSON file. Please ensure it is valid JSON.'
              })
            );
          }
        };
        reader.readAsText(file);
      }
    };

    input.click();
  };

  return (
    <Menubar.Root className="MenubarRoot">
      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">
          <FormattedMessage id="appMenu.file" defaultMessage="File" />
        </Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item className="MenubarItem" onClick={newHandler}>
              <FormattedMessage id="appMenu.file.new" defaultMessage="New..." />
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() => setModal('scenes')}
            >
              <FormattedMessage
                id="appMenu.file.open"
                defaultMessage="Open..."
              />
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
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
              <FormattedMessage id="appMenu.file.save" defaultMessage="Save" />
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() => {
                if (!currentUser) {
                  setModal('signin');
                  return;
                }
                saveScene(true, true);
              }}
            >
              <FormattedMessage
                id="appMenu.file.saveAs"
                defaultMessage="Save As..."
              />
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => setModal('share')}
            >
              <FormattedMessage
                id="appMenu.file.share"
                defaultMessage="Share..."
              />
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => importAssetFromPicker()}
            >
              <FormattedMessage
                id="appMenu.file.import"
                defaultMessage="Import..."
              />
            </Menubar.Item>
            <Menubar.Sub>
              <Menubar.SubTrigger className="MenubarItem">
                <FormattedMessage
                  id="appMenu.file.export"
                  defaultMessage="Export"
                />
                <div className="RightSlot">
                  <AwesomeIcon icon={faChevronRight} size={12} />
                </div>
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent className="MenubarContent">
                  <Menubar.Item
                    className="MenubarItem"
                    onClick={() => exportSceneToGLTF(false)}
                  >
                    <FormattedMessage
                      id="appMenu.export.glb"
                      defaultMessage="GLB glTF"
                    />
                    <div className="RightSlot">
                      <span className="pro-badge">
                        <FormattedMessage
                          id="appMenu.proBadge"
                          defaultMessage="Pro"
                        />
                      </span>
                    </div>
                  </Menubar.Item>
                  <Menubar.Item
                    className="MenubarItem"
                    onClick={() => exportSceneToGLTF(true)}
                  >
                    <FormattedMessage
                      id="appMenu.export.arReadyGlb"
                      defaultMessage="AR Ready GLB"
                    />
                    <div className="RightSlot">
                      <span className="pro-badge">
                        <FormattedMessage
                          id="appMenu.proBadge"
                          defaultMessage="Pro"
                        />
                      </span>
                    </div>
                  </Menubar.Item>
                  <Menubar.Item
                    className="MenubarItem"
                    onClick={exportSceneToJSON}
                  >
                    .3dstreet.json
                  </Menubar.Item>
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">
          <FormattedMessage id="appMenu.view" defaultMessage="View" />
        </Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.CheckboxItem
              className="MenubarCheckboxItem"
              checked={isGridVisible}
              onCheckedChange={setIsGridVisible}
            >
              <Menubar.ItemIndicator className="MenubarItemIndicator">
                <AwesomeIcon icon={faCheck} size={14} />
              </Menubar.ItemIndicator>
              <FormattedMessage
                id="appMenu.view.showGrid"
                defaultMessage="Show Grid"
              />
              <div className="RightSlot">G</div>
            </Menubar.CheckboxItem>
            <Menubar.Separator className="MenubarSeparator" />
            {cameraOptions.map((option) => (
              <Menubar.CheckboxItem
                key={option.value}
                className="MenubarCheckboxItem"
                checked={currentCamera === option.value}
                onCheckedChange={() => handleCameraChange(option)}
              >
                <Menubar.ItemIndicator className="MenubarItemIndicator">
                  <AwesomeIcon icon={faCircle} size={8} />
                </Menubar.ItemIndicator>
                <FormattedMessage {...cameraMessages[option.value]} />
                <div className="RightSlot">{option.shortcut}</div>
              </Menubar.CheckboxItem>
            ))}
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => AFRAME.INSPECTOR.controls.resetZoom()}
            >
              <FormattedMessage {...commonMessages.resetCameraView} />
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Sub>
              <Menubar.SubTrigger className="MenubarItem">
                <FormattedMessage
                  id="appMenu.view.language"
                  defaultMessage="Language"
                />
                <div className="RightSlot">
                  <AwesomeIcon icon={faChevronRight} size={12} />
                </div>
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent className="MenubarContent">
                  {SUPPORTED_LOCALES.map(({ code, label }) => (
                    <Menubar.CheckboxItem
                      key={code}
                      className="MenubarCheckboxItem"
                      checked={locale === code}
                      onCheckedChange={() => setLocale(code)}
                    >
                      <Menubar.ItemIndicator className="MenubarItemIndicator">
                        <AwesomeIcon icon={faCheck} size={14} />
                      </Menubar.ItemIndicator>
                      {/* Language names are shown as endonyms (in their own
                          language), so they are intentionally not translated. */}
                      {label}
                    </Menubar.CheckboxItem>
                  ))}
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() => {
                makeScreenshot();
                setModal('screenshot');
              }}
            >
              <FormattedMessage
                id="appMenu.view.snapshotRender"
                defaultMessage="Snapshot & Render..."
              />
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className="MenubarTrigger">
          <FormattedMessage id="appMenu.help" defaultMessage="Help" />
        </Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className="MenubarContent"
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item
              className="MenubarItem"
              onClick={() =>
                window.open('https://www.3dstreet.org/docs/', '_blank')
              }
            >
              <FormattedMessage {...commonMessages.documentation} />
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item
              className="MenubarItem"
              onClick={() =>
                window.open(
                  'https://www.3dstreet.org/docs/3dstreet-editor/keyboard-shortcuts',
                  '_blank'
                )
              }
            >
              <FormattedMessage {...commonMessages.keyboardShortcuts} />
            </Menubar.Item>
            <Menubar.Item
              className="MenubarItem"
              onClick={() =>
                window.open(
                  'https://www.3dstreet.org/docs/3dstreet-editor/mouse-and-touch-controls',
                  '_blank'
                )
              }
            >
              <FormattedMessage
                id="appMenu.help.mouseTouchControls"
                defaultMessage="Mouse and Touch Controls"
              />
            </Menubar.Item>
            <Menubar.Separator className="MenubarSeparator" />
            <Menubar.Item className="MenubarItem" onClick={showAIChatPanel}>
              <FormattedMessage
                id="appMenu.help.aiSceneAssistant"
                defaultMessage="AI Scene Assistant"
              />
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
};

export default AppMenu;
