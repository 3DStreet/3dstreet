# Blender-capable Cloud Run image for the renderStreetGlb endpoint.
#
# The default Firebase Functions buildpack can't run Blender, so this endpoint
# ships as a Cloud Run container: Node (assembler + firebase function shell),
# Python + Pillow (label compositor), and a portable Blender (Cycles CPU).
#
# Build (from repo root):
#   docker build -f tools/street-to-glb/render/Dockerfile -t street-glb-render .
# Prod deploy is deferred; this documents the runtime the function needs.

FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive \
    BLENDER_BIN=/opt/blender/blender \
    PYTHON_BIN=/usr/bin/python3 \
    STREET_TO_GLB_DIR=/workspace/tools/street-to-glb

# Blender runtime deps + Python/Pillow. Blender needs a handful of X/GL libs
# even in headless (-b) mode.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl xz-utils ca-certificates python3 python3-pip \
      libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libglu1-mesa \
      libsm6 libice6 libxkbcommon0 \
    && pip3 install --no-cache-dir --break-system-packages Pillow \
    && rm -rf /var/lib/apt/lists/*

# Portable Blender 4.2 LTS.
ARG BLENDER_URL=https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz
RUN mkdir -p /opt/blender \
    && curl -sSL "$BLENDER_URL" | tar -xJ -C /opt/blender --strip-components=1 \
    && /opt/blender/blender --version

WORKDIR /workspace

# The assembler tool (with its own node_modules) + the functions code.
COPY tools/street-to-glb /workspace/tools/street-to-glb
COPY public/functions /workspace/public/functions
COPY src/catalog.json /workspace/src/catalog.json

RUN cd /workspace/tools/street-to-glb && npm ci --omit=dev || npm install --omit=dev
RUN cd /workspace/public/functions && npm ci --omit=dev || npm install --omit=dev

# Warming the model/texture cache at build time is optional; left to first
# request. Run the gen2 function as a Cloud Run container via the functions
# framework (the same entrypoint Firebase uses under the hood).
RUN cd /workspace/public/functions && npm install --no-save @google-cloud/functions-framework
EXPOSE 8080
ENV FUNCTION_TARGET=renderStreetGlb
CMD ["npx", "--prefix", "/workspace/public/functions", "functions-framework", \
     "--target=renderStreetGlb", "--source=/workspace/public/functions", "--port=8080"]
