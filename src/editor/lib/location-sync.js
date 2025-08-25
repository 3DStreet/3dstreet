import useStore from '@/store';

let isInitialized = false;
let geoLayerObserver = null;

// Function to update the store with current location
export const updateLocationInStore = () => {
  const geoLayer = document.getElementById('reference-layers');

  if (geoLayer && geoLayer.hasAttribute('street-geo')) {
    const geoData = geoLayer.getAttribute('street-geo');
    const locationString = geoData.locationString || null;
    const currentLocation = useStore.getState().locationString;

    // Only log when location actually changes
    if (currentLocation !== locationString) {
      console.log('[location-sync] Location updated:', locationString);
    }

    useStore.getState().setLocationString(locationString);
  } else {
    const currentLocation = useStore.getState().locationString;
    if (currentLocation !== null) {
      console.log('[location-sync] Location cleared');
    }
    useStore.getState().setLocationString(null);
  }
};

// Use MutationObserver to watch for attribute changes on the geo layer
const setupGeoLayerObserver = (geoLayer) => {
  if (geoLayerObserver) {
    geoLayerObserver.disconnect();
  }

  geoLayerObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'street-geo'
      ) {
        updateLocationInStore();
      }
    });
  });

  geoLayerObserver.observe(geoLayer, {
    attributes: true,
    attributeFilter: ['street-geo']
  });
};

// Main initialization function
export function initializeLocationSync() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  // Function to set up observers when geo layer is available
  const setupObservers = () => {
    const geoLayer = document.getElementById('reference-layers');
    if (geoLayer) {
      setupGeoLayerObserver(geoLayer);
      updateLocationInStore(); // Check initial state
      return true;
    }
    return false;
  };

  // Try to set up immediately
  if (!setupObservers()) {
    // If not available, use MutationObserver to wait for it
    const documentObserver = new MutationObserver((mutations, observer) => {
      if (document.getElementById('reference-layers')) {
        setupObservers();
        observer.disconnect();
      }
    });

    documentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Listen for scene changes (for clearing/updating location)
  const sceneEl =
    document.querySelector('a-scene') || document.createElement('a-scene');
  sceneEl.addEventListener('newScene', () => {
    // Small delay to let the scene finish loading
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateLocationInStore();
      });
    });
  });
}

// Cleanup function
export function cleanupLocationSync() {
  if (geoLayerObserver) {
    geoLayerObserver.disconnect();
    geoLayerObserver = null;
  }
  isInitialized = false;
}
