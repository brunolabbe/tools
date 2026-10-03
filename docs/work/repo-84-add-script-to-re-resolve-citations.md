---
id: repo-84
tool: repo
title: Add a re-resolve-citations utility script under scripts/ (decided 2026-09-30, build after repo-47)
kind: work-package
status: done
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

## Review

### Gate 1

Re-issued with gate 2: unpinned coordinates re-resolved against `fcb3be0`, where the sentence below names `9ed966d` as the tree this gate read; the two F1 test calls and the F2 script line are prose naming `9ed966d`, because gate 2 corrected the first and deleted the second.

**Gate: FAIL** — 2026-10-03 · `ebb808b...9ed966d` (base `ebb808b`, head `9ed966d`; `origin/main` still at `ebb808b` after the fetch) · code-review at medium

The ticket has no `## Done when` (F3). Acceptance was derived from the 2026-09-30 decision and the option it chose, not from the superseded option list; the sentences treated as acceptance are quoted in the first column. Unpinned coordinates resolve against `9ed966d`.

| Acceptance (from the decision)                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "option 1, a script under `scripts/`" … "a permanent utility for gates and builders to use"       | **verified** — run on all 16 merged records that `citations-gate.mjs --against ebb808b` reports with moved citations (45 moved): 128 holds, 44 repoint, 1 gone. All 44 repoints and the 1 gone re-found by `grep -n -F` of the anchor in the cited file: 45 of 45 agree                                                                                                                                                                                                                                                                                                                                            |
| "one small script plus a test"                                                                    | **proven** — `npx vitest run scripts/test/re-resolve-citations.test.ts` 18 of 18, registered in `scripts/test/tsconfig.json`. Positive control: an off-by-one in the repoint suggestion turns 4 of 18 red. The suite itself breaks the no-shell scan, F1                                                                                                                                                                                                                                                                                                                                                           |
| "re-resolve every unpinned citation by anchor"                                                    | **proven** — repoint `scripts/test/re-resolve-citations.test.ts:111 "expect(single).toMatchObject"`, ambiguous `scripts/test/re-resolve-citations.test.ts:120 "hits: [7, 8]"`, a file shortened below the range `scripts/test/re-resolve-citations.test.ts:136 "short.ts:3"`, pin `scripts/test/re-resolve-citations.test.ts:146 "expect(holdsAtTip).toMatchObject"`, pin of text the tip deleted `scripts/test/re-resolve-citations.test.ts:155 "expect(deleted).toMatchObject"`, introduced content not pinned `scripts/test/re-resolve-citations.test.ts:159-161 "content the branch introduced is left alone"` |
| "written against the new meaning" of moved after repo-47; "the builder re-measures after repo-47" | **verified** — the premise is false and the Log says so correctly: repo-47 (`9fadda7`) did not touch `scripts/citations.mjs`, where `moved` is computed; it changed which records `citations-gate.mjs` fails on. The script takes one record and carries no gate-scope logic, which is right                                                                                                                                                                                                                                                                                                                       |
| "a gate calls it instead of rebuilding it"                                                        | **verified** — one sentence in `.claude/skills/orchestrate-tickets/roles/reviewer.md`, under "When you are woken to re-gate", in the "Woken only to re-issue" bullet; accurate apart from F2 and F5                                                                                                                                                                                                                                                                                                                                                                                                                |

- **high** · F1 · The new suite fails the no-shell scan. `packages/core/test/spawn-safety.test.ts@ebb808b:88 "callsWithoutShellFalse(source.text)"` reads `scripts/test/` since repo-75 and requires `shell: false` at each call; the two calls at lines 54 and 248 of `scripts/test/re-resolve-citations.test.ts` at `9ed966d` carry none. At the head `npx vitest run packages/core/test/spawn-safety.test.ts` is 1 failed of 18, naming exactly those two calls; at the base `ebb808b` it is 18 of 18. CI runs `npm test` over every project, so the unit matrix goes red on the pull request. `preflight.mjs` exits 0 on this head because it runs only `--project repo` for a `scripts/` diff (the dropped line below). Remedy: `shell: false` in `TEXT`, which the scan accepts through a named literal (`packages/core/test/spawn-safety.test.ts@ebb808b:117 "through a named literal or a spread of one"`).
- **med** · F2 · `pin` guesses when the anchor starts on several lines of the base. Line 201 of `scripts/re-resolve-citations.mjs` at `9ed966d`, `baseResult.foundAt?.[0]`, takes the first base occurrence with no ambiguity check, where the tip path refuses to choose. Reproduced in a scratch repository: the base has `const DUPX` on lines 2 and 5, the tip has it once, on line 7; a citation of line 7 anchored on `const DUPX`, run with `--base`, prints `PIN` to base line 2 and `At the tip: holds`, and nothing says line 5 exists. The pin it suggests is then refused by the dry run (`checkCitations` with `isIndistinct` on that pin: verified, occurrences 2, indistinct true), so it costs a round rather than landing, but the output reads as unique. No test reaches it: mutating `[0]` to `.at(-1)` leaves 18 of 18 green. Remedy: when the base hits number more than one, report `ambiguous` with the base lines rather than `pin`.
- **low** · F3 · On the ticket, not the build: it has no `## Done when`, which `docs/01-TICKETS.md@ebb808b:83 "Acceptance, in terms someone else can check"` asks for; acceptance had to be derived from the Decision paragraph.
- **low** · F4 · Two findings, one mechanism: `exit 0 — nothing to change` is narrower than what CI enforces, because the script applies neither the distinct-anchor nor the `.claude` pin rule. In the scratch repository, a holding anchor that starts on two lines, and an unpinned citation of a `.claude/` page that holds, both print `ok`; `checkCitations` with `requireClaudePins` and `isIndistinct` calls them indistinct and unpinned-volatile. A repoint into `.claude/` content the branch introduced suggests a bare line, which CI refuses. The reviewer.md sentence claims no CI parity, so this misleads only a reader who takes exit 0 as clean.
- **low** · F5 · The reviewer.md sentence says the script "turns that list into the repair" but not that a `repoint` is coordinate-only: it reads the tip, not the commit the section gated, and cannot tell a moved claim from a corrected one, which `.claude/skills/orchestrate-tickets/reference/records.md@ebb808b:370 "a repaired citation in a merged record is checked against the"` and the next sentence of the same bullet leave to the reader. It also lists `gone`/`ambiguous` as for a human and omits `unresolvable`. Nothing else on that page or in records.md is contradicted: the pin test (the anchor is in the file at `--base`) is a narrower form of the base-pin rule and consistent with the `git log origin/main -S` pin-or-declare test.
- **low** · F6 · On the ticket: the Decision paragraph of the brief still asserts two premises the Log corrects, both checked here. repo-47 changed which records fail, not what `moved` means (`git show --stat 9fadda7 -- scripts/citations.mjs` prints nothing), and `roles/reviewer.md` held a recipe at the base, not script semantics (`.claude/skills/orchestrate-tickets/roles/reviewer.md@ebb808b:198 "The recipe is to"`). The Log is right; the brief above it is stale.
- **dropped** · Out of the reviewed range: `scripts/preflight.mjs@ebb808b:252 "if (scriptsTouched(diffPaths))"` runs only `--project repo` for a `scripts/` diff, while the `core` spawn-safety scan reads `scripts/`, which is why preflight passed this head with F1 present. Present at the base; for the orchestrator to file.
- **findings** · code-review at medium returned 7; 6 carried, 1 dropped.
- **Pin, checked a second way.** The record of repo-60 run with `--base fe28fed`, its own pre-merge base: 3 pin, 6 repoint. `git show fe28fed:<file>` with `grep -n -F` agrees on all 9: the 3 pinned anchors are at the suggested lines 424, 103 and 33 at the base, and the 6 repointed ones are absent there; `git log origin/main -S` on `const inQuotation` returns only `179f6f5`, the merge of repo-60 itself. That is the planted case, anchor absent at the base and present in the working tree, and none of the 6 is pinned.
- **Edge cases**, in the scratch repository: regex metacharacters and an anchor padded with spaces repoint correctly; a range `2-3` holds, and a repoint keeps the width; an anchor spanning two lines repoints to its first line; a deleted file is `unresolvable`, or `pin` with `--base`; an anchor with backticks is `gone`; a Windows-style path is read by `citations.mjs` as its basename and comes back `unresolvable`, and the script builds no OS paths. Mutations the Log claims, reproduced: tip range not widened 1 failed, pin disabled 3, ambiguous disabled 1, each matching the Log.
- **Invariants:** no shell — F1. `npm run check` exit 0. `node scripts/preflight.mjs --base origin/main --title "feat(repo): re-resolve a record's unpinned citations by anchor (repo-84)"` exit 0, `type and paths agree`. `feat` with only `scripts/`, `.claude/` and `docs/` paths releases nothing: the release-please packages are only `tools/*`. Precedent for a new repo script is `chore(repo)` (repo-80, #320); either type is acceptable. Cross-tool imports, `AppError`, redaction, SSRF, progress, contracts and Dockerfiles are untouched by the diff and skipped.
- NFR: security — F1 · performance n/a · reliability — F2 · maintainability — F4, F5.
- **Not verified:** the other four mutations the Log claims; the claim that four gate rounds of repo-80 rebuilt the script (no transcript); the 128 `holds` verdicts by a second method.

### Gate 2

**Gate: PASS** — 2026-10-03 · `9ed966d..fcb3be0` (`origin/main` still at `ebb808b`) · re-gate of the gate 1 findings and the lines this round touched, code-review at medium

The ticket now carries a `## Done when`; the table traces its five lines. Unpinned coordinates resolve against `fcb3be0`. The `scripts/preflight.mjs` change this round carries is gated in the repo-90 record, not here.

| Done when                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The script exists under `scripts/`, re-resolves each unpinned anchored citation over the whole file, and prints one verdict per citation | **proven** — the gate 1 table, third row, as re-issued, plus gone `scripts/test/re-resolve-citations.test.ts:123 "an anchor that is nowhere in the file is gone"`, unresolvable `scripts/test/re-resolve-citations.test.ts:128 "a file that does not exist is unresolvable"` and the base-side ambiguous `scripts/test/re-resolve-citations.test.ts:287 "starts on 2 lines there (2, 5)"` |
| It edits nothing, counts the references it leaves out, and exits 0, 1 or 2                                                               | **proven** — counts `scripts/test/re-resolve-citations.test.ts:186 "expect(skipped).toEqual"`, exit 1 `scripts/test/re-resolve-citations.test.ts:261 "expect(wants.status).toBe(1)"`, exit 2 `scripts/test/re-resolve-citations.test.ts:274 "expect(badRef.status).toBe(2)"`; edits nothing **verified**: `git status --porcelain` empty after every run in both gates                    |
| On a real record its output agrees with a second method                                                                                  | **verified** — re-run at `fcb3be0` over the same 16 records: 44 of 44 repoints and 1 of 1 gone agree with `grep -n -F`; the repo-60 record with `--base fe28fed` is unchanged, 3 pin and 6 repoint                                                                                                                                                                                        |
| The suite fails when each branch is removed                                                                                              | **verified** — the new base-side branch disabled: 1 failed of 21, the test at line 287 above; gate 1 reproduced three of the earlier mutations. That `[0]` alone is now an equivalent mutant is checked by reading `scripts/re-resolve-citations.mjs:207 "baseHits.length === 1 ? baseHits[0] : null"`, not run                                                                           |
| `npm run check`, the `repo` and `core` projects pass, and preflight exits 0                                                              | **verified** — `npm run check` exit 0; preflight at `fcb3be0` exit 0, `ok` for check, `--project repo` and `--project core`; spawn-safety 18 of 18                                                                                                                                                                                                                                        |

- **F1 fixed** · `scripts/test/re-resolve-citations.test.ts:19 "shell: false"`; `npx vitest run packages/core/test/spawn-safety.test.ts` 18 of 18 at `fcb3be0`, against 1 failed of 18 at `9ed966d` in gate 1.
- **F2 fixed**, option (a) · `scripts/re-resolve-citations.mjs:224 "if (baseHits.length > 1)"` returns `ambiguous` before any pin. The gate 1 scratch fixture, re-run, now prints `AMBIGUOUS` with the detail `starts on 2 lines there (2, 5)` and `At the tip: holds`.
- **F3 fixed**, with a new low, G2-1.
- **F4 taken as documentation**, as the Log says · `scripts/re-resolve-citations.mjs:48 "Exit 0 is narrower"`, `scripts/re-resolve-citations.mjs:352 "not checked here: distinct anchors, .claude pins"`, and the hint `scripts/test/re-resolve-citations.test.ts:296 "never a bare line"`. The gate 1 fixtures, a twice-anchored holding citation and an unpinned `.claude/` one, still print `ok`, now with the caveat. A new low, G2-2.
- **F5 fixed** · the sentence in `.claude/skills/orchestrate-tickets/roles/reviewer.md`, under "When you are woken to re-gate", in the "Woken only to re-issue" bullet, now calls the output a proposed repair of coordinates only, read from the working tree and not the gated commit (true: `scripts/re-resolve-citations.mjs:194 "checkWhole(candidates, repo, null)"`), and lists `unresolvable`. Its "(above)" resolves to the 2026-10-01 paragraph under "Returning the gate", which does come first. The `--require-distinct-anchors` and `--require-claude-pins` clause is accurate as far as it goes; see G2-2.
- **F6 fixed** · the Decision paragraph of the brief now carries the correction in place.
- **Dropped preflight line, fixed** in this branch as repo-90, on the owner decision; gated in that record.
- **low** · G2-1 · The new `## Done when` opens "Derived from the Decision", but only its first clause comes from there (a script under `scripts/` that re-resolves unpinned citations by anchor). The verdict list, the exit codes "as its docblock says", the second-method run and the mutation runs are the build and its Log written back as acceptance. The one Decision clause that is a deliverable outside the script, "a gate calls it instead of rebuilding it", met by the reviewer.md pointer, has no line. Every line is true at `fcb3be0`, so nothing ships wrong; a later reader would take the verdict set for the owner decision.
- **low** · G2-2 · The exit-0 caveat covers two of the four things CI fails and this script does not. A scratch record holding one unanchored citation, one malformed pin and one holding anchored citation prints `not re-resolved: 0 pinned, 1 malformed pin, 1 unanchored` and then `exit 0 — every re-resolved citation holds (not checked here: distinct anchors, .claude pins)`; CI fails both under `--require-anchors` and as `malformed-pin`. The counts are printed, so it is disclosed, but the reviewer.md sentence then says to run `citations.mjs` with "them", the two flags, after a recipe in the same bullet that runs it with none, so a reader following it omits `--require-anchors`.
- **findings** · code-review at medium over the repo-84 lines of `9ed966d..fcb3be0` returned 2; 2 carried, 0 dropped. The `scripts/preflight.mjs` lines are counted in the repo-90 record.
- NFR: security ✓ (F1) · performance n/a · reliability ✓ (F2) · maintainability — G2-1, G2-2.
- **Not verified:** the four earlier mutations the Log claims and gate 1 did not reproduce; the `[0]` equivalent-mutant claim by a run.

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
