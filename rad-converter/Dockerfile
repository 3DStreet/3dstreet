# RAD converter — Cloud Run service that turns a splat .ply into a Spark RAD
# (LOD) file (the splat "optimized" variant). Multi-stage:
#   1. builder — applies our RAD-compression parallelism patch to Spark v2.1.0
#                and compiles the `build-lod` Rust binary
#   2. runtime — Node 22 + the binary, runs the HTTP handler
#
# Both stages are Debian bookworm so the dynamically-linked binary's glibc
# matches at runtime. build-lod is CPU-only — no GPU needed (and the default
# `gpu` feature is intentionally disabled at build time below).

# ---- Stage 1: build the Spark build-lod binary ----------------------------
# Pin Spark to the same version the in-app reader ships (2.1.0) so converter
# and reader are never skewed. Per the Hetzner README, build from the rust
# workspace root with `-p build-lod`.
FROM rust:1-bookworm AS builder

# git to clone Spark; cmake/pkg-config cover common native-build needs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git cmake pkg-config \
    && rm -rf /var/lib/apt/lists/*

ARG SPARK_VERSION=v2.1.0
RUN git clone --branch ${SPARK_VERSION} --depth 1 \
        https://github.com/sparkjsdev/spark.git /spark

# Apply our private patch that parallelizes RAD output compression (the
# single largest cost — ~28% of build-lod by callgrind — and embarrassingly
# parallel). The patch is kept in version control (see ./patches/) rather
# than carried as a vendored fork, so re-bases onto a newer Spark tag are
# tractable. If the patch fails to apply we want the image build to fail
# loudly — DON'T silently fall back to upstream's sequential compression.
COPY patches/ /tmp/patches/
WORKDIR /spark
RUN git -c user.email=build@local -c user.name=build \
        am --whitespace=nowarn /tmp/patches/*.patch

WORKDIR /spark/rust
# Two compile-time levers worth the trouble:
#   1. target-cpu=x86-64-v3 — emit AVX2/FMA/BMI (Haswell+); universally
#      present on Cloud Run's x86 fleet. v4/AVX-512 is NOT guaranteed across
#      hosts, so don't reach for it. The Spark release profile already sets
#      lto=fat / opt-level=3 / codegen-units=1.
#   2. --no-default-features — drop the `gpu` feature (wgpu/pollster). Our
#      handler never passes --cluster-sh, so the GPU code path is dead
#      weight that would otherwise drag wgpu's transitive deps (and Vulkan
#      runtime requirements) into the build.
ENV RUSTFLAGS="-C target-cpu=x86-64-v3"
RUN cargo build --release -p build-lod --no-default-features
# Binary lands at /spark/rust/target/release/build-lod

# Collect the production (patched) binary.
RUN mkdir -p /out && cp /spark/rust/target/release/build-lod /out/build-lod

# Optional second binary: the UPSTREAM, UNPATCHED build-lod, for A/B perf
# benchmarking only (see ../docs/rad-perf-staging-benchmark.md). OFF by default
# so prod builds exactly one binary and is byte-for-byte unchanged. When
# BUILD_BASELINE=1 we clone a pristine Spark at the same tag, build it WITHOUT
# the patch, and install it as build-lod-baseline; the benchmark service then
# runs BOTH binaries on the SAME Cloud Run instance, so the A/B is immune to
# cross-machine variance (the thing that made the sandbox big-file numbers
# meaningless). When 0, build-lod-baseline is just a copy of the patched binary
# (never invoked in prod) so the runtime COPY below always has a file to take.
ARG BUILD_BASELINE=0
RUN if [ "${BUILD_BASELINE}" = "1" ]; then \
      echo ">> BUILD_BASELINE=1 — also building UPSTREAM baseline build-lod"; \
      git clone --branch ${SPARK_VERSION} --depth 1 \
          https://github.com/sparkjsdev/spark.git /spark-baseline; \
      cd /spark-baseline/rust; \
      RUSTFLAGS="-C target-cpu=x86-64-v3" cargo build --release -p build-lod --no-default-features; \
      cp target/release/build-lod /out/build-lod-baseline; \
    else \
      cp /out/build-lod /out/build-lod-baseline; \
    fi

# ---- Stage 2: runtime ------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Copy the compiled converter binary onto PATH. build-lod-baseline is the
# unpatched binary used only by the staging perf A/B (../docs/rad-perf-staging-benchmark.md);
# in prod it is an unused copy of build-lod.
COPY --from=builder /out/build-lod /usr/local/bin/build-lod
COPY --from=builder /out/build-lod-baseline /usr/local/bin/build-lod-baseline
RUN chmod +x /usr/local/bin/build-lod /usr/local/bin/build-lod-baseline

# Install handler deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

# Cloud Run injects PORT (defaults to 8080); the handler reads it.
EXPOSE 8080
CMD ["node", "server.js"]
