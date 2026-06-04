# RAD conversion — staging Cloud Run perf A/B (handoff runbook)

**This file is a self-contained prompt for a *local* Claude Code session** that
has `gcloud` authenticated against the 3DStreet GCP projects with deploy +
invoke permissions. The cloud sandbox where the `build-lod` patch was written
**cannot** measure the thing we care about (see "Why" below), so the experiment
has to run against real Cloud Run hardware from a machine that can deploy to it.

Everything needed is committed on this branch — point a local session at this
file and it can run the whole thing without copy/paste from elsewhere:

> Read `docs/rad-perf-staging-benchmark.md` and run the staging Cloud Run
> perf A/B it describes (Part A). Report results back per the "Report back"
> section. Don't touch the prod `rad-converter` service or the `rad-convert`
> queue.

---

## Why this can't be done in the cloud sandbox (the open question)

`docs/rad-conversion-perf.md` establishes:

- The shipped patch (`rad-converter/patches/0001-rad-parallel-compress.patch`)
  parallelizes RAD output compression. It's a **reliable 1.16×** on the small
  (1.18M-splat) cache-bound file, and **byte-identical** output (zero quality
  risk).
- On the **big** (22.3M-splat, 363 MB) file the effect is **lost in noise**: the
  sandbox test box showed **~25% run-to-run variance** on an *unchanged* binary
  (814 / 1004 / 1022s). That swamps any patch effect, so **the big-file question
  is unanswered.**
- The roadmap's #1 lever is hardware (the big workload looks
  memory-bandwidth-bound), which also can't be tested on a shared sandbox.

**Goal of this runbook:** answer, on real Cloud Run hardware, the two questions
the sandbox couldn't:

- **Part A (primary):** does the parallel-compress patch measurably speed up the
  **big-file** conversion on Cloud Run's 4-vCPU instance? (Small is already
  proven; we re-confirm it as a sanity anchor.)
- **Part B (optional, higher effort):** is a **faster/higher-bandwidth machine
  type** (e.g. C4D) the real lever, as the profile suggests?

### The method that beats the variance: same-instance interleaving

The sandbox numbers were noise because A and B ran at different times on a
shared VM with drifting co-tenant memory-bandwidth contention. We kill that
here by:

1. Baking **both** binaries — patched `build-lod` and unpatched
   `build-lod-baseline` — into **one** image (`BUILD_BASELINE=1`).
2. Pinning the service to **one** instance (`--max-instances=1 --min-instances=1`,
   `--concurrency=1`).
3. Running trials as **back-to-back pairs** on that one warm instance: baseline
   then patched, same CPU, same cached input. Per-pair *ratio*
   `baseline_ms / patched_ms` cancels slow drift; the **median ratio across
   pairs** is the headline result.

The committed `benchmark` mode (server.js) makes each trial a side-effect-free
`build-lod` run that returns `buildLodMs` (no upload, no Firestore), caching the
source `.ply` per-instance so only the CPU cost varies between trials.

---

## Prerequisites

```bash
# 0. Auth + target. Staging is dev-3dstreet.
gcloud auth login                       # if not already
gcloud auth application-default login   # for any ADC-based calls
export PROJECT=dev-3dstreet
export REGION=us-central1
gcloud config set project "$PROJECT"

# Tools used below: gcloud, curl, jq, awk. Confirm jq is installed.
jq --version || echo "install jq"
```

Permissions the running user needs in `$PROJECT`: `roles/run.admin` (deploy +
set IAM on the bench service), `roles/cloudbuild.builds.editor` (submit the
image build), `roles/iam.serviceAccountUser`, `roles/artifactregistry.writer`,
and `roles/storage.admin` or at least object read on the assets bucket (to stage
a test `.ply`).

### Test inputs — locate or upload a small and a big `.ply`

The A/B needs two real inputs. **Small** is for the sanity anchor; **big** is
the actual question.

```bash
# Small: an existing dev splat (~50–64 MB .ply). List candidates:
gcloud storage ls -r 'gs://dev-3dstreet.appspot.com/users/**/assets/splats/*.ply' \
  --project "$PROJECT"
```

Pick one and note its `plyPath` (the path after the bucket), plus the `<uid>`
and `<assetId>` embedded in `users/<uid>/assets/splats/<assetId>.ply`.

**Big input (22M-class, ~300–400 MB).** There may be no big `.ply` in
`dev-3dstreet`. If not, upload one to a throwaway benchmark path (benchmark mode
never writes to any asset doc, so a fake uid/assetId is fine — it's only used to
name scratch files):

```bash
# Upload your big test .ply (e.g. the 363 MB Mission District file) to a
# benchmark-only path. Use a fixed fake uid/assetId you'll pass to the harness.
export BENCH_UID=benchmark
export BENCH_BIG_ID=mission-big
gcloud storage cp ./mission-district.ply \
  "gs://dev-3dstreet.appspot.com/users/${BENCH_UID}/assets/splats/${BENCH_BIG_ID}.ply" \
  --project "$PROJECT"
```

> If you don't have a big `.ply` handy, any splat in the 15–25M-splat range
> (≈250–400 MB) exercises the same memory-bandwidth regime. Record which file
> you used in the report.

---

## Part A — patch A/B on staging Cloud Run

### A1. Build the benchmark image (both binaries)

```bash
cd rad-converter

# Ensure the Artifact Registry repo exists (gcloud run --source usually creates
# this one already; create if missing).
gcloud artifacts repositories describe cloud-run-source-deploy \
  --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create cloud-run-source-deploy \
       --project "$PROJECT" --location "$REGION" --repository-format=docker

export BENCH_IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/rad-converter-bench:latest"

# BUILD_BASELINE=1 (the cloudbuild.yaml default) compiles build-lod twice —
# patched + unpatched. First build is several minutes (two Rust builds).
gcloud builds submit --config cloudbuild.yaml \
  --project "$PROJECT" \
  --substitutions=_IMAGE="$BENCH_IMAGE"
```

### A2. Deploy the single-instance benchmark service

This is a **separate** service (`rad-converter-bench`) — it never touches the
prod `rad-converter` service or its traffic. Same sizing as prod
(`deploy.sh`): 16Gi / 4 vCPU / 3600s / concurrency 1, **pinned to one warm
instance** so every trial lands on the same CPU.

```bash
gcloud run deploy rad-converter-bench \
  --project "$PROJECT" --region "$REGION" \
  --image "$BENCH_IMAGE" \
  --no-allow-unauthenticated \
  --memory 16Gi --cpu 4 --timeout 3600 \
  --concurrency 1 --min-instances 1 --max-instances 1 \
  --set-env-vars "STORAGE_BUCKET=${PROJECT}.appspot.com"

# Grant yourself invoke on the private service.
gcloud run services add-iam-policy-binding rad-converter-bench \
  --project "$PROJECT" --region "$REGION" \
  --member="user:$(gcloud config get-value account)" --role=roles/run.invoker
```

> The runtime service account also needs Storage read on the assets bucket to
> download the `.ply` (the prod runtime SA already has `storage.objectAdmin`
> per `rad-converter/README.md`; the bench service uses the same default
> Compute SA, so no extra grant if you benchmarked in the same project).

### A3. Run the interleaved A/B harness

Paste this into the local shell. It pairs baseline+patched back-to-back per
trial, for each input, and prints tab-separated rows plus saves raw JSON.

```bash
export SERVICE_URL=$(gcloud run services describe rad-converter-bench \
  --project "$PROJECT" --region "$REGION" --format='value(status.url)')

post() {  # $1=variant $2=uid $3=assetId $4=plyPath  -> prints buildLodMs
  curl -sS -X POST "$SERVICE_URL" --max-time 3600 \
    -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
    -H 'Content-Type: application/json' \
    -d "{\"benchmark\":true,\"variant\":\"$1\",\"uid\":\"$2\",\"assetId\":\"$3\",\"plyPath\":\"$4\"}"
}

run_ab() {  # $1=label $2=uid $3=assetId $4=plyPath $5=pairs
  local label="$1" uid="$2" id="$3" ply="$4" pairs="$5"
  echo -e "# input\tpair\tbaseline_ms\tpatched_ms\tratio"
  for i in $(seq 1 "$pairs"); do
    b=$(post baseline "$uid" "$id" "$ply" | jq -r '.buildLodMs // empty')
    p=$(post patched  "$uid" "$id" "$ply" | jq -r '.buildLodMs // empty')
    if [ -z "$b" ] || [ -z "$p" ]; then echo "$label pair $i FAILED — check logs"; continue; fi
    r=$(awk "BEGIN{printf \"%.3f\", $b/$p}")
    echo -e "${label}\t${i}\t${b}\t${p}\t${r}"
  done
}

# Small = sanity anchor (expect ~1.1–1.2× per the sandbox). Use its real uid/id.
run_ab small "<small-uid>" "<small-assetId>" \
  "users/<small-uid>/assets/splats/<small-assetId>.ply" 8 | tee /tmp/ab-small.tsv

# Big = the real question. First baseline pair also warms the .ply cache.
# 6 pairs ≈ 6×2×~900s ≈ a few hours; reduce if needed but keep >=5 pairs.
run_ab big "$BENCH_UID" "$BENCH_BIG_ID" \
  "users/${BENCH_UID}/assets/splats/${BENCH_BIG_ID}.ply" 6 | tee /tmp/ab-big.tsv
```

> Cloud Run's max request timeout is 3600s (already set); a ~900–1000s big build
> fits. The identity token only needs to be valid at request *start*, so the
> per-call refresh above is fine even for long conversions.

### A4. Analyze

The headline is the **median per-pair ratio** (baseline/patched). Because each
pair runs on the same warm instance back-to-back, this is robust to the drift
that ruined the sandbox numbers.

```bash
summarize() {  # reads a *.tsv from run_ab
  awk -F'\t' 'NR>1 && $5!="" {
      n++; r[n]=$5; sb+=$3; sp+=$4
    }
    END{
      if(n==0){print "no data"; exit}
      asort(r);
      med = (n%2)? r[(n+1)/2] : (r[n/2]+r[n/2+1])/2;
      printf "pairs=%d  median_ratio=%.3f  min=%.3f  max=%.3f  mean_baseline_ms=%.0f  mean_patched_ms=%.0f\n", \
             n, med, r[1], r[n], sb/n, sp/n
    }' "$1"
}
summarize /tmp/ab-small.tsv
summarize /tmp/ab-big.tsv
```

**Decision rule (big file):**

- **median_ratio ≳ 1.10 and min > 1.0** (every pair favored patched) → the patch
  is a **real big-file win** on Cloud Run. Update the docs to say so and keep the
  patch with confidence.
- **median_ratio ≈ 1.00 (say 0.97–1.03), pairs straddle 1.0** → patch is
  **neutral on big files** even on real hardware (consistent with the
  memory-bandwidth-bound hypothesis). Keep it for the small-file win (it's
  byte-identical, zero risk), and point the next effort at **Part B (machine
  type)** rather than more parallelism.
- **median_ratio < 1.0** → patch is a **regression** on big files — surface this
  immediately; it would argue for the one-line `GZ_LEVEL` alternative instead.

Also sanity-check `optimizedSourceSize` (the `radBytes` in each response) is
equal between variants on the big file — the patch is supposed to be
byte-identical, so output size must match.

### A5. Teardown

```bash
gcloud run services delete rad-converter-bench --project "$PROJECT" --region "$REGION" --quiet
gcloud artifacts docker images delete "$BENCH_IMAGE" --project "$PROJECT" --quiet || true
# The benchmark .ply (if you uploaded one) can stay or go:
# gcloud storage rm "gs://${PROJECT}.appspot.com/users/${BENCH_UID}/assets/splats/${BENCH_BIG_ID}.ply"
```

Prod `rad-converter` and the `rad-convert` queue were never touched.

---

## Part B (optional) — machine-type A/B

Roadmap #1 in `rad-conversion-perf.md` is "faster-memory / higher-clock
machine." **Cloud Run does not let you choose the CPU platform** (N2 vs C4D vs
EPYC), so a real machine-type A/B has to run `build-lod` somewhere you *can*
pin it. Two honest options:

1. **GCE VMs (most direct).** Spin up two VMs of different families sized to the
   job (e.g. `n2-standard-4` vs `c4d-standard-4`, both 4 vCPU / 16 GB), copy the
   patched `build-lod` binary (pull it out of the bench image, or `cargo build`
   per `rad-converter/Dockerfile`) and the test `.ply` onto each, and time
   `build-lod <ply> --quality` (best-of-5, `/usr/bin/time -v`). Compare wall
   time and note DDR generation/clock. Delete the VMs after.
2. **Cloud Run worker pools / jobs.** *Verify first* whether the current Cloud
   Run offering actually exposes a CPU-platform / machine-type knob for jobs or
   worker pools — earlier notes assumed it does, but that may be stale. If it
   doesn't, use option 1; don't fabricate a capability.

This part is heavier (provisioning, binary distribution) and is only worth doing
if Part A shows the patch is neutral on big files — i.e. cores aren't the lever,
so test whether memory bandwidth is.

---

## Report back (commit to this branch)

When the run is done, fold the results into the repo so the next person inherits
real numbers, not a sandbox caveat:

1. **Append a dated section to `docs/rad-conversion-perf.md`** titled e.g.
   "Staging Cloud Run A/B (YYYY-MM-DD)" with: the inputs used (file, splat count,
   size), `pairs`, `median_ratio` + min/max for small and big, mean ms per
   variant, and the verdict from the decision rule. Replace/annotate the
   "Measurement validity" caveat for the big file with the real finding.
2. **If the verdict changes the recommendation**, update the CPU-rationale
   comment in `rad-converter/deploy.sh` and the perf note in
   `rad-converter/README.md` accordingly (e.g. "big-file patch effect confirmed
   at N× on Cloud Run 4-vCPU" or "confirmed neutral; lever is machine type").
3. **Commit + push to `claude/tender-volta-7M1ug`** (this branch) with a message
   like `docs(rad-converter): staging Cloud Run A/B results for parallel-compress`.
   Do **not** open a PR unless asked.

Leave the prod converter, queue, and the `deploy.sh` sizing as-is unless the data
justifies a change (and if it does, change `deploy.sh` — it's the single source
of truth — not the live service by hand).
