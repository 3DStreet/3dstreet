'use strict';

// needle-uploader — Cloud Run HTTP handler (#1990).
//
// Produces the mesh "streaming optimized" variant: downloads the user's GLB
// from GCS, runs `needle-cloud optimize --progressive true --usecase world
// --name <assetId>` (uploads to Needle Cloud and waits for its optimization
// job), resolves the served CDN URL with `needle-cloud list --output json`,
// patches the asset doc's optimizedSource* fields, records the Needle content
// id in the `needleContent/{assetId}` ledger, and writes the job's terminal
// status. The renderer keys progressive behavior purely off the URL host
// (src/tested/progressive-models.js), so the doc patch is all it takes.
//
// It is also the ONLY holder of the Needle token, so the asset GC asks it to
// delete a purged asset's copy: { action: 'delete', uid, assetId, needleAssetId }.
//
// Contract mirrors rad-converter/server.js: POST / with JSON, jobId optional
// (with it we write terminal status to generationJobs; without it — a manual
// one-shot — we just process and patch). GET / is a health check.
//
// Env: NEEDLE_CLOUD_TOKEN (Secret Manager), NEEDLE_TEAM (team name or id),
// STORAGE_BUCKET, SERVICE_REGION.

const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const express = require('express');
const admin = require('firebase-admin');
const cli = require('./needle-cli.js');

const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET ||
  (process.env.GCLOUD_PROJECT
    ? `${process.env.GCLOUD_PROJECT}.appspot.com`
    : undefined);

admin.initializeApp({ storageBucket: STORAGE_BUCKET });

const NEEDLE_TOKEN = process.env.NEEDLE_CLOUD_TOKEN || '';
const NEEDLE_TEAM = process.env.NEEDLE_TEAM || '';
const NEEDLE_USECASE = process.env.NEEDLE_USECASE || 'world';
const NEEDLE_CLI_VERSION = require('needle-cloud/package.json').version;
const NEEDLE_BIN = path.join(__dirname, 'node_modules', '.bin', 'needle-cloud');
const LEDGER_COLLECTION = 'needleContent';
const FORMAT = 'needle-progressive';
const ID_RE = /^[a-zA-Z0-9_-]+$/;

// Same allowlist as the client predicate: refuse to persist a URL the runtime
// would not treat as progressive (a Needle-side change would otherwise
// silently downgrade the asset to a plain remote GLB).
const PROGRESSIVE_HOSTS = ['cloud.needle.tools'];

function runtimeInfo() {
  return {
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    region: process.env.SERVICE_REGION || null,
    revision: process.env.K_REVISION || null,
    needleCliVersion: NEEDLE_CLI_VERSION,
    usecase: NEEDLE_USECASE
  };
}

function validateId(value, label) {
  if (!value || typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

// Needle rejected the file itself (unsupported/corrupt input, or the CLI
// reported its optimization job failed). Deterministic → terminal 'skipped',
// HTTP 200, no Cloud Tasks retry. Transient errors (download, spawn, missing
// listing) still 500 and retry.
class ProcessingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProcessingError';
    this.deterministic = true;
  }
}

// Run the CLI, capturing stdout/stderr (token-redacted in logs and errors).
function runNeedle(args, { timeoutMs = 25 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    console.log(
      `[needle-uploader] needle-cloud ${cli.redact(args.join(' '), NEEDLE_TOKEN)}`
    );
    const proc = spawn(NEEDLE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', NO_COLOR: '1' }
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d;
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(
        new Error(`needle-cloud ${args[0]} timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err); // spawn failure — retryable
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = cli.redact(stdout, NEEDLE_TOKEN);
      const errOut = cli.redact(stderr, NEEDLE_TOKEN);
      if (out.trim()) console.log(`[needle-cloud ${args[0]}] ${out.trim()}`);
      if (errOut.trim()) {
        console.warn(`[needle-cloud ${args[0]} stderr] ${errOut.trim()}`);
      }
      resolve({ code, stdout: out, stderr: errOut });
    });
  });
}

// Byte size of the served initial file (what optimizedSourceSize means for a
// progressive model: the first request, before any LOD streams in). Best
// effort: null if the CDN does not answer a HEAD with a length.
async function fetchContentLength(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const len = Number(res.headers.get('content-length'));
    return res.ok && Number.isFinite(len) && len > 0 ? len : null;
  } catch (err) {
    console.warn('[needle-uploader] HEAD failed:', err?.message || err);
    return null;
  }
}

function assetRef(uid, assetId) {
  return admin
    .firestore()
    .collection('users')
    .doc(uid)
    .collection('assets')
    .doc(assetId);
}

function ledgerRef(assetId) {
  return admin.firestore().collection(LEDGER_COLLECTION).doc(assetId);
}

// Core processing. Returns { optimizedSourceUrl, optimizedSourceSize,
// needleAssetId } after the asset doc is patched. `perf` is filled per phase
// so a failure still reports the phases that ran.
async function processAsset({ uid, assetId, storagePath }, perf = {}) {
  validateId(uid, 'uid');
  validateId(assetId, 'assetId');
  if (!storagePath || typeof storagePath !== 'string') {
    throw new Error('Missing storagePath');
  }
  if (!storagePath.startsWith(`users/${uid}/`)) {
    throw new Error('storagePath is outside the owner folder');
  }
  if (!NEEDLE_TOKEN) throw new Error('NEEDLE_CLOUD_TOKEN is not configured');

  const bucket = admin.storage().bucket();
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'needle-'));
  // Keep the real extension: the CLI dispatches on it (.glb/.gltf).
  const ext = (path.extname(storagePath) || '.glb').toLowerCase();
  const localSrc = path.join(workDir, `${assetId}${ext}`);
  perf.phaseMs = perf.phaseMs || {};
  const start = performance.now();

  try {
    // 1. Download the original. /tmp is tmpfs on Cloud Run (memory) — size
    //    the service (deploy.sh) above the per-file upload cap.
    console.log(
      `[needle-uploader] downloading gs://${bucket.name}/${storagePath}`
    );
    let mark = performance.now();
    await bucket.file(storagePath).download({ destination: localSrc });
    perf.phaseMs.download = Math.round(performance.now() - mark);
    perf.inputBytes = fs.statSync(localSrc).size;

    // 2. Upload + optimize on Needle (the CLI waits for the job). --name is
    //    our assetId, so a re-run updates the same content item and the GC
    //    can always find the copy by name.
    mark = performance.now();
    const opt = await runNeedle(
      cli.optimizeArgs({
        file: localSrc,
        token: NEEDLE_TOKEN,
        team: NEEDLE_TEAM,
        name: assetId,
        usecase: NEEDLE_USECASE
      })
    );
    perf.phaseMs.optimize = Math.round(performance.now() - mark);
    const contentId = cli.parseEditContentId(opt.stdout + '\n' + opt.stderr);
    if (opt.code !== 0) {
      const detail =
        (opt.stderr || opt.stdout || '').trim().split('\n').pop() ||
        `exit ${opt.code}`;
      // "Optimization failed: ..." is Needle judging the file; anything else
      // (auth, network, license) is ours to fix and worth a retry.
      if (/optimization failed|optimization cancelled/i.test(detail)) {
        throw new ProcessingError(detail);
      }
      throw new Error(`needle-cloud optimize failed: ${detail}`);
    }

    // 3. Resolve the served URL. The CLI only prints the edit URL, so read the
    //    listing filtered by our name.
    mark = performance.now();
    const list = await runNeedle(
      cli.listArgs({ token: NEEDLE_TOKEN, team: NEEDLE_TEAM, search: assetId }),
      { timeoutMs: 2 * 60 * 1000 }
    );
    const items = cli.parseListJson(list.stdout);
    const item = cli.pickListing(items, { contentId, name: assetId });
    const optimizedSourceUrl = cli.servedUrlOf(item);
    if (!item || !optimizedSourceUrl) {
      throw new Error(
        `optimized content '${assetId}' not found in Needle listing (${items.length} items, contentId=${contentId || 'none'})`
      );
    }
    let host = '';
    try {
      host = new URL(optimizedSourceUrl).hostname.toLowerCase();
    } catch (e) {
      host = '';
    }
    if (!PROGRESSIVE_HOSTS.includes(host)) {
      throw new Error(
        `served URL host '${host}' is not a progressive-model host`
      );
    }
    const needleAssetId = item.identifier || contentId;
    const optimizedSourceSize = await fetchContentLength(optimizedSourceUrl);
    perf.phaseMs.resolve = Math.round(performance.now() - mark);
    perf.durationMs = Math.round(performance.now() - start);

    // 4. Ledger first, then the doc: if the doc patch fails we still know
    //    the copy exists on Needle and the GC can reclaim it.
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ledgerRef(assetId).set(
      {
        uid,
        assetId,
        needleAssetId,
        url: optimizedSourceUrl,
        status: 'live',
        updatedAt: now,
        createdAt: now
      },
      { merge: true }
    );

    // 5. Patch the asset doc. optimizedSourcePath is removed: the doc now
    //    describes one variant, and it lives off-bucket. A previous
    //    client-optimized object stays readable for scenes that baked its URL
    //    (assetRole: 'optimized' keeps it until the doc is purged).
    await assetRef(uid, assetId).set(
      {
        optimizedSourceUrl,
        optimizedSourcePath: admin.firestore.FieldValue.delete(),
        ...(optimizedSourceSize ? { optimizedSourceSize } : {}),
        optimizationMetadata: {
          format: FORMAT,
          tool: 'needle-cloud',
          needleCliVersion: NEEDLE_CLI_VERSION,
          needleAssetId,
          profile: NEEDLE_USECASE,
          durationMs: perf.durationMs,
          phaseMs: perf.phaseMs,
          inputBytes: perf.inputBytes,
          optimizedSourceSize: optimizedSourceSize || null,
          runtime: perf.runtime || runtimeInfo(),
          completedAt: admin.firestore.Timestamp.now()
        },
        updatedAt: now
      },
      { merge: true }
    );

    console.log(`[needle-uploader] done: ${assetId} → ${optimizedSourceUrl}`);
    return { optimizedSourceUrl, optimizedSourceSize, needleAssetId };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// GC path: move the content item to Needle's trash and record the outcome on
// the ledger. Success is idempotent from our side; an item Needle no longer
// knows counts as deleted.
async function deleteNeedleContent({ uid, assetId, needleAssetId }) {
  validateId(assetId, 'assetId');
  validateId(needleAssetId, 'needleAssetId');
  if (!NEEDLE_TOKEN) throw new Error('NEEDLE_CLOUD_TOKEN is not configured');
  const del = await runNeedle(
    cli.deleteArgs({
      token: NEEDLE_TOKEN,
      team: NEEDLE_TEAM,
      identifier: needleAssetId
    }),
    { timeoutMs: 2 * 60 * 1000 }
  );
  const output = `${del.stdout}\n${del.stderr}`;
  const gone =
    del.code === 0 || /not found|does not exist|already/i.test(output);
  const now = admin.firestore.FieldValue.serverTimestamp();
  if (gone) {
    await ledgerRef(assetId).set(
      { uid, needleAssetId, status: 'deleted', deletedAt: now, updatedAt: now },
      { merge: true }
    );
    return { deleted: true };
  }
  const message = output.trim().split('\n').pop() || `exit ${del.code}`;
  await ledgerRef(assetId).set(
    {
      uid,
      needleAssetId,
      status: 'delete-failed',
      error: message,
      updatedAt: now
    },
    { merge: true }
  );
  throw new Error(`needle-cloud delete failed: ${message}`);
}

async function writeJobStatus(uid, jobId, fields) {
  if (!jobId) return;
  try {
    await admin
      .firestore()
      .collection('users')
      .doc(uid)
      .collection('generationJobs')
      .doc(jobId)
      .set(
        { ...fields, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
  } catch (err) {
    console.error('[needle-uploader] failed to write job status:', err);
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => res.status(200).send('needle-uploader ok'));

app.post('/', async (req, res) => {
  const body = req.body || {};
  const action = body.action || 'optimize';
  const { uid, assetId, jobId } = body;
  console.log(
    `[needle-uploader] ${action} uid=${uid} assetId=${assetId} jobId=${jobId || '(none)'}`
  );

  if (action === 'delete') {
    try {
      const result = await deleteNeedleContent(body);
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      const msg = String(err?.message || err);
      console.error('[needle-uploader] delete failed:', msg);
      res.status(500).json({ ok: false, error: msg }); // Cloud Tasks retries
    }
    return;
  }

  const perf = { runtime: runtimeInfo(), phaseMs: {}, inputBytes: null };
  const startWall = performance.now();
  const perfFields = () => ({
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    durationMs:
      typeof perf.durationMs === 'number'
        ? perf.durationMs
        : Math.round(performance.now() - startWall),
    phaseMs: perf.phaseMs,
    runtime: perf.runtime,
    inputBytes: perf.inputBytes
  });
  try {
    await writeJobStatus(uid, jobId, {
      status: 'running',
      startedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const result = await processAsset(body, perf);
    await writeJobStatus(uid, jobId, {
      status: 'succeeded',
      ...result,
      ...perfFields()
    });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const msg = String(err?.message || err);
    if (err instanceof ProcessingError) {
      console.warn(
        '[needle-uploader] processing skipped (non-retryable):',
        msg
      );
      await writeJobStatus(uid, jobId, {
        status: 'skipped',
        skipReason: msg,
        ...perfFields()
      });
      res.status(200).json({ ok: false, skipped: true, reason: msg });
      return;
    }
    console.error('[needle-uploader] processing failed:', err);
    await writeJobStatus(uid, jobId, {
      status: 'failed',
      error: msg,
      ...perfFields()
    });
    res.status(500).json({ ok: false, error: msg }); // Cloud Tasks retries
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(
    `[needle-uploader] listening on ${port}, bucket=${STORAGE_BUCKET}, team=${NEEDLE_TEAM || '(default)'}, cli=${NEEDLE_CLI_VERSION}`
  );
});
