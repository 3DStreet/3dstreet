const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

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
  const stripe = require('stripe')(
    'sk_test_51PAsDFP2BZd7kkhqseXWoZnLwoKiuTwL4u7LAnkGJeUpTFy2YducfwlSq6YhuBaB5eZUpc9ZNsyhIZZAQFnrIlGb00GAZp2S4h'
  );

  const session = await stripe.checkout.sessions.create(data);

  return {
    id: session.id
  };
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const stripe = require('stripe')(
    'pk_test_51PAsDFP2BZd7kkhq6uIm5LRHQQCR2qBppnVwMA1vAokzkgjlngXgAgfaz1jexz1IbqoE2WjEQSWxjTpdeDNeJZSP00PqhX34fp'
  );
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      req.headers['stripe-signature'],
      'whsec_L7OLhcNHHiQ7dHbQiz0ad0j1cOFCKcQZ'
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

  return res.sendStatus(200);
});
