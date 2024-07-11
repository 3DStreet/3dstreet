const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const { getAuth } = require('firebase-admin/auth');

exports.getScene = functions
  .https
  .onRequest(async (req, res) => {
    // Extract scene id from the path, remove the .json part
    res.set('Access-Control-Allow-Origin', '*');
    const documentId = req.path
      .split('/')
      .filter(Boolean)[1]
      .replace('.json', '');
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
