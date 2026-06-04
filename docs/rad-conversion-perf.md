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

1. **Shipped:** parallelize RAD output compression → **1.27× big / 1.16×
   small, byte-identical output.** (`rad-converter/patches/`.)
2. The earlier "parallelize bhatt_lod" patch was a **measured dead end
   (1.00×)** — it parallelized ~15% of the work; see below.
3. Biggest *untapped* lever is a **faster per-core machine** (clock + IPC):
   LOD construction is single-threaded and the wall-clock floor. Measure via
   the generation-job instrumentation by pinning machine type.
4. Going past that needs **parallelizing the merge loop** — a real rewrite,
   scoped at the bottom.

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
Compression's share *grows with output size*, so it's even larger on big.

## What shipped: parallel RAD compression

RAD stores splats as chunks (65536 each), and within a chunk each property
(center, alpha, rgb, scales, orientation, SH bands, LOD child links) is
deflate-compressed independently — ~10 independent `compress_to_vec` calls
per chunk, ~4,700 for the big file, all sequential upstream.

The patch makes the per-property encoders return **raw** bytes and
compresses them with `rayon` `par_iter_mut` just before chunk assembly.
Output is **byte-identical** (same bytes, same `GZ_LEVEL=6`), so it needs
no quality validation — only wall time changes.

| build | small | big |
| --- | --- | --- |
| baseline (L6) | 13.3s | 1022.0s (570 MB) |
| **parallel compress (L6)** | **11.5s (1.16×)** | **804.9s (1.27×, 570 MB)** |
| `GZ_LEVEL=3` only | 12.4s (1.07×) | 814.7s (1.25×, 572 MB) |
| parallel compress + L3 | 11.6s | 816.4s — **no stacking** |

`GZ_LEVEL=3` (one line) gets ~the same big-file win for +0.4% size and is a
fine lower-maintenance alternative; the two are substitutes (both attack
compression) so combining them does nothing. `GZ_LEVEL=1` is *worse* than
L3 (962s, +3.9% size) — miniz's L1 path emits enough extra bytes that
assembly/write cost outweighs the lighter matching.

## Measured dead ends (don't re-try these)

- **Parallelize `bhatt_lod` (grid population + `recurse_to_output`):**
  **1.00×** (1.01× small, 1.003× big). Those stages are only ~15% of the
  work; Amdahl caps it, and the deferred-mutation refactor's allocation
  overhead erased even that. Also changed output (reordered merge
  tie-breaks). Reverted.
- **`mimalloc` global allocator:** 1.07× small but **0.99× big** — the win
  evaporates at scale because big is FP/compute-bound, not allocation-bound.
  Not worth a dependency.

Note: `build-lod` output is **already non-deterministic run-to-run**
(the same unpatched binary produces a differently-ordered—but
equal-quality—`.rad` each run; near-certainly ahash seeding the grid map).
So "byte-identical to upstream" is only a meaningful bar for changes
*downstream* of construction, like the compression patch; for anything
touching the merge order, the bar is *equivalent quality* (output count
/ size), not byte equality.

## Roadmap (highest leverage first)

1. **Faster per-core machine (no code).** LOD construction is single-
   threaded and clock/IPC-bound. A ~4 GHz C4 (Granite Rapids) / C4D (EPYC
   Turin) vs a 2.8 GHz Xeon is ~1.5–1.8× on that ~48%, stacking with the
   compression win. Cloud Run services don't pin machine type, but Cloud Run
   **jobs / worker pools** do — measure it directly via the
   `generationJobs` duration instrumentation.
2. **Cut the similarity FP (H1, contained).** The ~17% in `exp`/`log` is one
   `similarity()` per neighbor pair across the 27-cell scan. A cheap
   Euclidean pre-filter — skip the full Bhattacharyya (matrix inverse + det
   + exp + log) for neighbors already too far to score — cuts pairs
   evaluated. Changes output within tie-break noise (already non-det).
3. **Parallelize the merge loop (the big rewrite).** Per level: compute
   every active splat's best-neighbor in parallel (the expensive read-only
   FP scan), then commit merges serially, skipping proposals whose endpoints
   were already consumed. Targets the ~48% region, ceiling ≈ core count on
   it. Cost: a genuine rewrite of upstream's greedy clustering, changes
   output, and re-merges on every Spark bump — justify against (1) first.

## Reproducing

Binaries built per-variant with `cargo build --release -p build-lod
--no-default-features` (+ `RUSTFLAGS=-C target-cpu=x86-64-v3`). Wall time is
best-of-3 (small) / single trial (big — differences are >>noise). Profile:
`valgrind --tool=callgrind --cache-sim=no` then `callgrind_annotate`.
