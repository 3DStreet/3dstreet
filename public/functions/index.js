const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const { getAuth } = require('firebase-admin/auth');
const { serveWebXRVariant } = require('./webxr-variant.js');
const { getGeoidHeight } = require('./geoid-height.js');
const { generateReplicateImage, generateReplicateVideo } = require('./replicate.js');
const { checkAndRefillImageTokens, checkUserProStatus } = require('./token-management.js');
const { bflProxyImage, bflApiProxy } = require('./bfl-proxy.js');
const { onTokenExhaustion } = require('./tokenExhaustion.js');

// Re-export the WebXR variant function
exports.serveWebXRVariant = serveWebXRVariant;

// Re-export the getGeoidHeight function
exports.getGeoidHeight = getGeoidHeight;

// Re-export the Replicate functions
exports.generateReplicateImage = generateReplicateImage;
exports.generateReplicateVideo = generateReplicateVideo;

// Re-export the token management functions
exports.checkAndRefillImageTokens = checkAndRefillImageTokens;
exports.checkUserProStatus = checkUserProStatus;

// Re-export the BFL proxy functions
exports.bflProxyImage = bflProxyImage;
exports.bflApiProxy = bflApiProxy;

// Re-export the token exhaustion notification function
exports.onTokenExhaustion = onTokenExhaustion;

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

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to create checkout session.');
    }

    // SECURITY: Always use the authenticated user's ID from context, never trust client-provided IDs
    const userId = context.auth.uid;

    // Get user email from Firebase Auth
    const userRecord = await getAuth().getUser(userId);
    const userEmail = userRecord.email;

    // Check if customer already exists in our records
    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("userId", "==", userId).get();
    let stripeCustomerId = null;
    querySnapshot.forEach((doc) => {
      stripeCustomerId = doc.data().stripeCustomerId;
      return; // only need the first one
    });

    // Check if customer already has active subscriptions (prevent duplicates)
    if (stripeCustomerId) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: 'active',
          limit: 10
        });

        if (subscriptions.data.length > 0) {
          console.log(`User ${userId} already has ${subscriptions.data.length} active subscription(s)`);
          throw new functions.https.HttpsError(
            'already-exists',
            'You already have an active subscription. Please manage your subscription through the billing portal.'
          );
        }
      } catch (error) {
        // If it's our custom error, re-throw it
        if (error.code === 'already-exists') {
          throw error;
        }
        // Otherwise log and continue (don't block on Stripe API errors)
        console.error('Error checking existing subscriptions:', error);
      }
    }

    // Set either customer or customer_email (mutually exclusive)
    if (stripeCustomerId) {
      // Returning customer - use their customer ID
      data.customer = stripeCustomerId;
    } else if (userEmail) {
      // New customer - pre-fill their email
      data.customer_email = userEmail;
    }
    
    // Set metadata.userId with the authenticated user's ID for security
    if (!data.metadata) {
      data.metadata = {};
    }
    data.metadata.userId = userId;

    if (data.subscription_data) {
      if (!data.subscription_data.metadata) {
        data.subscription_data.metadata = {};
      }
      data.subscription_data.metadata.userId = userId;
    }

    // Restrict payment methods (removes US bank account, keeps card/Google Pay/Apple Pay)
    // Override any client-provided payment_method_types for security
    data.payment_method_types = ['card'];

    const session = await stripe.checkout.sessions.create(data);

    return {
      id: session.id,
      clientSecret: session.client_secret // For embedded checkout
    };
  });

exports.getStripeSessionStatus = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
  .https
  .onCall(async (data, context) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to check session status.');
    }

    const { sessionId } = data;

    if (!sessionId) {
      throw new functions.https.HttpsError('invalid-argument', 'Session ID is required.');
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      // Verify this session belongs to the authenticated user
      if (session.metadata?.userId !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'Session does not belong to authenticated user.');
      }

      return {
        status: session.status,
        customer_email: session.customer_details?.email,
        payment_status: session.payment_status
      };
    } catch (error) {
      console.error('Error retrieving session:', error);
      throw new functions.https.HttpsError('internal', 'Failed to retrieve session status.');
    }
  });

exports.checkActiveSubscriptions = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
  .https
  .onCall(async (data, context) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to check subscriptions.');
    }

    const userId = context.auth.uid;

    try {
      // Get Stripe customer ID from Firestore
      const collectionRef = admin.firestore().collection("userProfile");
      const querySnapshot = await collectionRef.where("userId", "==", userId).get();
      let stripeCustomerId = null;
      querySnapshot.forEach((doc) => {
        stripeCustomerId = doc.data().stripeCustomerId;
        return;
      });

      // If no customer ID, user has never subscribed
      if (!stripeCustomerId) {
        return {
          hasActiveSubscription: false,
          subscriptionCount: 0,
          subscriptions: []
        };
      }

      // Check for active subscriptions
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'active',
        limit: 10
      });

      return {
        hasActiveSubscription: subscriptions.data.length > 0,
        subscriptionCount: subscriptions.data.length,
        subscriptions: subscriptions.data.map(sub => ({
          id: sub.id,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
          planId: sub.items.data[0]?.price?.id,
          interval: sub.items.data[0]?.price?.recurring?.interval
        }))
      };
    } catch (error) {
      console.error('Error checking subscriptions:', error);
      throw new functions.https.HttpsError('internal', 'Failed to check subscriptions.');
    }
  });

exports.createStripeBillingPortal = functions
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
  .https
  .onCall(async (data, context) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to access billing portal.');
    }

    // SECURITY: Always use the authenticated user's ID from context, never trust client-provided IDs
    const userId = context.auth.uid;

    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("userId", "==", userId).get();
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
  .runWith({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET_CHECKOUT", "STRIPE_YEARLY_PRICE_ID", "STRIPE_MONTHLY_PRICE_ID"] })
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

    // Retrieve the full session details including line items
    const sessionWithLineItems = await stripe.checkout.sessions.retrieve(
      checkoutSession.id,
      {
        expand: ['line_items']
      }
    );

    // Check if this is an annual or monthly plan purchase
    const annualPriceId = process.env.STRIPE_YEARLY_PRICE_ID;
    const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID;

    let isAnnualPlan = false;
    let isMonthlyPlan = false;
    if (sessionWithLineItems.line_items && sessionWithLineItems.line_items.data) {
      if (annualPriceId) {
        isAnnualPlan = sessionWithLineItems.line_items.data.some(item =>
          item.price.id === annualPriceId
        );
      }
      if (monthlyPriceId) {
        isMonthlyPlan = sessionWithLineItems.line_items.data.some(item =>
          item.price.id === monthlyPriceId
        );
      }
    }

    const collectionRef = admin.firestore().collection("userProfile");
    const querySnapshot = await collectionRef.where("userId", "==", checkoutSession.metadata.userId).get();
    let stripeCustomerId = null;

    querySnapshot.forEach((doc) => {
      stripeCustomerId = doc.data().stripeCustomerId;
      return; // only need the first one
    });

    // Update or create user profile with stripeCustomerId
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

    // Grant tokens for subscription purchases
    if (isAnnualPlan || isMonthlyPlan) {
      const db = admin.firestore();
      const tokenProfileRef = db.collection('tokenProfile').doc(checkoutSession.metadata.userId);

      // Determine token amount based on plan type
      const tokensToGrant = isAnnualPlan ? 840 : 100;
      const planType = isAnnualPlan ? 'annual' : 'monthly';

      try {
        const tokenDoc = await tokenProfileRef.get();

        if (tokenDoc.exists) {
          // User has existing token profile, add tokens
          const currentTokens = tokenDoc.data().genToken || 0;
          await tokenProfileRef.update({
            genToken: currentTokens + tokensToGrant,
            lastMonthlyRefill: `${new Date().getFullYear()}-${new Date().getMonth()}`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`${planType} tokens granted: user=${checkoutSession.metadata.userId} added=${tokensToGrant} total=${currentTokens + tokensToGrant}`);
        } else {
          // Create new token profile with granted tokens
          const newProfile = {
            userId: checkoutSession.metadata.userId,
            geoToken: 3,
            genToken: tokensToGrant, // Annual: 840; Monthly: 100
            lastMonthlyRefill: `${new Date().getFullYear()}-${new Date().getMonth()}`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };

          await tokenProfileRef.set(newProfile);
          console.log(`${planType} token profile created: user=${checkoutSession.metadata.userId} tokens=${tokensToGrant}`);
        }
      } catch (error) {
        console.error(`${planType} token grant failed: user=${checkoutSession.metadata.userId}`, error);
        // Don't fail the webhook, just log the error
      }
    }

    return res.sendStatus(200);
  });

// Discord webhook function for sharing scenes
exports.shareToDiscord = functions
  .runWith({ secrets: ["DISCORD_WEBHOOK_URL"] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to share scenes.');
    }

    const { title, location, username, sceneUrl, imageUrl } = data;

    // Validate required data
    if (!title || !username || !sceneUrl) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing required scene data.');
    }

    // Create Discord message with embed for rich preview
    const message = {
      content: `🙋 **${username}** shared a new scene!`,
      embeds: [{
        title: title,
        description: location ? `📍 ${location}` : undefined,
        url: sceneUrl,
        color: 0x6366F1, // Indigo color for the embed stripe
        image: imageUrl ? {
          url: imageUrl
        } : undefined,
        footer: {
          text: '3DStreet',
          icon_url: 'https://3dstreet.app/favicon-32x32.png'
        },
        timestamp: new Date().toISOString()
      }]
    };

    try {
      const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }

      return { success: true, message: 'Scene shared to Discord successfully!' };
    } catch (error) {
      console.error('Error sharing to Discord:', error);
      throw new functions.https.HttpsError('internal', 'Failed to share scene to Discord.');
    }
  });
