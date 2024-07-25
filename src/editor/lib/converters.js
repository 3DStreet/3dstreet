import posthog from 'posthog-js';
import { saveBlob } from './utils';

function getSceneName(scene) {
  return scene.id || slugify(window.location.host + window.location.pathname);
}
function filterHelpers(scene, visible) {
  scene.traverse((o) => {
    if (o.userData.source === 'INSPECTOR') {
      o.visible = visible;
    }
  });
}

/**
 * Slugify the string removing non-word chars and spaces
 * @param  {string} text String to slugify
 * @return {string}      Slugified string
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '-') // Replace all non-word chars with -
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
}

const convertToObject = () => {
  try {
    posthog.capture('convert_to_json_clicked', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
    const entity = document.getElementById('street-container');

    const data = STREET.utils.convertDOMElToObject(entity);

    const jsonString = `data:text/json;chatset=utf-8,${encodeURIComponent(
      STREET.utils.filterJSONstreet(data)
    )}`;

    const link = document.createElement('a');
    link.href = jsonString;
    link.download = 'data.json';

    link.click();
    link.remove();
    STREET.notify.successMessage('3DStreet JSON file saved successfully.');
  } catch (error) {
    STREET.notify.errorMessage(
      `Error trying to save 3DStreet JSON file. Error: ${error}`
    );
    console.error(error);
  }
};

const exportSceneToGLTF = () => {
  try {
    const sceneName = getSceneName(AFRAME.scenes[0]);
    const scene = AFRAME.scenes[0].object3D;
    posthog.capture('export_scene_to_gltf_clicked', {
      scene_id: STREET.utils.getCurrentSceneId()
    });

    filterHelpers(scene, false);
    AFRAME.INSPECTOR.exporters.gltf.parse(
      scene,
      function (buffer) {
        filterHelpers(scene, true);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        saveBlob(blob, sceneName + '.glb');
      },
      function (error) {
        console.error(error);
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
};

export { exportSceneToGLTF };
export { convertToObject };
