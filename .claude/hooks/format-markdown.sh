#!/usr/bin/env bash
# PostToolUse hook: run oxfmt over a markdown file Claude just wrote.
#
# oxfmt formats markdown in this repo and `npm run check` runs `oxfmt --check`,
# so an unformatted .md fails CI — and ci.yml's check job is filtered by nothing,
# markdown included. A documentation-only change can break the build. Prose said
# so and it still happened, which is what makes this a hook rather than a rule.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

file="$(jq -r '.tool_input.file_path // empty')"
[ -n "$file" ] || exit 0
case "$file" in
  *.md) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

# Only format files inside the repo. Claude edits markdown elsewhere too — auto
# memory under ~/.claude, scratch notes — and this repo's formatter has no
# business rewriting those. Caught on the hook's first live run, which reformatted
# a memory index outside the project.
root="$(pwd -P)"
abs="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
case "$abs" in
  "$root"/*) ;;
  *) exit 0 ;;
esac
# Never reformat a fixture: .oxfmtrc.json exempts **/test/fixtures/ precisely
# because oxfmt reflows HTML text nodes and rewrites inline <script>, which is
# editing the thing under test.
case "$file" in
  */test/fixtures/*) exit 0 ;;
esac

# Call the binary directly rather than through npx: npx spends ~600 ms resolving
# before oxfmt does ~20 ms of work, and this fires on every markdown write.
oxfmt="$root/node_modules/.bin/oxfmt"
if [ -x "$oxfmt" ]; then
  "$oxfmt" "$file" >/dev/null 2>&1
else
  npx --no-install oxfmt "$file" >/dev/null 2>&1
fi
exit 0
