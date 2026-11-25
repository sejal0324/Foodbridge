# syntax=docker/dockerfile:1
#
# FoodBridge backend (Node.js 24 + Express + TypeScript), multi-stage build.
# Build context is the repository root (the image also ships database/migrations):
#   docker build -f deployment/docker/backend.Dockerfile -t foodbridge-backend .
# Runtime configuration comes from environment variables only.

FROM node:24-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/backend
RUN groupadd --system --gid 10001 foodbridge \
    && useradd --system --uid 10001 --gid foodbridge --no-create-home --shell /usr/sbin/nologin foodbridge \
    && mkdir -p /app/uploads && chown foodbridge:foodbridge /app/uploads
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/package.json ./
COPY database/migrations /app/database/migrations
COPY --chmod=0755 deployment/docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint
USER foodbridge
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["backend-entrypoint"]
