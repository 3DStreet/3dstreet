# RAD converter — Cloud Run service that turns a splat .ply into a Spark RAD
# (LOD) file (the splat "optimized" variant). Multi-stage:
#   1. builder — compiles the `build-lod` Rust binary from Spark v2.1.0
#   2. runtime — Node 22 + the binary, runs the HTTP handler
#
# Both stages are Debian bookworm so the dynamically-linked binary's glibc
# matches at runtime. build-lod is CPU-only (no GPU needed).

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

WORKDIR /spark/rust
# build-lod is single-threaded, so the only "faster core" lever is the binary
# itself. Default `cargo build` targets baseline x86-64 (SSE2 only); compile for
# a modern ISA instead. x86-64-v3 = AVX2/FMA/BMI (Haswell+), universally present
# on Cloud Run's fleet — safe. (v4/AVX-512 is NOT guaranteed across hosts, so
# don't.) The Spark release profile already sets lto=fat / opt-level=3 /
# codegen-units=1, so target-cpu is the remaining free win. Gain is modest on
# this heap/hashmap-bound workload, but it costs nothing at runtime.
ENV RUSTFLAGS="-C target-cpu=x86-64-v3"
RUN cargo build --release -p build-lod
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
