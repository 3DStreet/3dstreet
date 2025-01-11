import posthog from 'posthog-js';
import useStore from '@/store.js';
import {
  createScene,
  updateScene,
  uploadThumbnailImage
} from '@/editor/api/scene';

export function createBlankScene() {
  STREET.utils.newScene();
  AFRAME.scenes[0].emit('newScene');
}

export function inputStreetmix() {
  const streetmixURL = prompt(
    'Please enter a Streetmix URL',
    'https://streetmix.net/kfarr/3/example-street'
  );

  // clear scene data, create new blank scene.
  // clearMetadata = true, clearUrlHash = false
  STREET.utils.newScene(true, false);

  setTimeout(function () {
    window.location.hash = streetmixURL;
  });

  AFRAME.scenes[0].addEventListener('streetmix-loader-street-loaded', () => {
    // setTimeout very important here, otherwise all entities are positionned at 0,0,0 when reloading the scene
    setTimeout(() => {
      AFRAME.scenes[0].emit('newScene');
    });
  });

  const defaultStreetEl = document.getElementById('default-street');
  defaultStreetEl.setAttribute(
    'streetmix-loader',
    'streetmixStreetURL',
    streetmixURL
  );
}

export function createElementsForScenesFromJSON(streetData) {
  // clear scene data, create new blank scene.
  // clearMetadata = true, clearUrlHash = false, addDefaultStreet = false
  STREET.utils.newScene(true, false, false);

  const streetContainerEl = document.getElementById('street-container');

  if (!Array.isArray(streetData)) {
    console.error('Invalid data format. Expected an array.');
    return;
  }

  STREET.utils.createEntities(streetData, streetContainerEl);
  AFRAME.scenes[0].emit('newScene');
}

export function fileJSON(event) {
  let reader = new FileReader();

  reader.onload = function () {
    STREET.utils.createElementsFromJSON(reader.result, true);
  };

  reader.readAsText(event.target.files[0]);
}

export function convertToObject() {
  try {
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
}

export function makeScreenshot() {
  const imgHTML = '<img id="screentock-destination">';
  // Set the screenshot in local storage
  localStorage.setItem('screenshot', JSON.stringify(imgHTML));
  const screenshotEl = document.getElementById('screenshot');
  screenshotEl.play();

  screenshotEl.setAttribute('screentock', 'type', 'img');
  screenshotEl.setAttribute(
    'screentock',
    'imgElementSelector',
    '#screentock-destination'
  );
  // take the screenshot
  screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
}

export async function saveScene(currentUser, doSaveAs) {
  const sceneTitle = useStore.getState().sceneTitle;
  const authorId = STREET.utils.getAuthorId();
  let sceneId = STREET.utils.getCurrentSceneId();

  posthog.capture('saving_scene', {
    save_as: doSaveAs,
    user_id: currentUser ? currentUser.uid : null,
    scene_id: sceneId,
    scene_title: sceneTitle
  });

  if (!currentUser) {
    useStore.getState().setModal('signin');
    return;
  }

  // check if the user is not pro, and if the geospatial has array of values of mapbox
  const streetGeo = document
    .getElementById('reference-layers')
    ?.getAttribute('street-geo');
  if (
    !currentUser.isPro &&
    streetGeo &&
    streetGeo['latitude'] &&
    streetGeo['longitude']
  ) {
    useStore.getState().setModal('payment');
    return;
  }
  if (authorId !== currentUser.uid) {
    // posthog.capture('not_scene_author', {
    //   scene_id: sceneId,
    //   user_id: currentUser.uid
    // });
    doSaveAs = true;
  }

  // generate json from 3dstreet core
  const entity = document.getElementById('street-container');
  const data = STREET.utils.convertDOMElToObject(entity);
  const filteredData = JSON.parse(STREET.utils.filterJSONstreet(data));

  // we want to save, so if we *still* have no sceneID at this point, then create a new one
  if (!sceneId || !!doSaveAs) {
    sceneId = await createScene(
      currentUser.uid,
      filteredData.data,
      sceneTitle,
      filteredData.version
    );
  } else {
    await updateScene(
      sceneId,
      filteredData.data,
      sceneTitle,
      filteredData.version
    );
  }

  // make sure to update sceneId with new one in metadata component!
  AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
  AFRAME.scenes[0].setAttribute('metadata', 'authorId', currentUser.uid);

  // Change the hash URL without reloading
  window.location.hash = `#/scenes/${sceneId}`;
  return sceneId;
}

export async function saveSceneWithScreenshot(currentUser, doSaveAs) {
  const currentSceneId = await saveScene(currentUser, doSaveAs);
  if (currentSceneId) {
    makeScreenshot();
    uploadThumbnailImage(currentSceneId);
  }
}
