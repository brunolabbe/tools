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
- 2026-10-15 — Built at 59e3909d (Sonnet 5.5). `scripts/preflight.mjs`:
  `CHECK_ORDER` puts `mergeTree` first; `checkMergeTree` runs `git fetch origin`
  after `listOpenHeads` and before the first compare, and for an oid still
  missing asks `git fetch origin <oid>` (a branch force-updated between the
  listing and the fetch is no tip, so the plain fetch skips it — measured: the
  "force-updated" test below passes only with that second fetch). The "does not
  have" failure is kept and now says "even after `git fetch origin`". A fetch
  that fails is a `note` line, not a verdict. `preflight()` takes `only` and
  `onResult`; `main` prints each check as it finishes, so the probe's lines are
  out before the first suite starts. `--only` is a comma list, repeatable, and
  an unknown name is `EXIT.setup`. `review-record.mjs` `pushedHint` reads
  `preflight failed: <names> (exit N)` off the output and appends
  `Rerun only what failed: node scripts/preflight.mjs --only <names> --base … --title …`.
  Pages: `roles/builder.md` and `roles/fixer.md` preflight bullets and the exit-16
  bullet, `reference/records.md` _Landing_.
  - **Two choices the brief left open.** (1) A probe that returns a failure
    (conflict, or an oid a fresh fetch lacks) halts the run with exit 16 and
    adds a `halted` result naming `--only check,ciCommands,review,title`; a
    probe that _throws_ (`gh` down) does not halt, because
    "preflight isolates a throwing check to its own bit and still runs the
    others" (repo-51's gate) pins that a `gh` outage costs its own verdict only.
    The cost of halting on a conflict is that a builder with a real exit 16 must
    run the printed command before reporting; `roles/builder.md` now says so.
    (2) `--land` calls the probe "the same way" by construction — it runs the
    same script, so it inherits the order and the fetch; the ticket's trap is
    met by the hint above, and I did not move a probe in front of the push (that
    would change `--land`'s sequence, which repo-94 fixed on purpose).
  - **Proof.** `npx vitest run scripts/test/preflight.test.ts` gave 101 of 101
    before the CLI test was added; with `-t repo-104` it gave 11 passed, 91
    skipped, of 102. `scripts/test/review-record.test.ts` gave 67 of 67.
    Mutations were made on the committed tree and each restored with
    `git checkout 59e3909d -- scripts/preflight.mjs`. Removing both fetches
    failed 3 tests (moved head, force-updated head, failed-fetch note). Putting
    `mergeTree` last in `CHECK_ORDER` failed 3 (order, halt, CLI exit 16).
    Ignoring `only` failed 2 (the `--only mergeTree` unit test and the CLI one).
  - **Measured, Done when 1.** `node scripts/preflight.mjs --only mergeTree`
    on this repo took `real 0m0.719s` with five heads compared, and ended
    `preflight passed (only mergeTree; the other checks did not run) (exit 0)`.
    The CLI test, with a planted `gh` listing a conflicting head, exits exactly
    16 (a started `npm run check` in that fixture would add bit 1) and
    `== mergeTree ==` is the first output. A real conflict on a downloader
    branch was not staged: unmeasured, the fixture stands in for it.
- 2026-10-15 — Round 1, after gate 1 failed at 2505255f. The owner chose, over
  halting only on an unfetchable oid, to keep the halt on any verdict failure
  and fix the hints. Findings and what changed:
  - **High: a halted run's rerun text named only the probe.** The last line now
    ends `; not run:` and the four unrun check names, `failedChecks` returns the failed and the unrun checks, and
    `--land`'s hint says preflight stopped at the probe and prints one `--only`
    command over all five names. The `== halted ==` block prints two commands,
    the probe alone and the rest. `roles/builder.md`, `roles/fixer.md`,
    `reference/records.md` and `reference/dispatching.md` no longer say that
    `--only mergeTree` is the rerun, or that exit 16 alone means the rest passed.
    The `--land` test's stub now has the real output shape.
  - **Low: three causes of exit 16.** The halt block names a conflict and a
    missing head separately, and the two role pages describe three causes
    (conflict, unreachable head, `mergeTree threw`, which does not halt).
  - **Low: `rerunCommand` quoting.** It single-quotes the title and the base,
    escaping `'` as `'\''`.
  - **Low: oid option injection.** `defaultListOpenHeads` refuses a
    `headRefOid` that is not 40 or 64 hex digits, before any `git fetch`.
  - **Low: this entry's formatting.** The two bullets above are rewritten with
    no code span across a line and no stray list item.
- 2026-10-15 — Fixed at landing by owner choice: gate 2, the low on `roles/fixer.md`'s exit-16 bullet — "That sentence is unconditional, but the same bullet ends `mergeTree threw` (`gh` down) does not halt … start that bullet with \"Exit 16 from a conflict or a missing head stops the run\"". The owner answered "Apply at landing" on 2026-10-15 to whether the lander applies fully stated lows without a re-gate. `grep -n "Exit 16 from a conflict" .claude/skills/orchestrate-tickets/roles/fixer.md` → `41:- **Exit 16 from a conflict or a missing head stops the run** (repo-104): the`.
