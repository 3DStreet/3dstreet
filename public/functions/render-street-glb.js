/**
 * renderStreetGlb — GLB-pipeline sibling of renderStreet (render-street.js).
 *
 * Same public POST/GET contract, but instead of driving a headless browser it
 * runs the DOM-free assembler (tools/street-to-glb: managed-street JSON → GLB
 * via pure THREE + GLTFExporter) and renders the GLB with Blender Cycles, then
 * composites the 2D cross-section label bar with Pillow. It returns BOTH a
 * rendered image and the GLB, and caches both at content-hash paths — mirroring
 * the /render/img/v1/ cache in render-street.js.
 *
 *   POST { street:{name,length,segments:[...]}, options?:{...} }
 *   POST { name, length, segments:[...] }
 *   GET  ?data=<base64url>&format=json
 *
 *   Response (?format=json):
 *     { image:<dataURL>, imageUrl, glbUrl, openInEditorUrl, meta, width, height }
 *   Otherwise: image bytes, with X-3DStreet-Glb-Url / X-3DStreet-Editor-Url /
 *   X-3DStreet-Image-Url headers.
 *
 * Runtime note: this needs Blender + Python/Pillow + the assembler's Node deps
 * on PATH, so it is intended to run as a Cloud Run container (see
 * render-street-glb.Dockerfile), not the default Functions buildpack. Prod
 * deploy is deferred; the legacy renderStreet endpoint stays the live path.
 */
const { onRequest } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const admin = require('firebase-admin');

const PROD_PROJECT_ID = 'dstreet-305604';
const ACTIVE_PROJECT =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const IS_PROD = ACTIVE_PROJECT === PROD_PROJECT_ID;

const EDITOR_BASE_URL =
  process.env.EDITOR_BASE_URL ||
  (IS_PROD ? 'https://3dstreet.app/' : 'https://dev-3dstreet.web.app/');

// The assembler + Blender render scripts. Defaults resolve to the in-repo tool
// (the Cloud Run image copies it to /workspace/tools/street-to-glb).
const TOOL_DIR =
  process.env.STREET_TO_GLB_DIR ||
  path.resolve(__dirname, '..', '..', 'tools', 'street-to-glb');
const BLENDER_BIN = process.env.BLENDER_BIN || 'blender';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

const MAX_PAYLOAD_BYTES = 262144;
const MAX_SEGMENTS = 64;
const RENDER_CACHE_VERSION = 'v1';
const CACHE_PREFIX = `glb-renders/${RENDER_CACHE_VERSION}`;

// ---- request parsing (mirrors render-street.js) -------------------------
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
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

function decodeBase64Url(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

const NUMBER_OPTIONS = {
  width: [320, 2560],
  height: [240, 2560],
  fov: [5, 90],
  azimuth: [-180, 180],
  elevation: [5, 85],
  margin: [1, 2],
  samples: [4, 256]
};
const BOOLEAN_OPTIONS = ['vehicles', 'ground', 'boundaries', 'branding', 'striping'];
const STRING_OPTIONS = {
  environment: /^[a-z0-9-]{1,32}$/,
  units: /^(metric|imperial)$/,
  title: /^[\s\S]{0,120}$/
};

function sanitizeOptions(raw) {
  const options = {};
  for (const [key, [min, max]] of Object.entries(NUMBER_OPTIONS)) {
    if (raw[key] === undefined) continue;
    const value = Number(raw[key]);
    if (Number.isFinite(value)) options[key] = Math.min(max, Math.max(min, value));
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

function parseRenderRequest(req) {
  let payload;
  if (req.method === 'POST') {
    payload = req.body;
    if (typeof payload === 'string') payload = JSON.parse(payload);
  } else if (req.method === 'GET' && req.query.data) {
    payload = JSON.parse(decodeBase64Url(String(req.query.data)));
  } else {
    throw new Error('POST { street, options } or GET ?data=<base64url JSON>');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('request payload must be a JSON object');
  }
  const street = payload.street || payload;
  const options =
    payload.options && typeof payload.options === 'object' ? payload.options : {};
  if (!Array.isArray(street.segments) || street.segments.length === 0) {
    throw new Error('street must contain a non-empty segments array');
  }
  if (street.segments.length > MAX_SEGMENTS) {
    throw new Error(`too many segments (max ${MAX_SEGMENTS})`);
  }
  const size = Buffer.byteLength(JSON.stringify(street), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`street JSON too large (${size} bytes, max ${MAX_PAYLOAD_BYTES})`);
  }
  let merged = options;
  if (req.method === 'GET') {
    const flat = { ...req.query };
    delete flat.data;
    delete flat.format;
    merged = { ...options, ...flat };
  }
  return { street, options: sanitizeOptions(merged) };
}

function buildEditorUrl(street) {
  return (
    EDITOR_BASE_URL +
    '#managed-street-json:' +
    encodeURIComponent(JSON.stringify(street))
  );
}

function spawnStep(bin, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label} exited with code ${code}`))
    );
  });
}

// ---- the actual render: JSON -> GLB -> PNG -> labeled PNG ---------------
// Returns { pngBuffer, glbBuffer, meta }. Exported for local testing.
async function runGlbRender(street, options) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'street-glb-'));
  const glbPath = path.join(workDir, 'street.glb');
  const rawPng = path.join(workDir, 'raw.png');
  const finalPng = path.join(workDir, 'final.png');
  const streetJson = path.join(workDir, 'street.json');
  const paramsJson = path.join(workDir, 'params.json');
  fs.writeFileSync(streetJson, JSON.stringify({ street, options }));

  // 1) assemble the GLB (ESM tool, dynamic-imported from this CJS module).
  const tool = await import(pathToFileURL(path.join(TOOL_DIR, 'index.js')).href);
  const { buffer: glbBuffer, meta } = await tool.streetToGlbWithMeta(
    { street, options },
    {
      vehicles: options.vehicles,
      boundaries: options.boundaries,
      striping: options.striping
    }
  );
  fs.writeFileSync(glbPath, glbBuffer);

  // 2) Blender Cycles render.
  const params = {
    glb: glbPath,
    out: rawPng,
    cache_dir: path.join(TOOL_DIR, '.cache'),
    environment: options.environment || 'day',
    background_color: options.backgroundColor,
    width: Math.round(options.width || 1280),
    height: Math.round(options.height || 800),
    fov: options.fov ?? 20,
    azimuth: options.azimuth ?? 20,
    elevation: options.elevation ?? 30,
    margin: options.margin ?? 1.12,
    ground: options.ground !== false,
    samples: options.samples || 12
  };
  fs.writeFileSync(paramsJson, JSON.stringify(params));
  await spawnStep(
    BLENDER_BIN,
    ['-b', '-P', path.join(TOOL_DIR, 'render', 'render_blender.py'), '--', '--params', paramsJson],
    'blender'
  );

  // 3) Pillow label bar + branding.
  await spawnStep(
    PYTHON_BIN,
    [
      path.join(TOOL_DIR, 'render', 'composite_labels.py'),
      '--render', rawPng,
      '--street', streetJson,
      '--out', finalPng,
      '--units', options.units || 'metric',
      ...(options.title !== undefined ? ['--title', String(options.title)] : []),
      ...(options.branding === false ? ['--no-branding'] : [])
    ],
    'composite'
  );

  const pngBuffer = fs.readFileSync(finalPng);
  fs.rmSync(workDir, { recursive: true, force: true });
  return { pngBuffer, glbBuffer, meta };
}

function assetUrls(hash) {
  return {
    imageUrl: `${EDITOR_BASE_URL}render/glb/${RENDER_CACHE_VERSION}/${hash}.png`,
    glbUrl: `${EDITOR_BASE_URL}render/glb/${RENDER_CACHE_VERSION}/${hash}.glb`
  };
}

function sendResponse(req, res, { pngBuffer, editorUrl, imageUrl, glbUrl, meta, options }) {
  const wantsJson =
    req.query.format === 'json' ||
    (req.get('accept') || '').includes('application/json');
  if (wantsJson) {
    res.json({
      image: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      imageUrl,
      glbUrl,
      openInEditorUrl: editorUrl,
      meta,
      width: Math.round(options.width || 1280),
      height: Math.round(options.height || 800)
    });
    return;
  }
  res.set('Content-Type', 'image/png');
  if (Buffer.byteLength(editorUrl) <= 8192) res.set('X-3DStreet-Editor-Url', editorUrl);
  if (imageUrl) res.set('X-3DStreet-Image-Url', imageUrl);
  if (glbUrl) res.set('X-3DStreet-Glb-Url', glbUrl);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(pngBuffer);
}

exports.renderStreetGlb = onRequest(
  {
    memory: '4GiB',
    cpu: 4,
    timeoutSeconds: 300,
    concurrency: 1, // Cycles CPU wants all cores for one render
    minInstances: 0,
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
      res.status(400).json({ error: String(err.message || err) });
      return;
    }

    const editorUrl = buildEditorUrl(street);
    const hash = renderCacheKey(street, options);
    const { imageUrl, glbUrl } = assetUrls(hash);
    const bucket = admin.storage().bucket();
    const base = `${CACHE_PREFIX}/${hash}`;

    // Cache read: serve the stored PNG (+ meta) if this exact input rendered
    // before. The GLB is cached alongside at ${base}.glb.
    try {
      const [exists] = await bucket.file(`${base}.png`).exists();
      if (exists) {
        const [[pngBuffer], meta] = await Promise.all([
          bucket.file(`${base}.png`).download(),
          bucket
            .file(`${base}.json`)
            .download()
            .then(([s]) => JSON.parse(s.toString('utf8')).meta)
            .catch(() => null)
        ]);
        console.log(`renderStreetGlb cache hit: ${hash}`);
        sendResponse(req, res, { pngBuffer, editorUrl, imageUrl, glbUrl, meta, options });
        return;
      }
    } catch (cacheErr) {
      console.warn('renderStreetGlb cache read failed:', cacheErr);
    }

    try {
      const started = Date.now();
      const { pngBuffer, glbBuffer, meta } = await runGlbRender(street, options);
      console.log(
        `renderStreetGlb ok: "${meta && meta.name}" segments=${street.segments.length} ms=${Date.now() - started}`
      );

      // Cache both artifacts + a meta sidecar (best-effort).
      try {
        await Promise.all([
          bucket.file(`${base}.png`).save(pngBuffer, {
            resumable: false,
            contentType: 'image/png',
            metadata: { cacheControl: 'public, max-age=31536000, immutable' }
          }),
          bucket.file(`${base}.glb`).save(glbBuffer, {
            resumable: false,
            contentType: 'model/gltf-binary',
            metadata: { cacheControl: 'public, max-age=31536000, immutable' }
          }),
          bucket.file(`${base}.json`).save(JSON.stringify({ street, options, meta }), {
            resumable: false,
            contentType: 'application/json'
          })
        ]);
      } catch (cacheErr) {
        console.warn('renderStreetGlb cache write failed:', cacheErr);
      }

      sendResponse(req, res, { pngBuffer, editorUrl, imageUrl, glbUrl, meta, options });
    } catch (err) {
      console.error('renderStreetGlb failed:', err);
      res.status(500).json({ error: `render failed: ${err.message}` });
    }
  }
);

// Serves the cached PNG or GLB at the stable URL (hosting rewrite
// /render/glb/**). Cheap + highly concurrent; immutable cache headers let the
// CDN absorb repeats. Misses 404.
const SERVE_RE = /\/render\/glb\/(v\d+)\/([a-f0-9]{20})\.(png|glb)$/;

exports.serveRenderGlbAsset = onRequest(
  { memory: '256MiB', timeoutSeconds: 30, concurrency: 80, maxInstances: 4, cors: true },
  async (req, res) => {
    const match = SERVE_RE.exec(req.path || '');
    if (!match) {
      res.status(400).json({ error: 'expected /render/glb/v1/<hash>.png or .glb' });
      return;
    }
    const [, version, hash, ext] = match;
    try {
      const [buffer] = await admin
        .storage()
        .bucket()
        .file(`glb-renders/${version}/${hash}.${ext}`)
        .download();
      res.set('Content-Type', ext === 'glb' ? 'model/gltf-binary' : 'image/png');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    } catch (err) {
      if (err && err.code === 404) {
        res.status(404).json({ error: 'unknown render hash' });
        return;
      }
      console.error('serveRenderGlbAsset failed:', err);
      res.status(500).json({ error: 'internal error' });
    }
  }
);

exports.runGlbRender = runGlbRender;
