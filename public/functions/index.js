const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const { getAuth } = require('firebase-admin/auth');
const { getGeoidHeightFromPGM } = require('./geoid.js');
const { Client: GoogleMapsClient } = require("@googlemaps/google-maps-services-js");

exports.getGeoidHeight = functions
  .runWith({ secrets: ["GOOGLE_MAPS_ELEVATION_API_KEY"] })
  .https
  .onCall(async (data, context) => {
    const lat = parseFloat(data.lat);
    const lon = parseFloat(data.lon);
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
            result_type: "street_address|route|locality|administrative_area",
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
      nearestIntersectionSource: intersectionInfo ? 'GeoNames FindNearestIntersectionOSM Service' : 'Request timed out or failed'
    };
  });

exports.getScene = functions
  .https
  .onRequest(async (req, res) => {
    // Extract scene id from the path, remove the .json part
    res.set('Access-Control-Allow-Origin', '*');
    const documentId = req.path
      .split('/')
      .filter(Boolean)[1]
    if (!documentId) {
      res.status(400).send({ error: 'Scene ID is required' });
      return;
    }

    try {
      const doc = await admin
        .firestore()
        .collection('scenes')
        .doc(documentId)
        .get();
      if (!doc.exists) {
        res
          .status(404)
          .send({ error: `Scene not found. DocumentID: ${documentId}` });
      } else {
        res.send(doc.data());
      }
    } catch (err) {
      res.status(500).send({ error: 'Error retrieving scene' });
    }
  });

exports.createStripeSession = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
  .https
  .onCall(async (data, context) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // get stripeCustomerID if it exists
    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("userId", "==", data.metadata.userId).get();
    let stripeCustomerId = null;
    querySnapshot.forEach((doc) => {
      stripeCustomerId = doc.data().stripeCustomerId;
      return; // only need the first one
    });
    // update data to include stripeCustomerID (data.customer)

    if (stripeCustomerId) {
      data.customer = stripeCustomerId;
    }
    const session = await stripe.checkout.sessions.create(data);

    return {
      id: session.id
    };
  });

exports.createStripeBillingPortal = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
  .https
  .onCall(async (data, context) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("userId", "==", data.user_id).get();
    let stripeCustomerId = null;
    querySnapshot.forEach((doc) => {
      stripeCustomerId = doc.data().stripeCustomerId;
      return; // only need the first one
    });
    // update data to include stripeCustomerID (data.customer)

    if (!stripeCustomerId) {
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: data.return_url
    });

    return {
      url: session.url
    };
  });

// function for Stripe webhook customer.subscription.deleted
exports.handleSubscriptionWebhook = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET_SUBSCRIPTION"] })
  .https
  .onRequest(async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET_SUBSCRIPTION
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed.');
      return res.send(err).sendStatus(400);
    }

    const subscription = event.data.object;

    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("stripeCustomerId", "==", subscription.customer).get();
    let userId = null;
    querySnapshot.forEach((doc) => {
      userId = doc.data().userId;
      return; // only need the first one
    });

    if (!userId) {
      // add stripeCustomerId to userProfile
      return res.sendStatus(500);
    }

    // Set custom user claims on this update.
    const customClaims = {
      plan: ''
    };
    await getAuth().setCustomUserClaims(userId, customClaims);

    return res.sendStatus(200);


  });

// function for Stripe webhook checkout.session.completed
exports.stripeWebhook = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET_CHECKOUT"] })
  .https
  .onRequest(async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET_CHECKOUT
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed.');
      return res.send(err).sendStatus(400);
    }

    const checkoutSession = event.data.object;

    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("userId", "==", checkoutSession.metadata.userId).get();
    let stripeCustomerId = null;
    querySnapshot.forEach((doc) => {
      stripeCustomerId = doc.data().stripeCustomerId;
      return; // only need the first one
    });
    // update data to include stripeCustomerID (data.customer)

    if (!stripeCustomerId) {
      // add stripeCustomerId to userProfile
      await admin.firestore().collection('userProfile').doc().set({
        userId: checkoutSession.metadata.userId,
        stripeCustomerId: checkoutSession.customer
      });
    }

    // Set custom user claims on this update.
    const customClaims = {
      plan: 'PRO'
    };
    await getAuth().setCustomUserClaims(checkoutSession.metadata.userId, customClaims);

    return res.sendStatus(200);
  });
