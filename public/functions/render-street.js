/**
 * renderStreet — public HTTP endpoint that turns a managed-street JSON blob
 * into a rendered "beauty shot" PNG: an angled pseudo-orthographic view
 * (perspective camera, narrow FOV) with the cross-section label bar, exactly
 * as the 3DStreet app renders it.
 *
 * Built for LLM / skill / MCP callers: text prompt → managed-street JSON →
 * one POST → image, plus an `openInEditorUrl` deep link that loads the same
 * street in the full 3DStreet editor (the inbound hook for further work:
 * 3D maps, AI rendering, editing). See docs/street-render-endpoint.md.
 *
 * How it works: puppeteer drives the deployed render page (render.html +
 * dist/street-render.js — a lean, editor-free bundle of the managed-street
 * component stack). The page exposes window.__STREET_RENDER__ with a
 * status/capture contract; readiness is model-load quiescence, not a fixed
 * delay. Headless Chromium renders WebGL via SwiftShader (no GPU needed).
 *
 * API (also usable via hosting rewrite /render-street):
 *   POST { street: {name, length, segments:[...]}, options?: {...} }
 *   POST { name, length, segments:[...] }            (bare street works too)
 *   GET  ?data=<base64url of either shape>
 *
 *   options: width, height (image px), fov, azimuth, elevation, margin,
 *            environment (street-environment preset), labels, vehicles,
 *            ground, boundaries, units ('metric'|'imperial'), title,
 *            branding, type ('png'|'jpg'), quality
 *
 *   Response: image bytes (image/png or image/jpeg) with the editor deep
 *   link in the X-3DStreet-Editor-Url header and the stable cached image
 *   URL in X-3DStreet-Image-Url, or with ?format=json a JSON body
 *   { image: <dataURL>, imageUrl, openInEditorUrl, meta, width, height }.
 */
/* global window */ // window only appears inside page.evaluate (browser ctx)
const { onRequest } = require('firebase-functions/v2/https');

const RENDER_PAGE_URL =
  process.env.RENDER_PAGE_URL || 'https://3dstreet.app/render.html';
const EDITOR_BASE_URL = process.env.EDITOR_BASE_URL || 'https://3dstreet.app/';

const crypto = require('crypto');
const admin = require('firebase-admin');

const MAX_PAYLOAD_BYTES = 262144; // 256 KB of street JSON is plenty
const MAX_SEGMENTS = 64;
const READY_TIMEOUT_MS = 90000;

// --- stable image URL cache ---------------------------------------------
// Successful renders are stored in the default bucket under
// renders/<version>/<hash>.<ext> with an input sidecar (<hash>.json), and
// the response carries a stable URL served by serveRenderImage via the
// hosting rewrite /render/img/**. The URL is the public contract; storage
// is an implementation detail we can move later. The version segment lets
// a future renderer change invalidate cleanly. The bucket path is
// Admin-SDK-only (storage.rules default-deny; no public ACLs needed).
const RENDER_CACHE_VERSION = 'v1';

// Deterministic JSON: recursively sorted object keys, so semantically
// identical payloads hash alike regardless of key order. Requests that
// spell out a default option (e.g. azimuth: 20) hash differently from ones
// that omit it — that's acceptable: same key ⇒ same pixels is the invariant,
// perfect dedup is not.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function renderCacheKey(street, options) {
  return crypto
    .createHash('sha256')
    .update(canonicalize({ street, options }))
    .digest('hex')
    .slice(0, 20);
}

// One shared browser per warm instance; relaunched if it dies.
let browserPromise = null;

async function launchBrowser() {
  const puppeteer = require('puppeteer-core');
  // Local/dev override (e.g. a system chromium); default is the
  // lambda-compatible build @sparticuz/chromium unpacks into /tmp.
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  let args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars'
  ];
  if (!executablePath) {
    const chromium = require('@sparticuz/chromium');
    chromium.setGraphicsMode = true; // keep WebGL (SwiftShader) available
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }
  return puppeteer.launch({
    executablePath,
    args: [...args, '--enable-unsafe-swiftshader'],
    defaultViewport: null,
    headless: 'shell'
  });
}

async function getBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.connected) return browser;
    } catch {
      // fall through to relaunch
    }
  }
  browserPromise = launchBrowser();
  return browserPromise;
}

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

function decodeBase64Url(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

/**
 * Normalize request input to { street, options }. Throws with a
 * human-readable message on invalid input.
 */
function parseRenderRequest(req) {
  let payload;
  if (req.method === 'POST') {
    payload = req.body;
    if (typeof payload === 'string') payload = JSON.parse(payload);
  } else if (req.method === 'GET' && req.query.data) {
    payload = JSON.parse(decodeBase64Url(String(req.query.data)));
  } else {
    throw new Error(
      'POST a JSON body { street, options } (or a bare managed-street ' +
        'object), or GET with ?data=<base64url JSON>'
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('request payload must be a JSON object');
  }

  const street = payload.street || payload;
  const options =
    payload.options && typeof payload.options === 'object'
      ? payload.options
      : {};

  if (!Array.isArray(street.segments) || street.segments.length === 0) {
    throw new Error(
      'street must contain a non-empty segments array — see ' +
        'docs/street-render-endpoint.md for the managed-street JSON format'
    );
  }
  if (street.segments.length > MAX_SEGMENTS) {
    throw new Error(`too many segments (max ${MAX_SEGMENTS})`);
  }
  const size = Buffer.byteLength(JSON.stringify(street), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `street JSON too large (${size} bytes, max ${MAX_PAYLOAD_BYTES})`
    );
  }

  // Merge flat GET query params as options for curl-friendly calls
  // (?width=1600&type=jpg&environment=sunset ...).
  const flat = { ...req.query };
  delete flat.data;
  delete flat.format;
  const merged = { ...flat, ...options };

  return { street, options: sanitizeOptions(merged) };
}

const NUMBER_OPTIONS = {
  width: [320, 2560],
  height: [240, 2560],
  fov: [5, 90],
  azimuth: [-180, 180],
  elevation: [5, 85],
  margin: [1, 2],
  quality: [0.1, 1]
};
const BOOLEAN_OPTIONS = [
  'labels',
  'vehicles',
  'ground',
  'boundaries',
  'branding',
  'autoSide'
];
const STRING_OPTIONS = {
  environment: /^[a-z0-9-]{1,32}$/,
  units: /^(metric|imperial)$/,
  type: /^(png|jpg|jpeg)$/,
  title: /^[\s\S]{0,120}$/
};

function sanitizeOptions(raw) {
  const options = {};
  for (const [key, [min, max]] of Object.entries(NUMBER_OPTIONS)) {
    if (raw[key] === undefined) continue;
    const value = Number(raw[key]);
    if (Number.isFinite(value)) {
      options[key] = Math.min(max, Math.max(min, value));
    }
  }
  for (const key of BOOLEAN_OPTIONS) {
    if (raw[key] === undefined) continue;
    options[key] = raw[key] === true || raw[key] === 'true';
  }
  for (const [key, pattern] of Object.entries(STRING_OPTIONS)) {
    if (raw[key] === undefined) continue;
    const value = String(raw[key]);
    if (pattern.test(value)) options[key] = value;
  }
  return options;
}

function buildEditorUrl(street) {
  return (
    EDITOR_BASE_URL +
    '#managed-street-json:' +
    encodeURIComponent(JSON.stringify(street))
  );
}

async function renderOnPage(street, options) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: Math.round(options.width || 1280),
      height: Math.round(options.height || 800),
      deviceScaleFactor: 1
    });
    await page.evaluateOnNewDocument((payload) => {
      window.__STREET_RENDER_PAYLOAD__ = payload;
    }, { street, options });
    await page.goto(RENDER_PAGE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForFunction(
      () =>
        window.__STREET_RENDER__ &&
        ['ready', 'error'].includes(window.__STREET_RENDER__.status),
      { timeout: READY_TIMEOUT_MS, polling: 500 }
    );
    const state = await page.evaluate(() => ({
      status: window.__STREET_RENDER__.status,
      error: window.__STREET_RENDER__.error,
      meta: window.__STREET_RENDER__.meta
    }));
    if (state.status !== 'ready') {
      const err = new Error(state.error || 'render failed');
      err.isRenderError = true;
      throw err;
    }
    const dataUrl = await page.evaluate(
      (captureOpts) => window.__STREET_RENDER__.capture(captureOpts),
      { type: options.type || 'png', quality: options.quality || 0.92 }
    );
    return { dataUrl, meta: state.meta };
  } finally {
    await page.close().catch(() => {});
  }
}

exports.renderStreet = onRequest(
  {
    memory: '2GiB',
    cpu: 2,
    timeoutSeconds: 180,
    // concurrency 2 = two chromium tabs per instance: SwiftShader renders
    // in system RAM and /tmp (chromium unpack) is RAM-backed, so a third
    // tab risks OOM on 2GiB; it also halves the ~1 vCPU each render gets.
    // maxInstances 2 bounds sustained-abuse cost at ~$280/mo (2 busy
    // instances × ~$139: 2vCPU+2GiB at Cloud Run rates); spikes get 429s.
    concurrency: 2,
    maxInstances: 2,
    cors: true
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'use GET or POST' });
      return;
    }

    let street, options;
    try {
      ({ street, options } = parseRenderRequest(req));
    } catch (err) {
      badRequest(res, String(err.message || err));
      return;
    }

    try {
      const started = Date.now();
      const { dataUrl, meta } = await renderOnPage(street, options);
      const editorUrl = buildEditorUrl(street);
      console.log(
        `renderStreet ok: "${meta && meta.name}" segments=${street.segments.length} ` +
          `ms=${Date.now() - started}`
      );

      const [head, body] = dataUrl.split(',');
      const buffer = Buffer.from(body, 'base64');
      const contentType = head.includes('image/jpeg')
        ? 'image/jpeg'
        : 'image/png';
      const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';

      // Best-effort cache write: a storage hiccup should degrade to a
      // response without imageUrl, not a failed render.
      let imageUrl = null;
      try {
        const hash = renderCacheKey(street, options);
        const bucket = admin.storage().bucket();
        const base = `renders/${RENDER_CACHE_VERSION}/${hash}`;
        await Promise.all([
          bucket.file(`${base}.${ext}`).save(buffer, {
            resumable: false,
            contentType,
            metadata: {
              cacheControl: 'public, max-age=31536000, immutable'
            }
          }),
          bucket.file(`${base}.json`).save(JSON.stringify({ street, options }), {
            resumable: false,
            contentType: 'application/json'
          })
        ]);
        imageUrl = `${EDITOR_BASE_URL}render/img/${RENDER_CACHE_VERSION}/${hash}.${ext}`;
      } catch (cacheErr) {
        console.warn('renderStreet cache write failed:', cacheErr);
      }

      const wantsJson =
        req.query.format === 'json' ||
        (req.get('accept') || '').includes('application/json');
      if (wantsJson) {
        res.json({
          image: dataUrl,
          imageUrl,
          openInEditorUrl: editorUrl,
          meta,
          width: Math.round(options.width || 1280),
          height: Math.round(options.height || 800)
        });
        return;
      }

      res.set('Content-Type', contentType);
      // already ASCII-safe: the JSON fragment is encodeURIComponent-encoded
      res.set('X-3DStreet-Editor-Url', editorUrl);
      if (imageUrl) res.set('X-3DStreet-Image-Url', imageUrl);
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(buffer);
    } catch (err) {
      console.error('renderStreet failed:', err);
      if (err.isRenderError) {
        res.status(422).json({ error: `could not render street: ${err.message}` });
      } else {
        res.status(500).json({ error: 'internal render error' });
      }
    }
  }
);

// Serves cached renders at the stable URL (hosting rewrite /render/img/**).
// Cheap and highly concurrent, unlike the puppeteer function above; with
// immutable cache headers the hosting CDN absorbs repeat traffic. Misses
// are unknown hashes (nothing is evicted today), so 404 — re-rendering
// from the .json sidecar is a deliberate non-goal until eviction exists.
const SERVE_PATH_RE = /\/render\/img\/(v\d+)\/([a-f0-9]{20})\.(png|jpg)$/;

exports.serveRenderImage = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    concurrency: 80,
    maxInstances: 4,
    cors: true
  },
  async (req, res) => {
    const match = SERVE_PATH_RE.exec(req.path || '');
    if (!match) {
      res
        .status(400)
        .json({ error: 'expected /render/img/v1/<hash>.png (or .jpg)' });
      return;
    }
    const [, version, hash, ext] = match;
    try {
      const [buffer] = await admin
        .storage()
        .bucket()
        .file(`renders/${version}/${hash}.${ext}`)
        .download();
      res.set('Content-Type', ext === 'jpg' ? 'image/jpeg' : 'image/png');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    } catch (err) {
      if (err && err.code === 404) {
        res.status(404).json({ error: 'unknown render hash' });
        return;
      }
      console.error('serveRenderImage failed:', err);
      res.status(500).json({ error: 'internal error' });
    }
  }
);
