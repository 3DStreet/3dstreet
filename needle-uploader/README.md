# needle-uploader

Cloud Run service that sends a user-uploaded GLB through **Needle Cloud**
progressive optimization and repoints the asset doc at the streamed result —
the mesh analog of the RAD splat pipeline (`../rad-converter/`). Issue #1990;
plan and status in [`../docs/plans/1990-progressive-glb-streaming.md`](../docs/plans/1990-progressive-glb-streaming.md).

It is **manually triggered**: the asset owner presses *Make streamable* in the
asset details modal, the `requestProgressiveGlb` callable
(`public/functions/progressive-dispatch.js`) writes a `generationJobs` doc
(`kind: 'glb-progressive'`, `provider: 'cloudrun'`, `tokenCost: 0`) and enqueues
a Cloud Task that POSTs this service. There is no automatic `onCreate` trigger.

## Contract

`POST /` with JSON. Two actions:

```json
{ "action": "optimize", "uid": "<owner uid>", "assetId": "<asset doc id>",
  "storagePath": "users/<uid>/assets/meshes/<file>.glb", "jobId": "<optional generationJobs id>" }
```

- Downloads the original from GCS, runs `needle-cloud optimize <file>
  --progressive true --usecase world --name <assetId>` (uploads and waits for
  Needle's job), reads the served URL from `needle-cloud list --output json
  --search <assetId>`, then patches `users/{uid}/assets/{assetId}`:
  `optimizedSourceUrl` (the `cloud.needle.tools` URL), `optimizedSourceSize`
  (initial file bytes, from a HEAD), `optimizationMetadata: { format:
  'needle-progressive', needleAssetId, profile, needleCliVersion, ... }`, and
  removes `optimizedSourcePath` (nothing lives in our bucket).
- Writes `needleContent/{assetId}` = `{ uid, needleAssetId, url, status: 'live' }`
  **before** the doc patch — the ledger the asset GC deletes from.
- With `jobId`, writes `running` → `succeeded` / `failed` / `skipped` on the
  job doc (`skipped` = Needle rejected the file; terminal, HTTP 200, no retry).

```json
{ "action": "delete", "uid": "<owner uid>", "assetId": "<asset doc id>", "needleAssetId": "<identifier>" }
```

- Runs `needle-cloud delete <identifier>` (moves it to Needle's trash,
  restorable 31 days) and sets the ledger doc to `deleted` or `delete-failed`.
  Enqueued by `purgeSoftDeletedAssets` (`public/functions/scheduled/asset-gc.js`).
  A ledger doc left in `orphaned` / `delete-failed` is the manual purge list.

`GET /` is a health check.

## Needle facts this service depends on (needle-cloud 2.7.0, pinned)

- `optimize` requires a **PRO/Enterprise** team license for CLI use and prints
  `Asset successfully optimized: https://cloud.needle.tools/edit/<id>` on
  success. `--usecase world` yields the `<viewId>-world/file` served URL.
- `list --output json` returns `{ identifier, title, content_type,
  content_formats, url, is_public, created_at, ... }`; `--name` becomes `title`.
- `delete <identifier>` exists since 2.6.0 (asked for on our behalf, see the
  plan doc). Frees total storage immediately; monthly usage is not refunded.
- `NEEDLE_CLOUD_TOKEN` as an env var was rejected on 2.5.0, so every command
  passes `--token` explicitly. Parsing lives in `needle-cli.js` and is covered
  by `test/core/needle-cli.test.js`.

## Deploy

[`deploy.sh`](./deploy.sh) is the single source of truth for the Cloud Run
sizing, the secret binding and the Cloud Tasks queue policy; it also lists the
one-time prerequisites (secret, IAM, invoker binding, service URL map).

```bash
cd needle-uploader
./deploy.sh dev-3dstreet us-central1 <needle-team>
```

Then put the printed service URL into `PROGRESSIVE_SERVICE_URLS` in
`public/functions/progressive-dispatch.js` (or set `NEEDLE_UPLOADER_URL` on the
functions) and deploy the functions:

```bash
cd public && firebase use dev-3dstreet && firebase deploy \
  --only functions:requestProgressiveGlb,functions:reconcileGenerationJobs,functions:purgeSoftDeletedAssets,firestore:rules
```

## One-shot test (by hand)

```bash
URL=$(gcloud run services describe needle-uploader --project dev-3dstreet --region us-central1 --format='value(status.url)')
curl -sS -X POST "$URL" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences="$URL")" \
  -H 'Content-Type: application/json' \
  -d '{"uid":"<uid>","assetId":"<assetId>","storagePath":"users/<uid>/assets/meshes/<file>.glb"}'
```

Then open the asset in the editor: the served URL is now the Needle URL, so
`gltf-model` hooks the progressive loader (`&debugprogressive` in the editor
URL prints the LOD swaps).
