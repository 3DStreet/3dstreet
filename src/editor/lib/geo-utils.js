/**
 * Reverse geocode latitude and longitude to get location string using Google Maps JavaScript API
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string>} - Location string
 */
export const reverseGeocode = async (lat, lng) => {
  try {
    if (!lat || !lng) {
      return 'Location';
    }

    // Check if Google Maps JavaScript API is loaded
    if (!window.google || !window.google.maps || !window.google.maps.Geocoder) {
      console.warn('[geo-utils] Google Maps JavaScript API not loaded');
      return 'Location';
    }

    const geocoder = new window.google.maps.Geocoder();
    const latlng = { lat: parseFloat(lat), lng: parseFloat(lng) };

    return new Promise((resolve) => {
      geocoder.geocode({ location: latlng }, (results, status) => {
        if (status === 'OK' && results && results.length > 0) {
          const addressComponents = results[0]?.address_components || [];

          // Extract location components exactly like the backend implementation
          const streetName =
            addressComponents.find((c) => c.types.includes('route'))
              ?.long_name || '';
          const locality =
            addressComponents.find((c) => c.types.includes('locality'))
              ?.long_name || '';
          const state =
            addressComponents.find((c) =>
              c.types.includes('administrative_area_level_1')
            )?.long_name || '';
          const country =
            addressComponents.find((c) => c.types.includes('country'))
              ?.long_name || '';

          // Build locationString exactly like backend: streetName, locality, state, country
          const locationString = `${streetName}, ${locality}, ${state}, ${country}`;

          // Clean up the string by removing empty parts and extra commas
          const cleanedString = locationString
            .split(', ')
            .filter((part) => part.trim() !== '')
            .join(', ');

          resolve(cleanedString || 'Location');
        } else {
          console.warn('[geo-utils] Geocoding failed:', status);
          resolve('Location');
        }
      });
    });
  } catch (error) {
    console.warn('[geo-utils] Error reverse geocoding:', error);
    return 'Location';
  }
};

/**
 * Wait for Google Maps JavaScript API to be loaded
 * @param {number} maxWait - Maximum wait time in milliseconds
 * @returns {Promise<boolean>} - True if API is loaded
 */
const waitForGoogleMaps = async (maxWait = 5000) => {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    if (window.google && window.google.maps && window.google.maps.Geocoder) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

/**
 * Get location string for display in UI components
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string>} - Formatted location string for display
 */
export const getLocationDisplayString = async (lat, lng) => {
  // Wait for Google Maps API to be loaded
  const apiLoaded = await waitForGoogleMaps();
  if (!apiLoaded) {
    console.warn('[geo-utils] Google Maps API not available after waiting');
    return 'Location';
  }

  const location = await reverseGeocode(lat, lng);
  return location;
};
