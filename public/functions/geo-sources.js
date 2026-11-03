const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const {
  MAX_RESPONSE_BYTES,
  AIRTABLE_PAGE_GAP_MS,
  AIRTABLE_MAX_PAGES,
  isValidSourceId,
  canReadSource,
  sourceProblem,
  publicSourceInfo,
  airtableRowsFromRecords,
  airtableListUrl,
  sheetRowsFromValues,
  guessFormat
} = require('./geo-sources-utils.js');

/**
 * Private geo data sources for outside map apps (Joiner). See
 * docs/geo-sources.md.
 *
 * A user signs in with their 3DStreet account in the outside app, which calls:
 *   listGeoSources()           → { sources: [{ id, name, description? }] }
 *   getGeoSource({ sourceId }) → { name, format: 'csv' | 'json', text }
 * The source's location (Airtable base, Google Sheet, private URL) and the
 * credentials to read it stay here; the browser only ever sees the rows.
 *
 * No App Check: these are called from other origins (burritojustice.github.io)
 * that can't attest as a 3DStreet client. Sign-in plus the per-source grant
 * is the gate, and the functions spend nothing billable per call.
 */

const HttpsError = functions.https.HttpsError;
const FETCH_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireAuth(context) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Sign in with your 3DStreet account first.');
  }
}

/**
 * Every source this user may read. The collection is small and admin-curated
 * (grants are lists on each doc), so it's read whole and filtered here.
 */
const listGeoSources = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  const snap = await admin.firestore().collection('geoSources').get();
  const sources = snap.docs
    .filter((d) => canReadSource(d.data(), context.auth) && !sourceProblem(d.data()))
    .map((d) => publicSourceInfo(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { sources };
});

const getGeoSource = functions
  .runWith({ secrets: ['AIRTABLE_GEO_TOKEN'], timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    requireAuth(context);
    const sourceId = data && data.sourceId;
    if (!isValidSourceId(sourceId)) {
      throw new HttpsError('invalid-argument', 'That isn’t a source name.');
    }
    const doc = await admin.firestore().doc(`geoSources/${sourceId}`).get();
    // Missing and not-allowed look the same, so ids can't be probed.
    if (!doc.exists || !canReadSource(doc.data(), context.auth)) {
      throw new HttpsError(
        'permission-denied',
        'Your 3DStreet account can’t open this source. Ask whoever shared it to add you.'
      );
    }
    const source = doc.data();
    const problem = sourceProblem(source);
    if (problem) {
      console.error(`[geoSources] ${sourceId} is misconfigured: ${problem}`);
      throw new HttpsError('failed-precondition', 'This source isn’t set up correctly yet.');
    }

    let result;
    try {
      if (source.kind === 'airtable') result = await readAirtable(source);
      else if (source.kind === 'gsheet') result = await readSheet(source);
      else result = await readUrl(source);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error(`[geoSources] reading ${sourceId} (${source.kind}) failed:`, e.message);
      throw new HttpsError('unavailable', 'Couldn’t read this source just now. Try again in a minute.');
    }

    if (Buffer.byteLength(result.text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new HttpsError(
        'out-of-range',
        'This source is too big to send in one go. Ask for it to be split into smaller views.'
      );
    }
    console.log(`[geoSources] ${context.auth.uid} read ${sourceId} (${source.kind}, ${result.text.length} chars)`);
    return { name: publicSourceInfo(sourceId, source).name, ...result };
  });

async function fetchOk(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* no body */
    }
    throw new Error(`${new URL(url).host} answered ${res.status} ${detail}`);
  }
  return res;
}

// ── Airtable: one read-only token (data.records:read) in AIRTABLE_GEO_TOKEN ──
async function readAirtable(source) {
  const token = process.env.AIRTABLE_GEO_TOKEN;
  if (!token) {
    console.error('[geoSources] AIRTABLE_GEO_TOKEN secret not loaded');
    throw new HttpsError('failed-precondition', 'This source isn’t set up correctly yet.');
  }
  const records = [];
  let offset;
  for (let page = 0; page < AIRTABLE_MAX_PAGES; page++) {
    if (page) await sleep(AIRTABLE_PAGE_GAP_MS);
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchOk(airtableListUrl(source, offset), {
          headers: { Authorization: `Bearer ${token}` }
        });
        break;
      } catch (e) {
        if (!/ 429 /.test(e.message) || attempt >= 3) throw e;
        await sleep(1000 * (attempt + 1)); // rate limited: back off
      }
    }
    const body = await res.json();
    records.push(...(body.records || []));
    offset = body.offset;
    if (!offset) break;
  }
  const rows = airtableRowsFromRecords(records, source.fields || []);
  return { format: 'json', text: JSON.stringify(rows) };
}

// ── Google Sheets: shared (Viewer) with this project's service account ──
// The default service account's token from the metadata server, scoped for
// read-only Sheets access. (Sheets API must be enabled in the project.)
async function googleAccessToken() {
  const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const res = await fetchOk(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=' +
      encodeURIComponent(scope),
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  return (await res.json()).access_token;
}

async function readSheet(source) {
  const token = await googleAccessToken();
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${source.sheetId}`;
  let range = source.range;
  if (!range) {
    // No range named: the tab with `gid` (as in the sheet's own URL), or the first tab.
    const meta = await (await fetchOk(`${base}?fields=sheets.properties(sheetId,title)`, auth)).json();
    const tabs = (meta.sheets || []).map((s) => s.properties);
    const tab = tabs.find((t) => String(t.sheetId) === String(source.gid ?? '')) || tabs[0];
    if (!tab) throw new Error('sheet has no tabs');
    range = `'${tab.title.replace(/'/g, "''")}'`;
  }
  const values = await (
    await fetchOk(`${base}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, auth)
  ).json();
  return { format: 'json', text: JSON.stringify(sheetRowsFromValues(values.values)) };
}

// ── Any https link (CSV, JSON, GeoJSON). A key in the URL stays here. ──
async function readUrl(source) {
  const res = await fetchOk(source.url);
  const text = await res.text();
  const format = source.format === 'csv' || source.format === 'json'
    ? source.format
    : guessFormat(res.headers.get('content-type'), text);
  return { format, text };
}

module.exports = { listGeoSources, getGeoSource };
