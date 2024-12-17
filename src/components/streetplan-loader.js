/* global AFRAME, XMLHttpRequest */
import useStore from '../store.js';
var streetplanUtils = require('../streetplan/streetplan-utils.js');

const state = useStore.getState();

AFRAME.registerComponent('streetplan-loader', {
  dependencies: ['street'],
  schema: {
    streetplanStreetURL: { type: 'string' },
    streetplanAPIURL: { type: 'string' },
    streetplanEncJSON: { type: 'string' },
    showBuildings: { default: true },
    name: { default: '' },
    synchronize: { default: false }
  },
  streetplanResponseParse: function (streetplanResponseObject) {
    const el = this.el;
    const data = this.data;
    if (!streetplanResponseObject || !streetplanResponseObject.project) {
      console.error('[streetplan-loader] Invalid streetplan data structure');
      return;
    }
    try {
      // convert Streetplan structure to Streetmix-like structure
      const streetData = streetplanUtils.convertStreetStruct(
        streetplanResponseObject
      );

      const streetplanSegments = streetData.segments;
      const streetplanName = streetData.name;
      // const projectName = streetData.projectName || streetplanName;

      // Update layer name with project and street names
      el.setAttribute('data-layer-name', `StreetPlan • ${streetplanName}`);

      if (!state.sceneTitle) {
        state.setSceneTitle(streetplanName);
      }

      // Handle buildings if enabled
      if (data.showBuildings) {
        // Find building segments in the full data
        const buildingSegments = streetplanSegments.filter(
          (segment) => segment.type === 'Buildings'
        );

        // Set building variants based on side
        const leftBuilding = buildingSegments.find((b) => b.side === 'left');
        const rightBuilding = buildingSegments.find((b) => b.side === 'right');

        if (leftBuilding) {
          el.setAttribute('street', 'left', leftBuilding.title);
        }
        if (rightBuilding) {
          el.setAttribute('street', 'right', rightBuilding.title);
        }
      }
      // Set street type
      el.setAttribute('street', 'type', 'streetmixSegmentsMetric');

      // Filter out building segments for the main street data if needed
      const finalSegments = data.showBuildings
        ? streetplanSegments.filter((s) => s.type !== 'Buildings')
        : streetplanSegments;

      // Set JSON attribute last
      el.setAttribute(
        'street',
        'JSON',
        JSON.stringify({ streetmixSegmentsMetric: finalSegments })
      );
      el.emit('streetplan-loader-street-loaded');
    } catch (error) {
      console.error('[streetplan-loader] Error parsing street data:', error);
      el.emit('streetplan-loader-error', { error });
    }
  },
  init: function () {
    this.el.setAttribute('streetplan-loader', 'synchronize', true);
  },
  update: function (oldData) {
    const data = this.data;

    // Skip update if synchronization is disabled
    if (!data.synchronize) return;

    // Handle URL encoded JSON data
    if (data.streetplanEncJSON) {
      try {
        const streetplanJSON = decodeURIComponent(data.streetplanEncJSON);
        this.streetplanResponseParse(JSON.parse(streetplanJSON));
      } catch (error) {
        console.error('[streetplan-loader] Error parsing encoded JSON:', error);
        this.el.emit('streetplan-loader-error', { error });
      }
      return;
    }

    // Skip if URLs haven't changed
    if (
      oldData.streetplanStreetURL === data.streetplanStreetURL &&
      oldData.streetplanAPIURL === data.streetplanAPIURL
    ) {
      return;
    }

    // Load from API
    const request = new XMLHttpRequest();
    console.log('[streetplan-loader]', 'GET ' + data.streetplanAPIURL);

    request.open('GET', data.streetplanAPIURL, true);
    request.onload = () => {
      if (request.status >= 200 && request.status < 400) {
        try {
          const streetplanResponseObject = JSON.parse(request.response);
          this.streetplanResponseParse(streetplanResponseObject);
          this.el.setAttribute('streetplan-loader', 'synchronize', false);
        } catch (error) {
          console.error(
            '[streetplan-loader] Error parsing API response:',
            error
          );
          this.el.emit('streetplan-loader-error', { error });
        }
      } else {
        const error = new Error(`Server returned status ${request.status}`);
        console.error('[streetplan-loader] API request failed:', error);
        this.el.emit('streetplan-loader-error', { error });
      }
    };

    request.onerror = () => {
      const error = new Error('Network request failed');
      console.error('[streetplan-loader] Network error:', error);
      this.el.emit('streetplan-loader-error', { error });
    };
    request.send();
  }
});
