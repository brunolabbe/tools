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

# Depth 5 reaches /workspaces/<repo>/tools/<tool>/<package>/node_modules, which
# is the deepest a workspace nests. -prune stops the walk from descending into a
# tree with tens of thousands of files.
mapfile -t node_modules_dirs < <(
  find /workspaces -maxdepth 5 -type d -name node_modules -prune -print
)

# The contents too, not just the mount point. A volume outlives the image, so
# after the container user's uid changes (see USER_UID in devcontainer.json) a
# populated volume is full of files owned by the old one — and `npm ci` dies
# trying to unlink them, which reads as a broken install rather than a stale
# volume. The filter keeps the common case cheap: nothing to chown means one
# stat pass and no writes. `-h` because most of .bin is symlinks.
for dir in "${node_modules_dirs[@]}"; do
  chown "${USERNAME}:${USERNAME}" "$dir"
  find "$dir" \( ! -user "${USERNAME}" -o ! -group "${USERNAME}" \) \
    -exec chown -h "${USERNAME}:${USERNAME}" {} +
done

printf '[fix-mounts] volumes are owned by %s\n' "$USERNAME"
