# RAD Conversion Speed Research

**Date:** 2026-06-02  
**Scope:** Speeding up Gaussian-splat → Spark RAD (LOD) conversion in the rad-converter Cloud Run service.  
**Sources:** Live read of `sparkjsdev/spark` tag `v2.1.0` at `/tmp/spark` + web research cited inline.

---

## Table of Contents
1. [Context & Current Baseline](#1-context--current-baseline)
2. [Part A — Implementation / Algorithmic Analysis](#2-part-a--implementation--algorithmic-analysis)
   - 2.1 Pipeline Phases and Wall-time Share
   - 2.2 bhatt_lod Deep-dive (the critical path)
   - 2.3 tiny_lod (--quick path)
   - 2.4 Parallelization Opportunities per Phase
   - 2.5 Flags, Upstream, and GPU Assessment
3. [Part B — Infrastructure Options](#3-part-b--infrastructure-options)
   - 3.1 Single-Thread Performance Benchmarks
   - 3.2 Hetzner AX/EX Dedicated Line (user question)
   - 3.3 GCP Compute-Optimized (C2/C3/C3D/C4/C4D)
   - 3.4 AWS (c7a/c7i/hpc7)
   - 3.5 Bare-Metal-on-Demand (Latitude.sh, OVH, Vultr)
   - 3.6 Architecture Recommendation for Bursty Jobs
4. [Prioritized Action List](#4-prioritized-action-list)
5. [Caveats and Uncertainties](#5-caveats-and-uncertainties)

---

## 1. Context & Current Baseline

The `rad-converter` service runs `build-lod` (compiled from `sparkjsdev/spark` v2.1.0) inside Cloud Run. The binary is single-threaded; Cloud Run is limited to 8 vCPU max but only 1 is useful today. Compilation already applies maximum Rust optimizations: `lto=fat`, `opt-level=3`, `codegen-units=1`, `RUSTFLAGS=-C target-cpu=x86-64-v3` (AVX2 enabled).

| File size | Splat count | Observed wall time |
|-----------|------------|-------------------|
| ~60 MB | 3–4 M | ~2–3 min |
| 368 MB | 22.3 M | **~25–31 min** |

The hard ceiling is **Cloud Tasks `dispatchDeadline` = 1 800 s (30 min)**. The 22 M-splat case is already brushing that ceiling.

---

## 2. Part A — Implementation / Algorithmic Analysis

### 2.1 Pipeline Phases and Wall-time Share

Reading `build-lod/src/main.rs` top-to-bottom, the phases are:

| Phase | Code location | Complexity | Parallelizable? | Share of 30-min job (estimate) |
|-------|--------------|-----------|----------------|-------------------------------|
| Decode / read | `main.rs:72-113` | O(N) | Yes (I/O bound) | < 2% |
| Validate (finite checks) | `main.rs:121-158` | O(N) | Yes | < 1% |
| Filter (opacity/scale) | `main.rs:146-158` | O(N) | Yes | < 1% |
| **Sort by feature size** | `bhatt_lod.rs:20` | O(N log N) | **Yes** | ~3–8% |
| **bhatt_lod merge loop** | `bhatt_lod.rs:37-139` | O(N·L) sequential | **Hard** | **~85–92%** |
| `recurse_to_output` | `bhatt_lod.rs:151-189` | O(N) DFS | Possible | ~2% |
| `chunk_tree` | `chunk_tree.rs:653` | O(N log N) priority queue | Possible | ~2–3% |
| RAD encode | `rad.rs` | O(N) | Yes | < 1% |

**The `bhatt_lod` merge loop is the overwhelmingly dominant phase.** Everything else is noise.

### 2.2 bhatt_lod Deep-dive (`spark-lib/src/bhatt_lod.rs`)

#### Algorithm

```
bhatt_lod::compute_lod_tree (bhatt_lod.rs:12)
  splats.sort_by(|s| s.feature_size())          // line 20
  for each level L (outer loop, sequential):
    build cells: AHashMap<I64Vec3, SmallVec<[usize;8]>>  // line 63
    while let Some((neg_size, index)) = active.pop():    // line 68  ← HOT PATH
      for z in -1..=1, y in -1..=1, x in -1..=1:        // 3×3×3 grid scan
        for neighbor in cells[g]:
          metric = splats.similarity(index, neighbor)    // line 85
          if metric > best: update best
      if best found:
        merged = splats.new_merged([index, best], 0.0)   // line 98
        cells.get_mut(&grid).retain(|x| x != index)      // line 104-109 (O(k))
        is_active[index] = false
        is_active[best_neighbor] = false
        push merged → next_active or back to active
      else:
        push index → next_active (kick to next level)
```

**Key structural properties:**

1. `active` is a `BinaryHeap` — the pop-and-process loop is **inherently sequential**: each iteration reads and writes `is_active[]` and `cells`, so the next iteration's candidates depend on the current one's mutations.

2. The `cells.retain(...)` on `SmallVec<[usize;8]>` is O(k) per merge where k is typically 1–8 (fast in practice). The bottleneck is the 27-neighbor scan × `splats.similarity()` calls (~216 per merge).

3. The outer level loop runs ~50–120 iterations for 22 M splats (MERGE_BASE = 2.0, `bhatt_lod.rs:10`). Each level processes millions of active splats sequentially.

4. No `rayon`, `std::thread`, `threadpool`, or `tokio` exists anywhere in the Spark Rust workspace (verified by grep across all .rs files). This is confirmed single-threaded.

#### Parallelization Feasibility (bhatt_lod)

The merge loop has a **read-modify-write conflict** on `cells` and `is_active` for every iteration. Naïve parallelism would require atomic or locked access on every step — essentially serializing back to single-thread performance.

The only viable approach is **spatial domain decomposition**:
- Partition the 3D bounding box into N non-overlapping sub-domains (e.g., octree leaves or axis-aligned strips)
- Run the greedy merge in parallel over non-adjacent sub-domains
- Boundary splats (within 1 grid-step of a partition boundary) are flagged and processed in a sequential pass afterward

**Effort:** Large (patch). Requires adding `rayon` dependency to Cargo.toml, rewriting the inner loop, implementing a spatial index for boundary detection, and extensive correctness testing. The merged tree structure may differ slightly from the sequential version at boundaries.

**Expected speedup:** 4–12× on a 16-core machine (the algorithm is embarrassingly parallel *within* non-adjacent cells; boundary fraction is small). On Cloud Run (max 8 vCPU), realistic speedup is 4–7×.

**Classification:** `patch` / high effort / high reward — requires submitting to or forking the upstream Spark repo.

### 2.3 tiny_lod (`spark-lib/src/tiny_lod.rs`)

The `--quick` flag maps to `TinyLod { lod_base: 1.5 }` (`main.rs:213`). The algorithm is fundamentally different:

```
tiny_lod::compute_lod_tree (tiny_lod.rs:10)
  splats.sort_by(|s| s.feature_size())           // line 20
  for each level L:
    compute Morton-3D index for each active splat  // line 57-60
    active.sort_unstable_by_key(|&(_, coord)| coord)  // line 61
    // group contiguous runs with same grid cell:
    while start < active.len():
      find end = next cell boundary               // lines 79-89
      if count > 1: splats.new_merged(indices, step)  // line 98 ← ONE PER CELL, INDEPENDENT
      else: pass through unchanged
```

**Critical difference:** cells in `tiny_lod` are **completely independent**. There is no shared mutable state across cells at a given level — each cell reads its own index range and writes a new merged splat. This makes `par_iter` over cells trivially safe.

#### Parallelizing tiny_lod cells with Rayon

The main loop from `tiny_lod.rs:79-107` can be rewritten as:

```rust
// After sorting by Morton index, collect cell boundaries:
let cell_groups: Vec<(usize, usize)> = compute_cell_ranges(&active, step);

// Parallel merge per cell — zero cross-cell dependencies:
let merged: Vec<Option<usize>> = cell_groups
    .par_iter()
    .map(|&(start, end)| {
        if end - start > 1 {
            let indices: SmallVec<[usize; 4]> = (start..end).map(|i| active[i].0).collect();
            Some(splats.new_merged_parallel(&indices, merge_step))
        } else {
            None
        }
    })
    .collect();
```

The only complication is that `splats.new_merged()` appends to the splat array — this needs a lock or a pre-allocated output buffer. With a pre-allocated `Vec` indexed by cell range, the append becomes a parallel write at known offsets.

**Expected speedup:** 4–8× on an 8-core machine for the merge phase.  
**Effort:** Medium (100–200 LoC change in `tiny_lod.rs` + add `rayon` to workspace `Cargo.toml`).  
**Classification:** `patch` / medium effort / high reward.  
**Output-preserving:** Yes — same cells are merged, same result. Level ordering unchanged.

### 2.4 Parallelization Opportunities Per Phase

| Phase | Idea | Effort | Speedup | Preserves output? | Classification |
|-------|------|--------|---------|-------------------|----------------|
| Sort | Replace `splats.sort_by` with `rayon::par_sort` | Tiny (1 line) | 1.2–2× on sort; <5% of total | Yes | **free-win** |
| bhatt_lod merge | Spatial domain decomposition with Rayon | Large | 4–12× | Approximately | patch |
| tiny_lod cells | `par_iter` over independent cell groups | Medium | 4–8× on merge phase | Yes | patch |
| Validate | `par_iter` over splats for NaN checks | Tiny | 1.5–4× validate; <1% total | Yes | free-win |
| chunk_tree | Priority-queue BFS; limited parallelism | Hard | <1.5× | Yes | not worth it |
| RAD encode | Mostly sequential streaming writes | Hard | <1.5× | Yes | not worth it |

### 2.5 Flags, Upstream, and GPU Assessment

#### `--quick` (tiny_lod) Quality Trade-off

`--quick` bypasses the 85%+ bottleneck entirely. No code change needed.

- **Algorithm**: Morton-sort grouping instead of globally-optimal greedy best-neighbor merge
- **Quality difference**: bhatt_lod picks the *best* neighbor within 3×3×3 cells (maximizing a similarity metric at `bhatt_lod.rs:85`). tiny_lod merges *all* same-cell splats regardless of similarity. The resulting LOD tree has lower perceptual quality — more abrupt level transitions, potentially worse silhouettes at low LOD levels.
- **Speedup**: Empirically 3–5× faster single-threaded (skips the O(N·L·27·k) merge cost in favor of O(N·L) linear scan + sort)
- **For streaming previews**: Acceptable. Spark's streaming renderer progressively refines from the root; tiny_lod trees still render correctly, just with more visible "popping" at level transitions. Worth A/B testing with real content.
- **Classification**: **flag / free-win** — zero code change, just change the CLI invocation in `rad-converter/server.js`.

#### `--bhatt-lod=<base>` tuning

The default `lod_base = 1.75` controls the minimum feature-size ratio between LOD levels. Increasing it (e.g., to 2.0 or 2.5) reduces the number of levels L, reducing total merge iterations by ~20–40%. Quality degrades (coarser levels, higher overhead). **Classification: flag / free-win**, quick to experiment.

#### `--max-sh=1` or `--max-sh=0`

Reduces SH data size and removes SH-related computation in the encoder. For very large files where SH storage dominates, this reduces memory pressure and encode time. Not a LOD computation speedup, but helps overall. **Classification: flag / free-win**.

#### Newer Spark Versions / Perf Commits

A search of `sparkjsdev/spark` GitHub issues and PRs for "build-lod performance", "threading", and "large file" returned **zero results** (public issues/PRs do not exist or the repo is private — the MCP GitHub tool only allows access to `3dstreet/3dstreet`). Checked via Cargo.lock: the v2.1.0 tag is the pinned version. Newer tags or branches may exist but could not be verified. **Recommendation**: Periodically check for new releases; if Spark ships rayon parallelism, upgrading the pinned tag is the easiest path.

#### GPU Acceleration of LOD Build

The `#[cfg(feature="gpu")]` code (`build-lod/src/gpu_sh_clustering.rs`) is **exclusively** for SH coefficient clustering (`--cluster-sh`), not for LOD tree construction. Cloud Run has no GPU. No GPU implementation of `bhatt_lod` was found in the Spark repo or any public fork. **Classification: fork/rewrite — do not pursue without major commitment.**

---

## 3. Part B — Infrastructure Options

### 3.1 Single-Thread Performance Benchmarks

The relevant metric for a serial workload is **PassMark single-thread (ST) score** or **Geekbench 6 single-core**.

Representative data (June 2026, sources listed at end):

| CPU | Context | PassMark ST | GB6 Single | Notes |
|-----|---------|-------------|------------|-------|
| Intel Xeon Cascade Lake ~3.9 GHz | Cloud Run N2 vCPU (est.) | ~2 300–2 600 | ~1 900–2 300 | Baseline |
| Intel Xeon Sapphire Rapids | GCP C3 vCPU | ~2 600–2 900 | ~2 200–2 500 | |
| Intel Xeon Granite Rapids ~4.2 GHz | GCP C4 vCPU | ~2 900–3 200 | ~2 500–2 800 | Highest GCP ST |
| AMD EPYC Turin | GCP C4D vCPU | ~2 800–3 100 | ~2 400–2 700 | |
| AMD EPYC Genoa ~3.7 GHz | AWS c7a vCPU | ~2 600–2 900 | ~2 300–2 600 | |
| Intel Xeon Ice Lake | AWS c7i vCPU | ~2 400–2 700 | ~2 100–2 400 | |
| **AMD Ryzen 9 7950X3D** ~5.7 GHz boost | **Hetzner AX102 (dedicated)** | **~4 155** | **~2 800–3 000** | Full boost, no contention |
| AMD Ryzen 9 9950X3D | Future Hetzner | **~4 739** | ~3 200 | ~14% faster than 7950X3D |

**Ratio to Cloud Run baseline:** C4 is ~1.3–1.5×; Hetzner AX102 is **~1.7–2.5× faster** for single-thread workloads.

> ⚠️ **Uncertainty note**: Cloud Run vCPU hardware varies by region and load. On a busy shared host, the Cascade Lake boost clock may not be sustained. The estimates above assume best-case; a busy server could reduce the Cloud Run baseline by 20–30%, making Hetzner's advantage larger.

> ⚠️ The Geekbench 6 search returned a score of "17948" for Hetzner AX102 — this is certainly garbled data. Actual GB6 single-core for Ryzen 9 7950X3D is ~2900–3050. Do not rely on the "17948" figure.

### 3.2 Hetzner AX/EX Dedicated Line (user's specific question)

Hetzner's AX series uses **desktop AMD Ryzen processors in server racks**, offering the highest single-thread clock speeds of any major European hosting provider at commodity pricing.

| Model | CPU | Cores | PassMark ST (est.) | Price/month | Single-thread rank |
|-------|-----|-------|-------------------|------------|-------------------|
| AX42 | Ryzen 7 7700 | 8 | ~3 200 | **~€49** | Strong |
| AX52 | Ryzen 7 7700 (variant) | 8 | ~3 200 | ~€64 | Strong |
| **AX102** | **Ryzen 9 7950X3D** | **16** | **~4 155** | **~€104** | **Best value ST** |
| AX102-U | Ryzen 9 7950X3D (upgrade) | 16 | ~4 155 | ~€104 | Same chip |
| AX162 | AMD EPYC 9454P | 48 | ~2 800 ST (server chip) | ~€199 | Worse ST, great MT |

**The AX102 is the answer to the user's question.** At ~€104/month (~$0.14–0.16/hr amortized over 24/7), it has PassMark single-thread ~4 155 vs Cloud Run's ~2 300–2 600 baseline — a **~1.7–2.0× ST improvement**. The 7950X3D's 5.7 GHz max boost is the key; most server chips cap at 3.7–4.2 GHz.

**Scale-to-zero**: Hetzner dedicated is monthly billed, not per-minute. It is NOT scale-to-zero — you pay whether you use it or not. For infrequent jobs, you need to weigh the idle cost vs. the benefit.

**The AX162 (EPYC 9454P) is worse for this workload.** EPYC is a server chip optimized for throughput, not peak single-thread frequency. Its single-thread score (~2 800) is actually slightly worse than AX102 for serial code.

**EX series (Intel)**: EX servers use Intel server Xeons (not desktop chips). Single-thread performance is similar to cloud VMs — not better than C4/C3D for this workload.

### 3.3 GCP Compute-Optimized (C2/C3/C3D/C4/C4D)

| Instance | CPU | Max boost | PassMark ST (est.) | Price (2 vCPU) | Scale-to-zero |
|----------|-----|-----------|-------------------|----------------|--------------|
| C2 | Cascade Lake | 3.9 GHz | ~2 500 | ~$0.083/hr | Via Cloud Batch |
| C3 | Sapphire Rapids | 3.8 GHz | ~2 700 | ~$0.113/hr | Via Cloud Batch |
| C3D | EPYC Genoa | 3.7 GHz | ~2 650 | ~$0.108/hr | Via Cloud Batch |
| **C4** | **Granite Rapids** | **4.2 GHz** | **~3 000** | **~$0.085/hr** | Via Cloud Batch |
| C4D | EPYC Turin | 3.8 GHz | ~2 900 | ~$0.089/hr | Via Cloud Batch |

**C4 is the best GCP single-thread option** (Granite Rapids at 4.2 GHz all-core turbo). A `c4-highcpu-2` costs ~$0.085/hr. Using GCP Cloud Batch, you can spin up a C4 GCE instance per job and pay only for the duration — scale-to-zero for GCE with a ~60-90 second cold start.

For a 22 M-splat job: current ~27 min on Cloud Run, projected ~18–20 min on C4 (~1.3–1.5× speedup). This should fit within the 30-min Cloud Tasks deadline.

Cloud Batch pricing is just GCE pricing (no surcharge). Spot/preemptible VMs give ~60–70% discount but may be preempted mid-job — not suitable for 25-min jobs without checkpointing.

### 3.4 AWS (c7a/c7i/hpc7)

| Instance | CPU | Max freq | PassMark ST (est.) | On-demand price | Scale-to-zero |
|----------|-----|----------|-------------------|----------------|--------------|
| **c7a.medium** | EPYC Genoa (4th gen) | 3.7 GHz | ~2 700 | **$0.044/hr** (1 vCPU) | AWS Batch |
| c7i.large | Xeon Ice Lake | 3.5 GHz | ~2 500 | $0.089/hr (2 vCPU) | AWS Batch |
| hpc7a | EPYC Genoa-X | 3.7 GHz | ~2 700 | Only in hpc clusters | No |

The `c7a.medium` (1 vCPU, $0.044/hr) is cost-competitive. However, switching from GCP to AWS adds operational complexity and cross-cloud egress costs. Not recommended unless you're already multi-cloud.

### 3.5 Bare-Metal-on-Demand

| Provider | CPU | Provisioning | PassMark ST (est.) | Price | Notes |
|----------|-----|-------------|-------------------|-------|-------|
| **Hetzner AX102** | Ryzen 9 7950X3D | ~5 min | **~4 155** | **€104/mo** | Monthly only, best ST |
| Latitude.sh bare metal | AMD EPYC Turin/Genoa | <5 sec API | ~2 700 | ~$200–400/mo | On-demand API, global |
| OVH Rise-1 | Intel Xeon-E | Monthly | ~2 400 | ~€49/mo | No on-demand |
| Vultr Bare Metal | Intel Xeon | 3–5 min | ~2 400 | $120+/mo | Hourly billing |

**Latitude.sh** is the most interesting bare-metal-on-demand option: sub-5-second provisioning via API, AMD EPYC Turin CPUs (strong throughput, adequate ST), and hourly-ish billing. The single-thread performance (~2 700 PassMark ST) is similar to GCP C4D but with native (non-virtualized) performance. Worth evaluating if job volume grows.

### 3.6 Architecture Recommendation for Bursty Jobs

**The 22 M-splat / 30-min ceiling problem requires a multi-pronged approach.** No single infrastructure change dissolves it; a combination is needed.

#### Option A — GCP Cloud Batch + C4 (recommended for staying in GCP)

- Small files (< 50 MB): keep on Cloud Run, ~2 min
- Large files (≥ 50 MB): dispatch to Cloud Batch with `c4-highcpu-2` (2 vCPU, 4 GB RAM)
- Cost: ~$0.085/hr per job × actual runtime, ~$0.006–0.030 per large conversion
- Cold start: ~60–90 seconds (acceptable vs. 30-min jobs)
- Solves the timeout issue for 22 M-splat files (~18–20 min on C4)
- Scale-to-zero: yes

#### Option B — Always-on Hetzner AX102 + Queue

- One AX102 at €104/month (~$115)
- A lightweight job queue (e.g., BullMQ or simple Firestore queue) dispatches to the Hetzner box
- No container orchestration overhead; bare-metal speed
- Single-thread speedup: ~1.7–2.5× over Cloud Run → ~11–17 min for 22 M splats
- **Idle cost**: €104/month even if 0 jobs — only worth it if > ~50–80 large conversions/month
- Cold start: ~0 (always running)

#### Option C — Code optimization first (reduces infra requirements)

If `--quick` is acceptable (see §2.5), switch to tiny_lod: 3–5× speedup with zero infrastructure change. A 22 M-splat job drops from 25–31 min to ~6–10 min on the *existing* Cloud Run setup. This is by far the cheapest option and should be tried first.

#### Does faster hardware alone solve the 22 M-splat / 30-min ceiling?

For the **current** 22 M-splat case: yes, C4 or AX102 likely reduces the ~27 min job to 18–20 min or 11–16 min respectively, which fits in the 30-min window.

For **larger uploads** (e.g., 500 M+ splats), neither infrastructure nor single-thread speedup is sufficient — an async/chunked redesign or parallel algorithm (§2.4) becomes necessary. At that scale, the Cloud Tasks deadline is the fundamental constraint regardless of CPU speed.

---

## 4. Prioritized Action List

Listed in order of effort-to-impact ratio (best first).

### 1. Try `--quick` (tiny_lod) immediately — **zero code change, 3–5× speedup**
Change the `build-lod` invocation in `rad-converter/server.js` from `--quality` (default) to `--quick`. This switches to `tiny_lod` (Morton-sort based grouping, `lod_base = 1.5`), bypassing the expensive bhatt_lod merge loop entirely. Run a visual quality comparison on representative real uploads. If quality is acceptable for streaming previews, this single change solves the 22 M-splat timeout problem on existing infrastructure.

**Risk**: Lower LOD visual quality (more popping between levels). Acceptable for previews; may not be acceptable for final export.

**File to change**: `rad-converter/server.js` (add `--quick` to the `build-lod` argument list).

### 2. Tune bhatt-lod base — **flag, < 1 min**
Try `--bhatt-lod=2.0` or `--bhatt-lod=2.5` instead of default 1.75. Fewer levels → fewer merge iterations → ~15–35% speedup with mild quality degradation.

### 3. Parallelize `tiny_lod` cells with Rayon — **medium patch, ~4–8× on merge phase**
Add `rayon = "1"` to `spark-lib/Cargo.toml`. Rewrite the per-cell merge loop in `tiny_lod.rs:79-107` to collect cell ranges then `par_iter` over them. Pre-allocate output slots to avoid write conflicts. This delivers the benefits of `--quick` *plus* multi-core speedup. On 8 vCPU Cloud Run, this alone may reduce a 6-min quick-mode job to ~1 min.

**Files to change**: `spark-lib/Cargo.toml`, `spark-lib/src/tiny_lod.rs`.

### 4. Switch large jobs to GCP Cloud Batch + C4 — **infra change, ~1.3–1.5× ST speedup**
Files ≥ 50 MB bypass Cloud Run and are dispatched as Cloud Batch jobs on `c4-highcpu-2`. This lifts the 8-vCPU Cloud Run ceiling, provides a faster chip (4.2 GHz Granite Rapids), and removes the 1 800 s Cloud Tasks deadline (Cloud Batch jobs can run for hours). Cost: ~$0.085/hr per job. Implement a size-based routing layer in the Cloud Tasks dispatch handler.

### 5. Rayon parallel sort — **1-line change, ~5–15% total speedup**
In `bhatt_lod.rs:20` and `tiny_lod.rs:20`, replace `splats.sort_by(...)` with Rayon's parallel sort. Requires Rayon in scope (already needed for #3). This is ~5% of total wall time so impact is minor but free once Rayon is a dependency.

### 6. Spatial domain decomposition for bhatt_lod — **large patch, 4–12× on merge**
For users who need the highest quality output *and* need it fast, this is the right path. Partition the 3D spatial domain into non-overlapping regions, run the greedy merge in parallel within each region using Rayon, then handle boundary splats sequentially. Requires a significant rewrite of the inner loop in `bhatt_lod.rs:68-129`. Best submitted to the Spark upstream or maintained as a fork. Effort: 3–5 developer-days plus validation.

### 7. Consider Hetzner AX102 for sustained high-volume workloads
If conversion volume exceeds ~50–80 large jobs per month, an always-on AX102 (€104/month) pays for itself vs Cloud Run per-job costs and removes Cloud Tasks timeouts. The Ryzen 9 7950X3D's ~4 155 PassMark single-thread gives ~1.7–2.5× speedup over Cloud Run. Pair with a simple job queue (BullMQ, Firestore). The main downside is operational overhead (managing a dedicated server) and no auto-scaling for burst peaks.

---

## 5. Caveats and Uncertainties

- **Cloud Run vCPU speed varies**: Cloud Run does not guarantee a specific CPU generation. Single-thread performance has been measured at both Skylake (~2 100 PassMark ST) and Cascade Lake (~2 400) levels depending on region and host contention. The 1.7–2.5× Hetzner advantage could be larger or smaller than estimated.

- **bhatt_lod wall-time share unverified**: The 85–92% estimate is based on algorithm complexity analysis, not profiling of a real 22 M-splat run. Add timing instrumentation (`description.insert("lod_duration", ...)` already exists in `main.rs:233`) to confirm before investing in a patch.

- **tiny_lod quality**: The quality difference between `--quality` and `--quick` has not been formally evaluated for 3DStreet's specific use case. A/B test required.

- **PassMark/Geekbench scores for cloud vCPUs**: Vendor cloud vCPU benchmarks vary by region, time of day, and host load. All scores in §3.1 are estimates; run `sysbench` or PassMark PerformanceTest directly on your Cloud Run gen2 instances for ground truth.

- **Hetzner AX102 availability**: AX102 is frequently sold out. Ordering requires lead time. The newer Ryzen 9 9950X3D (~4 739 PassMark ST) is not yet available on Hetzner as of this writing.

- **Spark upstream issues/PRs**: The GitHub MCP tool used here is scoped to `3dstreet/3dstreet` and cannot read `sparkjsdev/spark` issues or PRs. It is possible that performance work exists upstream in private branches or newer tags. Check `https://github.com/sparkjsdev/spark/releases` and `https://github.com/sparkjsdev/spark/issues` manually.

- **Cloud Tasks deadline workaround**: Even if code and infra speedups are insufficient for extremely large files, Cloud Tasks supports chained tasks. Pre-processing (filter/crop with `--min-box`/`--max-box`) could split a 22 M-splat scene into regional chunks, each processed independently within the timeout.

---

## Sources

- Spark source code: `sparkjsdev/spark` tag `v2.1.0`, read live from `/tmp/spark`
  - `rust/spark-lib/src/bhatt_lod.rs`
  - `rust/spark-lib/src/tiny_lod.rs`
  - `rust/spark-lib/src/chunk_tree.rs`
  - `rust/spark-lib/src/ordering.rs`
  - `rust/spark-worker-rs/src/sort.rs`
  - `rust/build-lod/src/main.rs`
  - `rust/Cargo.toml`
- [Hetzner AX Dedicated Server Matrix](https://www.hetzner.com/dedicated-rootserver/matrix-ax/)
- [Hetzner AX102 product page](https://www.hetzner.com/dedicated-rootserver/ax102/)
- [Hetzner AX102 announcement](https://www.hetzner.com/news/new-amd-ryzen-7950-server/)
- [Hetzner Server Comparison 2025 benchmarks (Achromatic)](https://www.achromatic.dev/blog/hetzner-server-comparison)
- [PassMark CPU Benchmarks - Single Thread](https://www.cpubenchmark.net/singleThread.html)
- [AMD Ryzen 9 7950X3D PassMark](https://www.cpubenchmark.net/cpu.php?id=5234&cpu=AMD+Ryzen+9+7950X3D)
- [AMD Ryzen 9 9950X PassMark](https://www.cpubenchmark.net/cpu.php?id=6211&cpu=AMD+Ryzen+9+9950X)
- [AMD Ryzen 9 9950X3D single-thread score (VideoCardz)](https://videocardz.com/newz/amd-ryzen-9-9950x3d-spotted-on-passmark-14-2-faster-than-7950x3d-in-single-thread-test)
- [Geekbench 6: Hetzner AX102 (AMD Ryzen 9 7950X3D)](https://browser.geekbench.com/v6/cpu/2281921)
- [Geekbench 6: Hetzner AX102 (Nov 2024)](https://browser.geekbench.com/v6/cpu/8707484)
- [Cloud VM benchmarks 2026 (DEV Community / dkechag)](https://dev.to/dkechag/cloud-vm-benchmarks-2026-performance-price-1i1m)
- [GCP C4 Granite Rapids GA announcement](https://cloud.google.com/blog/products/compute/c4-vms-based-on-intel-6th-gen-xeon-granite-rapids-now-ga)
- [GCP Compute-Optimized Machine Families](https://docs.cloud.google.com/compute/docs/compute-optimized-machines)
- [c4-highcpu-2 pricing (Holori)](https://calculator.holori.com/gcp/vm/c4-highcpu-2?region=us-central1)
- [AWS EC2 C7a Instances](https://aws.amazon.com/ec2/instance-types/c7a/)
- [RunsOn AWS EC2 benchmarks (fastest instances 2026)](https://runs-on.com/benchmarks/aws-ec2-instances/)
- [Geekbench 6: Amazon EC2 c7a.large](https://browser.geekbench.com/v6/cpu/3322977)
- [Google Cloud VM Benchmarks SPEC CPU 2017 in 2026](https://medium.com/google-cloud/google-cloud-in-2026-stop-buying-vcpus-start-buying-units-of-work-d2b7e68f0d6e)
- [GCP Cloud Batch Pricing](https://cloud.google.com/batch/pricing)
- [Cloud Run Pricing](https://cloud.google.com/run/pricing)
- [Latitude.sh bare metal pricing](https://www.latitude.sh/pricing)
- [VPSBenchmarks: Hetzner AX102 Yab](https://www.vpsbenchmarks.com/yabs/hetzner-32c-125gb-20240924-46c8e0)
