# syntax=docker/dockerfile:1
# One image runs any of the five services or the media verifier (SERVICE_NAME / command).
# Stages: build (compile), runtime (production, non-root, no dev deps), demo (judge walkthrough).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p /app/artifacts && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 ARTIFACT_DIR=/app/artifacts AUTO_MIGRATE=false
# Liveness only; /ready (database reachability) is used by orchestrator readiness probes.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/main.js"]

# No keys, no network calls, no money: fixture PayPal, fixture AI, locally encoded MP4.
FROM node:22-bookworm-slim AS demo
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
COPY evaluation ./evaluation
COPY migrations ./migrations
RUN chown -R node:node /app
USER node
CMD ["node_modules/.bin/tsx", "scripts/demo.ts"]
