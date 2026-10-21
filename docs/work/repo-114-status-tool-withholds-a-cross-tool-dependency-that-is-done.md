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
at intake on `93bfa1f1` (2026-10-20), and the output below is unchanged. The live
case is pl-59, which depends on `repo-108`:

```
$ npm run -s status -- --ready --tool planner
stdout: pl-58	planner	Make lodging and food proposals name a premises, then re-measure how many do
stderr: tools/planner/docs/work/pl-59-list-border-and-dark-provenance-marks.md: withheld from --ready — waits on repo-108

$ grep -m1 '^status:' docs/work/repo-108-share-design-tokens-across-the-web-uis.md
status: done
```

Without `--tool`, the same board lists pl-59 as ready:

```
$ npm run -s status -- --ready
dl-130	downloader	The dl-37 Done-when 2 browser test behind the terminating proxy fails intermittently
lg-64	ledger	Two layout defects — the mortgage radios float away from their labels, and an item's name field clips its entry
pl-58	planner	Make lodging and food proposals name a premises, then re-measure how many do
pl-59	planner	Draw the plans-list border that names a colour nobody defines, and make the provenance marks readable in dark
```

The cause is in `scripts/status.mjs`. `readyTickets` (line 557) and
`withheldFromReady` (line 596) each build `done` from the tickets they are given,
and `renderView` passes them `selected`, which `--tool` has already narrowed to one
tool. The same narrowing reaches the default view: `renderView`'s `unblocked` set
is `readyTickets(mine)`, so pl-59 is marked `·` and labelled `(waits on repo-108)`
under `npm run -s status -- --tool planner`, while `npm run -s status -- --show
pl-59` says `unblocked`. The `--show` path reads the whole graph and is correct.

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
   `status: done`, in a tree of its own. Three cases:
   - `run(["--tool", "planner", "--ready"], root)` lists the planner ticket on
     stdout and writes nothing about it to stderr. On `origin/main` it prints
     `nothing is ready and unblocked` and withholds the ticket, so this test fails
     before the fix.
   - `run(["--tool", "planner"], root)` marks the planner ticket `•` with no
     `(waits on …)` label.
   - The same fixture with `repo-9` at `status: ready` still withholds the planner
     ticket, with `waits on repo-9`. This pins that the fix did not make an
     unstartable ticket look startable.
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
- `scripts/test/status.test.ts`, the second case of Build 4: the default view marks
  that ticket `•` and shows no `(waits on` label. Fails before the fix.
- `scripts/test/status.test.ts`, the third case of Build 4: with the dependency
  `ready`, the planner ticket is still withheld with `waits on repo-9`. Passes before
  and after the fix.
- `scripts/test/status.test.ts`, the test Build 6 names: a planner ticket with one
  `done` and one open cross-tool dependency, under `--tool planner`, has the label
  `(waits on <open id>)` only, with no done id in it. Fails before the fix, which
  prints both ids.
- `npm run -s status -- --ready` still lists `pl-58` and `pl-59` on stdout, and its
  stderr still names `lg-65` and `repo-98` as withheld. Read on the builder's head,
  with pl-59 still `ready` (PR #591 open at intake).
- `npm run -s status -- --show pl-59` still prints `unblocked` on the builder's head,
  unchanged by the fix.
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
