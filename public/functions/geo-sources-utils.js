/**
 * Private geo data sources for outside map apps (Joiner): pure helpers.
 *
 * A source is a Firestore doc in `geoSources/{sourceId}` (server-only; see
 * docs/geo-sources.md) naming where the rows live and who may read them. The
 * callables in geo-sources.js read the source with credentials held on the
 * server and return the rows; nothing secret reaches the browser.
 *
 * No Firebase imports here, so test/core can require this file directly.
 */

// Callable responses are capped at 10 MB; stay under it with room for the
// envelope. A bigger source should be split (a view, a filtered range).
const MAX_RESPONSE_BYTES = 9 * 1024 * 1024;

// Airtable allows 5 requests a second per base.
const AIRTABLE_PAGE_GAP_MS = 220;
// Safety stop: 100 pages of 100 records.
const AIRTABLE_MAX_PAGES = 100;

const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = ['airtable', 'gsheet', 'url'];

// Contact details never leave the server unless the source lists the field
// in `fields` explicitly (Joiner's rule: no contact fields by default).
const CONTACT_NAMES =
  /(e-?mail|phone|street address|mailing address|home address|^address$|contact info)/i;

const isValidSourceId = (id) => typeof id === 'string' && SOURCE_ID.test(id);

const lowerList = (v) =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' && x).map((x) => x.trim().toLowerCase())
    : [];

/**
 * May this signed-in user read this source?
 *
 * `auth` is the callable's `context.auth` ({ uid, token }). Email and domain
 * grants need a verified email (Google sign-in always is); a uid grant
 * doesn't. A disabled source (`enabled: false`) is readable by no one.
 */
function canReadSource(source, auth) {
  if (!source || !auth || !auth.uid) return false;
  if (source.enabled === false) return false;
  if (lowerList(source.allowedUids).includes(auth.uid.toLowerCase())) return true;
  const token = auth.token || {};
  const email = typeof token.email === 'string' ? token.email.trim().toLowerCase() : '';
  if (!email || token.email_verified !== true) return false;
  if (lowerList(source.allowedEmails).includes(email)) return true;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return lowerList(source.allowedDomains).includes(domain);
}

/**
 * Check a source doc's shape before using it. Returns an error message, or ''
 * when it's usable. (A broken doc is an admin mistake: the caller logs it and
 * tells the user the source isn't available.)
 */
function sourceProblem(source) {
  if (!source || typeof source !== 'object') return 'missing';
  if (!KINDS.includes(source.kind)) return `unknown kind "${source.kind}"`;
  if (source.kind === 'airtable') {
    if (!/^app[A-Za-z0-9]{14}$/.test(source.base || '')) return 'airtable: bad base id';
    if (!source.table || typeof source.table !== 'string') return 'airtable: no table';
  }
  if (source.kind === 'gsheet' && !/^[A-Za-z0-9_-]{20,}$/.test(source.sheetId || '')) {
    return 'gsheet: bad sheetId';
  }
  if (source.kind === 'url') {
    let u;
    try {
      u = new URL(source.url);
    } catch {
      return 'url: not a URL';
    }
    if (u.protocol !== 'https:') return 'url: must be https';
  }
  return '';
}

/** What the source list shows: no ids of bases or sheets, no grants. */
function publicSourceInfo(id, source) {
  const info = { id, name: typeof source.name === 'string' && source.name ? source.name : id };
  if (typeof source.description === 'string' && source.description) {
    info.description = source.description;
  }
  return info;
}

// An Airtable cell → a plain value Joiner can show and join on.
function airtableCell(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' ? (x.name ?? x.text ?? '') : x))
      .filter((x) => x !== '' && x != null)
      .join(', ');
  }
  if (typeof v === 'object') return v.name ?? v.text ?? '';
  return v;
}

// Values that are contact details or files whatever the field is called:
// attachments ({ url, filename }) and Airtable users ({ email }).
function isContactValue(v) {
  const first = Array.isArray(v) ? v[0] : v;
  return !!(
    first &&
    typeof first === 'object' &&
    ('email' in first || ('url' in first && 'filename' in first))
  );
}

/**
 * Airtable `records` pages → plain row objects. Contact fields are dropped
 * unless named in `keepFields` (the source's explicit `fields` list). Each row
 * keeps its record id as `_airtable_id`, as Joiner's own Airtable loader does.
 */
function airtableRowsFromRecords(records, keepFields = []) {
  const keep = new Set(keepFields);
  return records.map((r) => {
    const row = {};
    for (const [k, v] of Object.entries(r.fields || {})) {
      if (!keep.has(k) && (CONTACT_NAMES.test(k) || isContactValue(v))) continue;
      row[k] = airtableCell(v);
    }
    row._airtable_id = r.id;
    return row;
  });
}

/** The Airtable list-records URL for one page. */
function airtableListUrl(source, offset) {
  const q = new URLSearchParams();
  q.set('pageSize', '100');
  if (source.view) q.set('view', source.view);
  for (const f of Array.isArray(source.fields) ? source.fields : []) q.append('fields[]', f);
  if (offset) q.set('offset', offset);
  return `https://api.airtable.com/v0/${source.base}/${encodeURIComponent(source.table)}?${q}`;
}

/**
 * Sheets API `values` (first row = headers) → row objects. Blank header
 * cells get a column name; short rows are padded with ''.
 */
function sheetRowsFromValues(values) {
  if (!Array.isArray(values) || !values.length) return [];
  const seen = new Map();
  const headers = values[0].map((h, i) => {
    let name = String(h ?? '').trim() || `Column ${i + 1}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
  return values
    .slice(1)
    .filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => {
      const row = {};
      headers.forEach((h, i) => {
        row[h] = r[i] ?? '';
      });
      return row;
    });
}

/** Is a fetched body JSON or CSV? (Prefer the content type, then sniff.) */
function guessFormat(contentType, text) {
  if (/json/i.test(contentType || '')) return 'json';
  if (/csv|text\/plain|tab-separated/i.test(contentType || '')) return 'csv';
  return /^\s*[[{]/.test(text || '') ? 'json' : 'csv';
}

module.exports = {
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
};
