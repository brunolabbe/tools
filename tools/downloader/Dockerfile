# Multi-stage build for the whole service: API, resolvers, engine, and the UI
# it serves. One image, one process, one port.
#
# **The build context is the repository root, not this directory.** Everything
# below copies from there, because a tool is not self-contained: it is built out
# of the root lockfile, the root tsconfig and `packages/core`. Build it with
#
#     docker build -f tools/downloader/Dockerfile .
#
# or let `compose.yaml` do it, which is why that file names both. This file
# lives here rather than at the root because there are two tools now and their
# images have nothing in common — see docs/adr/002-releases-from-conventional-commits.md.
#
# The base is Playwright's own image rather than a plain `node:` one. The
# browser sniffer is the tier that makes "any website" reachable, and Chromium
# needs some seventy shared libraries that no Node image carries; installing
# them by hand is a list that goes stale every Playwright release. The tag must
# match the `playwright` version in `tools/downloader/resolvers` — a mismatch
# makes Playwright try to download a browser at runtime, into a read-only
# filesystem, at the moment of the first probe.
ARG PLAYWRIGHT_VERSION=1.62.1
ARG BASE=mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

# ---------------------------------------------------------------------------
# Build: install everything, compile TypeScript, bundle the UI, then drop the
# dev dependencies from the same tree rather than installing twice.
# ---------------------------------------------------------------------------
FROM ${BASE} AS build
WORKDIR /app

# The base image already ships the browsers; a second copy would be ~400 MB of
# files nothing opens.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Manifests first: this layer is what `npm ci` is keyed on, and it changes far
# less often than the source does.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY tools/downloader/contract/package.json tools/downloader/contract/
COPY tools/downloader/resolvers/package.json tools/downloader/resolvers/
COPY tools/downloader/engine/package.json tools/downloader/engine/
COPY tools/downloader/api/package.json tools/downloader/api/
COPY tools/downloader/web/package.json tools/downloader/web/
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
# This tool only. `npm run build` builds `--workspaces`, and npm discovers those
# by globbing `tools/*/*` on disk — so copying the whole directory would enlist
# every other tool in the repo into this image's build, with only the manifests
# above installed for them. Keeping the copy narrow is also what makes this the
# downloader's image rather than the monorepo's.
COPY tools/downloader tools/downloader

# The bundle's transport is decided at build time
# (see tools/downloader/web/src/api/client.ts).
# A production build already defaults to the real API; it is spelled out here
# because an image that silently mocked every download would look perfectly
# healthy and do nothing.
ENV VITE_API_MOCK=false
RUN npm run build

# Leaves the workspace symlinks and the native builds in place, but drops
# TypeScript, Vite and the test runner — roughly half the tree.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ${BASE} AS runtime
WORKDIR /app

# ffmpeg from the distribution rather than `ffmpeg-static`. The engine falls
# back to the bundled binary happily, but that one arrives through a postinstall
# download, which makes the image depend on a GitHub release being up and leaves
# no way to patch a CVE without an npm publish. FFMPEG_PATH points at this one.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

# Optional, and off by default: yt-dlp is a latency optimisation, never a
# dependency. Without it every request falls through to the browser sniffer and
# still works — see tools/downloader/docs/02-ROADMAP.md. Build with
# `--build-arg INSTALL_YTDLP=true` to include it.
ARG INSTALL_YTDLP=false
ARG YTDLP_VERSION=2025.09.26
RUN if [ "${INSTALL_YTDLP}" = "true" ]; then \
  curl -fsSL -o /usr/local/bin/yt-dlp \
  "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
  && chmod 0755 /usr/local/bin/yt-dlp; \
  fi

# Compiled output and manifests only — no TypeScript sources, no tests, no
# fixtures. The manifests are not optional: they are how Node resolves the
# `@downloader/*` workspace symlinks, and `/api/health` reads the API's version
# out of its own.
#
# This list and the manifest list above are both checked as of pl-17, by
# `packages/core/test/image-closure.test.ts` — every workspace `@downloader/api`
# resolves has its manifest copied before `npm ci`, its pair here, and nothing
# outside that closure is copied. It reads this file as text and assumes nothing about the
# planner's, which is built on a different base and must stay a separate file.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/tools/downloader/contract/package.json tools/downloader/contract/
COPY --from=build /app/tools/downloader/contract/dist tools/downloader/contract/dist
COPY --from=build /app/tools/downloader/resolvers/package.json tools/downloader/resolvers/
COPY --from=build /app/tools/downloader/resolvers/dist tools/downloader/resolvers/dist
COPY --from=build /app/tools/downloader/engine/package.json tools/downloader/engine/
COPY --from=build /app/tools/downloader/engine/dist tools/downloader/engine/dist
COPY --from=build /app/tools/downloader/api/package.json tools/downloader/api/
COPY --from=build /app/tools/downloader/api/dist tools/downloader/api/dist
COPY --from=build /app/tools/downloader/web/package.json tools/downloader/web/
COPY --from=build /app/tools/downloader/web/dist/app tools/downloader/web/dist/app

ENV NODE_ENV=production
# 127.0.0.1 — the default — is unreachable from outside a container.
ENV HOST=0.0.0.0
ENV PORT=8080
# A volume, so downloads and the job database survive a redeploy.
ENV STORAGE_DIR=/data
ENV DATABASE_PATH=/data/jobs.db
# Same-origin UI: no CORS to configure, and EventSource just works.
ENV WEB_DIR=/app/tools/downloader/web/dist/app
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# `pwuser` comes with the base image. Nothing here needs root, and this process
# opens attacker-supplied pages in a browser for a living.
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser

EXPOSE 8080
VOLUME ["/data"]

# The app's own endpoint, which reports 503 while draining and whenever ffmpeg
# is missing — see tools/downloader/api/src/routes/health.ts. `start-period` is
# generous because the first boot runs the SQLite migrations.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "tools/downloader/api/dist/main.js"]
