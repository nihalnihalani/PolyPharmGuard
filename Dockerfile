# syntax=docker/dockerfile:1.6
# ============================================================================
# PolyPharmGuard — multi-stage build for the MCP server (Streamable HTTP)
# ============================================================================
# Stage 1 (builder): install all deps, compile TypeScript -> dist/
# Stage 2 (runtime): copy dist + production deps into a slim Node image,
#                    run as non-root, expose /mcp and /health.
# ----------------------------------------------------------------------------

# ---- builder ---------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 needs python + a C++ toolchain to compile its native binding.
# Installing here keeps the runtime image free of build deps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first so layer caches survive source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile. Tests are excluded from the image (not needed at
# runtime, and they import demo fixtures from data/synthea that the runtime
# stage copies separately). We use a build-time tsconfig that omits tests.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('tsconfig.json'));t.include=['src/**/*','scripts/**/*','data/**/*'];delete t.exclude;fs.writeFileSync('tsconfig.build.json',JSON.stringify(t,null,2));" \
 && npx tsc -p tsconfig.build.json

# Drop dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_PORT=3000

WORKDIR /app

# curl is included for the HEALTHCHECK below; everything else stays minimal.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Bring over compiled output, pruned node_modules, knowledge base, and
# manifests. Anything not copied here is not in the image.
#
# Tool callbacks resolve their JSON KB via __dirname relative paths, e.g.
#   dist/src/mcp-server/tools/x.js -> ../../knowledge-base/foo.json
# which ends up at /app/dist/src/knowledge-base/. tsc does NOT copy JSON
# files into dist/, so we copy them ourselves into the same location the
# compiled code expects. The originals at /app/src/knowledge-base/ are also
# kept for any code path that resolves from the source tree.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY src/knowledge-base ./src/knowledge-base
COPY src/knowledge-base ./dist/src/knowledge-base
COPY data/synthea ./data/synthea
COPY data/synthea ./dist/data/synthea
COPY src/a2a-agent/agent-card.json ./dist/src/a2a-agent/agent-card.json
COPY marketplace.yaml ./marketplace.yaml

# Run as the unprivileged user that ships in the Node image.
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${MCP_PORT}/health || exit 1

CMD ["node", "dist/src/mcp-server/index.js"]
