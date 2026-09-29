'use strict';

// Pure helpers around the needle-cloud CLI (no I/O), so the argument shapes
// and output parsing are unit-tested from test/core/needle-cli.test.js.
//
// Pinned against needle-cloud 2.7.0 (package.json). Facts this file encodes:
//   - `optimize` prints "Asset successfully optimized: https://cloud.needle.tools/edit/<id>"
//     on success and exits 0; it exits 1 with the failure on stderr/stdout.
//   - `list --output json` prints a JSON array of content items with at least
//     { identifier, title, content_type, content_formats, url, is_public }.
//     `--search` matches name/title/description; `--name` passed to optimize
//     becomes the item's title.
//   - `delete <identifier>` moves an item to the trash (restorable 31 days).
//   - The token env var NEEDLE_CLOUD_TOKEN was rejected as "not logged in" on
//     2.5.0 while `--token` worked, so every command passes --token explicitly.

const EDIT_URL_RE = /https:\/\/cloud\.needle\.tools\/edit\/([A-Za-z0-9_-]+)/;

/** Content id from the CLI's success line, or null. */
function parseEditContentId(output) {
  const m = typeof output === 'string' ? output.match(EDIT_URL_RE) : null;
  return m ? m[1] : null;
}

/**
 * Pick the listing entry for the content we just optimized. Prefers an exact
 * identifier match on the id parsed from the CLI output, then an exact title
 * match on the --name we passed (a `--search` is a substring match, so several
 * items can come back). Returns null when nothing matches unambiguously.
 */
function pickListing(items, { contentId, name }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (contentId) {
    const byId = items.find((it) => it && it.identifier === contentId);
    if (byId) return byId;
  }
  if (name) {
    const byTitle = items.filter((it) => it && it.title === name);
    if (byTitle.length === 1) return byTitle[0];
    if (byTitle.length > 1) {
      // Newest first: a re-run under the same name may have created a sibling.
      return byTitle
        .slice()
        .sort(
          (a, b) =>
            Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
        )[0];
    }
  }
  return null;
}

/** Served URL of a listing item, or null when it is not an https URL. */
function servedUrlOf(item) {
  const url = item && typeof item.url === 'string' ? item.url.trim() : '';
  return /^https:\/\//i.test(url) ? url : null;
}

function authArgs({ token, team }) {
  const args = ['--token', token];
  if (team) args.push('--team', team);
  return args;
}

function optimizeArgs({ file, token, team, name, usecase = 'world' }) {
  return [
    'optimize',
    file,
    ...authArgs({ token, team }),
    '--progressive',
    'true',
    '--usecase',
    usecase,
    '--name',
    name
  ];
}

function listArgs({ token, team, search, limit = 100 }) {
  return [
    'list',
    ...authArgs({ token, team }),
    '--type',
    '3d-asset',
    '--search',
    search,
    '--limit',
    String(limit),
    '--output',
    'json'
  ];
}

function deleteArgs({ token, team, identifier }) {
  return ['delete', identifier, ...authArgs({ token, team })];
}

/** Strip the token from anything we log or persist. */
function redact(text, token) {
  if (!token || typeof text !== 'string') return text;
  return text.split(token).join('[redacted]');
}

/**
 * `list --output json` prints a spinner line first, then the JSON array. Find
 * the array in the combined stdout. Returns [] when there is no parsable array.
 */
function parseListJson(stdout) {
  if (typeof stdout !== 'string') return [];
  // The array is pretty-printed, so it opens at the start of a line; anything
  // else in the output that happens to contain a bracket is not the listing.
  const open = stdout.match(/^\[/m);
  if (!open) return [];
  const start = open.index;
  const end = stdout.lastIndexOf(']');
  if (end < start) return [];
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  parseEditContentId,
  pickListing,
  servedUrlOf,
  optimizeArgs,
  listArgs,
  deleteArgs,
  redact,
  parseListJson
};
