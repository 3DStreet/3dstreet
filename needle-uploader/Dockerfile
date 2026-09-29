# needle-uploader — Cloud Run service that turns a user-uploaded GLB into a
# Needle Cloud progressive-streaming variant (#1990). Node only: the work is
# done by the pinned needle-cloud CLI (package.json), which uploads the file
# and waits for Needle's optimization job.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install deps first for layer caching. needle-cloud is pinned exactly: its
# output lines and JSON shape are what needle-cli.js parses.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js needle-cli.js ./

# Cloud Run injects PORT (defaults to 8080); the handler reads it.
EXPOSE 8080
CMD ["node", "server.js"]
