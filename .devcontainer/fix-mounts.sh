#!/usr/bin/env bash
#
# Hands the container user its own mount points.
#
# Docker creates a fresh named volume owned by root whenever the path it mounts
# onto did not exist in the image — which is the case for every
# `node_modules` under /workspaces, since the workspace itself is a bind mount
# from the host. Without this, the first `npm install` fails with EACCES on a
# directory the agent cannot chown, and the failure reads like a broken
# devcontainer rather than a mount detail.
#
# Runs once, from postCreateCommand, via a no-argument sudo rule.

set -euo pipefail

USERNAME="${DEV_USER:-pwuser}"

for dir in /commandhistory "/home/${USERNAME}/.claude" "/home/${USERNAME}/.config/gh"; do
  mkdir -p "$dir"
  chown -R "${USERNAME}:${USERNAME}" "$dir"
done

# Depth 4 reaches /workspaces/<repo>/apps/<app>/node_modules. -prune stops the
# walk from descending into a tree with tens of thousands of files.
find /workspaces -maxdepth 4 -type d -name node_modules -prune \
  -exec chown "${USERNAME}:${USERNAME}" {} +

printf '[fix-mounts] volumes are owned by %s\n' "$USERNAME"
