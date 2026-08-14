#!/usr/bin/env bash
#
# One-time setup after the container is created. Runs as the container user,
# from the workspace folder. Everything here is idempotent — a rebuild reruns
# it against volumes that may already be populated.

set -euo pipefail

sudo /usr/local/bin/fix-mounts.sh

# The host tree is a Windows checkout, so its node_modules holds win32 binaries
# (esbuild, rollup, better-sqlite3). Named volumes cover the node_modules paths
# instead, and this fills them with the Linux build. `npm ci` rather than
# `install`, so the container matches the lockfile the way CI does.
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# The UI ships with a mocked transport so it can run without a backend. In here
# there is always a backend, and an agent debugging a UI that silently talks to
# nothing loses an hour to it.
if [ ! -f apps/web/.env.local ] && [ -f apps/web/.env.example ]; then
  cp apps/web/.env.example apps/web/.env.local
  echo "[post-create] apps/web/.env.local created — UI points at the real API"
fi

# A no-op when the image's browsers already match the installed Playwright,
# which is the intent of pinning PLAYWRIGHT_VERSION in the Dockerfile. When
# they have drifted, this is the download the firewall's cdn.playwright.dev
# entry exists for. Runs before postStartCommand installs the firewall anyway.
npx --yes playwright install chromium || echo "[post-create] playwright install skipped"

# Fails loudly here rather than three prompts into an agent session.
node --version
ffmpeg -version | head -n 1
echo "[post-create] ready"
