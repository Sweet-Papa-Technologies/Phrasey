# syntax=docker/dockerfile:1
#
# Phrasey game server.
#
# The build context is the REPO ROOT, not this directory — pnpm needs the
# workspace to resolve @phrasey/shared and @phrasey/engine:
#
#   docker build -f packages/server/Dockerfile -t phrasey-server .
#
# cloudbuild.yaml and scripts/deploy.sh both do exactly that.

ARG NODE_IMAGE=node:22-slim

# ---------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# ----------------------------------------------------------- manifests
# Every workspace manifest, so `pnpm install --frozen-lockfile` can validate
# the lockfile. Kept in its own layer: dependency installs only re-run when a
# package.json or the lockfile changes, not when source does.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json     packages/shared/package.json
COPY packages/engine/package.json     packages/engine/package.json
COPY packages/server/package.json     packages/server/package.json
COPY packages/client/package.json     packages/client/package.json
COPY packages/corpus-gen/package.json packages/corpus-gen/package.json

# --------------------------------------------------------------- build
# Full (dev included) install of @phrasey/server and its workspace deps only —
# the client's React/Vite toolchain is never downloaded.
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@phrasey/server..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY packages/server packages/server
# Dependency order: shared -> engine -> server.
RUN pnpm --filter @phrasey/shared build \
 && pnpm --filter @phrasey/engine build \
 && pnpm --filter @phrasey/server build

# ----------------------------------------------------------- prod-deps
# The same workspace with devDependencies pruned.
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@phrasey/server..."

# ------------------------------------------------------------ assemble
# Production node_modules + compiled output, nothing else. Assembled at /repo
# so pnpm's relative symlinks into node_modules/.pnpm stay valid after the copy.
FROM prod-deps AS assemble
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/engine/dist packages/engine/dist
COPY --from=build /repo/packages/server/dist packages/server/dist

# ------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /repo
COPY --from=assemble --chown=node:node /repo /repo

# Non-root. The `node` user (uid 1000) ships with the base image.
USER node

# Cloud Run injects PORT; 8080 is the documented default and what the Terraform
# container port and health probes expect.
EXPOSE 8080

CMD ["node", "packages/server/dist/index.js"]
