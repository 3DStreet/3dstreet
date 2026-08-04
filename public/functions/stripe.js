/**
 * Stripe billing — checkout sessions, billing portal, and webhooks.
 * Extracted from index.js (which only re-exports these, same pattern as the
 * other modules). Token-balance mutations live in token-management.js
 * (grantPurchasedTokens); pack definitions in token-packs.js.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('./app-check.js');
const { isUserProInternal, grantPurchasedTokens } = require('./token-management.js');
const { TOKEN_PACK_PRICE_SECRETS, findTokenPackByPriceIds } = require('./token-packs.js');
const { sendLifecycleEmail } = require('./email/lifecycle-email.js');
const EMAIL_TEMPLATES = require('./email/templates.js');

const createStripeSession = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'ALLOWED_PRO_TEAM_DOMAINS', ...TOKEN_PACK_PRICE_SECRETS] })
  .https
  .onCall(async (data, context) => {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to create checkout session.');
    }
    assertAppCheck(context);

    // SECURITY: Always use the authenticated user's ID from context, never trust client-provided IDs
    const userId = context.auth.uid;

    // Get user email from Firebase Auth
    const userRecord = await getAuth().getUser(userId);
    const userEmail = userRecord.email;

    // One-time gen-token pack checkout (#1374). Packs are an upsell for paid
    // plans only — free users are routed to the Pro upgrade by the client, and
    // this server-side gate makes sure a hand-crafted call can't sidestep that.
    // Domain-team Pro (no plan claim) counts as paid, same as everywhere else.
    const requestedPriceIds = (Array.isArray(data.line_items) ? data.line_items : [])
      .map((item) => item && item.price)
      .filter(Boolean);
    const requestedTokenPack = findTokenPackByPriceIds(requestedPriceIds);
    if (requestedTokenPack) {
      const isPaidUser = await isUserProInternal(userId);
      if (!isPaidUser) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Token packs require a Pro or Max plan. Upgrade to purchase additional tokens.'
        );
      }
      // Packs are one-time purchases — never let a client open one as a subscription.
      data.mode = 'payment';
    }

    // Check if customer already exists in our records
    const collectionRef = admin.firestore().collection('userProfile');
    const querySnapshot = await collectionRef.where('userId', '==', userId).get();
    let stripeCustomerId = null;
    querySnapshot.forEach((doc) => {
      stripeCustomerId = doc.data().stripeCustomerId;
      return; // only need the first one
    });

    // Check if customer already has active subscriptions (prevent duplicates).
    // Skipped for one-time payments: token pack buyers are usually active
    // subscribers, and an existing subscription is no reason to block a pack.
    if (stripeCustomerId && data.mode !== 'payment') {
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

    // Trigger instrumentation for the abandoned-checkout lifecycle email
    // (email/lifecycle-sweeps.js): record the open session, and stamp the
    // user's last checkout start so the pricing-page nudge excludes anyone
    // who actually reached checkout. Never blocks checkout on failure.
    try {
      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('checkoutSessions').doc(session.id).set({
        userId,
        email: userEmail || null,
        priceId: data.line_items?.[0]?.price ?? null,
        mode: data.mode || null,
        status: 'open',
        createdAt: now
      });
      await db.collection('userSignals').doc(userId).set(
        { userId, lastCheckoutStartedAt: now },
        { merge: true }
      );
    } catch (err) {
      console.error(`checkoutSessions instrumentation failed for ${userId}:`, err);
    }

    return {
      id: session.id,
      url: session.url, // For hosted checkout redirect (null in embedded mode)
      clientSecret: session.client_secret // For embedded checkout
    };
  });

const checkActiveSubscriptions = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https
  .onCall(async (data, context) => {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to check subscriptions.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;

    try {
      // Get Stripe customer ID from Firestore
      const collectionRef = admin.firestore().collection('userProfile');
      const querySnapshot = await collectionRef.where('userId', '==', userId).get();
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
          currentPeriodEnd: sub.items.data[0]?.current_period_end,
          planId: sub.items.data[0]?.price?.id,
          interval: sub.items.data[0]?.price?.recurring?.interval
        }))
      };
    } catch (error) {
      console.error('Error checking subscriptions:', error);
      throw new functions.https.HttpsError('internal', 'Failed to check subscriptions.');
    }
  });

const createStripeBillingPortal = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https
  .onCall(async (data, context) => {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to access billing portal.');
    }
    assertAppCheck(context);

    // SECURITY: Always use the authenticated user's ID from context, never trust client-provided IDs
    const userId = context.auth.uid;

    const collectionRef = admin.firestore().collection('userProfile');
    const querySnapshot = await collectionRef.where('userId', '==', userId).get();
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
const handleSubscriptionWebhook = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET_SUBSCRIPTION'] })
  .https
  .onRequest(async (req, res) => {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET_SUBSCRIPTION
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed.');
      return res.status(400).send(err);
    }

    const subscription = event.data.object;

    const collectionRef = admin.firestore().collection('userProfile');
    const querySnapshot = await collectionRef.where('stripeCustomerId', '==', subscription.customer).get();
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

// Best-effort status update on the checkoutSessions trigger record (written
// by createStripeSession). Feeds the abandoned-checkout sweep: 'complete'
// sessions are excluded; 'open'/'expired' both count as abandoned.
const markCheckoutSessionStatus = async (sessionId, status) => {
  try {
    await admin.firestore().collection('checkoutSessions').doc(sessionId).set({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error(`Failed to mark checkoutSession ${sessionId} ${status}:`, err);
  }
};

// invoice.payment_failed → Failed Payment email, once per invoice (Stripe
// fires this event again on each retry attempt; the dedupeKey absorbs them).
// DORMANT: dunning uses Stripe's hosted failed-payment emails instead, so
// invoice.payment_failed is not enabled on the webhook endpoint. Kept as a
// fallback — re-enabling the event in the Stripe dashboard reactivates this.
// Never run both (double email). See docs/email-lifecycle.md.
const handleInvoicePaymentFailed = async (invoice) => {
  const customerId = invoice.customer;
  if (!customerId) {
    console.warn(`invoice.payment_failed without customer: ${invoice.id}`);
    return;
  }

  const querySnapshot = await admin.firestore()
    .collection('userProfile')
    .where('stripeCustomerId', '==', customerId)
    .get();
  let userId = null;
  querySnapshot.forEach((doc) => {
    userId = doc.data().userId;
    return; // only need the first one
  });

  if (!userId) {
    console.warn(`invoice.payment_failed: no userProfile for customer ${customerId} (invoice ${invoice.id})`);
    return;
  }

  const result = await sendLifecycleEmail({
    db: admin.firestore(),
    uid: userId,
    emailId: 'failedPayment',
    category: 'transactional',
    stream: 'outbound',
    template: EMAIL_TEMPLATES.failedPayment,
    dedupeKey: invoice.id
  });
  console.log(`failedPayment email for invoice ${invoice.id} (user ${userId}):`, JSON.stringify(result));
};

// Stripe webhook endpoint (one endpoint, one signing secret). The endpoint's
// enabled events in the Stripe dashboard must include:
//   checkout.session.completed  — plan claim + token grant + post-upgrade email
//   checkout.session.expired    — marks the abandoned-checkout trigger record
// (invoice.payment_failed is handled below but deliberately NOT enabled —
// see the dormant note on handleInvoicePaymentFailed.)
// Unrecognized events are acked and ignored, so enabling extra events is safe.
const stripeWebhook = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET_CHECKOUT', 'STRIPE_YEARLY_PRICE_ID', 'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_MAX_YEARLY_PRICE_ID', 'STRIPE_MAX_MONTHLY_PRICE_ID', 'POSTMARK_API_KEY', ...TOKEN_PACK_PRICE_SECRETS] })
  .https
  .onRequest(async (req, res) => {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET_CHECKOUT
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed.');
      return res.status(400).send(err);
    }

    if (event.type === 'checkout.session.expired') {
      await markCheckoutSessionStatus(event.data.object.id, 'expired');
      return res.sendStatus(200);
    }

    if (event.type === 'invoice.payment_failed') {
      await handleInvoicePaymentFailed(event.data.object);
      return res.sendStatus(200);
    }

    if (event.type !== 'checkout.session.completed') {
      console.log(`stripeWebhook: ignoring event type ${event.type}`);
      return res.sendStatus(200);
    }

    const checkoutSession = event.data.object;

    // Retrieve the full session details including line items
    const sessionWithLineItems = await stripe.checkout.sessions.retrieve(
      checkoutSession.id,
      {
        expand: ['line_items']
      }
    );

    // One-time token pack purchase? Grant tokens + audit row and stop — none
    // of the subscription plan-claim / welcome-email logic below applies.
    const lineItems = sessionWithLineItems.line_items?.data || [];
    const packLineItem = lineItems.find((item) =>
      findTokenPackByPriceIds([item.price?.id].filter(Boolean))
    );
    if (packLineItem) {
      const pack = findTokenPackByPriceIds([packLineItem.price.id]);
      await grantPurchasedTokens({
        checkoutSession,
        pack,
        quantity: packLineItem.quantity || 1
      });
      await markCheckoutSessionStatus(checkoutSession.id, 'complete');
      return res.sendStatus(200);
    }

    // Resolve which tier (PRO / MAX) and billing cycle (annual / monthly) was
    // purchased by matching the checkout's line-item price IDs against the four
    // configured price-ID secrets. MAX is a superset of PRO; both unlock all
    // Pro features (see isPaidPlanClaim in token-management.js).
    //
    // Token grant = the tier's monthly floor, regardless of cycle. Subscriptions
    // are "pure" recurring access + a metered monthly drip (PRO 100, MAX 500); the
    // ~30% annual discount is the only annual sweetener — there is no up-front
    // lump-sum bonus on annual. This seed just covers the first month; the monthly
    // top-up-to-floor in token-management.js handles every cycle thereafter. (Bulk
    // token purchasing is the one-time token packs, handled above — token-packs.js.)
    const PRICE_CONFIG = [
      { tier: 'MAX', cycle: 'annual', priceId: process.env.STRIPE_MAX_YEARLY_PRICE_ID, tokens: 500 },
      { tier: 'MAX', cycle: 'monthly', priceId: process.env.STRIPE_MAX_MONTHLY_PRICE_ID, tokens: 500 },
      { tier: 'PRO', cycle: 'annual', priceId: process.env.STRIPE_YEARLY_PRICE_ID, tokens: 100 },
      { tier: 'PRO', cycle: 'monthly', priceId: process.env.STRIPE_MONTHLY_PRICE_ID, tokens: 100 }
    ];

    const purchasedPriceIds =
      (sessionWithLineItems.line_items && sessionWithLineItems.line_items.data
        ? sessionWithLineItems.line_items.data.map(item => item.price?.id).filter(Boolean)
        : []);

    const matchedPlan = PRICE_CONFIG.find(
      entry => entry.priceId && purchasedPriceIds.includes(entry.priceId)
    );

    // Loud warning if a checkout completed but no plan matched — usually means
    // the STRIPE_*_PRICE_ID secrets drifted from the price IDs the frontend is
    // actually selling. We still fall back to granting PRO below (preserves the
    // original behavior) so a transient secret misconfig doesn't strand a paying
    // user without access.
    if (!matchedPlan) {
      console.warn(
        `checkout completed but no plan matched: session=${checkoutSession.id} ` +
        `userId=${checkoutSession.metadata?.userId} ` +
        `seen=[${purchasedPriceIds.join(',')}] ` +
        `expected=[${PRICE_CONFIG.map(e => `${e.tier}/${e.cycle}=${e.priceId || 'unset'}`).join(', ')}]`
      );
    }

    const planTier = matchedPlan ? matchedPlan.tier : 'PRO';

    const collectionRef = admin.firestore().collection('userProfile');
    const querySnapshot = await collectionRef.where('userId', '==', checkoutSession.metadata.userId).get();
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
      plan: planTier
    };
    await getAuth().setCustomUserClaims(checkoutSession.metadata.userId, customClaims);

    // Grant tokens for subscription purchases. Only when we matched a known
    // price (the PRO fallback above sets the claim but, with no token mapping,
    // we don't guess an allotment).
    if (matchedPlan) {
      const db = admin.firestore();
      const tokenProfileRef = db.collection('tokenProfile').doc(checkoutSession.metadata.userId);

      // Token amount is the tier's monthly floor (PRO 100, MAX 500), same for
      // both cycles — annual carries no up-front bonus.
      const tokensToGrant = matchedPlan.tokens;
      const planType = `${matchedPlan.tier} ${matchedPlan.cycle}`;

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
            genToken: tokensToGrant, // tier monthly floor: PRO 100 · MAX 500 (both cycles)
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

    // Close out the abandoned-checkout trigger record for this session.
    await markCheckoutSessionStatus(checkoutSession.id, 'complete');

    // Post-Upgrade Welcome email. Keyed on the session id so Stripe webhook
    // retries (and re-purchases via a NEW session) behave correctly: one email
    // per completed checkout. Errors are swallowed — failing the webhook here
    // would make Stripe retry and re-run the non-idempotent token grant above.
    try {
      const result = await sendLifecycleEmail({
        db: admin.firestore(),
        uid: checkoutSession.metadata.userId,
        emailId: 'postUpgradeWelcome',
        category: 'transactional',
        stream: 'outbound',
        template: EMAIL_TEMPLATES.postUpgradeWelcome,
        data: { planTier },
        dedupeKey: checkoutSession.id
      });
      console.log(`postUpgradeWelcome for session ${checkoutSession.id} (user ${checkoutSession.metadata.userId}):`, JSON.stringify(result));
    } catch (err) {
      console.error(`postUpgradeWelcome failed for session ${checkoutSession.id}:`, err);
    }

    return res.sendStatus(200);
  });

module.exports = {
  createStripeSession,
  checkActiveSubscriptions,
  createStripeBillingPortal,
  handleSubscriptionWebhook,
  stripeWebhook
};
