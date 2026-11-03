# Private geo data sources (Joiner)

Outside map apps can let a user **sign in with their 3DStreet account** and load
data shared with that account, without anyone pasting a link or an API token.
The first client is [Joiner](https://github.com/burritojustice/joiner), John's
static map that joins table rows to SF boundaries (its `js/threedstreet.js` and
the "3DStreet sources" card, v52).

3DStreet's server keeps both where each source lives and the credentials to read
it. The browser only ever gets the rows.

## Pieces

| Where                                     | What                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `public/functions/geo-sources.js`         | The `listGeoSources` and `getGeoSource` callables, and the Airtable / Sheets / URL readers |
| `public/functions/geo-sources-utils.js`   | Pure helpers: access check, doc validation, Airtable/Sheets → rows (tested in `test/core/geo-sources-utils.test.js`) |
| `geoSources/{sourceId}` (Firestore)       | One doc per source. Closed to clients in `firestore.rules`; admins edit it in the console |
| `AIRTABLE_GEO_TOKEN` (Secret Manager)     | One read-only Airtable token for every Airtable source                                |

## Callables

Both callables need a signed-in user. Neither calls `assertAppCheck`, because
they're called from other origins that can't attest as a 3DStreet client. The
sign-in plus the per-source grant is the gate, and a call costs nothing
billable.

- `listGeoSources()` returns `{ sources: [{ id, name, description? }] }`: only
  the sources this user may read that are also set up correctly. The list never
  includes base or sheet ids, URLs or grants.
- `getGeoSource({ sourceId })` returns
  `{ name, format: 'csv' | 'json', text }`. For `json`, `text` is an array of
  row objects or a GeoJSON FeatureCollection. A source that doesn't exist and
  one the user can't read both answer `permission-denied`, so ids can't be
  probed. A response over 9 MB answers `out-of-range`, because callables cap
  responses at 10 MB; split such a source into smaller views or ranges.

## A source doc

`geoSources/{sourceId}`: the id is a slug (`[A-Za-z0-9_-]`, up to 64
characters) and is what shows in Joiner's shareable `?source=` links.

```js
{
  name: 'Block Party 2026',          // shown in the list
  description: 'Airtable · blocks',  // optional, shown in the list
  enabled: true,                     // optional; false hides it from everyone

  // Who may read it (any match grants; email and domain need a verified email)
  allowedEmails: ['someone@example.org'],
  allowedDomains: ['sfgov.org'],     // exact domain match
  allowedUids: [],

  kind: 'airtable' | 'gsheet' | 'url',
  // airtable:
  base: 'appXXXXXXXXXXXXXX', table: 'tbl… or table name', view: 'viw…',  // view optional
  fields: ['name', 'cnn'],           // optional allow-list; also how to keep a contact field
  // gsheet:
  sheetId: '1AbC…', gid: 0,          // gid = the tab (from the sheet URL); or range: "'Tab'!A:F"
  // url:
  url: 'https://…?key=…',            // https only; a key in the URL never leaves the server
  format: 'csv' | 'json',            // optional; else from content type / sniffed
}
```

**Contact details:** Airtable fields named like email, phone or address, and
attachment or Airtable-user values, are dropped unless the field is listed in
`fields`. This matches Joiner's own rule.

## Setup (once per project)

1. Set the Airtable token. Make it read-only (`data.records:read`), with access
   to only the bases you'll share:
   ```bash
   firebase functions:secrets:set AIRTABLE_GEO_TOKEN
   ```
2. For Google Sheets, enable the **Google Sheets API** in the GCP project. Then
   share each sheet as **Viewer** with the functions' runtime service account
   (`<project-id>@appspot.gserviceaccount.com` for v1 functions). The sheet can
   then stay **Restricted**. An "Anyone with the link" sheet isn't private (the
   sheet id alone reads it), so don't rely on link sharing.
3. Firebase Auth → Settings → Authorized domains: add the client's origin
   (`burritojustice.github.io`) so its Google sign-in popup is accepted.
4. Give the client 3DStreet's public web config (`apiKey`, `authDomain`,
   `projectId`, `appId`). These values aren't secrets.

## Notes

- The sheet reader gets its Google token from the metadata server
  (`spreadsheets.readonly` scope), so it needs no added dependency and no stored
  key. It only works when deployed; the emulator has no metadata server.
- `listGeoSources` reads the whole collection and filters it in memory. That's
  fine for an admin-curated list of tens of sources. Index the grants if the
  list ever grows large.
- Each read is logged as `[geoSources] <uid> read <sourceId>`.
