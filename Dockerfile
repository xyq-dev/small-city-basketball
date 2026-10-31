# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci
COPY apps/api ./apps/api
COPY apps/admin ./apps/admin
COPY packages/contracts ./packages/contracts
COPY ops/db ./ops/db
COPY ops/recovery ./ops/recovery
# The shipped static client always talks to the same-origin API.
RUN npm run build --workspace @small-city-basketball/api \
    && VITE_DATA_MODE=api npm run build --workspace @small-city-basketball/admin

FROM node:24.22.1-bookworm-slim AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --omit=dev --workspace @small-city-basketball/api --include-workspace-root \
    && npm cache clean --force

FROM node:24.22.1-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fontconfig ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 scb && useradd --uid 10001 --gid 10001 --no-create-home scb \
    && install -d -m 0700 -o 10001 -g 10001 /var/lib/scb/live-media
COPY --from=api-deps /app/node_modules ./node_modules
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations
COPY packages/contracts/package.json packages/contracts/index.js packages/contracts/runtime-privileges.json ./packages/contracts/
USER 10001:10001
EXPOSE 3300
ENTRYPOINT []
CMD ["node", "apps/api/dist/main.js"]

FROM nginx:1.30.6-alpine AS web
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY --chmod=0555 ops/web/entrypoint.sh /opt/scb/web-entrypoint.sh
COPY --chmod=0444 ops/web/nginx.conf.template /opt/scb/nginx.conf.template
USER 101:101
EXPOSE 8443
ENTRYPOINT ["/opt/scb/web-entrypoint.sh"]

# Both Alpine stages use the same libc release and the build's target architecture.
FROM node:24.22.1-alpine3.24 AS node-musl
FROM postgres:18.6-alpine3.24 AS db-tools
RUN apk add --no-cache libstdc++ \
    && addgroup -g 10001 scb && adduser -D -H -u 10001 -G scb scb
COPY --from=node-musl /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations
COPY packages/contracts/package.json packages/contracts/index.js packages/contracts/runtime-privileges.json ./packages/contracts/
COPY ops/db ./ops/db
COPY ops/recovery ./ops/recovery
# Immutable acceptance modules ship with the tools image; no source-tree mounts or native image addon.
COPY scripts/check-database-restart.mjs scripts/c05-media-fixtures.mjs scripts/c05-commerce-check.mjs scripts/c23-participant-material-check.mjs scripts/x02-adjudication-check.mjs scripts/x03-template-check.mjs scripts/x05-recruitment-check.mjs scripts/x08-archive-check.mjs scripts/x12-local-check.mjs scripts/x18-governance-check.mjs scripts/x22-account-recovery-check.mjs ./scripts/
USER 10001:10001
ENTRYPOINT []
CMD ["node", "--version"]
