---
id: repo-104
tool: repo
title: preflight's merge-tree probe runs last, on a fetch ten minutes stale, and fails whole runs and landings
kind: fix
status: done
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

## Review

**Gate: FAIL**: 2026-10-15 · `8e49523c..2505255f` · Opus 5.5, depth standard

| Done when                                                                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `node scripts/preflight.mjs` prints the `mergeTree` lines before any suite output, and a merge-tree failure exits 16 within a minute on a downloader branch                          | `scripts/test/preflight.test.ts` › "the CLI prints the probe's failure first and exits 16 alone, with no suite started (repo-104)" ✓ (asserts `stdout` starts `== mergeTree ==`, status exactly 16, no `== check ==`). Also › "preflight runs the merge-tree probe before any other check and reports each as it finishes (repo-104)" ✓ (`onResult` order is before the first `buildRun`). **Verified** for the "within a minute on a downloader branch" clause: a fixture whose diff and conflict sit in `tools/downloader/api/src/a.ts` exited 16 in 0.1 s with only `mergeTree` and `halted` printed. A real run on this head printed `== mergeTree ==` at 1.0 s and `== check ==` at 66.1 s |
| 2. A test plants a head moved after `gh pr list` and shows the probe fetches and compares it with no "does not have" failure; the failure still fires for an oid the fetch cannot bring | `preflight.test.ts` › "checkMergeTree fetches a head that moved after gh pr list, then compares it (repo-104)" ✓ (no `does not have`, a `conflicts on` line, and the oid is present afterwards). › "checkMergeTree brings in a listed head that was force-updated before the fetch (repo-104)" ✓. › "checkMergeTree still fails an oid that a fetch cannot bring (repo-104)" ✓                                                                                                                                                                                                                                                                                                                  |
| 3. `--only mergeTree --base origin/main --title "<title>"` runs the probe alone and exits 0 or 16 with no suite run, and its test proves no suite ran                                   | `preflight.test.ts` › "--only mergeTree runs the probe alone: no suite, no other check (repo-104)" ✓ (`suites` is 0 on a diff that plans a downloader suite). › "the CLI's --only mergeTree exits 16 on a failed probe and prints no other check (repo-104)" ✓ (16). The exit-0 branch is **verified** but no test asserts it: on fixtures, `--only mergeTree` with a clean head exited 0 and printed `preflight passed (only mergeTree; the other checks did not run) (exit 0)`                                                                                                                                                                                                                |
| 4. `scripts/preflight.mjs`'s header and `roles/builder.md`'s preflight bullet say the probe runs first and fetches                                                                      | **verified** by reading: the header paragraph "Check 5 runs first, and fetches (repo-104)", and the builder.md bullet "a merge-tree probe against every other open pull request head first, fetching `origin` itself"                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **high** · no `Done when` line depends on it · **The checks that a halted run never ran are left out of the rerun instructions.** A merge-tree verdict failure (a conflict, or an oid that is still missing) now stops preflight before `check`, `ciCommands`, `review` and `title`. The final line still reads `preflight failed: mergeTree (exit 16)`. Three shipped texts then name `mergeTree` as the only thing to rerun:
  - `failedChecks`/`pushedHint` in `scripts/review-record.mjs` print "only the preflight finding above is left … Rerun only what failed: `node scripts/preflight.mjs --only mergeTree …`".
  - `roles/builder.md`, _Before you report_, the exit-16 bullet, says for a "does not have" failure: "rerun `--only mergeTree` …, never the whole run".
  - `roles/fixer.md`, the same bullet, says the same, and for a conflict it says the rest-command exists but never tells the fixer to run it.

  These texts are false in the unsafe direction. A builder or lander who follows them gets `exit 0` from `--only mergeTree` even though no suite, no `## Review` presence check and no title check ever ran on that head. At `--land`, `review` is the check that reads the record that was just landed. The `== halted ==` block does print the right command, but the last instruction on screen contradicts it.

  The branch's own test › "land() after a merge-tree failure says the records are landed and names the one command to rerun (repo-104)" asserts the defect. It does so on a stubbed output with no `== halted ==` block, which the real preflight never produces for a verdict failure.

  Reproduction (premise: a fixture repo, a fake `gh` listing a conflicting head, then `failedChecks` and `rerunCommand` imported from the tree and applied to the real CLI output):

  ```
  A-conflict: status=16 headers=[mergeTree,halted] last="preflight failed: mergeTree (exit 16)"
  R failedChecks(real halted output) = ["mergeTree"]
  R land hint would print: Rerun only what failed: node scripts/preflight.mjs --only mergeTree --base origin/main --title "docs(repo): ours (repo-1)"
  ```

  An oid that a fetch cannot bring (`B-ghost`) and an offline fetch with a missing head (`E2-offline-lack`) halt in the same way: `status=16 headers=[mergeTree,halted]`.

  Fix, fully stated: make a halted run's last line or `failedChecks` carry the unrun names, for example by unioning the `== halted ==` list, so the hint becomes `--only mergeTree,check,ciCommands,review,title`. Change the builder.md and fixer.md sentences to "rerun the probe, then the halted command" (or "rerun the whole preflight, since the probe now fails in seconds"), and correct the land test's stub to the real output shape. `reference/dispatching.md` ("A sibling whose preflight exits 16 … changes nothing") still assumes that exit 16 alone means everything else passed, which is no longer true.

- **low** · "exit 16 alone" now has three causes, but the halt message and the pages name only one. The `halted` block says "A conflict with another pull request's head is not a fault in this branch" even when the cause was an unreachable oid or a failed fetch (`B-ghost`, `E2-offline-lack`). `roles/builder.md`/`roles/fixer.md` open with "Exit 16 alone is a conflict … The probe stops the run there, so no suite has run". For a `gh` outage whose other checks all pass, exit 16 alone comes with every suite run and no halt block: `C-gh-throws` printed `headers=[mergeTree,check,ciCommands,review,title]`. builder.md also says a lasting "does not have" is "one the remote no longer serves", but it is just as likely a failed fetch (the `note` line). The text is false in the safe direction (it over-reports what was skipped) or names the wrong cause.
- **low** · `rerunCommand` in `scripts/preflight.mjs` quotes the title with `JSON.stringify`, which gives a double-quoted shell string, so a pasted command runs backticks and `$(…)` in the title. Reproduction: `rerunCommand(["title"], "origin/main", "fix: \`npm run dev\` never $(id) started")` → `… --title "fix: \`npm run dev\` never $(id) started"`. 1 of the last 600 subjects on `main` has backticks (`fix: \`npm run dev\` never started the web app`). Fix: single-quote, escaping `'`as`'\''`.
- **low** · no live call site · `checkMergeTree` passes the `gh`-reported `head.oid` to `git fetch origin <oid>` without validating it, so an oid that begins with `-` is parsed as an option. With a fake `gh` listing `headRefOid: "--upload-pack=touch <marker>;false"` against a local-path origin, the marker appeared at head (`marker exists: true`) and did not appear at base (`marker exists: false`, because base has no fetch). It cannot happen in practice: GitHub computes `headRefOid`, and `origin` here is `https://github.com/…`, where `--upload-pack` has no effect. Fix: reject anything other than `/^[0-9a-f]{40}([0-9a-f]{24})?$/` in `defaultListOpenHeads`.
- **low** · the ticket's `## Log` (2026-10-15 entry, the "Measured, Done when 1" bullet): oxfmt turned "would add bit 1." into an ordered list item `1. with \`== mergeTree ==\` …`, and the parenthesis is never closed. Several code spans in the "Proof" bullet are also split across lines.
- **dropped** · whether the in-probe `git fetch origin` can clobber a local ref or the caller's branch. Measured: `remote.origin.fetch` is `+refs/heads/*:refs/remotes/origin/*`, `fetch.prune` is unset and `FETCH_HEAD` is per-worktree. Only remote-tracking refs move, as they already do whenever any session fetches (`common.md`). The prelude computes `diffPaths` before the probe moves `origin/main`, so the later checks in the same run stay consistent. Not a defect.
- **dropped** · `git fetch` has no timeout, so a stalled network could hang the probe. The same was already true of the `gh pr list` call this probe made before the branch, so the branch introduces no new exposure. Out of scope.
- **dropped** · `--only " title"` and `--only mergeTree, title` are rejected with exit 64 rather than trimmed. That fails safe, so it is not a defect.
- **dropped** · `--only title` with no `--title` exits 0 (`G6`). That is `checkTitle`'s existing behaviour, not something this branch introduced.
- **findings** · the hunt returned 9; 5 carried, 4 dropped.
- Positive control: in a second detached worktree at this head, each mutation of `scripts/preflight.mjs` turned the repo-104 tests red. Each was restored from the head sha, and the worktree was removed with 0 dirty paths. `mergeTree` last in `CHECK_ORDER` → 3 of 11 failed. Both fetches removed → 3 failed. Only the oid fetch removed → 1 failed ("force-updated"). Halt removed → 2 failed. `only` ignored → 2 failed.
- CI at `2505255f`: `check`, `test (ubuntu-latest)`, `changes`, `codeql`/`CodeQL` and `dependency-review` passed. `test (windows-latest, informational)` was still pending and has not been read. The diff reaches its `repo` project.
- Invariants: no shell ✓ (argv arrays, `shell: false`; the option-injection case is above). Specs registered ✓ (both files already existed). The rest (cross-tool imports, AppError, redaction, SSRF, progress, contract, Dockerfile closure) do not apply to `scripts/`.
- NFR: security, low above (option injection, title quoting) · performance ✓ (the probe took 1.0 s on 7 real heads, and a halt costs 0.1 s on a fixture) · reliability, high above · maintainability ✓.

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
