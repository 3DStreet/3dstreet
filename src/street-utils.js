/* global AFRAME, THREE */
/* 3DStreet utils functions */

/* 
clear old scene elements and data. Create blank scene 
*/
function newScene() {
	
	const streetContainerEl = document.querySelector("#street-container");
	const environmentEl = document.querySelector("#environment");
	const referenceLayersEl = document.querySelector("#reference-layers");

	// clear street-container element
	while (streetContainerEl.firstChild) {
		streetContainerEl.removeChild(streetContainerEl.lastChild);
	}
	//	streetContainerEl.innerHTML = '';
	// create default-street element
	const defaultStreet = document.createElement("a-entity");
	defaultStreet.id = "default-street";
	streetContainerEl.appendChild(defaultStreet);

	// clear environment element
	while (environmentEl.firstChild) {
		environmentEl.removeChild(environmentEl.lastChild);
	}	
	// set default preset:day  
	environmentEl.setAttribute('street-environment', 'preset', 'day');

	// clear reference layers
	while (referenceLayersEl.firstChild) {
		referenceLayersEl.removeChild(referenceLayersEl.lastChild);
	}

	// clear metadata
	AFRAME.scenes[0].setAttribute('metadata', 'sceneId', '');
	AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', '');

	// clear url hash
	setTimeout(function () {
		window.location.hash = '';
	});
}

STREET.utils.newScene = newScene;
