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

  const defaultStreetEl = document.getElementById('default-street');
  defaultStreetEl.setAttribute(
    'streetmix-loader',
    'streetmixStreetURL',
    streetmixURL
  );

  AFRAME.scenes[0].emit('newScene');
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
