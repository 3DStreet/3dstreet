# Bollard Buddy Snapshot Map (Dev Only)

A hacky map viewer that shows geotagged Bollard Buddy snapshots on a Leaflet/OpenStreetMap map. **Dev server only — not intended for production.**

## How it works

1. **Cloud Function** (`getBollardBuddySnapshots`) queries across all users' gallery assets using a Firestore collection group query
2. Filters for `generationMetadata.source == "bollard-buddy-ios"` with lat/lon data
3. Returns snapshot URLs, coordinates, heading, and scene links
4. **`snapshot-map.html`** fetches from the function and renders markers with photo popups

## Files changed

| File | What |
|------|------|
| `public/functions/index.js` | Added `getBollardBuddySnapshots` HTTP cloud function (unauthenticated, CORS enabled) |
| `public/firestore.indexes.json` | Added `COLLECTION_GROUP` index on `assets` for `generationMetadata.source` + `deleted` |
| `public/snapshot-map.html` | Standalone map page served by webpack dev server |

## Deploy

```bash
cd public
firebase deploy --only functions:getBollardBuddySnapshots --project dev-3dstreet
firebase deploy --only firestore:indexes --project dev-3dstreet
```

The collection group index takes a few minutes to build after first deploy. Check status with:

```bash
firebase firestore:indexes --project dev-3dstreet
```

## Usage

With `npm start` running:

```
http://localhost:3333/snapshot-map.html
```

Or after deploying to Firebase hosting, at the dev site URL.

## Notes

- No auth required on the function — fine for dev, would need auth gating before any prod use
- Uses Firebase Admin SDK to bypass Firestore security rules (gallery assets are private per-user)
- Leaflet + OpenStreetMap tiles — no API key needed
- Branch: `bollard-buddy-snapshot-viewer-dev-server-only`
