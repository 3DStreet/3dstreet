import posthog from 'posthog-js';
import useStore from '@/store.js';
import {
  createScene,
  updateScene,
  uploadThumbnailImage
} from '@/editor/api/scene';
import { createUniqueId } from '@/editor/lib/entity.js';

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

export function createElementsForScenesFromJSON(streetData, memoryData) {
  // clear scene data, create new blank scene.
  // clearMetadata = true, clearUrlHash = false, addDefaultStreet = false
  STREET.utils.newScene(true, false, false);

  const streetContainerEl = document.getElementById('street-container');

  if (!Array.isArray(streetData)) {
    console.error('Invalid data format. Expected an array.');
    return;
  }

  // Load project info from memory if available
  if (memoryData && memoryData.projectInfo) {
    console.log(
      'Loading project info from memory in createElementsForScenesFromJSON:',
      memoryData.projectInfo
    );
    useStore.getState().setProjectInfo(memoryData.projectInfo);
  }

  const processStreetDataForDuplicateIds = (data) => {
    // Keep track of IDs we've seen during processing
    const seenIds = new Set();
    let changeCounter = 0;

    // Main recursive function to process IDs and children
    const processItem = (obj) => {
      if (obj.id) {
        if (seenIds.has(obj.id)) {
          // If we've seen this ID before, generate a new one
          obj.id = createUniqueId();
          changeCounter++;
        } else {
          // First time seeing this ID, add it to seen set
          seenIds.add(obj.id);
        }
      }

      if (obj.children) {
        obj.children = obj.children.map(processItem);
      }

      return obj;
    };
    const output = data.map(processItem);
    if (changeCounter > 0) {
      console.log(`Duplicate IDs fixed: ${changeCounter} instances`);
    }
    return output;
  };

  const correctedStreetData = processStreetDataForDuplicateIds(streetData);

  STREET.utils.createEntities(correctedStreetData, streetContainerEl);
  AFRAME.scenes[0].emit('newScene');
}

export function fileJSON(event) {
  let reader = new FileReader();

  reader.onload = function () {
    const data = JSON.parse(reader.result);
    // Pass the entire data object to handle both scene data and memory
    createElementsForScenesFromJSON(data.data, data.memory);
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

export async function makeScreenshot(hideOverlays = false) {
  await new Promise((resolve, reject) => {
    const screenshotEl = document.getElementById('screenshot');
    screenshotEl.play();

    const screentockImgElement = document.getElementById(
      'screentock-destination'
    );
    screentockImgElement.addEventListener(
      'load',
      () => {
        resolve();
      },
      { once: true }
    );
    const oldVals = {
      showLogo: screenshotEl.getAttribute('screentock').showLogo,
      showTitle: screenshotEl.getAttribute('screentock').showTitle
    };
    screenshotEl.setAttribute('screentock', 'type', 'img');
    screenshotEl.setAttribute(
      'screentock',
      'imgElementSelector',
      '#screentock-destination'
    );
    if (hideOverlays) {
      screenshotEl.setAttribute('screentock', 'showLogo', false);
      screenshotEl.setAttribute('screentock', 'showTitle', false);
    }
    // take the screenshot
    screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
    screenshotEl.setAttribute('screentock', 'showLogo', oldVals.showLogo);
    screenshotEl.setAttribute('screentock', 'showTitle', oldVals.showTitle);
  });
}

export async function saveScene(currentUser, doSaveAs, doPromptTitle) {
  const sceneTitle = useStore.getState().sceneTitle;
  const authorId = STREET.utils.getAuthorId();
  let sceneId = STREET.utils.getCurrentSceneId();
  const store = useStore.getState();

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

  // Ensure memory data (including project info) is preserved
  filteredData.memory = data.memory;

  // we want to save, so if we *still* have no sceneID at this point, then create a new one
  if (!sceneId || !!doSaveAs) {
    let title = sceneTitle;
    if (doPromptTitle) {
      // Prompt user for new scene title when saving as
      const newTitle = window.prompt(
        'Enter a title for your scene:',
        sceneTitle || 'Untitled'
      );
      if (!newTitle) return; // User cancelled the prompt
      store.setSceneTitle(newTitle);
      title = newTitle;
    }
    sceneId = await createScene(
      currentUser.uid,
      filteredData.data,
      title,
      filteredData.version,
      filteredData.memory
    );
  } else {
    await updateScene(
      sceneId,
      filteredData.data,
      sceneTitle,
      filteredData.version,
      filteredData.memory
    );
  }

  // make sure to update sceneId with new one in metadata component!
  AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
  AFRAME.scenes[0].setAttribute('metadata', 'authorId', currentUser.uid);

  // Change the hash URL without reloading
  window.location.hash = `#/scenes/${sceneId}`;
  return sceneId;
}

export async function saveSceneWithScreenshot(
  currentUser,
  doSaveAs,
  doPromptTitle
) {
  const currentSceneId = await saveScene(currentUser, doSaveAs, doPromptTitle);
  // if currentSceneId AND the screenshot modal is NOT open
  if (currentSceneId && useStore.getState().modal !== 'screenshot') {
    // wait a bit for models to be loaded, may not be enough...
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await makeScreenshot(true);
    uploadThumbnailImage(currentSceneId);
  }
}
