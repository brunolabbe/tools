---
id: repo-118
tool: repo
title: next-id labels a ticket on main "merged" while its work's pull request is open, and a stacked branch as a clash
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-118 — next-id labels a ticket on main "merged" while its work's pull request is open, and a stacked branch as a clash

## Why

`scripts/next-id.mjs` prints every claimant of an id with its source, and the source
for a ticket file present at `origin/main` is the word `merged`. A builder reads that
as the opposite of the fact it acts on: a ticket is filed on `main` long before its
work merges, so `merged lg-40` printed while lg-40's pull request #548 was open
(orchestration log, tools-01 item 4, 2026-10-18):

```
$ node scripts/next-id.mjs lg | grep lg-40
merged lg-40
$ gh pr view 548 --json state --jq .state
OPEN
```

Two readings reported in the same period belong with it. The answer is the last
line, `next free:`, after some fifty `merged` rows for a tool with that many
tickets, and nothing says so (lg-66's builder, 2026-10-24). A branch stacked on a
sibling's reports the sibling's new ticket as a `clash` held by both pull requests
(`clash: lg-66 is claimed by PR#623, PR#625`), where #625 only carries #623's
commits.

## Build

1. Rename the source label for a file at the ref from `merged` to `on main` (or
   `at <ref>` when `--ref` names another), in the output and in
   `scripts/test/next-id.test.ts`'s expectations; `concurrency.md`'s sample output
   quotes the label and is updated with it.
2. Print the `next free:` line first or mark it, so the answer is not the last of
   sixty lines; keep the claimant rows.
3. For a `clash` between two pull requests where one branch contains the other's
   head (`git merge-base --is-ancestor`), report the stacked one as `PR#<n> (stacked
on PR#<m>)` and not as a clash.

## Done when

1. `node scripts/next-id.mjs lg` prints no `merged` row; a ticket file on `main`
   reads `on main <id>`, and a test asserts the label.
2. The `next free:` answer is on the first line of output, asserted by a test.
3. A fixture with a branch stacked on another's head reports no `clash` for the
   parent's ticket, asserted by a test that goes red when the ancestor check is
   removed.

## Review

**Gate: PASS** — 2026-10-24 · `3c5edec4..700d5b24` · Sonnet 5.5, depth narrow

Range: `git diff 3c5edec4...700d5b24`, five files. The head is a merge of `origin/main` at the base sha itself, so the three-dot range carries none of `main`'s files. Tree: detached at the head, farmed, not built (the diff is `scripts/` and markdown; the `repo` project imports no workspace `dist`).

| Done when (repo-118)                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `next-id lg` prints no `merged` row; a ticket file on `main` reads `on main <id>`; a test asserts it                                | **proven** — `scripts/test/next-id.test.ts` › "a ticket file on main is labelled on main, and no row says merged": `rows` equals `["on main repo-40", "PR#548 repo-41"]` (cannot pass on empty output) and no row's source is `merged`. Live `node scripts/next-id.mjs lg`: 56 lines, 55 `on main`, 0 containing `merged`.                                                               |
| 2. `next free:` is line 1, asserted by a test (owner's layout: notes directly under, `render` comment reworded)                        | **proven** — same file › "the next free answer is the first line, and a note sits directly under it": line 1 `next free: repo-51`, line 2 the `unread:` note, line 3 `on main repo-1`, last line `on main repo-50`, 52 lines. Live `lg` and `repo`: line 1 is `next free:`. The `render` comment is reworded. No unread branch exists live, so "notes under" is proven by the test only. |
| 3. A branch stacked on another's head reports no `clash` for the parent's ticket; the test goes red when the ancestor check is removed | **proven** — same file › "a pull request stacked on another's head reports no clash for the parent's ticket": `clashes(result)` equals `[]`, asserted before the labels. With `isAncestor` made to return `false`: 3 failed, 33 passed, on `expected [ { id: 66, sources: [ …(2) ] } ] to deeply equal []`. Restored: 36 of 36.                                                          |

| Check (from the dispatch), repo-124 filing | Result                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format against `docs/01-TICKETS.md`        | **verified** — every frontmatter field present, no wrapped quotes; Why, Build, Done when, Log; no Review. `npm run -s status -- --json` exits 0 with `problems: []`; `--show repo-124` prints `blocked by repo-118 (ready)`.                                                                                             |
| The id is free                             | **verified** — `next-id repo` names PR#631 alone as holding `repo-124` (PR#632 holds 119 to 123); no file on `origin/main` and no line of PR#632's diff names it.                                                                                                                                                        |
| Reproduction matches what was measured     | **verified** — rebuilt the fixture from the ticket's words and the test helpers (real bare remote, `parent-pr` adds `repo-66`, `stacked-no-pr` cut from it adds `repo-67`, fake `gh` for PR#623). Output is the ticket's six lines, byte for byte. The ticket marks it as a scratch script and does not ship the script. |
| Claims about the code                      | **verified** — `stackPulls` keeps only sources whose label starts `PR#` and which carry a `sha`; a `branch/…` source is never a candidate, so the gap is as filed. No live case: the live `repo` sweep's one clash is repo-93, a squash-merged branch (repo-49's shape 2).                                               |
| `status` and `difficulty` honest           | **verified** — `ready` with a stated Build and a named dependency on repo-118; `standard` fits a widened pairwise pass with pruning and a timing to take.                                                                                                                                                                |

- **low** · no `Done when` line depends on it · `concurrency.md`, guard table, row "take a stacked child's name-derived ids off its claim" quotes the wrong printed line. With the name rule removed the line is `clash: repo-66 is claimed by PR#623, PR#625 (stacked on PR#623)`; the row says `PR#623, PR#625`, which is what removing the _ancestor_ check prints. False in a detail nothing relies on. Reproduction: `node <scratch>/plant.mjs <tree> name`, then `node <scratch>/scenarios.mjs <tree> name`.
- **low** · no `Done when` line depends on it · repo-118's Log says that with the name rule removed "the other two stayed green". Measured: 2 failed, 34 passed — "a stacked child's name keeps the ids its parent does not hold" also went red; only "two unrelated pull requests whose branch names share an id still clash" stayed green. False in the safe direction (the test has more teeth than claimed).
- **low** · no `Done when` line depends on it · `concurrency.md` ("and so does a stacked child's own, different ticket under a parent's id") and `stackPulls`'s comment promise a clash that no test asserts. The promise is true: a stacked child filing `repo-66-other.md` under the parent's `repo-66` prints `clash: repo-66 is claimed by PR#623, PR#625 (stacked on PR#623)` (`scenarios.mjs <tree> otherfile`). Missing fixture, no live call site.
- **dropped** · the live `clash: repo-93 is claimed by branch/repo-93-sqlite-file-tests-windows-timeout, on main` that the Log says was not investigated: the branch's three-dot diff still adds `docs/work/repo-93-sqlite-file-tests-time-out-on-the-windows-leg.md`, which `main` holds. That is repo-49's shape 2, already in `concurrency.md`; the branch did not cause it.
- **dropped** · the only clash on a 122-line `repo` sweep prints at the bottom, below the answer. That is the owner's settled layout.
- **dropped** · the `concurrency.md` sample wraps the `unread:` note over two lines where the CLI prints one. Unchanged shape from before the branch.
- **dropped** · "lg-40 read `on main`" in `concurrency.md` reads as the current label for that case, not history; ambiguous tense, no reader misled.
- **dropped** · Build 1 still says `--ref`; the flag is `--rev`. The Log records the brief's error and the label reads `at HEAD` live (`next-id repo --rev HEAD`: `at HEAD repo-1`). The brief is not edited by a gate.
- **findings** · the hunt returned 8; 3 carried, 5 dropped.
- Consumers of the renamed label: 70 tracked files name `next-id`; none parses its output. Only `concurrency.md` (updated by the branch) and `scripts/test/next-id.test.ts` (updated) read a label, the line order or `clash:`; `docs/01-TICKETS.md` describes what it computes without them; `.claude/hooks`, `.claude/agents`, `.githooks`, `.github` and every other skill page name the script nowhere. No hook, skill or script greps `merged ` or takes the last line.
- CI: `gh pr checks 631` at head `700d5b24`: `check` x2, `CodeQL`, `codeql` and `dependency-review` pass; `test (ubuntu-latest)` and `test (windows-latest, informational)` still pending. The three `Done when` lines are proven by the local run, not by the pending legs.
- NFR: security n/a (`isAncestor` spawns an argument array through `runCommand`, as the other git calls do) · performance — one `git merge-base` spawn per ordered pair of open pull requests, 5 live, scale unmeasured · reliability ✓ (an exit other than 0 or 1 propagates, not read as "no") · maintainability — the lows above.

## Log

- 2026-10-24 — Filed by the 2026-10-24 review of the orchestration log (tools-01 item 4; the
  stacked-branch and last-line readings relayed by session tools-f6 from lg-66's builder, not
  re-run by the review).
- 2026-10-24 — Owner answers at intake, recorded by the builder before any source change:
  1. **Layout: option (a), answer first.** Line 1 is `next free:`, the notes come straight
     after it, then the claimant rows and clashes. Options offered: (a) answer first, notes
     under, with `render`'s comment reworded to say notes sit immediately _below_ the answer,
     for the same reason; (b) keep the answer last and mark it, rewording Done when 2; (c)
     print it both first and last. Build 2 is therefore the "print first" branch. Recommended
     by the builder's question; chosen by the owner.
  2. **Rating: keep `mechanical`.** Options offered: keep `mechanical`, or re-rate to
     `standard` because of Build 3's ancestor check. Chosen: keep. `difficulty` is not edited.
     Status stays `ready`; this is the owner's answer to a `ready` ticket's open question, not a
     change of state.
- 2026-10-24 — Built on `repo-118-next-id-labels-and-stacked` from `5f9e3c0a`. Commits:
  `2af649ed` (the answers above), `9b1e3f17` (the build), `561ed0c8` (the clash assertion moved
  ahead of the labels, so a red run names the clash).
  - **Build 1, the label.** The source for ticket files at the ref is `on main`, or `at <rev>`
    for another ref. `scripts/test/next-id.test.ts` expectations are relabelled throughout.
    The brief says `--ref`; the flag is `--rev` (`parseArgs`), and the build uses that. Done
    when 1 is `on main repo-40` with no `merged` source, in "a ticket file on main is labelled
    on main, and no row says merged". Live, `node scripts/next-id.mjs lg` on this checkout
    printed 0 `merged` rows and 55 `on main` rows.
  - **Build 2, the answer first.** `render` prints `next free:` on line 1, the notes straight
    under it, then the rows and clashes. Its doc comment is reworded with the same reason.
    Done when 2 is "the next free answer is the first line, and a note sits directly under
    it", a 50-ticket board with one unread note: line 1 `next free: repo-51`, line 2 the unread
    note, line 3 `on main repo-1`, last row `on main repo-50`.
  - **Build 3, stacked.** `stackPulls` runs after the sources are built. A read pull request
    head that `git merge-base --is-ancestor` puts inside another's is labelled `PR#<n> (stacked
on PR#<m>)`, and the parent's paths come off its claim. Done when 3 is "a pull request
    stacked on another's head reports no clash for the parent's ticket", over a real fixture
    remote, and "two unrelated pull requests that file one id still clash", which keeps the
    check from being a rule about paths. **Removal:** `isAncestor` made to return `false`
    without running git, the spec red on the clash:
    `expected [ { id: 66, sources: [ …(2) ] } ] to deeply equal []`, with `PR#623` and `PR#625`
    in the sources. Restored from `9b1e3f17`; `scripts/test/next-id.test.ts` 33 of 33.
  - **Fold-in, the owner-selected `concurrency.md`.** Its paragraph, sample (answer first, the
    new labels, one stacked row), pull-request paragraph, clash paragraph and two table rows
    are reworded. No other page under `.claude/skills/` is edited. The guard table gains a row
    for the ancestor check. Nothing else on the ready list is made free by this work
    (`repo-117` shares no file), so there is no other fold-in.
  - **Two open decisions, answered by the owner through the coordinator (2026-10-24,
    relayed; the coordinator put both to the owner that day).** Each question, its options,
    the choice, and whose recommendation it overrode:
    - **Q1, a stacked branch with no pull request.** Options: keep the pull-request scope and
      note the gap in `concurrency.md` (the coordinator's recommendation, which overrode the
      builder's); file a follow-up ticket (the builder's recommendation); widen Build 3 now.
      **Chosen: file a follow-up ticket**, which is the builder's recommendation, so it
      overrode the coordinator's. Filed as `repo-124`, `depends_on: [repo-118]`, `ready`.
    - **Q2, a stacked child whose branch name carries its parent's id.** Options: leave it and
      record it in `concurrency.md` (the coordinator's and the builder's recommendation, both
      the same); fix it now. **Chosen: fix it now**, which overrode both recommendations.
      Built in `e8216ac6` (`fix(repo): take a stacked child's name-derived ids off its
claim`), which adds `unheldName`. The `concurrency.md` paragraph is updated to say so.
  - **Q2 fix and its removal.** `unheldName` takes the ids a parent holds off a stacked
    child's branch name. An id the parent does not hold stays, restated on its own. Tests:
    "a stacked child whose branch name carries its parent's id reports no clash for it",
    "a stacked child's name keeps the ids its parent does not hold", and "two unrelated pull
    requests whose branch names share an id still clash". With the name rule removed
    (`paths: child.paths.filter(...)` in place of `unheldName(...)`), the first test went red
    on `expected [ { id: 66, sources: [ …(2) ] } ] to deeply equal []` with `PR#623` and
    `PR#625 (stacked on PR#623)` in the sources; the other two stayed green. Restored from
    the fix's sha; `scripts/test/next-id.test.ts` 36 of 36.
    - **WITHDRAWN — do not cite this paragraph:** the clause "the other two stayed green" in
      the bullet above. The builder wrote it; gate 1 measured otherwise. With the name rule
      removed, `scripts/test/next-id.test.ts` ran 2 failed, 34 passed (36): "a stacked child
      whose branch name carries its parent's id reports no clash for it" and "a stacked
      child's name keeps the ids its parent does not hold" both went red; only "two
      unrelated pull requests whose branch names share an id still clash" stayed green. The
      error is in the safe direction, since the second test has more teeth than claimed.
  - **Still not covered.** A stacked branch with no pull request is not checked against its
    parent. That is repo-124, filed in this branch. Its reproduction is a fixture, not a live
    case; the output is in repo-124's _Why_.
  - **Blind spot, reported and not filed.** `next-id` cannot see a peer's unpushed worktree:
    per the coordinator, `node scripts/next-id.mjs repo` printed `next free: repo-119` on main
    while worktree `deps-2026-10-24` held repo-119 to repo-123 as files. This builder did not
    check that worktree. The gap is already recorded in `docs/01-TICKETS.md` (the 2026-09-30
    note) and `concurrency.md`, and no open ticket covers it. The coordinator asked for it to
    be reported, not filed.
  - **Live, not a test:** `node scripts/next-id.mjs repo` on this checkout prints
    `clash: repo-93 is claimed by branch/repo-93-sqlite-file-tests-windows-timeout, on main`.
    That is a branch with no pull request, so the stacking check does not reach it. Its cause
    was not investigated.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the first low — "quotes the wrong
  printed line". In `concurrency.md`'s guard-table row for the name rule, the line is now
  `clash: repo-66 is claimed by PR#623, PR#625 (stacked on PR#623)`. Planting the removal
  (`plant.mjs <tree> name`) and running `scenarios.mjs <tree> name` printed exactly that
  line. The removed-line count, from `git diff 700d5b24 HEAD -- <concurrency.md>` piped
  to `grep -c '^-.*PR#625.\. Measured'`, is `1`; the same pattern on `^+` lines is `0`.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the second low — "the other two
  stayed green" is false. Withdrawn in place under the Q2 bullet above, attributed to the
  builder, with the measured counts: 2 failed, 34 passed (36), with the name rule removed
  (`plant.mjs <tree> name`, then `npx vitest run scripts/test/next-id.test.ts`).
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the third low — "promise a clash that
  no test asserts". Added "a stacked child filing a different ticket under its parent's id
  still clashes" at the end of `scripts/test/next-id.test.ts`; it passes at the head, 37 of 37.
  With `stackPulls`'s filter also dropping any entry that carries an id the parent
  holds, it alone went red, `expected [] to deeply equal [ { id: 66, sources: [ …(2) ] } ]`,
  1 failed, 36 passed (37). Restored from `7037f68a`.
