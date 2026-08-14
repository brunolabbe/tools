# The planner: Fastify API, SQLite, and the UI it serves same-origin.
# One image, one process, one port.
#
# **The build context is the repository root, not this directory.** Everything
# below copies from there, because a tool is built out of the root lockfile, the
# root tsconfig and `packages/core`. Build it with
#
#     docker build -f tools/planner/Dockerfile .
#
# Nothing here is shared with `tools/downloader/Dockerfile` and it must not be.
# That one is built on Playwright's image and carries Chromium and ffmpeg —
# roughly two gigabytes bought by the browser sniffer, which is the whole point
# of that tool. This one resolves no media and opens no pages, so it takes a
# plain Node base and is a twentieth of the size. A single shared Dockerfile
# would mean the planner shipping a browser it never launches.
ARG NODE_VERSION=22-bookworm

# ---------------------------------------------------------------------------
# Build: install everything, compile TypeScript, bundle the UI, then drop the
# dev dependencies from the same tree rather than installing twice.
#
# The full image rather than `-slim`: `better-sqlite3` is a native addon, and
# while it usually lands a prebuilt binary, the fallback is a compile that needs
# python3, make and g++. Discovering that in CI is a broken build; the runtime
# stage below is slim, so the tooling is not what ships.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Manifests first: this layer is what `npm ci` is keyed on, and it changes far
# less often than the source does.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY tools/planner/contract/package.json tools/planner/contract/
COPY tools/planner/agent/package.json tools/planner/agent/
COPY tools/planner/api/package.json tools/planner/api/
COPY tools/planner/web/package.json tools/planner/web/
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
# This tool only. `npm run build` builds `--workspaces`, and npm discovers those
# by globbing `tools/*/*` on disk — so copying the whole directory would enlist
# every other tool in the repo into this image's build, with only the manifests
# above installed for them. Keeping the copy narrow is also what makes this the
# planner's image rather than the monorepo's.
COPY tools/planner tools/planner

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
# binary meets the glibc it was linked against. Crossing releases here produces
# a GLIBC_2.xx not found at the first query rather than at boot, which reads as
# a database fault and is not one.

# Compiled output and manifests only — no TypeScript sources, no tests. The
# manifests are not optional: they are how Node resolves the `@planner/*`
# workspace symlinks, and `/api/health` reads the API's version out of its own.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/tools/planner/contract/package.json tools/planner/contract/
COPY --from=build /app/tools/planner/contract/dist tools/planner/contract/dist
COPY --from=build /app/tools/planner/agent/package.json tools/planner/agent/
COPY --from=build /app/tools/planner/agent/dist tools/planner/agent/dist
COPY --from=build /app/tools/planner/api/package.json tools/planner/api/
COPY --from=build /app/tools/planner/api/dist tools/planner/api/dist
COPY --from=build /app/tools/planner/web/package.json tools/planner/web/
COPY --from=build /app/tools/planner/web/dist/app tools/planner/web/dist/app

ENV NODE_ENV=production
# 127.0.0.1 — the default in `API_DEFAULTS` — is unreachable from outside a
# container.
ENV HOST=0.0.0.0
# 8090, not 8080: the downloader's API defaults there and both tools run on the
# same host.
ENV PORT=8090
# A volume, so intakes and plans survive a redeploy.
ENV DATABASE_PATH=/data/planner.db
# Same-origin UI: no CORS to configure.
ENV WEB_DIR=/app/tools/planner/web/dist/app

# Spelled out although it is also the default. An unset `MODEL_PROVIDER` gives a
# service that boots, reports healthy, and answers from a fixed script — see
# `ScriptedProvider`. That is the right default for a fresh clone and the wrong
# thing to arrive at by omission on a deployed host, so the value is stated here
# where a reader will see it. `/api/health` reports it too.
ENV MODEL_PROVIDER=scripted

# `node` comes with the base image and owns nothing it does not need.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8090
VOLUME ["/data"]

# Node is PID 1 unless the runtime supplies an init. Nothing here forks, so this
# is a plain exec — `compose.prod.yaml` still sets `init: true` for the reaping
# it costs nothing to have.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "tools/planner/api/dist/main.js"]
