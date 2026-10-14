---
id: repo-104
tool: repo
title: preflight's merge-tree probe runs last, on a fetch ten minutes stale, and fails whole runs and landings
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-104 — preflight's merge-tree probe runs last, on a stale fetch

## Why

`scripts/preflight.mjs` runs its checks in the order `check`, `review`, `title`,
`mergeTree` (the `guarded(...)` list in `preflight()`). The suites in `check`
take about ten minutes on a downloader branch. The merge-tree probe then
compares every open pull request's head oid, as `gh pr list` reports it at that
moment, against the objects this checkout fetched before the run began.
release-please force-updates its three
`release-please--branches--main--components--*` branches on every push to
`main`, so a head that moved during the suites is one this checkout does not
have, and `checkMergeTree` fails the whole run with exit 16 — by design, since
an oid it cannot compare must not read `ok` (its header: "An oid this checkout
does not have is a failure, not a skip").

The design is right; the order and the fetch are wrong. Three times in the
orchestration log since 2026-10-10 the failure cost a full run or a landing:

- dl-98's builder (2026-10-10):
  `FAIL #401 release-please--branches--main--components--ledger is at fcd77cc, which this checkout does not have — run git fetch origin and re-run`,
  after the ten-minute suites had passed.
- dl-118's builder (2026-10-12): the first preflight failed at `mergeTree`
  naming two release-please heads; a second `git fetch origin` and a second
  full preflight passed.
- lg-8's landing (2026-10-13): `git fetch origin` immediately before `--land`
  showed the three release-please branches `(forced update)`; `--land` still
  printed
  `FAIL #465 release-please--branches--main--components--planner is at 4ad9dfb, which this checkout does not have`
  (and #460, #459) and `--land failed at "preflight"` — after the records were
  pushed. A second fetch showed them forced again, and
  `node scripts/preflight.mjs --base origin/main --title "…(lg-8)"` passed.

`roles/builder.md` has said since the 2026-10-10 review that a head preflight
"does not have" is a `git fetch origin`, not a conflict. The rule did not stop
the recurrences: the fetch an agent runs before preflight is ten minutes old by
the time the probe reads it, and there is no way to rerun the probe alone —
`parseArgs` takes only `--base`, `--title` and `--repo`.

## Build

1. Run the merge-tree probe first, before `check`: it costs seconds and fails
   fast, so a stale head is found before the suites, not after them.
2. Fetch inside the probe — `git fetch origin`, or the exact refs `gh pr list`
   returned — immediately before `mergeTreeConflicts`, so the oids compared are
   the ones just listed. Keep the "does not have" failure for an oid a fresh
   fetch still lacks.
3. Add `--only <check>` so one check can be rerun alone after a failure, and
   have `review-record.mjs --land` call the probe the same way.
4. Tests in `scripts/test/preflight.test.ts`: the order; a head that moves
   between listing and probing is fetched and compared; `--only mergeTree` runs
   no suite.

Trap: `review-record.mjs --land` runs preflight after the push (repo-94). A
failure there must keep saying the records are landed and name the one check to
rerun.

## Done when

1. `node scripts/preflight.mjs` prints the `mergeTree` lines before any suite
   output, and a merge-tree failure exits 16 within a minute on a downloader
   branch.
2. A test plants a head moved after `gh pr list` and shows the probe fetches
   and compares it with no "does not have" failure; the failure still fires for
   an oid the fetch cannot bring.
3. `node scripts/preflight.mjs --only mergeTree --base origin/main --title "<title>"`
   runs the probe alone and exits 0 or 16 with no suite run, and its test proves
   no suite ran.
4. `scripts/preflight.mjs`'s header and `roles/builder.md`'s preflight bullet
   say the probe runs first and fetches.

## Log

- 2026-10-14 — Filed by the review of the orchestration log over the eleven
  batches since 2026-10-10, from three logged recurrences (items 15 of the
  eight-ticket entry, 15 of tools-9e and 6 of tools-4f). The owner chose to file
  it rather than record it as known; the review's pull request carries the
  filing.
