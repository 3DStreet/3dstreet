import posthog from 'posthog-js';
import useStore from '@/store';
import { saveBlob } from './utils';
import { convertToObject, getExportFilename } from './SceneUtils';
import { expandBatchedMeshesForExport } from '../../batch-models';

const filterHelpers = (scene, visible) => {
  scene.traverse((o) => {
    if (o.userData.source === 'INSPECTOR') {
      o.visible = visible;
    }
  });
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

// Generate the current scene as a GLB Blob. Shared by the download path
// (exportSceneToGLTF) and the Export modal's on-demand preview. No store or
// notification side effects — callers own the UX. Returns
// { blob, uvTransformSkipped } so callers can surface the AR-Ready
// post-processing fallback their own way.
export const generateGlbBlob = async (arReady) => {
  let scene = AFRAME.scenes[0].object3D;
  if (arReady) {
    // only export user layers, not geospatial
    scene = document.querySelector('#street-container').object3D;
    // remove rigged vehicles and people from the scene
    filterRiggedEntities(scene, false);
  }
  filterHelpers(scene, false);
  // Expand BatchedMeshes into exportable meshes — restored in the finally
  // below (before post-processing, matching the pre-refactor ordering).
  const restoreExportScene = expandBatchedMeshesForExport(scene);

  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      AFRAME.INSPECTOR.exporters.gltf.parse(scene, resolve, reject, {
        binary: true
      });
    });
  } finally {
    restoreExportScene();
    filterHelpers(scene, true);
    filterRiggedEntities(scene, true);
  }

  // Lazy-load the GLB post-processing helpers. They pull in the heavy
  // @gltf-transform/* libraries, which we keep out of the core bundle
  // (loaded only when a user actually exports a GLB) to stay under the
  // webpack entrypoint size budget.
  const { transformUVs, addGLBMetadata } =
    await import('../components/modals/ScreenshotModal/gltfTransforms');

  let finalBuffer = buffer;
  let uvTransformSkipped = false;

  // Post-process GLB if AR Ready option is selected
  if (arReady) {
    try {
      finalBuffer = await transformUVs(buffer);
      console.log('Successfully post-processed GLB file');
    } catch (error) {
      // console.error (not warn) so it's captured by Sentry
      console.error('Error in GLB post-processing:', error);
      // Fall back to original buffer if post-processing fails
      finalBuffer = buffer;
      uvTransformSkipped = true;
    }
  }

  // fetch metadata from scene
  const geoLayer = document.getElementById('reference-layers');
  if (geoLayer && geoLayer.hasAttribute('street-geo')) {
    const metadata = {
      longitude: geoLayer.getAttribute('street-geo').longitude,
      latitude: geoLayer.getAttribute('street-geo').latitude,
      orthometricHeight: geoLayer.getAttribute('street-geo').orthometricHeight,
      geoidHeight: geoLayer.getAttribute('street-geo').geoidHeight,
      ellipsoidalHeight: geoLayer.getAttribute('street-geo').ellipsoidalHeight,
      orientation: 270
    };
    try {
      finalBuffer = await addGLBMetadata(finalBuffer, metadata);
      console.log('Successfully added geospatial metadata to GLB file');
    } catch (error) {
      // console.error (not warn) so it's captured by Sentry; the
      // GLB is still usable, just without geospatial metadata.
      console.error('Error adding geospatial metadata:', error);
    }
  }

  return {
    blob: new Blob([finalBuffer], { type: 'application/octet-stream' }),
    uvTransformSkipped
  };
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
  setTimeout(async () => {
    try {
      posthog.capture('export_initiated', {
        export_type: arReady ? 'ar_glb' : 'glb',
        scene_id: STREET.utils.getCurrentSceneId()
      });
      posthog.capture('export_scene_to_gltf_clicked', {
        scene_id: STREET.utils.getCurrentSceneId()
      });

      const sceneName = getExportFilename();
      const { blob, uvTransformSkipped } = await generateGlbBlob(arReady);
      if (uvTransformSkipped) {
        STREET.notify.warningMessage(
          intl.formatMessage({
            id: 'appMenu.export.uvTransformSkipped',
            defaultMessage: 'UV transformation skipped - using original export'
          })
        );
      }
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
  }, 50);
};

export const exportSceneToJSON = () => {
  posthog.capture('convert_to_json_clicked', {
    scene_id: STREET.utils.getCurrentSceneId()
  });
  convertToObject();
};

// DXF plan-view export. `options` maps onto planModel's
// DEFAULT_PLAN_EXPORT_OPTIONS (unitsFeet, layerPrefix, …). Callers are
// responsible for the Pro gate (`startCheckout('export-dxf')`) — this
// assumes the user may export.
export const exportSceneToDXF = (intl, options = {}) => {
  const { startExportingScene, finishExportingScene } = useStore.getState();
  // Same blocking saving-style indicator as the GLB export (issue #1797) —
  // the segment walk + serialization run on the main thread.
  startExportingScene(
    intl.formatMessage({
      id: 'appMenu.export.exportingDxf',
      defaultMessage: 'Exporting scene as DXF file...'
    })
  );
  // Defer the export so the indicator paints before the synchronous export
  // work blocks the main thread.
  setTimeout(async () => {
    try {
      posthog.capture('export_initiated', {
        export_type: 'dxf',
        scene_id: STREET.utils.getCurrentSceneId()
      });

      const { exportScenePlanToDxf } = await import('./dxf/scenePlanToDxf');
      const { dxfString, segmentCount, intersectionCount } =
        exportScenePlanToDxf(options);

      if (segmentCount === 0 && intersectionCount === 0) {
        STREET.notify.warningMessage(
          intl.formatMessage({
            id: 'appMenu.export.dxfEmpty',
            defaultMessage:
              'No street or intersection elements found to export as DXF.'
          })
        );
        return;
      }

      const blob = new Blob([dxfString], { type: 'application/dxf' });
      saveBlob(blob, getExportFilename() + '.dxf');

      STREET.notify.successMessage(
        intl.formatMessage({
          id: 'appMenu.export.dxfSuccess',
          defaultMessage: '3DStreet scene exported as DXF file.'
        })
      );
    } catch (error) {
      console.error(error);
      STREET.notify.errorMessage(
        intl.formatMessage(
          {
            id: 'appMenu.export.dxfError',
            defaultMessage:
              'Error while trying to save DXF file. Error: {error}'
          },
          { error: error?.message ?? String(error) }
        )
      );
    } finally {
      finishExportingScene();
    }
  }, 50);
};

// PDF plan-view export — same linework as the DXF (shared plan model) drawn
// as a vector PDF, letter landscape, fit-to-page with a footer (title · scale
// · date). Callers are responsible for the Pro gate (`startCheckout(
// 'export-pdf')`) — this assumes the user may export.
export const exportSceneToPDF = (intl, options = {}) => {
  const { startExportingScene, finishExportingScene } = useStore.getState();
  startExportingScene(
    intl.formatMessage({
      id: 'appMenu.export.exportingPdf',
      defaultMessage: 'Exporting scene as PDF file...'
    })
  );
  // Defer the export so the indicator paints before the synchronous export
  // work blocks the main thread.
  setTimeout(async () => {
    try {
      posthog.capture('export_initiated', {
        export_type: 'pdf',
        scene_id: STREET.utils.getCurrentSceneId()
      });

      const { buildStreetPlanModel } = await import('./plan/planModel');
      const model = buildStreetPlanModel(options);

      if (!model.bounds) {
        STREET.notify.warningMessage(
          intl.formatMessage({
            id: 'appMenu.export.pdfEmpty',
            defaultMessage:
              'No street or intersection elements found to export as PDF.'
          })
        );
        return;
      }

      // jspdf is inside this lazily-loaded module — kept out of the core
      // bundle like the DXF writer.
      const { planModelToPdfBlob } = await import('./plan/planToPdf');
      const { blob } = planModelToPdfBlob(model, {
        title: getExportFilename(),
        dateLabel: new Date().toLocaleDateString()
      });
      saveBlob(blob, getExportFilename() + '.pdf');

      STREET.notify.successMessage(
        intl.formatMessage({
          id: 'appMenu.export.pdfSuccess',
          defaultMessage: '3DStreet scene exported as PDF file.'
        })
      );
    } catch (error) {
      console.error(error);
      STREET.notify.errorMessage(
        intl.formatMessage(
          {
            id: 'appMenu.export.pdfError',
            defaultMessage:
              'Error while trying to save PDF file. Error: {error}'
          },
          { error: error?.message ?? String(error) }
        )
      );
    } finally {
      finishExportingScene();
    }
  }, 50);
};
