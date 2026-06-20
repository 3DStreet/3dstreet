/**
 * Editor AI chat proxy — the server-side gate for the Editor "AI Assistant".
 *
 * Why this exists: the client used to call Firebase AI Logic
 * (firebasevertexai.googleapis.com) directly via the public web API key. That
 * endpoint lets the *browser* choose the model, so anyone replaying the public
 * key could request an expensive image model (gemini-3-pro-image-preview) on our
 * bill — which is exactly what triggered the 2026-06-19 billing incident. App
 * Check can't stop a logged-in browser from picking a model, and referrer locks
 * are spoofable, so the durable fix is to stop exposing model selection to the
 * client at all.
 *
 * This callable is now the ONLY path to the model. It:
 *   - requires Firebase Auth (every call is attributable to a uid)
 *   - HARDCODES the model (text only) and ignores any client-supplied model
 *   - rate-limits per uid (caps a single compromised/abusive account)
 *   - clamps output tokens and rejects oversized inputs
 *
 * Prompt text, tool declarations and chat history are still built client-side
 * and passed through — they aren't the cost-attack surface once the model is
 * locked and calls are authenticated + rate-limited. Tool *execution* stays in
 * the browser (it mutates the live A-Frame scene); this only proxies the model
 * round-trip.
 *
 * SDK: @google/genai with the Vertex backend. gemini-3 preview models are only
 * served on the `global` location (regional endpoints 404); the Gen AI SDK
 * targets it natively. (The older @google-cloud/vertexai SDK is deprecated and
 * scheduled for removal 2026-06-24.)
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

// Locked server-side. The Editor only ever needs text generation; the image
// model is deliberately unreachable from here.
const MODEL_ID = 'gemini-3-flash-preview';
// gemini-3 preview is served on the global endpoint only.
const LOCATION = 'global';

const MAX_OUTPUT_TOKENS = 4096;
// Guard against a single giant prompt running up input tokens. The legit prompt
// (scene JSON + mixin catalog + history) is well under this; it only bounds abuse.
const MAX_INPUT_CHARS = 300000;

// Per-uid sliding-window caps. The Editor chat is interactive — a human sends a
// handful of messages a minute — so these are generous for real use while
// capping a scripted account hard.
const RATE_PER_MIN = 20;
const RATE_PER_DAY = 300;

let genaiClient = null;
function getClient() {
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT,
      location: LOCATION
    });
  }
  return genaiClient;
}

/**
 * Sliding-window rate limit per uid, stored at users/{uid}/meta/aiChatRate.
 * Throws resource-exhausted when either window is exceeded. Best-effort fail
 * is NOT used here — if the limiter can't run we'd rather block than risk an
 * uncapped account, so a transaction error propagates.
 */
async function enforceRateLimit(uid) {
  const ref = admin
    .firestore()
    .collection('users')
    .doc(uid)
    .collection('meta')
    .doc('aiChatRate');

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const d = snap.exists ? snap.data() : {};

    const minStart = d.minStart || 0;
    const dayStart = d.dayStart || 0;
    let minCount = d.minCount || 0;
    let dayCount = d.dayCount || 0;

    const nextMinStart = now - minStart >= 60 * 1000 ? now : minStart;
    if (nextMinStart === now) minCount = 0;
    const nextDayStart = now - dayStart >= 24 * 60 * 60 * 1000 ? now : dayStart;
    if (nextDayStart === now) dayCount = 0;

    if (minCount >= RATE_PER_MIN) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Too many requests — please wait a moment and try again.'
      );
    }
    if (dayCount >= RATE_PER_DAY) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Daily AI assistant limit reached. Try again tomorrow.'
      );
    }

    tx.set(
      ref,
      {
        minStart: nextMinStart,
        minCount: minCount + 1,
        dayStart: nextDayStart,
        dayCount: dayCount + 1,
        lastRequestAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });
}

// Convert the client's lightweight history ({ role: 'user'|'assistant',
// content: string }) into Gen AI `contents`. 'assistant' maps to the 'model'
// role; everything becomes a single text part.
function historyToContents(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }]
    }));
}

// The client historically built tool schemas with Firebase AI Logic's Schema
// builder, which emits `optionalProperties` — a field the Vertex/Gen AI API
// rejects (it expresses optionality via `required`). Normalize defensively so
// even a cached old client works: keep only the OpenAPI-subset keys the API
// accepts, and convert optionalProperties → required.
const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'format',
  'nullable'
]);

function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (ALLOWED_SCHEMA_KEYS.has(k)) out[k] = v;
  }

  if (out.properties && typeof out.properties === 'object') {
    const props = {};
    for (const [k, v] of Object.entries(out.properties)) {
      props[k] = sanitizeSchema(v);
    }
    out.properties = props;

    // If the source used `optionalProperties` instead of `required`, derive
    // `required` from it (unless the schema already specified required).
    if (!out.required && Array.isArray(schema.optionalProperties)) {
      const optional = new Set(schema.optionalProperties);
      const required = Object.keys(props).filter((k) => !optional.has(k));
      if (required.length) out.required = required;
    }
  }

  if (out.items) out.items = sanitizeSchema(out.items);
  return out;
}

function sanitizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((tool) => ({
    ...tool,
    functionDeclarations: (tool.functionDeclarations || []).map((fd) => ({
      ...fd,
      parameters: fd.parameters ? sanitizeSchema(fd.parameters) : fd.parameters
    }))
  }));
}

const generateEditorChat = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be signed in to use the AI assistant.'
      );
    }
    const uid = context.auth.uid;

    const message = typeof data?.message === 'string' ? data.message : '';
    if (!message.trim()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Message is required.'
      );
    }

    const systemInstruction =
      typeof data?.systemInstruction === 'string' ? data.systemInstruction : '';
    // Tool declarations. Shape: [{ functionDeclarations: [...] }]. Sanitized to
    // the OpenAPI subset the Vertex API accepts. Execution happens in the browser.
    const tools = sanitizeTools(data?.tools);
    const history = data?.history;

    // Cheap input ceiling before we spend a model call.
    const approxChars =
      message.length +
      systemInstruction.length +
      JSON.stringify(history || '').length;
    if (approxChars > MAX_INPUT_CHARS) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Request too large for the AI assistant.'
      );
    }

    await enforceRateLimit(uid);

    const contents = [
      ...historyToContents(history),
      { role: 'user', parts: [{ text: message }] }
    ];

    const config = { maxOutputTokens: MAX_OUTPUT_TOKENS };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (tools && tools.length) config.tools = tools;

    let response;
    try {
      response = await getClient().models.generateContent({
        model: MODEL_ID,
        contents,
        config
      });
    } catch (err) {
      console.error(`[ai-chat-proxy] Gen AI error uid=${uid}:`, err);
      // Surface a short, safe reason to the client so the chat can show what
      // went wrong instead of a generic failure. Provider error messages carry
      // model/quota/permission info (no secrets); cap the length to be safe.
      const reason = (err && err.message ? String(err.message) : 'unknown error')
        .replace(/\s+/g, ' ')
        .slice(0, 200);
      throw new functions.https.HttpsError(
        'internal',
        `The AI assistant failed: ${reason}`
      );
    }

    // `.text` and `.functionCalls` are getters on the Gen AI response; both can
    // be undefined (text-only or call-only turns).
    return {
      text: response?.text || '',
      functionCalls: response?.functionCalls || [],
      usageMetadata: response?.usageMetadata || null
    };
  });

module.exports = { generateEditorChat };
