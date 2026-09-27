# The ledger: Fastify API, SQLite, and the UI it serves same-origin.
# One image, one process, one port.
#
# **The build context is the repository root, not this directory.** Everything
# below copies from there, because a tool is built out of the root lockfile, the
# root tsconfig and `packages/core`. Build it with
#
#     docker build -f tools/ledger/Dockerfile .
#
# Copied from `tools/planner/Dockerfile`, which is the same shape for the same
# reason — a plain Node base, no browser, no ffmpeg — and shares nothing with it
# at build time. Its comments carry the reasoning for each choice below and are
# not repeated in full here.
ARG NODE_VERSION=22-bookworm

# ---------------------------------------------------------------------------
# Build: install everything, compile TypeScript, bundle the UI, then drop the
# dev dependencies from the same tree rather than installing twice.
#
# The full image rather than `-slim`: `better-sqlite3` is a native addon, and
# its fallback when no prebuilt binary fits is a compile that needs python3,
# make and g++. The runtime stage below is slim, so the tooling does not ship.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Manifests first: this layer is what `npm ci` is keyed on, and it changes far
# less often than the source does.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY tools/ledger/contract/package.json tools/ledger/contract/
COPY tools/ledger/api/package.json tools/ledger/api/
COPY tools/ledger/web/package.json tools/ledger/web/
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
# This tool only. `npm run build` builds `--workspaces`, and npm discovers those
# by globbing `tools/*/*` on disk — so copying the whole directory would enlist
# every other tool in the repo into this image's build.
COPY tools/ledger tools/ledger

RUN npm run build

# Leaves the native `better-sqlite3` build in place and the workspace symlinks
# intact, but drops TypeScript, Vite and the test runner.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

# Same Debian release as the build stage, so the compiled `better-sqlite3`
# binary meets the glibc it was linked against.

# Compiled output and manifests only — no TypeScript sources, no tests. The
# manifests are how Node resolves the `@ledger/*` workspace symlinks, and
# `/api/health` reads the API's version out of its own.
#
# **Adding a workspace to `api`'s dependencies costs two edits to this file** —
# its manifest in the build stage above, and its pair here — and the two fail
# differently. `packages/core/test/image-closure.test.ts` checks both against
# what `@ledger/api` actually resolves, and names the missing line. It proves
# the list, never the image: `.github/workflows/ledger.yml` owns that.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/tools/ledger/contract/package.json tools/ledger/contract/
COPY --from=build /app/tools/ledger/contract/dist tools/ledger/contract/dist
COPY --from=build /app/tools/ledger/api/package.json tools/ledger/api/
COPY --from=build /app/tools/ledger/api/dist tools/ledger/api/dist
COPY --from=build /app/tools/ledger/web/package.json tools/ledger/web/
COPY --from=build /app/tools/ledger/web/dist/app tools/ledger/web/dist/app

ENV NODE_ENV=production
# 127.0.0.1 — the default in `API_DEFAULTS` — is unreachable from outside a
# container.
ENV HOST=0.0.0.0
# 8100: the downloader's API is on 8080 and the planner's on 8090, and every
# tool runs on the same host.
ENV PORT=8100
# A volume, so the books survive a redeploy. It is the only copy of anything
# either person typed or imported.
ENV DATABASE_PATH=/data/ledger.db
# Same-origin UI: no CORS to configure.
ENV WEB_DIR=/app/tools/ledger/web/dist/app

# `node` comes with the base image and owns nothing it does not need.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8100
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "tools/ledger/api/dist/main.js"]
