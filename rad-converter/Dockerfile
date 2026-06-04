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

# ---- Stage 2: runtime ------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Copy the compiled converter binary onto PATH.
COPY --from=builder /spark/rust/target/release/build-lod /usr/local/bin/build-lod
RUN chmod +x /usr/local/bin/build-lod

# Install handler deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

# Cloud Run injects PORT (defaults to 8080); the handler reads it.
EXPOSE 8080
CMD ["node", "server.js"]
