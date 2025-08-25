import useStore from '@/store';

// Function to update the store with current location
export const updateLocationInStore = () => {
  console.log('[location-sync] updateLocationInStore called');
  const geoLayer = document.getElementById('reference-layers');
  console.log('[location-sync] geoLayer found:', !!geoLayer);

  if (geoLayer && geoLayer.hasAttribute('street-geo')) {
    const geoData = geoLayer.getAttribute('street-geo');
    console.log('[location-sync] street-geo data:', geoData);
    const locationString = geoData.locationString || null;
    console.log(
      '[location-sync] Setting location string in store:',
      locationString
    );
    useStore.getState().setLocationString(locationString);
  } else {
    console.log(
      '[location-sync] No street-geo found, setting location to null'
    );
    useStore.getState().setLocationString(null);
  }
};

/**
 * Initialize location sync between street-geo component and Zustand store
 * This should be called once when the app starts
 */
export function initializeLocationSync() {
  console.log('[location-sync] initializeLocationSync called');

  // Listen for changes to the street-geo component
  const handleComponentChange = (event) => {
    console.log('[location-sync] componentchanged event:', event.detail);
    if (event.detail.name === 'street-geo') {
      console.log(
        '[location-sync] street-geo component changed, updating store'
      );
      updateLocationInStore();
    }
  };

  // Listen for component removal
  const handleComponentRemoved = (event) => {
    if (event.detail.name === 'street-geo') {
      useStore.getState().setLocationString(null);
    }
  };

  // Set up event listeners on the reference-layers element
  const setupListeners = () => {
    console.log('[location-sync] Setting up listeners');
    const geoLayer = document.getElementById('reference-layers');
    console.log(
      '[location-sync] geoLayer found in setupListeners:',
      !!geoLayer
    );
    if (geoLayer) {
      geoLayer.addEventListener('componentchanged', handleComponentChange);
      geoLayer.addEventListener('componentinitialized', handleComponentChange);
      geoLayer.addEventListener('componentremoved', handleComponentRemoved);

      // Also listen for when components are added
      geoLayer.addEventListener('componentadd', (event) => {
        console.log('[location-sync] componentadd event:', event.detail);
        if (event.detail.name === 'street-geo') {
          console.log(
            '[location-sync] street-geo component added, updating store'
          );
          setTimeout(updateLocationInStore, 100); // Small delay to ensure initialization
        }
      });

      // Listen for all attribute changes to catch setAttribute calls
      geoLayer.addEventListener('componentupdate', (event) => {
        console.log('[location-sync] componentupdate event:', event.detail);
        if (event.detail.name === 'street-geo') {
          console.log(
            '[location-sync] street-geo component updated, updating store'
          );
          setTimeout(updateLocationInStore, 100);
        }
      });

      // Also listen for the generic attribute change event
      const attributeChangeHandler = (event) => {
        console.log('[location-sync] attribute changed:', event.detail);
        if (event.detail && event.detail.component === 'street-geo') {
          console.log(
            '[location-sync] street-geo attribute changed, updating store'
          );
          setTimeout(updateLocationInStore, 100);
        }
      };
      geoLayer.addEventListener('attributeChanged', attributeChangeHandler);
      geoLayer.addEventListener('componentupdated', attributeChangeHandler);

      console.log('[location-sync] Event listeners added');

      // Check initial state
      console.log('[location-sync] Checking initial state');
      updateLocationInStore();

      // Also retry after a short delay in case the component is still loading
      setTimeout(() => {
        console.log('[location-sync] Retry check after delay');
        updateLocationInStore();
      }, 500);
    } else {
      console.log('[location-sync] No reference-layers element found');
    }
  };

  // Wait for the DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupListeners);
  } else {
    // If DOM is already loaded, set up immediately
    setupListeners();
  }

  // Also listen for scene loads (when loading from hash or modal)
  document.addEventListener('sceneLoaded', () => {
    setTimeout(updateLocationInStore, 100); // Small delay to ensure components are initialized
  });

  // Listen for new scene events
  document.addEventListener('newScene', () => {
    console.log(
      '[location-sync] newScene event on document, checking for location'
    );
    setTimeout(updateLocationInStore, 500); // Give time for components to load
  });

  // Set up scene event listeners
  const setupSceneListeners = () => {
    const sceneEl = document.querySelector('a-scene');
    console.log(
      '[location-sync] Setting up scene listeners, sceneEl found:',
      !!sceneEl
    );
    if (sceneEl) {
      sceneEl.addEventListener('newScene', () => {
        console.log(
          '[location-sync] newScene event on scene element, checking for location'
        );
        setTimeout(updateLocationInStore, 500); // Give time for components to load
      });

      sceneEl.addEventListener('metadata-change', () => {
        console.log('[location-sync] metadata-change event on scene element');
        setTimeout(updateLocationInStore, 100);
      });
    }
  };

  // Try to set up scene listeners immediately and also after DOM is ready
  setupSceneListeners();

  setTimeout(setupSceneListeners, 1000); // Retry after a delay in case scene isn't ready
}
