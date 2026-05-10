# Build context: the REPO ROOT (not artifacts/api-server).
# Run from repo root:
#   docker build -f artifacts/api-server/Dockerfile -t velocap-api-server:local .
# Or remotely:
#   az acr build --registry velocapcr --image api-server:<tag> \
#     --file artifacts/api-server/Dockerfile .

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /repo

# ---------- deps + build ----------
FROM base AS build
# Copy the full workspace so pnpm can resolve cross-package references.
# .dockerignore excludes node_modules, dist, .terraform, etc.
COPY . .

# --ignore-scripts: the root package.json preinstall hook validates the
# package manager via $npm_config_user_agent, but corepack in Node 24
# sets it differently. Safe to skip — we're already using pnpm.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/api-server run build

# pnpm deploy extracts api-server + its prod deps into a flat, self-contained
# directory with no symlinks — ideal for a thin runtime layer.
# --legacy flag: pnpm v10 requires this unless the workspace uses injected deps.
RUN pnpm --filter @workspace/api-server --ignore-scripts deploy --prod --legacy /out

# ---------- runtime ----------
FROM node:24-alpine AS runtime
# WORKDIR must match the build stage's path because esbuild-plugin-pino bakes
# absolute worker paths into the bundle. Keeping /repo/artifacts/api-server
# makes the pino workers resolve at runtime.
WORKDIR /repo/artifacts/api-server

COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json

# Give the non-root user ownership of the runtime dir so any future lazy dir
# creation doesn't EACCES.
RUN chown -R node:node /repo

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
