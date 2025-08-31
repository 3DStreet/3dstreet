const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getGeoidHeightFromPGM } = require('./geoid.js');
const { Client: GoogleMapsClient } = require("@googlemaps/google-maps-services-js");
const { isUserProInternal } = require('./token-management.js');

// Function to get geoid height and location information
exports.getGeoidHeight = functions
  .runWith({ secrets: ["GOOGLE_MAPS_ELEVATION_API_KEY", "ALLOWED_PRO_DOMAINS"] })
  .https
  .onCall(async (data, context) => {
    // Check if user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;
    const lat = parseFloat(data.lat);
    const lon = parseFloat(data.lon);

    // Check if user is Pro or has tokens
    const db = admin.firestore();
    const isProUser = await isUserProInternal(userId);
    let canProceed = isProUser;

    // If not Pro, check tokens
    if (!canProceed) {
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tokenProfileRef.get();
      
      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data();
        if (tokenData.geoToken > 0) {
          canProceed = true;
        }
      } else {
        // Create initial token profile with 3 tokens
        await tokenProfileRef.set({
          userId: userId,
          geoToken: 3,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        canProceed = true;
      }
    }

    if (!canProceed) {
      throw new functions.https.HttpsError('permission-denied', 'No tokens or Pro subscription available');
    }
    const geoidFilePath = 'EGM96-15.pgm'; // Converted from USA NGA data under Public Domain license.
    const geoidHeight = await getGeoidHeightFromPGM(geoidFilePath, lat, lon);
    const client = new GoogleMapsClient({});

    // Helper function to add timeout to a promise
    const promiseWithTimeout = (promise, timeoutMs) => {
      let timeoutId;
      const timeoutPromise = new Promise((resolve, _) => {
        timeoutId = setTimeout(() => {
          console.log(`Promise timed out after ${timeoutMs}ms`);
          // Resolving with null instead of rejecting to handle timeout gracefully
          resolve(null);
        }, timeoutMs);
      });
      
      return Promise.race([
        promise.then(value => {
          clearTimeout(timeoutId);
          return value;
        }).catch(err => {
          clearTimeout(timeoutId);
          console.log('Promise error:', err);
          return null; // Return null on error
        }),
        timeoutPromise
      ]);
    };

    // Create all three API call promises with timeout
    const elevationPromise = promiseWithTimeout(
      client
        .elevation({
          params: {
            locations: [{ lat: lat, lng: lon }],
            key: process.env.GOOGLE_MAPS_ELEVATION_API_KEY,
          }
        })
        .then((r) => {
          return r.data.results[0].elevation;
        }),
      3000 // 3 second timeout
    );

    const reverseGeocodePromise = promiseWithTimeout(
      client
        .reverseGeocode({
          params: {
            latlng: `${lat},${lon}`,
            result_type: ["street_address", "route", "locality", "administrative_area_level_1"],
            key: process.env.GOOGLE_MAPS_ELEVATION_API_KEY,
          }
        })
        .then((r) => {
          const addressComponents = r.data.results[0]?.address_components || [];
          // Extract everything except the street number
          const streetName = addressComponents.find(c => c.types.includes("route"))?.long_name || '';
          const locality = addressComponents.find(c => c.types.includes("locality"))?.long_name || '';
          const state = addressComponents.find(c => c.types.includes("administrative_area_level_1"))?.long_name || '';
          const country = addressComponents.find(c => c.types.includes("country"))?.long_name || '';
          const locationString = `${streetName}, ${locality}, ${state}, ${country}`;

          return {
            streetName,
            locality,
            state,
            country,
            locationString
          };
        }),
      3000 // 3 second timeout
    );

    const intersectionPromise = promiseWithTimeout(
      fetch(
        `http://api.geonames.org/findNearestIntersectionOSM?lat=${lat}&lng=${lon}&username=3dstreet`
      )
        .then(response => response.text())
        .then(data => {
          // Parse XML response
          // Simple parsing for example purposes - in production use proper XML parser
          const streetMatch = data.match(/<street1>([^<]+)<\/street1>/);
          const crossStreetMatch = data.match(/<street2>([^<]+)<\/street2>/);
          
          return {
            street: streetMatch ? streetMatch[1] : '',
            crossStreet: crossStreetMatch ? crossStreetMatch[1] : '',
            intersectionString: streetMatch && crossStreetMatch ? `${streetMatch[1]} & ${crossStreetMatch[1]}` : ''
          };
        }),
      3000 // 3 second timeout
    );

    // Execute all promises in parallel and wait for all to complete
    const [orthometricHeight, locationInfo, intersectionInfo] = await Promise.all([
      elevationPromise,
      reverseGeocodePromise,
      intersectionPromise
    ]);

    // Decrement token if not a Pro user (only after successful API calls)
    let remainingTokens = null;
    if (!isProUser) {
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tokenProfileRef.get();
      
      if (tokenDoc.exists) {
        const currentTokens = tokenDoc.data().geoToken;
        const newTokenCount = Math.max(0, currentTokens - 1);
        
        await tokenProfileRef.update({
          geoToken: newTokenCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        remainingTokens = newTokenCount;
      }
    }

    // Return combined response
    return {
      lat: lat,
      lon: lon,
      geoidHeight: geoidHeight,
      geoidSource: geoidFilePath,
      orthometricHeight: orthometricHeight || null,
      orthometricSource: orthometricHeight ? 'Google Maps Elevation Service' : 'Request timed out or failed',
      ellipsoidalHeight: orthometricHeight ? (geoidHeight + orthometricHeight) : null,
      ellipsoidalSource: orthometricHeight ? 'Calculated: ellipsoidalHeight = geoidHeight + orthometricHeight' : 'Could not be calculated',
      location: locationInfo || { streetName: '', locality: '', state: '', country: '', locationString: '' },
      locationSource: locationInfo ? 'Google Maps Reverse Geocoding Service' : 'Request timed out or failed',
      nearestIntersection: intersectionInfo || { street: '', crossStreet: '', intersectionString: '' },
      nearestIntersectionSource: intersectionInfo ? 'GeoNames FindNearestIntersectionOSM Service' : 'Request timed out or failed',
      tokenInfo: {
        isProUser: isProUser,
        remainingTokens: remainingTokens
      }
    };
  });