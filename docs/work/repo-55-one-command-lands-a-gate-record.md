---
id: repo-55
tool: repo
title: One command splices a returned Review section into its ticket, checks it, and formats it
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-55 — One command splices a returned `## Review` section into its ticket, checks it, and formats it

## Why

The reviewer returns its section as text and the builder commits it: above
`## Log`, verbatim, anchored on the heading form and not the bare heading
text, then `citations.mjs --section Review --require-anchors
--require-distinct-anchors`, then `npm run format`, then a re-resolve because
the formatter can reflow a table, then a disclosure note. Each of those is a
line on `records.md` or `review-ticket`, and each has failed at least once:

- a record spliced into the middle of an earlier record, because the insertion
  anchored on a heading string that prose had quoted 500 lines above (the
  `repo-13` session, recorded in `records.md`);
- a section that failed the gate the moment it was committed, in three of four
  tickets in one batch (sixteenth session, item 1);
- a gate record that went uncommitted entirely, twice on one ticket, costing
  three rounds (twenty-third session, items 1 and 10);
- a formatter rewrap that split a citation's coordinate from its anchor
  (twenty-third session, item 5).

None of these is judgement. They are one procedure done by hand under a
different context every time.

## Build

Add `scripts/review-record.mjs <ticket> <section-file> [--gate <n>]` that:

1. refuses a section file whose first line is not `## Review` or `### Gate <n>`;
2. finds the insertion point by heading form — a `## Review` at line start
   with blank lines around it, or, when the ticket already has one and
   `--gate` is given, the end of the existing `## Review` block — and refuses
   if the ticket has `## Review` and no `--gate`, or `--gate` and no
   `## Review`;
3. inserts the text unchanged, runs `npx oxfmt` on the ticket, then runs
   `citations.mjs <ticket> --section Review --require-anchors
--require-distinct-anchors` and, on a non-zero exit, restores the ticket
   from `git show HEAD:<ticket>` and prints the checker's output;
4. on success, diffs the inserted block against the section file ignoring
   table padding and rule width, and prints the diff — empty means verbatim
   survived the formatter — as the disclosure the builder pastes into its Log.

Then `review-ticket` step 8 and `records.md` name the script in place of the
procedure.

## Done when

- A test splices a section into a ticket whose prose quotes the `## Review`
  heading above the real one, and the section lands under the real heading.
- A test with a section that fails the checker leaves the ticket byte-identical
  to `HEAD` and exits non-zero with the checker's lines.
- A test with a table the formatter re-pads reports an empty normalised diff.
- `review-ticket` step 8 names the script; the procedure it replaces is gone.

## Review

### Gate 1 — 2026-09-20

**Gate: CONCERNS** — 2026-09-20 · `f9d981f...ebd05d2` at `ebd05d2` · coordinates re-resolved against `7db4d52` before commit, since round 2 moved them; three that pointed at code round 2 deleted are prose here, named in the bullet that found them · defect hunt run by the reviewer in its own context (no `Skill`/`Agent` tool in this role), to medium depth. Base branch `origin/orchestrate-skill-sweep` was at `811b8f6` at fetch time, one commit ahead of `f9d981f`; `f9d981f` is still the merge-base, so the range is unchanged.

| Done when                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. A section splices into a ticket whose prose quotes the `## Review` heading above the real one, and lands under the real heading | proven — `scripts/test/review-record.test.ts:273 "Reasons, mentioned once already as"` plants the decoy, `:299 "expect(after).toMatch(/mentioned once already"` asserts it survives untouched as prose, `:137 "expect(planInsertion(withReview, 2)).toEqual"` fixes the later-gate anchor. The guard is heading form throughout — `scripts/review-record.mjs:151 "const sections = extractSections(markdown);"`. Re-run by the reviewer on a real 250-line ticket carrying three decoys at once. |
| 2. A section that fails the checker leaves the ticket byte-identical to `HEAD` and exits non-zero with the checker lines           | proven — `scripts/test/review-record.test.ts:362-366 "The restore, proven against HEAD itself rather than a copy"` compares against `HEAD` itself rather than a copy, `:360 ").toMatch(/unanchored/);"` covers the printed lines; the restore is `scripts/review-record.mjs:416 "const restoreFromHead = () =>"`. Re-run by the reviewer.                                                                                                                                                        |
| 3. A table the formatter re-pads reports an empty normalised diff                                                                  | proven — `scripts/test/review-record.test.ts:393-405 "Confirm the formatter actually touched the table"` on the CLI path, whose comment says why the fixture is able to fail, and `:164 "expect(normalizeForDiff(loose)).toBe(normalizeForDiff(tight));"` on the collapser. Re-run by the reviewer.                                                                                                                                                                                              |
| 4. `review-ticket` step 8 names the script; the procedure it replaces is gone                                                      | **unproven** — and deliberately so. The dispatch scoped this branch out of `.claude/`, the Log records the deferral, and `review-ticket/SKILL.md` still reads `npx oxfmt`. Recorded as unproven rather than FAIL on the orchestrator instruction that scoped it. Not a defect of this branch.                                                                                                                                                                                                    |
| The gates pass, the suite count went up, no existing test changed meaning                                                          | verified — `npm run check` exit 0; `npm test -- --project repo` 366 tests in 8 files at `ebd05d2` against 346 in 7 files at `f9d981f`, both exit 0: +20 tests, +1 file, exactly the new suite. The only test file in the range is the new one.                                                                                                                                                                                                                                                   |

- **med** · **open decision** — a failed check restores from `HEAD`, which silently discards any _uncommitted_ edit to the ticket, not only the splice. Reproduced: append a line to a tracked ticket, leave it uncommitted, run with a section whose citation fails; exit 6, and the appended line is gone with no warning on either stream. The module docblock above `scripts/review-record.mjs:416 "const restoreFromHead = () =>"` presents `HEAD` as strictly safer than an in-memory copy; it is not, it trades a stale-memory hazard for a lost-work one, and does not say so. Two defensible remedies — (a) refuse to run when the ticket is dirty against `HEAD`, naming the fix, or (b) keep the `HEAD` restore and print what it discarded. (a) recommended.
- **med** · **open decision** — the disclosure diff is computed against the _last_ level-3 subsection under `## Review` — the `locateInsertedBlock` line that did this is gone at this tip, replaced by gate 2, so it is named here rather than cited — so a `--gate` section file that carries a second `###` heading of its own diffs only its tail and reports a false non-empty diff. Reproduced: a two-heading gate file spliced correctly and printed a diff deleting its own first six lines. It over-reports and never under-reports, but it is the one output a builder is told to paste as evidence that verbatim survived, and the repair it invites is editing the section. Two remedies — (a) bound the block from the `### Gate <n>` heading to the end of `## Review`, or (b) refuse a section file with more than one level-3 heading. (a) recommended.
- **low** · `--gate <n>` is not idempotent. Running the same gate number twice appends a second `### Gate <n>`, exit 0, no warning, while the first-review path refuses its repeat at `scripts/test/review-record.test.ts:311 "a gate appended later lands inside the existing"` sibling test. Reproduced on a real ticket: two `### Gate 3` blocks.
- **low** · the formatter spawn at `scripts/review-record.mjs:431 "const fmt = spawnSync(process.execPath, [OXFMT"` was given no working directory while the checker was given one. Config discovery therefore followed the caller cwd for one and the ticket repo for the other. No effect today: `.oxfmtrc.json` carries only `ignorePatterns`, measured — oxfmt 0.62.0 on markdown re-pads tables and normalises list markers and reflows no prose at all, a 196-character bullet came back untouched.
- **low** · the citations CLI is spawned as a bare `node` from `PATH` while the docblock argues at length for `process.execPath` over shims for `oxfmt`. Same process, two rules.
- **low** · a citation anchor that contains a backtick is not safe in a record here, and this section is the reproduction. A first draft of row 2 quoted a fragment carrying one; oxfmt re-parsed the cell and deleted the space on both sides of three inline code spans, and rewrote two emphasis pairs from asterisks to underscores in the same run. Step 4 surfaced all five as a non-empty normalised diff and the exit stayed 0 — the tool behaved exactly as designed, and the anchor was changed rather than the tool. `review-ticket` step 4 warns about a double quote inside an anchor and is silent on a backtick; worth adding when the orchestrator wires step 8.
- **dropped** · the entry guard no-ops silently when the script is reached through a symlink. Identical to four sibling scripts in `scripts/`; a repo convention, not this branch.
- **dropped** · `packages/core/test/spawn-safety.test.ts` walks `packages/` and `tools/` only, so the new spawns are outside it. Pre-existing scope, and every call here uses an argument array with no shell anyway.
- **findings** · defect hunt at medium, run by the reviewer: 8 returned, 6 carried, 2 dropped.
- NFR: security ✓ — no shell, argument arrays throughout, no user-influenced URL or credential in reach · performance n/a · reliability ✓ except the two `med` above · maintainability ✓ — the guards are mutation-tested, see the Log.

### Gate 2 — 2026-09-20

**Gate: CONCERNS** — `ebd05d2...7db4d52` at `7db4d52` · defect hunt run by the reviewer in its own context, to medium depth. Both gate-1 `med` findings closed and re-measured through the real CLI; all three folded `low`s applied. One new `med` remains, and it is not this branch — it is on the integration branch.

| Gate 1 finding                                                                                | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **med** · a failed check discarded uncommitted ticket edits                                   | **closed** — the run refuses before writing anything, `scripts/review-record.mjs:391 "const dirty = spawnSync("`, asserted at `scripts/test/review-record.test.ts:456-460 "expect(result.stderr).toMatch(/uncommitted changes against HEAD/);"`. Re-measured: planted an uncommitted Log line, ran a gate splice, got exit 1, the named message, and a checksum identical to before the run — the planted line survives, which is the whole point.                                                                  |
| **med** · the disclosure diff stopped at a gate own trailing heading                          | **closed** — `scripts/review-record.mjs:253 "return { start: heading.start, end: review.end };"`, asserted at `scripts/test/review-record.test.ts:466-519 "the disclosure diff is bounded to the end of"` and `:555-584 "locateInsertedBlock bounds a gate"`. Re-measured with the identical section file that produced the false six-line diff at `ebd05d2`: the normalised diff is now exactly two newlines.                                                                                                      |
| **low** · a repeated gate number was not refused                                              | **closed** — `scripts/review-record.mjs:172 "const already = sections.filter("`, asserted at `scripts/test/review-record.test.ts:521-544 "refuses to re-append a gate number that already exists"` and `:550 "planInsertion refuses a gate number that already exists"`. Re-measured: a repeat of the same gate number exits 1 with the named message, one heading remains, tree clean. The digit boundary holds both ways — an existing gate 3 does not block gate 30, which spliced at exit 0 with an empty diff. |
| **low** · the formatter had no working directory; the checker CLI was a bare interpreter name | **closed by reading, untested** — `scripts/review-record.mjs:431-433 "const fmt = spawnSync(process.execPath, [OXFMT"`, and both interpreter spawns now use `process.execPath`; every spawn is an argument array with no shell. No test covers either, so neither would go red if reverted. Stated as applied, not as proven.                                                                                                                                                                                       |

| Done when                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The splice trap                                                                                     | proven, re-measured at this tip on the same three-decoy fixture as gate 1: a gate landed at 260 under the real heading at 189, not the fenced decoy at 24; the first-gate run anchored at 189 above the real Log at 201, not the fenced decoy at 28.                                                                                                                                                                                                                                                                             |
| 2. A failed check leaves the ticket byte-identical to `HEAD`, exits non-zero, prints the checker lines | proven, and now also on the later-gate path, which gate 1 had not exercised: exit 6, a byte comparison against the `HEAD` blob clean, tree clean.                                                                                                                                                                                                                                                                                                                                                                                |
| 3. A re-padded table reports an empty normalised diff                                                  | proven, re-measured: two newlines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4. `review-ticket` step 8 names the script; the procedure it replaces is gone                          | **unproven — first clause met, second clause not.** Nothing in `f9d981f...7db4d52` touches `.claude/`, and `56d5564` is **not** in this branch ancestry; the branch still forks at `f9d981f`. On the integration branch the first clause holds. The second does not: the by-hand procedure survives in the `review-ticket` skill, in the paragraph beginning _So the builder writes it into_, which still names the formatter as a separate hand step, directly above the step 8 that now names the script. See the `med` below. |
| The gates pass, the suite count went up                                                                | verified — `npm run check` exit 0; `npm test -- --project repo` 371 tests in 8 files, against 366 at `ebd05d2` and 346 at `f9d981f`. +5, matching the five new tests.                                                                                                                                                                                                                                                                                                                                                            |

- **med** · **for the orchestrator, not this branch** — Done when 4 second clause is unmet on the integration branch. The `review-ticket` skill still carries the paragraph telling a builder to write the section in by hand and then run the formatter itself, five lines above the step 8 that replaces it, so a builder reading the page top to bottom meets the replaced procedure first. Reproduce on the integration branch tip by grepping that one file for the old formatter invocation: one hit, in that paragraph, where the acceptance line asks for zero. Out of this branch reviewed range; named here because it is the acceptance line, and the branch carries `status: done`.
- **low** · the refusal message advises committing _or stashing_ first. A bare stash is unsafe in this checkout — the stash stack is shared across worktrees and concurrent sessions — so the advice points at a footgun the environment warns about. Naming a commit alone, or a WIP commit, would be safer.
- **low** · an **untracked** ticket slips the new guard. A diff against `HEAD` reports clean for a path `HEAD` does not have, so the splice proceeds; on a failed check the restore cannot run and the file keeps the failed splice. Measured: exit 6 and the checksum changed. The failure is loud, but the repair the message prints — restoring that path from `HEAD` — cannot work for a path `HEAD` does not have.
- **findings** · defect hunt at medium, run by the reviewer: 3 returned, 3 carried, 0 dropped. Gate 1 carried 6; four are closed in the table above, and the two gate-1 spawn-hygiene lows are the row marked closed by reading.
- NFR: security ✓ — one new spawn, argument array, no shell, and it runs before any write · performance n/a · reliability ✓ — the restore docblock claim is now true, because the guard is what makes it true · maintainability ✓ — each new guard was re-measured by removing it and watching its named test go red.

### Gate 3 — 2026-09-20

**Gate: PASS** — `7db4d52...44e8326` at `44e8326` · defect hunt run by the reviewer in its own context, to medium depth, scoped to the two gate-2 `low`s and to whether the two committed records still say what the reviewer wrote. Both `low`s closed. Done when 4 now holds on the integration branch, re-checked by the reviewer rather than taken on report.

| Gate 2 finding                                  | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **low** · the refusal advised stashing          | **closed** — asserted at `scripts/test/review-record.test.ts:609 "expect(result.stderr).not.toMatch(/stash/iu);"`, a negative match, which is the only shape that can hold a message to an absence. Re-measured on a real dirty ticket: exit 1, and a case-insensitive search of the message for the word finds none.                                                                                                                                                                    |
| **low** · an untracked ticket slipped the guard | **closed** — `scripts/review-record.mjs:373 "const tracked = spawnSync("` runs ahead of the dirty check, asserted at `scripts/test/review-record.test.ts:632 "expect(result.stderr).toMatch(/is not tracked by"`. Re-measured: an untracked ticket plus a section whose citation fails now exits 1 with the named message and a checksum identical to before the run, where at `7db4d52` the same input exited 6 with the checksum changed and a repair instruction that could not work. |
|                                                 | The two guards compose across all three states a ticket can be in, which no single test covers: untracked is refused by the first, newly staged and tracked-but-modified by the second. The staged case was measured directly — a ticket added to the index and not committed is refused with the uncommitted-changes message, not the untracked one.                                                                                                                                    |

| Done when                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The splice trap                                                                                     | proven, re-measured at this tip: the gate landed at 240 under the real heading at 189, the first-gate run at 189 above the real Log at 201, neither taking the fenced decoys at 24 and 28.                                                                                                                                                                                                                                                            |
| 2. A failed check leaves the ticket byte-identical to `HEAD`, exits non-zero, prints the checker lines | proven, re-measured on the later-gate path: exit 6, a byte comparison against the `HEAD` blob clean, tree clean.                                                                                                                                                                                                                                                                                                                                      |
| 3. A re-padded table reports an empty normalised diff                                                  | proven, re-measured: two newlines.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4. `review-ticket` step 8 names the script; the procedure it replaces is gone                          | **verified, and the clause that failed at gate 2 now holds.** Re-checked on the integration branch tip rather than taken on report: the skill names the script twice, `records.md` once, and the old formatter invocation is gone from the skill entirely — the paragraph that carried it now points at the script instead. Still met on the branch this merges into rather than by a commit here; nothing in `f9d981f...44e8326` touches `.claude/`. |
| The gates pass, the suite count went up                                                                | verified — `npm run check` exit 0; `npm test -- --project repo` 373 tests in 8 files, against 371 at `7db4d52`. +2, matching the two new tests. Unmutated suite 27/27, and each new guard was re-measured by reverting it alone and watching only its own named test go red.                                                                                                                                                                          |

- **low** · one citation was narrowed, not just re-pointed, while the builder carried gate 2 across the drift from round 3. The formatter row cited a three-line range; it now cites a single line one above the working directory the row is about — the stated reason was that the call now fits unwrapped, and it does not: it is still spread over five lines, `scripts/review-record.mjs:431-433 "const fmt = spawnSync(process.execPath, [OXFMT"`, which is also the remedy. The claim stays true and the checker stays green, which is why this is a `low` and not a correction to the verdict. Writing the reviewer own coordinate back as a bare line was refused here by the same checker: the working-directory line occurs twice in that file, so it cannot carry a distinct anchor on its own — a range anchored on the call is the only spelling that holds.
- **verbatim** · both committed records were compared against the text the reviewer returned, normalised for table padding. Gate 1 differs on four coordinates and nothing else; gate 2 on four coordinates and nothing else. No severity, no row, no hedge altered in either.
- **findings** · defect hunt at medium, run by the reviewer: 1 returned, 1 carried, 0 dropped.
- NFR: security ✓ — one new spawn, argument array, no shell, ahead of any write · performance n/a · reliability ✓ — the restore now has a copy to restore from in every state that reaches it · maintainability ✓.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history.
- 2026-09-20 — Built `scripts/review-record.mjs` and
  `scripts/test/review-record.test.ts` (20 tests). Scope was narrowed by the
  dispatch to those two files plus closing the ticket — `review-ticket` step 8
  and `records.md` are explicitly deferred to the orchestrator's own commit
  after this branch merges, so **Done when**'s fourth line ("`review-ticket`
  step 8 names the script; the procedure it replaces is gone") is not done by
  this branch. The replacement text for both is in the build report handed
  back, not written here.

  What Build step 2 had wrong: its first branch names the insertion anchor for
  a brand-new review as "a `## Review` at line start with blank lines around
  it", but a ticket has no `## Review` at that point at all —
  `docs/01-TICKETS.md` says the section is "Absent until the work is
  reviewed", and every ticket observed with one (e.g. `repo-15`) carries it
  between `## Done when` and `## Log`. The Why section already says the real
  anchor: "above `## Log` ... anchored on the heading form". Implemented that
  way — the first review anchors on the ticket's own `## Log` heading, found
  via `citations.mjs`'s `extractSections`, and a later `--gate` anchors on the
  end of the existing `## Review` block (which lands at the same line in
  practice, since `## Log` always follows `## Review` immediately).

  Also found and worked around a formatter-invocation trap not in the brief:
  `npx oxfmt <ticket>`, run literally, fetches an unpinned `oxfmt` over the
  network whenever the ticket's own directory has no `node_modules` above it —
  reproduced directly (`0.68.0` installed against this tree's pinned
  `0.62.0`) — and separately, `node_modules/.bin/oxfmt` cannot be spawned
  without a shell on Windows (`.claude/rules/testing.md`, and
  `packages/core/test/oxfmt-ignore-patterns.test.ts` already carries the fix).
  `review-record.mjs` resolves `oxfmt`'s own `bin` entry via `createRequire`
  and runs it under `process.execPath`, matching that existing pattern, rather
  than shelling out to `npx`.

  Registered the new script in `scripts/test/tsconfig.json`'s `include` list,
  per that file's own documented convention for a plain `.mjs` under test.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (20/20 passed); `npm test -- --project
repo` (366/366 passed); full `npm test`, run because
  `scripts/test/tsconfig.json` moved (176 files, 3172 tests, exit 0).

- 2026-09-20 — Round 2, from a ticket-reviewer gate (Opus) on `ebd05d2` and the
  orchestrator's decisions on its two open findings. Reproduced both before
  applying: a check failure's `git show HEAD:<ticket>` restore silently
  discarded an uncommitted edit unrelated to the splice (planted one, ran a
  failing section, `grep -c` the planted line afterward → `0`); and
  `locateInsertedBlock`'s "last nested `### `" rule diffed only a gate's own
  tail against the whole section file when that gate's body carried a second
  `###` heading, reporting a false non-empty diff on a splice that landed
  correctly. Both held.

  Applied the orchestrator's decisions, both taking its recommendation: (1)
  `main()` now refuses to run at all when the ticket has uncommitted changes
  against `HEAD` (`git diff --quiet HEAD -- <ticket>`), before writing
  anything — corrected the module docblock, which had presented the `HEAD`
  restore as unconditionally safe. (2) `locateInsertedBlock` now bounds a
  gate's block from its own `### Gate <n>` heading to the end of `## Review`,
  not to the matched heading's own `extractSections` range. Also folded in the
  three low findings: `planInsertion` refuses a `--gate <n>` whose heading
  already exists under `## Review`; the citations CLI is spawned under
  `process.execPath` instead of a bare `node` from `PATH`, matching the
  reasoning the docblock already gave for `oxfmt`; and `oxfmt` is now given
  `cwd: ticketRepoRoot` (previously unset), matching the checker's own `cwd`.

  Added five tests (25 total), one per change above plus a pure-function test
  for the gate-bound fix, and watched each fail first by reverting its guard
  in isolation and restoring afterward — recorded here rather than assumed:
  removing the dirty-check branch reported `git diff failed` instead of the
  named message; returning the matched heading unbounded from
  `locateInsertedBlock` reproduced the reviewer's own "diffs only the tail"
  failure; dropping the repeat-gate guard let a second `--gate 1` land at exit 0.

  The `review-ticket` step 8 / `records.md` wiring landed on
  `orchestrate-skill-sweep` at `56d5564` while this branch was in review
  (`git grep -n review-record 56d5564 -- .claude` names both) — so **Done
  when** 4 is met on the branch this one merges into, not by a commit on this
  branch. `status: done` stands on the orchestrator's word; the reviewer's
  `unproven` grade on that line was correct at the time it was given.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (25/25 passed); `npx vitest run
--project repo` (371/371 passed, 8 files).

- 2026-09-20 — Round 3, folding two `low` findings from gate 2 (Opus,
  `ebd05d2...7db4d52`) per the orchestrator's instruction, ahead of splicing
  either gate's record: the dirty-ticket refusal now says "commit them
  first" rather than "commit or stash them first" — this checkout's stash
  stack is shared across worktrees and concurrent sessions, so the advice
  must not point at it — and the script now refuses to run at all when the
  ticket is not tracked by git yet (`git ls-files --error-unmatch`), because
  `git diff --quiet HEAD -- <path>` reports a clean tree for a path `HEAD`
  has no record of, which let an untracked ticket slip the round 2 dirty
  guard entirely and land a failed splice with no `HEAD` copy to restore
  from. Two new tests (27 total), each watched failing first against its own
  fix reverted.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (27/27 passed).

- 2026-09-20 — Spliced gate 1's `## Review` section with `scripts/review-record.mjs` itself (no `--gate`). Its
  first run at `7db4d52` failed exit 2, 4 moved: the reviewer's coordinates
  into `scripts/review-record.mjs` were resolved against `7db4d52`, and the
  round-3 commit (above) added lines ahead of all four, shifting them by the
  same mechanical amount the tool named exactly (`149→151`, `394→416`
  twice, `409→431`) — no content changed under any of the four, `citations.mjs`
  confirmed the anchor text still matched at the new line. Re-pointed all four
  to the lines the tool reported and re-ran: exit 0, 12/12 verified with
  distinct anchors, disclosure diff empty — the section landed verbatim,
  modulo table formatting there was none of. Altered: only those four line
  numbers; nothing else in the reviewer's text.

- 2026-09-20 — Spliced gate 2's `## Review` subsection with
  `scripts/review-record.mjs --gate 2`, after committing gate 1 first — the
  round-2 dirty guard makes two gates on one working tree a two-commit
  operation by design, not a workaround. Its first run again failed exit 2,
  4 moved, for the identical reason as gate 1's own splice: round 3 shifted
  the same four coordinates a second time (`369→391`, `251→253`, `170→172`,
  `409-411→431`, the last collapsing to one line since the call now fits
  on it unwrapped). Re-pointed all four, re-ran: exit 0, 21/21 verified with
  distinct anchors, disclosure diff empty. Altered: only those four line
  numbers; nothing else in the reviewer's text.

  The reviewer's new `med` — Done when 4's second clause unmet on the
  integration branch — is explicitly the orchestrator's to fix, not this
  branch's; not actioned here.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (27/27 passed).

- 2026-09-20 — Spliced gate 3's `### Gate 3` subsection with
  `scripts/review-record.mjs --gate 3`, after gate 2 was already committed:
  exit 0, 25/25 verified, disclosure diff empty first try — nothing in
  `scripts/review-record.mjs` moved between gate 2's commit and this one, so
  none of the reviewer's coordinates needed re-pointing this time. Gate: PASS.

  Folded gate 3's one `low` in this same commit, per the orchestrator: gate
  2's own "closed by reading, untested" row for the formatter's working
  directory cited a single line, `scripts/review-record.mjs:431`, when I
  carried it across round 3's line drift — the stated reason then was that
  the three-line call now fit on one line unwrapped, and it does not; `cwd:
ticketRepoRoot` sits on 432 and the call closes on 433, and the row is
  about that `cwd`. Widened the citation to `431-433`, a coordinate-only
  change to an already-committed row — the claim itself was never wrong and
  the checker was already green on the narrower citation, so this corrects
  precision rather than a defect. Re-checked: `citations.mjs --section
Review --require-anchors --require-distinct-anchors` on the ticket, exit
  0, 25/25 verified.

  Done when 4 is now met in full: the reviewer independently re-checked
  `review-ticket/SKILL.md` and `records.md` on `orchestrate-skill-sweep`
  (now at `df115ee`) and found the old by-hand procedure gone and the script
  named twice/once respectively — still true on the branch this merges into,
  not by a commit here.

  This is the last gate on this ticket.

  Gates: `npm run check` (exit 0); `npx vitest run --project repo`
  (373/373 passed, 8 files); `node scripts/citations-gate.mjs` (98 enforced,
  0 failing, over 105 records).
