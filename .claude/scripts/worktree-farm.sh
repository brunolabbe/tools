#!/usr/bin/env bash
# Give a fresh worktree its dependencies without running npm install.
#
# Usage: bash .claude/scripts/worktree-farm.sh [path-to-shared-checkout]
#
# npm install here is minutes, not seconds, it is the largest fixed cost of a
# subagent dispatch, and it can fail outright — ffmpeg-static's postinstall
# fetches from the network, and when that is blocked npm rolls the whole reify
# back and leaves no node_modules at all. This is ~0.5 s and ~28 KB instead of
# 342 MB.
#
# The linking rule is uniform and load-bearing: if the shared entry is itself a
# symlink (npm writes workspace links relatively, e.g. @planner/api ->
# ../../tools/planner/api) recreate its target string VERBATIM, so it resolves
# from where it physically lives — inside THIS worktree. Otherwise
# absolute-symlink to the shared copy. Scope directories (@foo) are re-created as
# real directories so their inner relative links land in the worktree too.
#
# Never symlink node_modules wholesale: the worktree's node_modules would BE the
# shared one, and every workspace link would resolve into the shared checkout —
# so an agent editing a contract would test against main's version, with exports
# present and tests green. Stale exports are far worse than missing ones.
#
# Hard links are not an option either: node_modules is a separate mount from the
# repo, so cp -al fails with "Invalid cross-device link".
set -euo pipefail

SHARED_ROOT="${1:-/workspaces/tools}"
SHARED="$SHARED_ROOT/node_modules"
DEST="$(git rev-parse --show-toplevel)/node_modules"

# --show-toplevel, not $PWD: this has to work when run from a subdirectory.
[ "$DEST" != "$SHARED" ] || { echo "refusing: this is the shared checkout" >&2; exit 1; }
[ -d "$SHARED" ] || { echo "no shared node_modules at $SHARED" >&2; exit 1; }

link_entry() { # $1 = source path, $2 = dest path
  local target
  if [ -L "$1" ]; then target="$(readlink "$1")"; else target="$1"; fi
  ln -sfn "$target" "$2"
}

mkdir -p "$DEST"
# ls -A, not a glob: a * glob silently misses .bin, and every npm run script then
# fails to find its binaries.
for e in $(ls -A "$SHARED"); do
  case "$e" in
    @*) mkdir -p "$DEST/$e"
        for i in $(ls -A "$SHARED/$e"); do link_entry "$SHARED/$e/$i" "$DEST/$e/$i"; done ;;
    *)  link_entry "$SHARED/$e" "$DEST/$e" ;;
  esac
done

echo "farm built: $(ls -A "$DEST" | wc -l) top-level entries in $DEST"
echo "now run: npm run build   (without dist, suites fail with packageEntryFailure)"
