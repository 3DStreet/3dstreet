# RAD conversion performance — profile, experiments, and roadmap

How fast `build-lod` turns a splat `.ply` into a streaming `.rad`, why, and
what we changed. The converter runs as a Cloud Run job (see
[`rad-cloud-run-pipeline.md`](./rad-cloud-run-pipeline.md)); conversion wall
time is the user-visible "optimizing…" wait, so it's worth attacking.

All numbers below are on a 4-vCPU / 15 GB Intel Xeon @ 2.8 GHz box, Spark
v2.1.0, `--quality`, built `--no-default-features -C target-cpu=x86-64-v3`.
Two real inputs:

- **small** — SHARP image→splat output, 1.18M splats, 64 MB `.ply`, ~13.5s
- **big** — Vincent's Mission District (SuperSplat-compressed), 22.3M splats,
  363 MB `.ply`, ~1022s

## TL;DR

1. ✅ **Big-file question — answered on real hardware (2026-06-05).** The
   parallel-compress patch is **neutral on the big file**: median **1.014×**
   over 4 same-instance pairs on Cloud Run (every pair in 1.007–1.037),
   vs a clean **1.096×** on small. See "Staging Cloud Run A/B (2026-06-05)"
   below. *Why it needed a dedicated run:* big (22.3M-splat) conversions on
   the **sandbox** test box had **~25% run-to-run variance** (one baseline
   measured 814 / 1004 / 1022s — see "Measurement validity"), which swamped
   every parallelization effect; the staging A/B's same-instance interleaving
   collapsed that spread to ~5% and made the delta measurable. For continuous
   tracking still prefer **prod instrumentation** (real hardware + sample
   size) over the sandbox.
2. **Shipped (`rad-converter/patches/`):** parallelize RAD output
   compression. Reliable, repeatable win **only on small/cache-bound inputs:
   1.16× on the 1.18M-splat file (best-of-3).** Output is byte-identical, so
   it's harmless on big files even if its big-file benefit is unproven here.
   *(A one-line `GZ_LEVEL=3` alternative is comparable; see below.)*
3. The earlier "parallelize bhatt_lod" patch was a **measured dead end
   (1.00× even on the low-variance small file)** — it parallelized ~15% of
   the work; reverted.
4. **The big workload looks memory-bandwidth-bound**, which is consistent
   with both the non-stacking we saw and the original "can't parallelize,
   need a faster CPU" symptom. So the likely real lever is a
   **faster-memory / higher-IPC machine** (e.g. C4D, DDR5 bandwidth), *not*
   more cores — measure it in prod by pinning machine type.
5. A **merge-loop parallelization** is prototyped (parallel best-neighbor +
   serial commit) and produces equivalent-quality output, but its big-file
   benefit is **unproven** (same variance problem). Not shipped; scoped below.

## Staging Cloud Run A/B (2026-06-05) — the big-file question, answered

Ran the [staging runbook](./rad-perf-staging-benchmark.md) on real Cloud Run
hardware. Both binaries — patched `build-lod` + unpatched `build-lod-baseline`
— baked into one image (`BUILD_BASELINE=1`), deployed as a separate
`rad-converter-bench` service **pinned to one warm instance** (16Gi / 4 vCPU /
concurrency 1, `min=max=1`) in `dev-3dstreet`/`us-central1`. Trials run as
back-to-back baseline→patched pairs on that one instance; the per-pair *ratio*
(baseline/patched) cancels the slow memory-bandwidth drift that made this box's
earlier big-file numbers noise. **The interleaving worked: run-to-run spread on
the big file collapsed from ~25% to ~5%** (baseline 1498–1578s across pairs).

Inputs (both already present in `dev-3dstreet`, no upload needed):

- **small** (sanity anchor) — 66 MB `.ply`
  (`users/D4CQ…/assets/splats/773217e4-…ply`)
- **big** (the question) — 363 MB `.ply`, Vincent's Mission District, 22.3M
  splats (`…/1368d3a4-…ply`)

| input | pairs | median ratio | min | max | mean baseline | mean patched |
| --- | --- | --- | --- | --- | --- | --- |
| small | 8 | **1.096×** | 1.017 | 1.134 | 23.2s | 21.3s |
| big   | 4 | **1.014×** | 1.007 | 1.037 | 1536.7s (25.6 min) | 1509.7s (25.2 min) |

Big-file output was **byte-identical** baseline vs patched on every pair
(597,294,504 bytes), re-confirming the patch's zero-quality-risk property at
scale. Big stopped at 4 pairs (not the runbook's ≥5) by deliberate choice: the
spread was so tight by pair 3 that the verdict was already unambiguous, and the
≥5 was sized for the *old* ~25% variance that the interleaving eliminated. (An
overnight network drop on the local driver killed pairs after the first attempt;
the harness was re-run under `caffeinate` with retry-on-transient logic — a
local-driver issue, not a service one. The bench service stayed healthy
throughout.)

**Verdict (big file): NEUTRAL.** Median 1.014×, every pair within
[1.007, 1.037] — squarely the runbook's "neutral" bucket (0.97–1.03), an order
of magnitude below the small-file's ~1.10× and far short of the "real win"
threshold (≳1.10). The parallel-compress patch **does not measurably speed up
big-file conversion on Cloud Run's 4-vCPU instance.** This is exactly what the
memory-bandwidth-bound hypothesis predicts: extra compression threads contend
for the same memory bus, so more cores don't help. Small file re-confirmed at
~1.10× (consistent with the sandbox's 1.16× best-of-3; a median-of-ratios runs
slightly below a best-of-3, as expected).

**Consequences:**

- **Keep the patch.** Real ~1.10× on small/cache-bound inputs, byte-identical
  (zero risk) on big — no reason to drop it.
- **Don't chase more parallelism for big files.** Cores aren't the lever. The
  next experiment is **Part B (machine type)** — whether a higher-bandwidth
  DDR5 part (C4D / EPYC Turin) moves the big-file number.
- The earlier "big-file effect is unmeasurable here" caveat is **resolved**: on
  low-variance Cloud Run hardware the effect is measurable, and it's ~1%
  (neutral).

## Where the time goes (callgrind, small file)

Self-cost (instruction refs), `build-lod --quality`, GPU feature off:

| % | Function | What |
| --- | --- | --- |
| 26.7% | `miniz_oxide deflate::compress_to_vec` | **compressing the `.rad` output** |
| 26.6% | `process_file_lod_tsplat` | merge-loop machinery (neighbor scan, grid) |
| 14.5% | `__expf` (libm) | `exp()` in the similarity metric |
|  3.4% | `quicksort` | initial sort by feature size |
|  3.1% | `BinaryHeap::pop` | the active-splat heap |
|  2.8% | `__powf` (libm) | `pow()` in `ellipsoid_area` |
|  2.4% | `__logf` (libm) | `ln()` in Bhattacharyya |
|  2.3% | `SymMat3::eigens` | covariance eigendecomposition |
|  1.9% | `deflate::flush_block` | **more output compression** |
|  1.9% | `new_merged` | building merged splats |

Two regions dominate: **output compression ≈ 28.6%** (`compress_to_vec` +
`flush_block`) and the **merge loop ≈ 48%** (its machinery + the
similarity FP it calls: `exp`/`log`/`pow` + `eigens` + `new_merged`).
(This profile is the *small* file; the big-file mix may differ, and note
that under memory-bandwidth contention instruction-count attribution and
wall-clock attribution diverge — see "Measurement validity.")

## What shipped: parallel RAD compression

RAD stores splats as chunks (65536 each), and within a chunk each property
(center, alpha, rgb, scales, orientation, SH bands, LOD child links) is
deflate-compressed independently — ~10 independent `compress_to_vec` calls
per chunk, ~4,700 for the big file, all sequential upstream.

The patch makes the per-property encoders return **raw** bytes and
compresses them with `rayon` `par_iter_mut` just before chunk assembly.
Output is **byte-identical** (same bytes, same `GZ_LEVEL=6`), so it needs
no quality validation — only wall time changes.

| build | small (best-of-3, **reliable**) | big (single trial, **within noise**) |
| --- | --- | --- |
| baseline (L6) | 13.3s | 814 / 1004 / 1022s (!) |
| **parallel compress (L6)** | **11.5s (1.16×)** | 804.9s — *indistinguishable* |
| `GZ_LEVEL=3` only | 12.4s (1.07×) | 814.7s — *indistinguishable* |
| parallel compress + L3 | 11.6s | 816.4s |
| merge-loop parallel (L6) | 13.1s (1.12×) | 792.4s — *indistinguishable* |
| merge-loop + compress | 11.3s | 783.2s — *indistinguishable* |

**Read the big column as "all ~780–1020s, i.e. equal within the baseline's
own ±25% variance."** The only trustworthy signal is the small column
(best-of-3, cache-bound, low variance): parallel compression is a real
1.16×; the merge-loop rewrite is a real but smaller 1.12× there. Neither
can be confirmed or denied on the big file from this box.

`GZ_LEVEL=3` (one line) is a substitute for parallel compression (both
attack the same phase); on the reliable small file it's 1.07× for +0.4%
output size. `GZ_LEVEL=1` is *worse* — bigger output, no faster.

## Measurement validity (why the big column is noise)

> **Resolved (2026-06-05):** this caveat is about the *sandbox* test box. The
> big-file patch effect has since been measured on real Cloud Run hardware via
> same-instance interleaving (spread ~5%, not ~25%) — it's **neutral (1.014×)**.
> See "Staging Cloud Run A/B (2026-06-05)". The variance story below still
> explains why the *sandbox* single-trial big numbers were meaningless.

A single unchanged `build-lod-baseline` binary, same 363 MB input, three
isolated runs: **814.5s, 1004.0s, 1022.0s** — a 25% spread with nothing
changed. The 22M-splat working set is multiple GB; on a shared cloud VM,
co-tenant memory-bandwidth contention dominates wall time for big inputs.
Small inputs fit in cache and are stable, so best-of-3 there is meaningful.

Consequence: **do not measure big-file conversion changes on a shared
sandbox.** Use the prod `generationJobs` duration instrumentation, which
samples real conversions on consistent hardware — the right tool for any
big-file perf decision (machine type, this patch's real effect, etc.).

## Measured dead ends (don't re-try these)

- **Parallelize `bhatt_lod` (grid population + `recurse_to_output`):**
  **1.00× on the low-variance small file** (1.01×). Those stages are only
  ~15% of the work; Amdahl caps it, and the deferred-mutation refactor's
  allocation overhead erased even that. Also changed output. Reverted.
- **`mimalloc` global allocator:** 1.07× small only; no measurable big
  effect. Not worth a dependency.

Note: `build-lod` output is **already non-deterministic run-to-run**
(the same unpatched binary produces a differently-ordered—but
equal-quality—`.rad` each run; near-certainly ahash seeding the grid map).
So "byte-identical to upstream" is only a meaningful bar for changes
*downstream* of construction, like the compression patch; for anything
touching the merge order, the bar is *equivalent quality* (output count
/ size), not byte equality.

## Roadmap (highest leverage first)

**First, fix measurement.** Every item below must be judged on **real
hardware with a sample size**, because this sandbox can't resolve big-file
deltas under ~25%. Two ways to get there: (a) a deliberate **staging Cloud Run
A/B** that runs both binaries on one pinned instance — runbook in
[`rad-perf-staging-benchmark.md`](./rad-perf-staging-benchmark.md); **done for
the compress patch (2026-06-05) — neutral on big, see the A/B section above**;
re-usable for the items below — and (b) wiring conversion duration + machine
type into `generationJobs` for continuous prod sampling. Use one of these
before spending effort on the items below.

1. **Faster-memory / higher-clock machine (no code).** The big workload
   looks memory-bandwidth-bound, so a higher-bandwidth DDR5 part (C4D / EPYC
   Turin) and/or higher single-core clock is the most likely real lever —
   *and more cores probably are not*, which is why parallelization didn't
   reliably help. Cloud Run services don't pin machine type, but Cloud Run
   **jobs / worker pools** do; A/B two machine types in prod and read the
   duration telemetry.
2. **Cut the similarity FP (H1, contained, unbuilt).** ~17% (small-file
   profile) is `exp`/`log`, one `similarity()` per neighbor pair across the
   27-cell scan. A cheap Euclidean pre-filter — skip the full Bhattacharyya
   for neighbors already too far to score — cuts pairs evaluated. Changes
   output within tie-break noise. Cheaper/safer than (3); try first if FP is
   confirmed hot in prod.
3. **Merge-loop parallelization (prototyped, unproven).** Parallel
   best-neighbor scan + serial commit, batched per level (`spark-mergeloop`
   branch / the 200-line diff). Produces equivalent-quality output (+1.1%
   splat count). Measured 1.12× on the low-variance small file; big-file
   effect indistinguishable from noise here. It's a genuine fork of
   upstream's greedy clustering that re-merges on every Spark bump — only
   ship if prod telemetry proves a real win that (1) can't deliver.

## Reproducing

Binaries built per-variant with `cargo build --release -p build-lod
--no-default-features` (+ `RUSTFLAGS=-C target-cpu=x86-64-v3`). Wall time is
best-of-3 (small) / single trial (big — differences are >>noise). Profile:
`valgrind --tool=callgrind --cache-sim=no` then `callgrind_annotate`.
