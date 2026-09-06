# syntax=docker/dockerfile:1.7
# Multi-stage build for the transactions service inside the pnpm workspace.
# The build context is the repository root so the shared package is available.

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---------- deps: manifests only, so the layer caches across source edits ----------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY services/accounts/package.json services/accounts/
COPY services/transactions/package.json services/transactions/
COPY services/payments/package.json services/payments/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build: compile the shared package, then the service ----------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/transactions services/transactions
RUN pnpm --filter @paynad/shared build \
 && pnpm --filter @paynad/transactions build

# ---------- prod-deps: the same install, pruned of devDependencies ----------
FROM build AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------- dev: used by docker-compose.override.yml for hot reload ----------
FROM build AS dev
ENV NODE_ENV=development
COPY docker/dev /app/docker/dev
RUN chmod +x /app/docker/dev/entrypoint.sh
EXPOSE 3002
WORKDIR /app/services/transactions
CMD ["/app/docker/dev/entrypoint.sh"]

# ---------- runner: minimal, non-root ----------
FROM node:20-alpine AS runner
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apk add --no-cache tini
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=prod-deps --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=prod-deps --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=node:node /app/services/transactions/package.json ./services/transactions/
COPY --from=prod-deps --chown=node:node /app/services/transactions/dist ./services/transactions/dist
COPY --from=prod-deps --chown=node:node /app/services/transactions/node_modules ./services/transactions/node_modules

USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "services/transactions/dist/main.js"]
