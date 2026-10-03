---
id: repo-84
tool: repo
title: Add a re-resolve-citations utility script under scripts/ (decided 2026-09-30, build after repo-47)
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# Add a re-resolve-citations utility script (repo-84)

## Brief

During the 2026-09-29 batch, a reviewer built the same "re-resolve every unpinned citation by anchor" script in each of four separate gate rounds to find citations that had moved in the branch but were not pinned. This suggests the operation is common enough and valuable enough to make available as a reusable script.

## Decision — answered 2026-09-30: option 1, a script under `scripts/`, built later

**Asked of the owner** by the orchestrator via `AskUserQuestion` on 2026-09-30,
with four options: build it now; **build it later** (option 1 below, chosen);
document it only (option 2); leave it ad hoc (option 3). **Answered by the
owner: option 1, built later, after repo-47.** The reason as filed: repo-47 changed what
"moved" means to the gate, so the script is written against the new meaning.
The script's semantics are documented in `roles/reviewer.md` meanwhile.
**Both premises were wrong, and the Log's 2026-10-03 entry says so** (gate 1, F6):
repo-47 changed which records fail, not what `moved` is, and that page held a
recipe, not script semantics. Nothing
is built; `status` is `ready`, and the builder re-measures after repo-47.

## Build (decided: option 1, built later — the step below is the options as filed, superseded)

Decide where to place a `re-resolve-citations.mjs` script. Options, costed
roughly, recommended one first (the filer's recommendation, not a decision
made here):

1. **Add it under `scripts/` as a permanent utility for gates and builders to
   use (recommended).** Cost: one small script plus a test, roughly the size
   of `repo-75`'s single-file addition to `scripts/` — a small builder round,
   once. After that the recurring cost is zero: a gate calls it instead of
   rebuilding it. Recommended because the alternative's recurring cost is
   already measured, not projected: four rebuilds in one round.
2. **Document it in the skill and build it when builders or gates need to
   re-resolve unpinned citations.** Cost: a paragraph in `records.md` or
   `roles/reviewer.md`, no new file — cheaper upfront than option 1, but it
   does not stop the rebuild. The next gate that needs it still writes it
   from the description, in its own worktree, each time.
3. **Leave it ad-hoc and built by hand in scratch directories when needed,
   avoiding the code path.** Cost: nothing upfront, and this is the status
   quo already measured this batch — the same script rebuilt four times
   across gate rounds 2 through 5 of `repo-80`'s branch.

## Why

The script was rebuilt four times by the same gate round over successive fix rounds, suggesting it would have been more efficient to have a stable, documented version available. Evidence: the four recreations across gate rounds 2-5 of repo-80's branch.

## Done when

Derived from the Decision, since the brief carried none (gate 1, F3). Each line
is checked by a test in `scripts/test/re-resolve-citations.test.ts` unless it
names a command.

- `node scripts/re-resolve-citations.mjs <record> [--section <name>] [--base <ref>]`
  exists under `scripts/`, re-resolves each unpinned anchored citation over the
  whole file, and prints one verdict per citation: `holds`, `repoint`,
  `ambiguous`, `gone`, `unresolvable`, and with `--base` `pin`.
- It edits nothing, counts the references it leaves out, and exits 0, 1 or 2 as
  its docblock says.
- On a real record in this repo its output agrees with a second method (see the
  Log).
- The suite fails when each branch of it is removed (the Log's mutation runs).
- `npm run check` and the `repo` and `core` projects pass, and preflight exits 0.

## Log

- 2026-09-30 — **Decided via AskUserQuestion:** option 1, add it under `scripts/`
  as a permanent utility. The filer's recommendation was chosen. To be built
  after repo-47, since repo-47 changed what "moved" means to the gate. The
  script's semantics are documented in `roles/reviewer.md`.
- 2026-10-03 — **Built** `scripts/re-resolve-citations.mjs <record> [--section <name>] [--base <ref>]`,
  its suite `scripts/test/re-resolve-citations.test.ts`, one `include` line in
  `scripts/test/tsconfig.json`, and one sentence in `roles/reviewer.md`'s
  "Woken only to re-issue" bullet pointing at it. **What it does:** for every
  unpinned, anchored citation it searches the anchor over the _whole_ file in the
  working tree and prints one verdict — `holds`, `repoint` (the line it is now
  on, at the old width), `ambiguous`, `gone`, `unresolvable`, and with `--base`
  `pin` (the anchor is already in the file at the base, so cite the base line as
  `file@<sha7>:<line>`, which wins over every other verdict and says what the
  tip does). It edits nothing. Pinned, malformed-pin, anchorless, prose and
  declared-evidence references are counted on the summary line and set no exit
  bit. Exit 0 / 1 (something wants a change) / 2 (usage, or a ref that is not a
  commit).
- 2026-10-03 — **Why not `citations.mjs` alone:** it already reports `moved` with
  the line the anchor went to. It cannot say `pin`, which needs a second tree,
  and it reports a range the branch shortened the file below as `unresolvable`
  before looking at the anchor, so the line the text went to is never printed.
  The suite's `a range the branch shortened the file below is still found`
  case is that gap; mutation M1 below turns it red.
- 2026-10-03 — **The suite, and that it can fail:** `npx vitest run
scripts/test/re-resolve-citations.test.ts` is 18 of 18. Seven mutations of the
  script, each applied alone and restored (a `finally` rewrites the original, and
  the run printed `restored true`): tip range not widened, 1 failed; range width
  dropped from the suggestion, 1; `pin` branch disabled, 3; declared-evidence
  skip removed, 1; ambiguous branch disabled, 1; `--section` scope ignored, 1;
  base verdict forced to never verified, 3. None survived.
- 2026-10-03 — **Run once on a real record, checked by two other methods.**
  `node scripts/re-resolve-citations.mjs docs/work/repo-80-land-records-one-command.md --section Review`
  exited 1: `24 holds, 15 repoint, 0 pin, 0 ambiguous, 0 gone, 0 unresolvable —
of 39 re-resolved`, and `not re-resolved: 2 pinned, 0 malformed pin, 0
unanchored, 6 prose or file-less, 0 declared evidence`. (1) Against
  `node scripts/citations.mjs <same record> --section Review` (exit 2): 15
  `MOVED`, and a comparison script over both outputs keyed on record line, cited
  file and start line, and new line printed `only in re-resolve: []` and `only in
citations.mjs: []` — but both read `locateAnchor`, so this shows the report is
  faithful to the checker, not that the checker is right. (2) So four of the 15
  were re-found with no shared code, by `grep -n -F` of the anchor in
  `scripts/review-record.mjs`: `--untracked-files=no` at 1369, `dirtyStatus.trimEnd()`
  at 1388, `const baseAnchorLine = baseResult.foundAt` at 1130, `export function
runPreflightDefault(repo, base, title, spawn` at 1243 — each the line the script
  suggested. The `pin` verdict was checked the same way with `--base 2ffb72a`
  (1 pin, the one anchor that predates repo-80): `git show 2ffb72a:<repo-62
record> | grep -n -F "starts on two"` printed line 173, the suggested pin, and
  `git show 2ffb72a:scripts/review-record.mjs | grep -c -F baseAnchorLine` printed
  0, so that anchor, which repo-80 introduced, was rightly not a pin. The run's
  other 38 verdicts (23 holds, 15 repoint) were not checked against the base by a
  second method.
- 2026-10-03 — **What the brief had wrong or left open.** It says repo-47 changed
  what "moved" means to the gate and that the script is written against the new
  meaning. repo-47 changed _who is billed_ for a moved citation (only records the
  branch edits fail; the rest are reported), not what `moved` is, so the script
  has no gate-scope logic: it takes one record and answers for it. It also says
  the semantics are documented in `roles/reviewer.md`; what that page held was the
  recipe (splice, run `citations.mjs`, repoint the `MOVED` list), which is what
  this script now computes. So the verdict set above is the builder's reading of
  the four gate rounds described in the Why, not a transcription.
- 2026-10-03 — **Folded in, and not folded in.** Folded in: the pointer sentence
  in `roles/reviewer.md`, since a utility nobody is told about is rebuilt a fifth
  time. **Could have, did not:** make `unpinnedPreexistingCitations` in
  `scripts/review-record.mjs` call this script's base half, since the two widen the
  base range identically. That file was being edited by two other branches
  (repo-86, repo-89) and the dispatch forbade touching it, and the two answers
  differ (it returns the pin line inside a sentence, this returns it as a field),
  so the lift is a change of its own. **Could have, did not:** a `--write` mode
  that applies the unambiguous `repoint` verdicts to the record. Nothing
  specifies it, it would rewrite a gate's text where a round that _corrected_ a
  claim, not merely moved a line, wants a human, and a report is what the four
  rebuilt scripts were.
- 2026-10-03 — **Gate 1 round: F1 and F2 fixed, F3 to F6 taken.**
  - **F1 (high), fixed.** `TEXT` in the new suite now carries `shell: false`, which
    the spawn scan accepts through a named literal and through a spread of one.
    Before: `npx vitest run packages/core/test/spawn-safety.test.ts` was 1 failed of
    18, naming both calls in `scripts/test/re-resolve-citations.test.ts`. After: 18
    of 18. The cause one layer up is filed and fixed as repo-90.
  - **F2 (med), fixed with option (a).** When the anchor starts on more than one
    line at the base, the verdict is `ambiguous` and lists the base lines, with the
    tip's own state beside it, instead of a pin to the first. Why (a) and not (b),
    keep `pin` and warn: the tip side already refuses to choose among several, so
    one rule on both sides; and a pin to one of several lines is a pin
    `--require-distinct-anchors` refuses at the dry run, so `pin` stating one
    would be a suggestion known to fail. New test `with --base, an anchor on
several base lines is ambiguous, never a pin to the first`; removing the new
    branch turns it red (1 failed of 21). Mutating `[0]` alone survives and is an
    equivalent mutant now, since the ambiguous branch returns first.
  - **F3, taken.** The ticket now has a `## Done when`, derived from the Decision.
  - **F4, taken, as documentation and one hint.** The docblock, the final line of
    the output and the reviewer.md sentence now say the exit 0 applies neither
    `--require-distinct-anchors` nor `--require-claude-pins`, and a `repoint` into
    a `.claude/` page says a bare line is refused there. Applying the two rules
    inside the script was not done: it would copy `citations.mjs`'s own checks for
    a second report of the same verdict, and `citations.mjs` with the flags is the
    authority the page now names.
  - **F5, taken.** The reviewer.md sentence now says a `repoint` is a proposal read
    from the working tree, not the commit the section gated, and lists
    `unresolvable` among the verdicts for a human.
  - **F6, taken.** The Decision paragraph above carries the correction in place.
