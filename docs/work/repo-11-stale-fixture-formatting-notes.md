---
id: repo-11
tool: repo
title: Two planner ticket logs still say fixtures get formatted, which repo-4 made false
kind: chore
status: ready
milestone: null
depends_on: [repo-4]
---

# repo-11 — pl-15 and pl-28 carry advice that repo-4 invalidated

## Why

repo-4 anchored `.oxfmtrc.json`'s fixture entry to `**/test/fixtures/`, so
checked-in fixtures are no longer formatted. Two planner ticket logs found that
bug independently, recorded it accurately at the time, and both now read as
current advice when they are stale:

- `tools/planner/docs/work/pl-15-candidate-legs.md` (~line 123) — "**`test/fixtures/`
  is in `.oxfmtrc.json`'s `ignorePatterns` and oxfmt formats these files anyway.**
  … a fixture edit must be followed by `npm run format` or `format:check` fails.
  Nothing depends on the ignore working, so it is left as it is."
  The last sentence is now false in both halves: the ignore works, and a fixture
  edit must **not** be followed by `npm run format` — the formatter will decline
  to touch it, and `format:check` passes regardless of the fixture's shape.
- `tools/planner/docs/work/pl-28-valhalla-adapter.md` (~lines 264 and 472) —
  "F6 · no change, deliberately … widening it is a repo-wide toolchain change
  that touches both tools and wants a `repo-` ticket" and "`oxfmt` indents the
  fixture, and **`test/fixtures/` … does not actually exempt it** — worth
  knowing, and left alone rather than fixed here."
  The `repo-` ticket they are deferring to is repo-4, and it has landed.

A planner agent reading either one will run `npm run format` after editing a
fixture expecting a diff, get none, and go looking for what it broke. That is
the same twenty minutes pl-15's own note was written to save.

## Build

1. Append a dated annotation to each of the two logs — not an edit of the
   original text, which was true when written. Say that repo-4 anchored the
   pattern, name the commit, and state the two consequences: fixtures are exempt,
   and a fixture edit no longer needs `npm run format`.
2. Leave `status` on both tickets alone. Both are historical records; neither is
   reopened by this.

**This must be its own pull request, and its title must carry a `hidden` type**
— `docs(planner):` is the natural one. Both files are under `tools/planner/`, and
release-please routes by path: any non-hidden type here cuts a planner release
whose changelog line is a sentence about the repo's formatter config. `hidden`
types today are `refactor`, `docs`, `test`, `build`, `ci` and `chore` — read that
off `release-please-config.json` rather than off this sentence.

That path constraint is exactly why repo-4 did not fold this in: repo-4's own
title is `fix(repo): …`, which is not hidden, so adding either planner path to
that branch would have released planner.

## Done when

- Both logs carry a dated annotation naming repo-4 and stating that fixtures are
  now exempt and `npm run format` is no longer required after a fixture edit.
- The pull request title's type is `hidden` in `release-please-config.json`, and
  `node scripts/commit-message.mjs --text "<title>"` accepts it.
- No planner release is cut by the merge.

## Log

_Not started._
