import posthog from 'posthog-js';
import useStore from '@/store';
import { saveBlob } from './utils';
import { convertToObject } from './SceneUtils';
import { expandBatchedMeshesForExport } from '../../batch-models';

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
          if (node.visible !== visible) {
            node.visible = visible;
            console.log(
              visible ? 'Showing Rigged Entity' : 'Hiding Rigged Entity',
              node.el.id || 'unnamed',
              'category:',
              category
            );
          }
        }
      }
    }
  });
};

// Exports the current scene as a GLB file. Callers are responsible for the
// Pro gate (`startCheckout('export')`) — this assumes the user may export.
export const exportSceneToGLTF = (intl, arReady) => {
  const { startExportingScene, finishExportingScene } = useStore.getState();
  // Blocking saving-style indicator (issue #1797) — export runs on the
  // main thread and can take several seconds on large scenes.
  startExportingScene(
    intl.formatMessage({
      id: 'appMenu.export.exportingGlb',
      defaultMessage: 'Exporting scene as GLB file...'
    })
  );
  // Defer the export so the indicator paints before the heavy synchronous
  // export work blocks the main thread.
  setTimeout(() => {
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
      // Expand BatchedMeshes into exportable meshes — restored in BOTH
      // exporter callbacks below.
      restoreExportScene = expandBatchedMeshesForExport(scene);
      // Modified to handle post-processing
      AFRAME.INSPECTOR.exporters.gltf.parse(
        scene,
        async function (buffer) {
          restoreExportScene();
          filterHelpers(scene, true);
          filterRiggedEntities(scene, true);

          try {
            // Lazy-load the GLB post-processing helpers. They pull in the heavy
            // @gltf-transform/* libraries, which we keep out of the core bundle
            // (loaded only when a user actually exports a GLB) to stay under the
            // webpack entrypoint size budget.
            const { transformUVs, addGLBMetadata } =
              await import('../components/modals/ScreenshotModal/gltfTransforms');

            let finalBuffer = buffer;

            // Post-process GLB if AR Ready option is selected
            if (arReady) {
              try {
                finalBuffer = await transformUVs(buffer);
                console.log('Successfully post-processed GLB file');
              } catch (error) {
                // console.error (not warn) so it's captured by Sentry
                console.error('Error in GLB post-processing:', error);
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
              try {
                finalBuffer = await addGLBMetadata(finalBuffer, metadata);
                console.log(
                  'Successfully added geospatial metadata to GLB file'
                );
              } catch (error) {
                // console.error (not warn) so it's captured by Sentry; the
                // GLB is still saved, just without geospatial metadata.
                console.error('Error adding geospatial metadata:', error);
              }
            }
            const blob = new Blob([finalBuffer], {
              type: 'application/octet-stream'
            });
            saveBlob(blob, sceneName + '.glb');
            STREET.notify.successMessage(
              intl.formatMessage({
                id: 'appMenu.export.gltfSuccess',
                defaultMessage: '3DStreet scene exported as glTF file.'
              })
            );
          } catch (error) {
            console.error(error);
            STREET.notify.errorMessage(
              intl.formatMessage(
                {
                  id: 'appMenu.export.gltfError',
                  defaultMessage:
                    'Error while trying to save glTF file. Error: {error}'
                },
                { error: error?.message ?? String(error) }
              )
            );
          } finally {
            finishExportingScene();
          }
        },
        function (error) {
          restoreExportScene();
          filterHelpers(scene, true);
          filterRiggedEntities(scene, true);
          finishExportingScene();
          console.error(error);
          STREET.notify.errorMessage(
            intl.formatMessage(
              {
                id: 'appMenu.export.gltfError',
                defaultMessage:
                  'Error while trying to save glTF file. Error: {error}'
              },
              { error: error?.message ?? String(error) }
            )
          );
        },
        { binary: true }
      );
    } catch (error) {
      restoreExportScene?.();
      finishExportingScene();
      STREET.notify.errorMessage(
        intl.formatMessage(
          {
            id: 'appMenu.export.gltfError',
            defaultMessage:
              'Error while trying to save glTF file. Error: {error}'
          },
          { error: error?.message ?? String(error) }
        )
      );
      console.error(error);
    }
  }, 50);
};

export const exportSceneToJSON = () => {
  posthog.capture('convert_to_json_clicked', {
    scene_id: STREET.utils.getCurrentSceneId()
  });
  convertToObject();
};
