---
id: repo-44
tool: repo
title: The review corpus's failing citations, repaired or grandfathered by the owner's decision
kind: chore
status: done
milestone: null
depends_on: [repo-35]
difficulty: hard
---

# repo-44 — The rest of repo-39, and the references only a pin can repair

**Packages:** `docs/work/`, `tools/*/docs/work/`, and `scripts/citations-gate.mjs`
(the `GRANDFATHERED` list only).

## Why

[repo-39](./repo-39-the-unanchored-half-of-the-review-corpus.md) was repo-37's
remainder, and it was taken in one slice as well: the downloader's records, less
`dl-44`. That slice repaired 247 of its 296 failing references and deleted eight
`GRANDFATHERED` entries. **This ticket is what is left**, filed when the slice was
built, so the debt never sits in a `done` ticket. Same reason repo-39 was filed
from repo-37.

It is two different jobs, and the second is new:

1. **The unbuilt records**: the 22 `docs/work/repo-*` records, the planner's three
   largest (`pl-25`, `pl-28`, `pl-32`) and `dl-44`. Same method as repo-37 and
   repo-39.
2. **The 49 downloader references repo-39 left on purpose.** Each is a coordinate
   that was true of some commit and is not true today, sitting where repointing
   would change what the record claims. The shapes: runner output quoted from a
   red run; a defective coordinate that is itself a finding's subject; an
   old → new correction transcript; a test a later ticket replaced; and a record
   that says in its own words that its line numbers are the reviewer's evidence
   for an earlier sha. `dl-33` holds 17 of the 49 on that last ground. **None of
   them can be repaired before repo-35 lands**, because repo-35's per-citation pin
   is the mechanism for exactly this case (see Build).

### What is left, measured on `repo-39-downloader-slice` over `64edce2`

`node scripts/citations-gate.mjs`, exit code read by redirecting to a file, exit 0:

```
38 enforced, 0 failing; 37 grandfathered, holding 12 unresolvable, 40 moved,
309 unanchored, 6 indistinct.
```

| Slice                                          | Records | References |
| ---------------------------------------------- | ------- | ---------- |
| `docs/work/repo-*`                             | 22      | 231        |
| `tools/planner/` — `pl-25`, `pl-28`, `pl-32`   | 3       | 83         |
| `tools/downloader/` — `dl-44`                  | 1       | 4          |
| `tools/downloader/` — repo-39's pin-wait class | 11      | 49         |
| **total**                                      | **37**  | **367**    |

The per-bucket figures are from calling `gate()` from `scripts/citations-gate.mjs`
with an empty grandfather map, which reproduced the gate's own 45 / 614 at
`64edce2` before any edit. The pin-wait class is `dl-15` (8), `dl-16` (3),
`dl-18` (4), `dl-19` (3), `dl-32` (3), `dl-33` (17), `dl-36` (2), `dl-40` (4),
`dl-41` (2), `dl-42` (1) and `dl-45` (2); each record's own Log names every
reference it left and why.

**Re-measure after repo-35 merges, before starting.** repo-35 migrates evidence
declarations to pins and will change the counts on `repo-21`, `repo-25` and
`dl-44`. Its branch also edits `GRANDFATHERED`, so expect a textual merge there,
and the line coordinates below will move with it.

## Build

Take one tool, or one run of ids, per dispatch, and keep repo-37's two
prohibitions: do not anchor a stale coordinate to today's content, and do not
touch a citation inside a quoted reproduction.

### The pin-wait class, once repo-35 is on `main`

- Pin each of the 49 at the commit it was true of: the reviewed sha where it is
  still reachable, and otherwise the commit that merged the record. repo-39 found
  several reviewed shas squashed away (`dl-36`'s `1fe5a4d` and `dab661c`, and
  `dl-37`'s pre-squash tip), so check reachability before choosing a rev — and
  **reachable means reachable from a pushed ref**, not present in your worktree:
  `git merge-base --is-ancestor <sha> origin/main` exits 0, or
  `git branch -r --contains <sha>` is non-empty. A commit object kept alive by a
  reflog entry, a stray local ref or an unpruned dangling commit resolves locally
  and not in a fresh clone, so a pin built on it verifies for you and fails in
  CI. repo-39's reviewer reproduced exactly that on `e3d065e`: `git cat-file -t`
  printed `commit`, `--is-ancestor` against `origin/main` exited 1, and no local
  or remote branch contained it.
- **Use a pin, not a declaration, for all 49.** Every one was true of some commit.
  repo-35 part 5's rule sends exactly that case to a pin, and its cheap half
  refuses a declaration whose anchor is still found elsewhere in the file — which
  several of these would be.
- **One of them cannot take an anchor even with a pin.** `dl-33`'s re-resolution
  table quotes a Vitest output string containing a coordinate; anchoring it would
  alter the quote. That is a question for the owner rather than a repoint: leave
  the reference counted, give the checker a way to mark quoted output, or accept
  prose. Surface it; do not settle it in a commit.

### What repo-37 and repo-39 learned about method

repo-37's nine notes, generalised from the planner, still hold. Note 3 is
corrected, and notes 10 onwards are what the downloader added — the brief
predicted it would behave differently, and it did, though not where it was
expected to.

1. **Read the enclosing test's name, not the cited line.** A gate record cites an
   assertion line, the file grows, and the coordinate lands on a comment or a
   blank. The test name is stable, almost always unique in its file, and is what
   the claim is about. Repoint to `test("…")` and anchor on its name.
2. **An anchor may not contain a double quote, and there is no escape.** The
   anchor is delimited by `"`, and `file.ts:1 "case \"snapshot\":"` is parsed as
   the anchor `case \` and reported `moved`. Pick a quote-free fragment, or cite a
   range whose other line has one.
3. **A record cannot cite itself under `--require-distinct-anchors`, ever.** The
   anchor text is written into the very file it points at, so it occurs at least
   twice. **Name the section in prose.** Whether the checker should skip the
   citing line was answered by repo-35's Build, part 8: it detects the
   self-citation and prints the true remedy, and the citation still fails.
4. **A backticked bare number is a live citation, and it will bind to the wrong
   file.** It inherits the last qualified citation above it. **Qualify with the
   full path; never leave the colon form.**
5. **Some colon-number references are record lines, not file lines.** A finding
   that quotes where a defective citation sat in a ticket names nothing a checker
   can resolve. Rewrite it as prose naming the section.
6. **A comma list is one citation, not several.** `file.ts:195,209,227,335` parses
   as `:195` and the rest is invisible. Expand them.
7. **A finding that was fixed usually has no coordinate left.** Point at what
   stands there now and say so in the same sentence, rather than at the
   replacement silently.
8. **`unchecked` and prose references do not fail this gate.** Demoting a
   citation to prose therefore stops it failing — right when it never named a
   file, gaming the gate when it did.
9. **`npm run format` reflows markdown, so re-run the checker after it.**
10. **A record that dates its own line numbers is not stale — it is pinned in
    prose.** The planner never had one; the downloader has four shapes. `dl-33`
    says its reviewer's numbers are "left as written" as evidence for `b48caf7`
    and resolves them forward in a table; `dl-42`'s Log says its Why "describe[s]
    `4a4cc4f`"; `dl-34`'s Log says its Provenance "pins itself to a different
    tree"; and
    `dl-45` says its citations are "anchored to `d3677ad`". Read the record's own
    words before its coordinates. Where the claim is a pointer that merely moved,
    repoint it and add a dated note beside the pinning sentence, as repo-39 did
    for `dl-15` and `dl-45`. Where the coordinate is the evidence, leave it for a
    pin.
11. **Wrong-file shorthands are the downloader's commonest silent defect.** repo-39
    qualified them in `dl-19`, `dl-32` (twice), `dl-33`, `dl-37` (three browser
    proofs bound to `ytdlp.test.ts`), `dl-43` and `dl-45`. The tell is a row or
    bullet whose prose names one file while its shorthand inherits another from
    the line above. **A bare `CLAUDE.md` resolves to the root file**, not the
    tool's, which is how `dl-34`'s finding D pointed at a blank line.
12. **Some citations were wrong the day they were written, and look merely stale.**
    `dl-19` cited a blank line one above its test; `dl-32`'s not-found pointer was
    a route registration at its own merge commit; `dl-37`'s yt-dlp range covered a
    different test at its own merge commit. Compare against the record's commit
    before assuming drift, and repoint by the claim, not by the offset.
13. **When a test file is rewritten, the probe needs one more column: the test
    that enclosed the citation at birth, and where that name is now.** Birth text
    alone found nothing for `dl-18` and `dl-15`, whose `job-card.test.tsx` gained
    over 200 lines and several duplicated assertion lines. With the enclosing name,
    49 of `dl-15`'s 57 references repointed in one pass. The brief expected
    `dl-15` to be the hard record; it was the most uniform one.
14. **Two tests can end in byte-identical assertions, and then no single-line
    anchor is distinct.** `dl-35` cited both. Cite the tests by name instead and
    keep the row's wording, or — where one line must be named — let the anchor run
    across the line break into the next statement, which the checker's whitespace
    join allows (`dl-46`).
15. **An external source is a declaration, not a pin.** `dl-35` cites zod's own
    files under `node_modules`, which no commit of this repository ever held;
    repo-35's rule keeps the declaration for exactly that.
16. **Deleting `GRANDFATHERED` lines moves citations into the list.** `repo-37`'s
    enforced gate record cites the planner entries by line, so repo-39's
    deletions turned the gate red until it was repointed. Every slice that edits
    the list re-runs the gate and repoints `repo-37` in the same commit.

### The probe, again

Rebuild it in the scratchpad from `citations.mjs`'s exports, as repo-39 describes,
and add note 13's enclosing-test column. repo-39's version also took line-scoped
substitutions for repoints outside `## Review`, refusing any pattern that did not
occur exactly once on its named line, because the owner's answer below requires
touching Logs and a whole-file replace would edit a dated sentence as readily as a
stale one.

### Carried decisions, both answered

- **Widen `SCOPE.section`, or repoint Log prose by hand?** Answered 2026-09-12:
  **not yet — repoint what you touch.** At `64edce2`, `gate()` with
  `section: null` and an empty grandfather map reported 128 records in scope, 87
  failing and 2,068 failing references (repo 1,008 · downloader 904 · planner
  156), against 75 / 45 / 614 at `section: "Review"`. repo-39's record of the
  question and its answer is in that ticket's Build. Widening stays repo-29's
  option C destination. Every slice repoints stale coordinates outside `## Review`
  in each record it touches, and leaves a coordinate its record dates as written.
- **`pl-20`'s unescaped pipe** was folded in by repo-39. A sweep of all 128 work
  records for a table row whose code span carries an unescaped `|` returned 0
  hits afterwards, so nothing is carried.

## Done when

1. `node scripts/citations-gate.mjs` exits 0 with an empty `GRANDFATHERED`, or
   the list holds only entries whose Log says why they cannot be repaired.
2. No citation is anchored on a fragment that occurs more than once in its
   target.
3. Every citation the work repointed or pinned still supports the claim the
   record makes about it, and anything that could not be given a distinctive
   anchor is listed in that record's Log.
4. `npm run check` and `node scripts/status.mjs --json` exit 0.

## Review

**Gate: PASS** — 2026-09-13 · `4b9ce2f...7725487` · defect hunt run directly by the reviewer (ticket-reviewer subagent, no `code-review` dispatch available), medium depth, plus full mechanical extraction and manual re-verification of every citation this branch touched

| Done when                                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `node scripts/citations-gate.mjs` exits 0 with an empty `GRANDFATHERED`, or the list holds only entries whose Log says why they cannot be repaired | **verified** — reran at `7725487`: `70 enforced, 0 failing; 7 grandfathered, holding 2 unresolvable, 21 unanchored`, exit 0, matching the Log exactly; each of the 7 `GRANDFATHERED` records' own Log entry names its held references and the reason (`docs/work/repo-18-citations-resolve-is-not-correct.md` "Three cannot be repaired", `docs/work/repo-22-grep-is-a-wrapper.md` "Two cannot be repaired", `docs/work/repo-25-citations-checker-misses-shorthand-references.md:573` "Two cannot be repaired", `docs/work/repo-36-citations-loses-the-record-path.md:433` "Eight cannot be repaired", `tools/downloader/docs/work/dl-33-tls-fixture-certificates-fail-under-contention.md:636` "Three cannot be repaired", `tools/planner/docs/work/pl-28-valhalla-adapter.md:781` "Three cannot be repaired", `tools/planner/docs/work/pl-32-vite-config-test.md:413` "Two cannot be repaired")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2. No citation is anchored on a fragment that occurs more than once in its target                                                                     | **Met for everything this branch wrote; not universally true of the 39 touched files.** Two pre-existing indistinct anchors sit outside `## Review`, in files this branch touched but did not write those specific lines — one in this ticket's sibling `repo-16-suppression-does-not-dismiss.md` naming a `repo-13` line whose anchor starts on 3 lines, one in `repo-21-the-orchestration-skill-outgrew-its-loop.md` naming a `ticket-reviewer.md` line whose anchor starts on 2 lines — both byte-identical at `4b9ce2f`, confirmed by reading that commit's copy directly. Every anchor this branch actually added or repointed, in or out of `## Review`, is distinct: a whole-file (no `--section`) distinct-anchor sweep over all 443 citations this branch touched found only those 2 pre-existing ones, and both predate this branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3. Every citation the work repointed or pinned still supports the claim the record makes about it                                                     | **Fully enumerated, not sampled.** Mechanical extraction using `citations.mjs`'s own `extractCitations`, filtered to every line this branch's diff added, found **443 citation occurrences this branch touched**: 409 inside `## Review` (123 pin, 286 non-pin) and 34 outside it (30 naming a file, 4 prose). Every one was resolved with `citations.mjs`'s own `checkCitations`/`makeTrees`/`makeResolver` against the rev or tree it claims, and the resolved content was read against the citing sentence by hand, all 443. **Zero semantic mismatches** — no case of a different test, replacement code where the sentence describes the old code, or a comment cited as an assertion. Two items are worth naming as correct-but-subtle rather than as defects. First, dl-44's fix-round narrative anchors a join-across-lines case exactly the way `citations.mjs`'s own line-join is documented to require, verified by calling `checkCitations` directly rather than trusting the CLI's summary. Second, dl-41's Log deliberately quotes a stale, pre-branch citation of its own record's history to illustrate the defect it fixed, and that quoted coordinate no longer describing today's code is the sentence's own point, not a hidden defect. **One count discrepancy against the ticket's own claim**: mechanical extraction found 26 distinct non-prose citation targets changed outside `## Review`, not the 25 the ticket's Log states; every one of the 26 was read and is correct, so this is a headcount mismatch in the Log's own tally, not a citation defect |
| 4. `npm run check` and `node scripts/status.mjs --json` exit 0                                                                                        | **verified** — both reran at `7725487`, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

- **Positive control, run before trusting the green gate.** On a scratch copy: (a) lowered `repo-18`'s `GRANDFATHERED` entry from 3 to 2 — gate went `WORSE`, exit 1; (b) on a scratch copy of `docs/work/repo-1-generated-status-tables.md`, shifted one pin's line number by one — gate reported a `moved` citation, exit 1. Both restored. The harness can fail.
- **Pin reachability, enumerated in full.** 28 distinct revs extracted from every pin the diff adds; all 28 pass `git merge-base --is-ancestor <rev> origin/main`. 114 literal `@rev:` occurrences plus 9 shorthand continuations that inherit one of those 28 revs, matching the mechanical extraction's 123 pinned citations.
- **Second prohibition (nothing inside a quoted reproduction touched).** Extracted every fenced code block from base and head trees for all 23 touched records that contain one: byte-identical, zero differences. Blockquote lines checked the same way; the only 2 files with non-anchor differences were bare shorthands gaining anchor text — legitimate repoints, not edits to the reproduction's substance.
- **Note 8 (gaming by demotion), checked against the base tree rather than trusted.** Every self-citation demoted to prose (repo-13, repo-16 rows 1 and 6, repo-18, repo-19, repo-31's 3) confirmed genuinely self-referential in the base tree. repo-16's and pl-32's "record-line" demotions confirmed pointing at the record's own prose. pl-32's three `tools/planner/Dockerfile` coordinates confirmed unmatchable by `citations.mjs`'s `INLINE` regex (`scripts/citations.mjs:220-226` "const INLINE = new RegExp(" requires a slash-qualified `.\w+` path or a fixed extension list; `Dockerfile` matches neither) — a real grammar gap, not a gamed exclusion.
- **dropped** · none.
- **findings** · defect hunt (mechanical checker plus manual re-reading of all 443 citations this branch touched against actual file content) returned 0 mismatches; 1 headcount discrepancy (25 vs 26 outside-Review repoints) and 2 pre-existing indistinct anchors outside this branch's own writing, both noted above rather than carried as defects.
- NFR: security n/a · performance n/a (two extra short-lived `git` calls per gate run, unchanged) · reliability ✓ — positive control confirms the gate can fail · maintainability ✓ — `GRANDFATHERED` down from 37 entries/367 references to 7 entries/23 references, each with a named, individually-verified reason.

## Log

- **2026-09-12** — Filed by repo-39's downloader-slice builder as that slice's
  remainder. The id was assigned by the orchestrator (`node scripts/next-id.mjs repo`
  printed `next free: repo-44` at `64edce2`, and the same command in this
  worktree printed the same). Every figure above is this branch's own measurement.
  **Re-measure before starting**, and after repo-35 merges in particular.
- **2026-09-13** — `depends_on` set to `[repo-35]`. Filed with `[]` so the
  `repo-*` and planner slices would stay dispatchable, with the dependency stated
  in prose; the builder's report put `[repo-35]` to the orchestrator as the
  alternative. **The owner answered `[repo-35]`.** Relayed by the orchestrator
  through repo-39's reviewer in its ship-authority text, and confirmed by the
  orchestrator's own message to the builder on 2026-09-13. Effect: `npm run status`
  will not report this ticket startable until repo-35 is `done`, which matches the
  Build's instruction to re-measure after repo-35 merges. Build's finding-1
  sentence on pushed-ref reachability added the same day, from repo-39's gate.

- **2026-09-13 — the whole ticket, one branch: 367 failing references down to 23, and those 23 grandfathered on the owner's decision.** Built on `repo-44-review-corpus` from `origin/main` at `4b9ce2f`, dispatched as `opus` (`difficulty: hard`). The owner chose the whole ticket in one branch over the recommended downloader-only slice. Measured in this worktree, exit codes read from a redirect rather than through a pipe.

  | Measured by                                                | at `4b9ce2f`                                          | at this branch                                      |
  | ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
  | `node scripts/citations-gate.mjs`                          | 40 enforced, 0 failing; 37 grandfathered, holding 367 | 70 enforced, 0 failing; 7 grandfathered, holding 23 |
  | `gate()` with an empty grandfather map: `docs/work/repo-*` | 22 records, 231                                       | 4 records, 15                                       |
  | the same: planner `pl-25`, `pl-28`, `pl-32`                | 3 records, 83                                         | 2 records, 5                                        |
  | the same: `dl-44`                                          | 1 record, 4                                           | 0                                                   |
  | the same: repo-39's pin-wait class                         | 11 records, 49                                        | 1 record, 3                                         |

  Both gate runs exit 0; the empty-map call reported 0 mismatches against the constant each time.

  **`GRANDFATHERED` now holds seven entries**, written from measurement by the same call: `repo-18` 3, `repo-22` 2, `repo-25` 2, `repo-36` 8, `dl-33` 3, `pl-28` 3, `pl-32` 2. Every one is a reference that cannot take an anchor without editing what it quotes, and none has a reachable commit a pin would verify: quoted runner, stack or alert output; a coordinate that is the defect a finding records (a blank line, the junk an old checker called `ok`); the old side of a correction transcript, true only of a squashed commit; and line numbers that quote a shape and name no file. They were put to the owner as three options — leave them grandfathered with each Log naming them, add a checker ticket, or rewrite them as prose — and **the owner chose to leave them grandfathered**, the recommendation. Each record's own Log entry names its references and the reason. No checker ticket.

  **114 pins written, across 28 revs.** For each rev, `git merge-base --is-ancestor <rev> origin/main` exits 0, and seven remote branches contain it. Every rev is either the merge that carried its record or `main` just before that merge, never a branch sha: every reviewed sha this needed had been squashed away.

  **Outside `## Review`**, under the owner's standing answer, 294 file citations in the 26 records repo-39 had not touched were classified by blaming each citing line to the commit that wrote it and comparing the cited text there with today: 77 unchanged, 137 moved, 14 ambiguous, 27 gone, 39 unresolvable. Read one by one, most of the moved ones are dated as written, and the present-tense pointers among them were repointed and each checked to verify distinctly: 28 citation occurrences at 24 distinct targets, which includes `repo-37`'s pointer (note 16). That figure is corrected after the gate from the 25 this entry first gave, which counted substitution rows rather than citations; see the post-gate entry below for the command. The coordinator was told the scale beforehand and judged it proportionate.

  **What the brief had wrong.**

  - It expected repo-35 to move the per-bucket counts on `repo-21`, `repo-25` and `dl-44`. It did not: 231, 83, 4 and 49 reproduced exactly at `4b9ce2f`.
  - It said one of `dl-33`'s references cannot take an anchor even with a pin. There are three. Besides the Vitest output the owner answered for, the stack frame at `egress-proxy.ts` line 624, column 23 is quoted with its column twice. `INLINE` in `scripts/citations.mjs` takes `ANCHOR` straight after the line number or range, and `ANCHOR` allows only an optional backtick and one space before its quote, so a coordinate carrying a column cannot take an anchor without the column being deleted. The owner's answer covers all three.
  - It framed the unrepairable references as the pin-wait class. 20 of the 23 are in `repo-18`, `repo-22`, `repo-25`, `repo-36`, `pl-28` and `pl-32`, and 46 of the pin-wait class's 49 did take pins.
  - Its rule for a pin's rev — the reviewed sha where reachable, otherwise the merge — has a gap. Where the claim describes code the branch itself replaced, the merge holds the replacement, and the right rev is `main` just before the merge. That was the rev six times: `repo-1`'s live skill contradiction, `repo-2`'s removed field, `repo-4`'s pre-fix `CLAUDE.md`, `dl-33`'s two `egress-proxy.ts` coordinates and `dl-36`'s off-by-one range.

  **Method, added to notes 1–16.**

  17. **`oxfmt` rewrites text inside an anchor.** A fragment cut in the middle of a code span leaves the line with an odd number of backticks, and the formatter then reflows every code span on the line; `*word*` becomes `_word_`. Both turned `repo-20` red after formatting. Anchor on whole code spans only, with no single-asterisk emphasis, and re-run the gate after `npm run format`.
  18. **The tree a gate record's numbers describe is often neither its header sha nor its merge.** `repo-12`'s gate-1 coordinates were written by the round that answered gate 1 and are exact at the merge, not at gate 1's sha; `pl-28`'s test coordinates are exact at one branch commit and its source coordinates at a later one. Find the tree per citation before repointing by content. Blaming the citing line narrows it.
  19. **A correction transcript's new side can take a pin; its old side usually cannot.** The old side is true only of the commit before the correction, which a squash merge discards.
  20. **A path with no extension is invisible to the checker.** The file grammar needs one, so a coordinate correctly qualified to `tools/planner/Dockerfile` is not counted at all. The owner accepted that for `pl-32`'s three with a Log note, and no ticket.
  21. **A proposal tool that re-reads every citation on a line also re-proposes the ones that already verify**, and content matching against the wrong tree proposes confident wrong lines. Every proposal here was read against its claim before it was applied, and a later verifier rebuilt each record from `HEAD` plus the substitutions to prove `oxfmt` changed nothing but table padding.

  **`Done when`, per line.**

  1. **Met, in its second form.** `node scripts/citations-gate.mjs` exits 0, and `GRANDFATHERED` holds seven entries, each of whose records has a Log entry saying which references cannot be repaired and why.
  2. **Met for the gate's scope, and for every citation this branch wrote outside it.** The gate enforces `--require-distinct-anchors` on all 70 enforced records with 0 failing; each of the 28 citations repointed outside `## Review` was checked for a distinct anchor after formatting. Anchors outside `## Review` that this branch did not write were not audited.
  3. **Met, as this branch's claim for a gate to check.** Every repointed or pinned citation was read against the claim beside it at the tree the record describes; every reference left unrepaired is named in its record's Log.
  4. **Met.** `npm run check` exit 0; `node scripts/status.mjs --json` exit 0.

  `status` stays `ready` until a gate record lands on this ticket. Also touched: `repo-37`, whose Why cited `const FAILING` by a line the list edit moved (note 16), repointed alongside.

- **2026-09-13, after the gate — two pre-existing indistinct anchors repaired, and the outside-`## Review` count corrected.** Both were raised in the gate exchange: the builder's whole-file sweep contradicted the reviewer's first "zero indistinct anywhere", and the reviewer's recount disagreed with this Log's 25. The gate record above describes `7725487` and is committed as the reviewer sent it.

  **Done-when 2 has no section scope, and this branch touched both records.** Measured with `node scripts/citations.mjs <record> --require-distinct-anchors`, no `--section`, exit code read from a redirect:

  | Record    | before                                                        | after                              |
  | --------- | ------------------------------------------------------------- | ---------------------------------- |
  | `repo-16` | `exit 16 — 1 anchor(s) not distinct`                          | `exit 0 — nothing to fix`          |
  | `repo-21` | `exit 19 — 1 unresolvable, 1 moved, 1 anchor(s) not distinct` | `exit 3 — 1 unresolvable, 1 moved` |

  `repo-16`'s citation of `repo-13`'s withdrawn row anchored on "correctly left **deferred**", which starts on three lines of `repo-13`; it now runs on to "— `gh api` denied", which only that row carries. `repo-21`'s citation of `ticket-reviewer.md`'s model line anchored on "model: sonnet", which starts on two lines; it now runs across the line break into "isolation: worktree" (note 14). Both anchors were byte-identical at `4b9ce2f`, outside `## Review`, and not written by this branch.

  `repo-21`'s remaining exit 3 is two citations that predate this branch and fail on purpose: a quoted `MOVED` line printed for a deliberately wrong citation, and a placeholder coordinate used as an illustration of what a verdict should name. Neither is an anchor question.

  **The count.** This Log said 25 citations were repointed outside `## Review`; the reviewer counted 26 distinct targets. A script that takes every citation outside `## Review` on a line `git diff -U0 4b9ce2f...HEAD` adds, using `citations.mjs`'s own `extractCitations`, and keeps those whose location token does not occur in the record's `4b9ce2f` copy, prints `repointed outside ## Review: 28 citation occurrence(s), 24 distinct target(s)`. The 25 counted substitution rows, one of which carries three citations, and left out `repo-37`'s pointer. The reviewer's 26 also counted two table rows in `repo-1` that only the formatter touched. The figure above is corrected to 28 and 24.
