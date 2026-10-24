---
id: repo-114
tool: repo
title: status --tool withholds a cross-tool dependency that is done
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-114 — status --tool withholds a cross-tool dependency that is done

## Why

`npm run status` narrows the board with `--tool` before it decides what is done.
`scripts/status.mjs` builds its set of finished ticket ids from the narrowed rows,
so a dependency on a ticket of another tool reads as unmet even when that ticket
is `done`. The ticket is withheld, and the reader is told it waits on work that
has already landed.

Reproduced on `origin/main` at `aaccab20` (2026-10-21). The same defect was seen
at intake on `93bfa1f1` (2026-10-20), and the `--tool planner` pair below is
unchanged. The unscoped `--ready` listing is not: at `93bfa1f1` it had eight rows
(`dl-130`, `lg-58`, `lg-61`, `lg-63`, `pl-58`, `pl-59`, `repo-109`, `repo-113`;
no `lg-64` yet), where the one below is `aaccab20`'s. The live case at `aaccab20`
was pl-59, which depends on `repo-108`. At `8a6dcf9a` (2026-10-24) the planner pair
no longer reproduces: pl-59 is `done` (PR #591), so it drops out of `--ready` and
the block below is history. The pair that reproduces now is lg-64 and `repo-109`,
shown after the second block:

```
$ npm run -s status -- --ready --tool planner
stdout: pl-58	planner	Make lodging and food proposals name a premises, then re-measure how many do
stderr: tools/planner/docs/work/pl-59-list-border-and-dark-provenance-marks.md: withheld from --ready — waits on repo-108

$ grep -m1 '^status:' docs/work/repo-108-share-design-tokens-across-the-web-uis.md
status: done
```

Without `--tool`, the same board listed pl-59 as ready at `aaccab20`:

```
$ npm run -s status -- --ready
dl-130	downloader	The dl-37 Done-when 2 browser test behind the terminating proxy fails intermittently
lg-64	ledger	Two layout defects — the mortgage radios float away from their labels, and an item's name field clips its entry
pl-58	planner	Make lodging and food proposals name a premises, then re-measure how many do
pl-59	planner	Draw the plans-list border that names a colour nobody defines, and make the provenance marks readable in dark
```

At `8a6dcf9a` the same narrowing withholds lg-64, which depends on `repo-109`:

```
$ npm run -s status -- --tool ledger --ready
stdout: nothing is ready and unblocked
stderr: tools/ledger/docs/work/lg-64-mortgage-radios-float-and-an-item-name-is-clipped.md: withheld from --ready — waits on repo-109

$ grep -m1 '^status:' docs/work/repo-109-every-screen-fits-a-phone-and-a-desktop.md
status: done
```

The cause is in `scripts/status.mjs`. `readyTickets` (line 557) and
`withheldFromReady` (line 596) each build `done` from the tickets they are given,
and `renderView` passes them `selected`, which `--tool` has already narrowed to one
tool. The same narrowing reaches the default view: `renderView`'s `unblocked` set
is `readyTickets(mine)`, so lg-64 is marked `·` and labelled `(waits on repo-109)`
under `npm run -s status -- --tool ledger`, while `npm run -s status -- --show
lg-64` says `unblocked`. At `aaccab20` the same held for pl-59 under `--tool
planner`. The `--show` path reads the whole graph and is correct.

It is not a fault in one ticket: a fixture with a planner ticket depending on a
done `repo` ticket shows the same wrong answer in all three views. The fixture
reproduction the regression test can follow is in the Build.

## Build

The change is in `scripts/status.mjs` only. Its shape is the builder's choice, within
the one rule below.

1. **The done set comes from the whole graph.** `readyTickets` and
   `withheldFromReady` take the set of finished ids from every ticket on the board,
   not from the list they were handed. The list they return is still the view the
   caller asked for. One way: a second parameter carrying the whole graph, which
   `renderView` passes as `all` next to `selected`. Whatever the shape, `--tool`
   narrows what is shown and never what counts as done.
2. **The default view takes the same fix.** `renderView`'s `unblocked` set, which
   drives the `•` and `·` marks and the `(waits on …)` label, is `readyTickets(mine)`.
   It must read the whole graph too, so the default view agrees with `--show`.
3. **Nothing else moves.** A dependency that is still open, a dependency that names
   no ticket, and a dependency on a `needs-decision` ticket in another tool all still
   withhold. `--show` is unchanged, since it already reads the whole graph.
   `--ready` without `--tool` is unchanged, because its view is the whole board.
4. **The regression tests go at the end of `scripts/test/status.test.ts`**, using
   `repoWith` from the top of the file, so no test line moves. The fixture is a
   planner ticket with `depends_on: [repo-9]` and a `repo-9` ticket with
   `status: done`, in a tree of its own. Six cases, the first three on that fixture:
   - `run(["--tool", "planner", "--ready"], root)` lists the planner ticket on
     stdout and writes nothing about it to stderr. On `origin/main` it prints
     `nothing is ready and unblocked` and withholds the ticket, so this test fails
     before the fix.
   - `run(["--tool", "planner"], root)` and `run([], root)` both mark the planner
     ticket `•` with no `(waits on …)` label. The second call is the default view
     with no flag: the per-tool grouping (`mine`) is the cause there, so it fires
     without `--tool`.
   - The same fixture with `repo-9` at `status: ready` still withholds the planner
     ticket, with `waits on repo-9`. This pins that the fix did not make an
     unstartable ticket look startable.
   - The fourth case, the one Build 6 grades: a planner ticket with
     `depends_on: [repo-9, repo-10]`, `repo-9` at `status: done` and `repo-10` at
     `status: ready`. `run(["--tool", "planner"], root)` prints the label
     `(waits on repo-10)` and not `(waits on repo-9, repo-10)`, which is what it
     prints before the fix.
   - The fifth case, on the fourth case's fixture: the `--ready` stderr of
     `run(["--tool", "planner", "--ready"], root)` is `waits on repo-10` and not
     `repo-9`. This pins `withheldFromReady`'s own message, which Build 1 changes and
     no other case reaches. Measured on the base, on a partial fix (the whole graph
     into `readyTickets` and the default view, `withheldFromReady`'s message left on
     its argument) and on a full fix, the stderr is `waits on repo-9, repo-10`,
     `waits on repo-9, repo-10` and `waits on repo-10`. With
     `depends_on: [repo-9, repo-404]`, a full fix prints `waits on repo-404`.
   - The sixth case: the first fixture with `repo-9` at `status: needs-decision`
     still withholds the planner ticket under `--tool planner --ready`. This pins
     Build 3's cross-tool `needs-decision` clause, which no existing test reaches (a
     dangling id is pinned by `WITHHELD_REPO9`).
5. Do not edit `CLAUDE.md`, `docs/01-TICKETS.md` or any ticket's frontmatter.
6. **The `(waits on …)` label lists only dependencies that are not `done`.** The
   default view's label is `ticket.depends_on.join(", ")` (`scripts/status.mjs:1005`),
   so a done dependency is named beside the open one. The label filters on the same
   whole-graph done set as Build 1, so `--tool` narrows the rows and never the
   dependencies the label names. Read from the code, not reproduced on the live
   board.

## Done when

- `scripts/test/status.test.ts`, the first case of Build 4: `--tool planner --ready`
  lists a planner ticket whose dependency is a done repo ticket, and stderr has no
  line for it. The test fails on `origin/main` at `aaccab20`, with stdout
  `nothing is ready and unblocked`, before the fix.
- `scripts/test/status.test.ts`, the second case of Build 4: the default view, under
  `--tool planner` and with no flag, marks that ticket `•` and shows no `(waits on`
  label. Fails before the fix.
- Plain `npm run -s status`, read on the builder's head with `lg-64` still `ready`,
  marks it with `•` and no `(waits on` label. At the base it prints
  `· lg-64 … (waits on repo-109)`, with `repo-109` `done`, and no flag at all. If
  `lg-64` is `done` by build time, the fixture reproduction in the Log stands in for
  this live reading.
- `scripts/test/status.test.ts`, the third case of Build 4: with the dependency
  `ready`, the planner ticket is still withheld with `waits on repo-9`. Passes before
  and after the fix.
- `scripts/test/status.test.ts`, the fourth case of Build 4: a planner ticket with
  one `done` and one open cross-tool dependency, under `--tool planner`, has the label
  `(waits on <open id>)` only, with no done id in it. Fails before the fix, which
  prints both ids.
- `scripts/test/status.test.ts`, the fifth case of Build 4: the `--ready` stderr for
  that ticket is `waits on repo-10`, with no `repo-9`. Fails before the fix, and on a
  fix that leaves `withheldFromReady`'s message on its argument.
- `scripts/test/status.test.ts`, the sixth case of Build 4: with the dependency at
  `needs-decision`, the planner ticket is still withheld under `--tool planner` with
  `--ready`. Passes before and after the fix.
- `npm run -s status -- --ready` still lists on stdout each `ready` ticket whose
  dependencies are all `done`, and its stderr still names `lg-65` and `repo-98` as
  withheld. Read on the builder's head, off whichever tickets are `ready` at build
  time; while `lg-64` is `ready` it is the named example, on stdout, since `repo-109`
  is `done`.
- `npm run -s status -- --show lg-64` still prints `unblocked` on the builder's head,
  with `lg-64` still `ready`, unchanged by the fix. If `lg-64` is `done` by build time,
  the `--show` fixture reproduction in the Log stands in for this live reading, as the
  plain-status line's fixture does for its own.
- `npm run -s status -- --json > <scratch>/status.json; echo $?` prints `0`.
- `npm run check` exits `0`.

## Log

- 2026-10-21 — Filed by a maintenance dispatch, with no source change. The owner
  chose on 2026-10-21 to file this now, rather than fold it into the batch or only
  note it in the batch log. The options were: file a `repo-` ticket now (chosen,
  and the recommendation); file and fix it in this batch; note it in the batch log
  only. The ticket is `ready`, since no question is open and the shape of the fix is
  the builder's to choose inside Build.
  - **Id.** `node scripts/next-id.mjs repo` printed `next free: repo-114`. `git grep
repo-114` outside `docs/work` printed nothing, and no branch or open pull request
    carries the id.
  - **Base.** `origin/main` at `aaccab20`. The intake reproduction was on `93bfa1f1`;
    its output is the one pasted above.
  - **Cause, read from the code.** `readyTickets` at `scripts/status.mjs:557-559` and
    `withheldFromReady` at `:596-598` both build `done` from their argument.
    `renderView` passes `selected` at `:961` and `:973`, and `mine` at `:991`.
  - **Default view, a third site.** `npm run -s status -- --tool planner` prints:
    `  · pl-59  Draw the plans-list border that names a colour nobody defines, and make the provenance marks readable in dark (waits on repo-108)`.
    `npm run -s status -- --show pl-59` prints `unblocked`.
  - **Fixture reproduction.** A planner ticket with `depends_on: [repo-9]` and a
    `repo-9` at `status: done`, in a throwaway tree, run through the CLI with `--root`:
    ```
    == status --tool planner --ready  (exit 0)
    -- stdout
    nothing is ready and unblocked
    -- stderr
    tools/planner/docs/work/pl-2-slug.md: withheld from --ready — waits on repo-9

    == status --ready  (exit 0)
    -- stdout
    pl-2	planner	the pl-2 thing
    -- stderr

    == status --tool planner  (exit 0)
    -- stdout
      · pl-2   the pl-2 thing (waits on repo-9)
    ```
    Without `--tool` the ticket is ready. With `--tool` it is withheld, and the default
    view says it waits on a dependency that is `done`.
- 2026-10-21 — The coordinator relayed the owner's answers to the two open
  decisions the builder raised at filing. Both matched the builder's recommendation.
  - **Decision 1: the default view's `unblocked` set.** It is `readyTickets(mine)`,
    which reads only the rows of one tool. Options: keep it in this ticket's Build
    (the recommendation); cut it and file it separately. **Chosen: keep it.** It is
    Build 2 and its Done-when line already names it.
  - **Decision 2: the `(waits on …)` label lists done dependencies too.** Options:
    fold the filter into this ticket's Build (the recommendation); file a separate
    ticket; leave it. **Chosen: fold it in.** It is Build 6, with a Done-when line
    naming the test that grades it.
  - **Reading.** Build 6 is read from the code: the label is `depends_on.join` at
    `scripts/status.mjs:1005`. It is not reproduced on the live board, because no
    live planner ticket has two dependencies with one `done`.
  - **Fixture reproduction, 2026-10-21 on `9ce3c210`.** A planner ticket `pl-2` with
    `depends_on: [repo-9, repo-10]`, `repo-9` at `status: done` and `repo-10` at
    `status: ready`, run with `node scripts/status.mjs --root <tree> --tool planner`.
    The script is `fixture-label.mts` in the builder's scratch directory. Output:
    ```
    == status --tool planner  (exit 0)
    -- stdout

    planner — 1 open of 1

      —    not started  0 done, 1 open

      · pl-2   the pl-2 thing (waits on repo-9, repo-10)

    -- stderr
    ```
    The label names `repo-9`, which is `done`. The fix must name `repo-10` only.
- 2026-10-21 — Gate record. Gate 1 (ticket-reviewer-sonnet) passed this filing with
  four lows at `c3219a3d`. A filing carries no `--land` record, so the gate's full
  report is on pull request #601's thread, not in this file.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, F1 — "`Done when` 4
  points at a test that is not named. It reads 'the test Build 6 names', Build 6
  states a rule and no test, and Build 4 says 'Three cases'." Build 4 now has the
  `repo-9` done / `repo-10` ready fixture as its fourth case and `Done when` 4 reads
  "the fourth case of Build 4". The phrase "Three cases" and the phrase naming
  Build 6's test, each counted above `## Log` by `awk '/^## Log/{exit} {print}'
<ticket> | grep -c`, → 0 and 0.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, F2 — "The ticket frames the
  default-view defect as `--tool`'s ... it also fires with no flag." Build 4's
  second case now calls `run([], root)` as well, and `Done when` carries a live line
  that plain `npm run -s status` marks `pl-59` and `lg-64` with `•` and no label.
  Confirmed on the base, by `npm run -s status` filtered to the two ids: lg-64 is
  `· lg-64 … (waits on repo-109)` and pl-59 is `· pl-59 … (waits on repo-108)`. The Why paragraph's
  framing ("the same narrowing reaches the default view") was not reworded, since
  the finding's fix does not name it.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, F3 — "Build 1 changes the
  `done` set that `withheldFromReady` uses for its own message, and no `Done when`
  line fails if that half is skipped." Build 4 now has a fifth case (the `--ready`
  stderr is `waits on repo-10` and not `repo-9`; `waits on repo-404` for
  `[repo-9, repo-404]` on a full fix) and a sixth (a `needs-decision` `repo-9` still
  withholds), each with its `Done when` line. The base's `waits on repo-9, repo-10`
  is the output of `withheldFromReady`'s `depends_on.filter` over the selected rows'
  `done` set, `scripts/status.mjs:596-598`. The partial-fix and full-fix outputs are
  the gate's measurements, not re-run here.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, F4 — "'The same defect was
  seen at intake on `93bfa1f1`, and the output below is unchanged' holds for the
  `--tool planner` pair and not for the unscoped `--ready` listing, which at
  `93bfa1f1` had eight rows." The Why now says so. Extracted `93bfa1f1` and ran
  `node scripts/status.mjs --root <tree> --ready` → `dl-130`, `lg-58`, `lg-61`,
  `lg-63`, `pl-58`, `pl-59`, `repo-109`, `repo-113` (eight rows).
- 2026-10-24 — Maintenance dispatch: the owner's answer to a question asked at batch
  intake, recorded as Done-when text. One Log entry and the reworded lines; no source
  change; `status` stays `ready`.
  - **Question.** "repo-114: two Done-when lines check status output for pl-58 and
    pl-59, which are now done, so they can't be met as written. How should they be
    reworded before dispatch?"
  - **Options.** (1) "Live pair + fixture": name lg-64 → repo-109 as the live example,
    read at build time, with the fixture reproduction in this Log as the lasting
    proof. The live reading goes stale once lg-64 lands; the fixture does not.
    (2) "Fixture only": drop the live status readings and prove it with the fixture
    tests alone.
  - **Choice.** Option (1), "Live pair + fixture", chosen by the owner on 2026-10-24.
    It was the orchestrator's recommendation.
  - **Third line.** The third reworded line below was not in the question. The
    orchestrator extended the same answer to it. It is the orchestrator's extension
    of the owner's answer, not the owner's own words.
  - **Reworded lines,** in `## Done when`. Old, then new:
    1. Plain status. Old: "Plain `npm run -s status`, read on the builder's head with `pl-59` and `lg-64` still `ready`, marks both with `•` and no `(waits on` label. At the base it prints `· pl-59 … (waits on repo-108)` and `· lg-64 … (waits on repo-109)`, both dependencies `done`, with no flag at all." New: "Plain `npm run -s status`, read on the builder's head with `lg-64` still `ready`, marks it with `•` and no `(waits on` label. At the base it prints `· lg-64 … (waits on repo-109)`, with `repo-109` `done`, and no flag at all. If `lg-64` is `done` by build time, the fixture reproduction in the Log stands in for this live reading."
    2. `--ready`. Old: "`npm run -s status -- --ready` still lists `pl-58` and `pl-59`
       on stdout, and its stderr still names `lg-65` and `repo-98` as withheld. Read on
       the builder's head, with pl-59 still `ready` (PR #591 open at intake)." New:
       "`npm run -s status -- --ready` still lists on stdout each `ready` ticket whose
       dependencies are all `done`, and its stderr still names `lg-65` and `repo-98` as
       withheld. Read on the builder's head, off whichever tickets are `ready` at build
       time; while `lg-64` is `ready` it is the named example, on stdout, since
       `repo-109` is `done`."
    3. `--show`, the orchestrator's extension. Old: "`npm run -s status -- --show pl-59`
       still prints `unblocked` on the builder's head, unchanged by the fix." New:
       "`npm run -s status -- --show lg-64` still prints `unblocked` on the builder's
       head, with `lg-64` still `ready`, unchanged by the fix."
  - **Why.** The `--tool planner` pl-59 example was written as current. At
    `8a6dcf9a` it no longer reproduces: pl-59 is `done` (PR #591) and drops out of
    `--ready`. The lg-64/repo-109 pair reproduces instead, under `--tool ledger`. The
    Why's cause paragraph now names that pair, and the `aaccab20` planner blocks are
    marked as history.
  - **Commands, run at `8a6dcf9a` on this branch after the edits:**
    ```
    $ npm run -s status -- --show pl-59 | grep -i unblock
    (no output; grep exit 1)
    $ npm run -s status -- --show lg-64 | grep -i unblock
      unblocked
    $ npm run -s status | grep 'lg-64'
      · lg-64  Two layout defects — the mortgage radios float away from their labels, and an item's name field clips its entry (waits on repo-109)
    $ npm run -s status | grep -c 'pl-59'
    0
    $ npm run -s status -- --tool ledger --ready
    stdout: nothing is ready and unblocked
    stderr: tools/ledger/docs/work/lg-64-mortgage-radios-float-and-an-item-name-is-clipped.md: withheld from --ready — waits on repo-109
    $ npm run -s status -- --ready
    stdout: dl-130, lg-64, pl-60, repo-114 (one row each)
    stderr: tools/ledger/docs/work/lg-65-….md and docs/work/repo-98-….md, both withheld as "needs-decision"
    $ npm run -s status -- --json > <scratch>/status.json; echo $?
    0
    $ npx oxfmt --check docs/work/repo-114-*.md
    All matched files use the correct format.
    ```
  - **Not covered by the fixture.** The fixture reproduction above shows `--tool planner` and `--ready`, and no `--show`. The `--show` line therefore had no fixture stand-in when this entry was written. Round 2 below closes that gap.
  - **Round 2, the `--show` fixture (2026-10-24).** Question, put to the owner by the coordinator on 2026-10-24: "the reworded '--show lg-64 still prints unblocked' line has no fixture to fall back on, so once lg-64 lands nothing can read it. How should that gap be closed?" Options: (1) "Add a --show fixture": one throwaway-tree fixture run of `--show` in this Log, so the "live pair + fixture" answer covers all three lines. (2) "Read any eligible ticket": reword the line like the `--ready` one. (3) "Leave it". Choice: option (1), "Add a --show fixture", chosen by the owner on 2026-10-24. It was the builder's recommendation and the orchestrator's.
  - **Fixture.** A throwaway tree in the builder's scratch directory, `show-fixture`, built the way the fixture reproduction above is built: `tools/planner/docs/work/pl-2-slug.md`, `status: ready`, `depends_on: [repo-9]`, and `docs/work/repo-9-slug.md`, `status: done`. It is planner-to-repo, not ledger-to-repo as lg-64 is, but the `--show` reading uses the same whole-graph code path. `scripts/status.mjs` is identical at `8a6dcf9a` and at this head: `git diff --stat 8a6dcf9a HEAD -- scripts/status.mjs` prints nothing.
    ```
    $ npm run -s status -- --root <scratch>/repo-114/build/show-fixture --show pl-2
    pl-2  the pl-2 thing

      tool        planner
      kind        chore
      status      ready
      milestone   —
      depends on  repo-9
      note        —
      difficulty  standard
      awaiting    —
      file        tools/planner/docs/work/pl-2-slug.md

      unblocked
    exit 0
    ```
  - **Control.** The same tree with `repo-9` set to `status: ready` (`show-fixture-control`) gives `  blocked by  repo-9 (ready)` in place of `  unblocked` for the same command, so the line tells the two readings apart.
  - **Live state at this head.** `lg-64` is still `status: ready` on this branch, and PR #604 is open for it. The `--show` line is read live until lg-64 is `done`, then the fixture above stands in.
