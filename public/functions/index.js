const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const { getAuth } = require('firebase-admin/auth');

exports.getScene = functions.https.onRequest(async (req, res) => {
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

exports.createStripeSession = functions.https.onCall(async (data, context) => {
  const stripe = require('stripe')('sk_test_30qcK5wZwyN1q6NMKIirvyD7');

  const session = await stripe.checkout.sessions.create(data);

  return {
    id: session.id
  };
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const stripe = require('stripe')('sk_test_30qcK5wZwyN1q6NMKIirvyD7');
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      req.headers['stripe-signature'],
      'whsec_6Em4oxFarrevhzxWdj8AKClmDBorBfaf'
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.');
    return res.send(err).sendStatus(400);
  }

  const dataObject = event.data.object;
  await admin.firestore().collection('orders').doc().set({
    checkoutSessionId: dataObject.id,
    paymentStatus: dataObject.payment_status,
    userId: dataObject.metadata.userId
  });

  // Set custom user claims on this update.
  const customClaims = {
    plan: 'PRO'
  };
  await getAuth().setCustomUserClaims(dataObject.metadata.userId, customClaims);

  return res.sendStatus(200);
});
