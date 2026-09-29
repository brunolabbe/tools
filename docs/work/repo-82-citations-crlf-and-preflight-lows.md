---
id: repo-82
tool: repo
title: citations.mjs reads a CRLF file the same as its LF form, and preflight covers every npm ci alias
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-82 — citations.mjs reads a CRLF file the same as its LF form, and preflight covers every npm ci alias

## Why

Two small code defects the 2026-09-27/28 batch's gates found, both disclosed
rather than closed at the time, owner decision 2026-09-28 (`AskUserQuestion`:
file one ticket for later / fix now in a separate PR / drop them — the
orchestrator recommended filing, the owner overrode it and chose to fix now).

**1. `scripts/citations.mjs` silently drops every heading in a CRLF file.**
Established by repo-79's post-gate fixer round, 2026-09-28
(`docs/work/repo-79-preflight-runs-all-checks.md`'s Log, the "post-gate fixer
round" entry): under `core.autocrlf=true` a record checked out with CRLF loses
its `## Review` heading, is treated as out of scope, and `citations-gate`
reports "clean over 0 record(s)" where it should report "1 moved". This repo
is protected only by `.gitattributes`' `* text=auto eol=lf` — a record edited
on a Windows checkout without that attribute, or one pasted in with `\r\n`
line endings from an editor, hits it for real.

**2. Two lows repo-79's gate 3 disclosed in `scripts/preflight.mjs`**
(`docs/work/repo-79-preflight-runs-all-checks.md`'s `### Gate 3`, "New in this
round"): the `npm ci` alias table knows only `clean-install`, while `npm ci
--help` lists four (`clean-install, ic, install-clean, isntall-clean`), so
`npm ic`, `npm install-clean` and `npm isntall-clean` in the CI check job
would still be spawned for real; and a comment says `otherHeads` is `[null]`
where the sentinel list is actually `targets`.

## Build

- `scripts/citations.mjs`: read a CRLF file the same as its LF form, in every
  place it splits a record's markdown into lines and matches against those
  lines with an end-anchored regex — not only `extractSections`'s heading
  regex. Add a `splitLines` helper that strips a trailing `\r` per line
  (never any other whitespace, so no citation's `line`/`start`/`end` numbers
  move), and use it everywhere `markdown.split("\n")` currently is:
  `extractCitations`, `extractDeclarations` and `extractSections`.
- `scripts/preflight.mjs`: add `npm`'s other three `ci` aliases (`ic`,
  `install-clean`, `isntall-clean`) to `NPM_ALIASES` so all four rewrite to
  `"ci"` and are never spawned; correct the fold-loop comment to name
  `targets` rather than `otherHeads`.
- Tests at the **end** of `scripts/test/citations.test.ts` and
  `scripts/test/preflight.test.ts`, red on `efffb35` and green after,
  including one through the real CLI on a CRLF record with a moved citation.
- Repoint every merged record's citation into `scripts/citations.mjs` or
  `scripts/preflight.mjs` that this branch's edits move — coordinate only,
  per `.claude/skills/orchestrate-tickets/reference/records.md` (content
  already on `main`, only the line moved, anchor text unchanged) — and name
  each repoint in a dated Log line of the ticket it repoints.

## Done when

1. `node -e 'console.log(/^(#{1,6})[ \t]+(.*\S)[ \t]*$/.exec("## Review\r"))'`
   still prints `null` (the raw regex is unchanged and undemonstrative on its
   own), but `extractSections`, `extractCitations` and `extractDeclarations`
   each read a CRLF-terminated record identically to its LF form.
2. A CRLF copy of a real merged record, with a citation forced to disagree
   with its anchor, is reported `moved` by the real CLI under `--section
Review` rather than failing to find the section at all.
3. `NPM_ALIASES` covers all four of `npm ci`'s own aliases and none of the
   four is ever spawned by `deriveExtraCiCommands`.
4. The fold-loop comment names `targets`, the actual sentinel list, not
   `otherHeads`.
5. `npx vitest run scripts/test/citations.test.ts`,
   `npx vitest run scripts/test/preflight.test.ts` and
   `npx vitest run --project repo` all pass.
6. `npm run check`, `packages/core/test/spawn-safety.test.ts` and
   `node scripts/citations-gate.mjs --against origin/main` all exit 0.

## Review

### Gate 1

**Gate: CONCERNS** — 2026-09-28 · `efffb35...dcc7880` · code-review at medium

Reviewed at `dcc7880` against base `efffb35`; `origin/main` was still at `efffb35` after the fetch. Lines this branch introduces are cited unpinned against `dcc7880`, and lines that already existed are pinned to `efffb35`. The ticket was filed on this branch, so its brief was read from the branch copy. Re-issued at `9ed3e6d` with every unpinned coordinate re-resolved against that tip; the words, rows and verdicts are unchanged, except that the med now names the CLI test in prose at `dcc7880`, because the gate 2 round corrected what it claimed.

| Done when                                                                                           | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The raw regex still prints `null`, and all three extractors read CRLF the same as LF             | **proven** — `scripts/test/citations.test.ts@2ffb72a:2981 "expect(crlf).toEqual(lf);"` and `scripts/test/citations.test.ts@2ffb72a:2991 "read an evidence declaration in a CRLF record"`. All 3 new tests are red with the `efffb35` script and green at the tip. Reverting `splitLines` at each call site in turn makes a test red every time: `extractCitations` 1 red, `extractDeclarations` 1 red, `extractSections` 2 red. Re-running the raw regex prints `null`                               |
| 2. A CRLF copy of a real record, with a citation forced to disagree, is reported `moved` by the CLI | **proven** — `scripts/test/citations.test.ts@2ffb72a:3041 "not.toMatch(/no section matches/)"`, which fails at `efffb35` on its empty-stdout assertion. On my own fixture (a CRLF record citing a CRLF target) the CLI at the tip printed identical output for the CRLF and LF forms: exit 2, 1 moved. At `efffb35` the CRLF form printed no section matches and exited 1, and `checkRecord` returned `skipped: true`. See the med below on how this test is coupled to a live record                |
| 3. `NPM_ALIASES` covers all four aliases and none is spawned                                        | **proven** — `scripts/test/preflight.test.ts:1852 "treats npm ic, npm install-clean and npm isntall-clean as covered"` covers the three new ones and `scripts/test/preflight.test.ts@efffb35:1781 "treats npm clean-install as covered, never spawning it"` the fourth. The new test is red at `efffb35`, and removing any one new entry makes it red (1 of 81), naming that alias. `npm ci --help` on npm 10.9.9 lists 4 aliases, and `scripts/preflight.mjs:432 "const NPM_ALIASES"` holds those 4 |
| 4. The fold-loop comment names `targets`                                                            | **verified** (a comment, so there is no test) — `scripts/preflight.mjs:1231 "closed by repo-82: this comment named"`, which matches `scripts/preflight.mjs:1247 "const targets = otherHeads.length > 0"`                                                                                                                                                                                                                                                                                             |
| 5. The two spec files and `--project repo` pass                                                     | **verified** — the two spec files together pass 193 of 193 (112 + 81), and `npx vitest run --project repo` passes 565 of 565. The test diff adds 95 lines and removes none (4 new tests), so the base count is 561; that count is subtracted, not run at the base                                                                                                                                                                                                                                    |
| 6. `npm run check`, spawn-safety and `citations-gate --against origin/main` exit 0                  | **verified** — preflight at `dcc7880` prints `ok npm run check`; `npx vitest run packages/core/test/spawn-safety.test.ts` passes 5 of 5 and exits 0; `node scripts/citations-gate.mjs --against origin/main` exits 0 with 130 enforced, 0 failing, 6 grandfathered and 0 raised                                                                                                                                                                                                                      |

- **med** · The CLI test in `scripts/test/citations.test.ts` titled the CLI finds a CRLF ## Review heading, as it stood at `dcc7880`, reads the live repo-79 record and expects a literal `MOVED` line at the `scripts/preflight.mjs` coordinate 1063, which is the coordinate that record cites today. Any branch that moves that code has to repoint the citation (the repo-29 standing rule), and doing the repoint turns this test red. Measured: changing only 1063 to 1064 in that record makes 1 of 3 CRLF tests red at its `toContain` assertion. This branch itself had to repoint six of that record’s `scripts/preflight.mjs` citations. Remedy: read the expected coordinate out of the record text the test has already loaded, or take the fixture from the record as it stood at a fixed commit. Done when 2 is proven at this tip; this is how its proof will break for the next branch that repoints the record.
- **low** · Two findings, one mechanism: outside `citations.mjs`, two readers still split a record on a bare newline and then compare a line that keeps its trailing CR. (a) `scripts/review-record.mjs@efffb35:618 "const firstTitle ="` — with a CRLF section file the title regex fails, and `locateGateBlock` falls back to the first `Gate <n>` heading. On an LF ticket with two headings beginning `Gate 1`, the CRLF section resolves to block 10–13 and the LF one to block 14–15. (b) `scripts/status.mjs@efffb35:122 "const end = lines.indexOf("` — CRLF frontmatter throws `the frontmatter is never closed`, which is loud, and this is not a heading read. Both are outside the Build’s scope.
- **low** · npm also resolves some prefixes of the aliases to `ci`. `npm install-clea --help` and `npm isntall-cl --help` both print Clean install a project, and `deriveExtraCiCommands` returns both as commands to spawn. `npm cit` (`install-ci-test`) runs a clean install and has no guard either. No check-job step uses any of them, and Done when 3 names only the four aliases.
- **low** · Three findings, one mechanism — counts in Logs that are wrong: (a) this ticket’s Log paragraph on repointed citations says 22 in total, but its own breakdown sums to 29, and 29 is what I measured; (b) the Logs of repo-48, repo-50, repo-52 and repo-60 call `splitLines` 28 lines, but it is 27 (hunk `+257,27`), and every repointed coordinate moved by exactly 27; (c) the repo-51 Log calls the new docblock 5 lines, but it is 8 (hunk `+451,8`), though its net +13 is right.
- **low** · The new `NPM_ALIASES` paragraph was appended to the docblock above `scripts/preflight.mjs@efffb35:453 "const NPM_ALIASES"`. That docblock describes `COVERED` and carries `COVERED`’s array `@type`. The mismatch predates this branch, which extended the docblock instead of splitting it.
- **checked, no finding** · Repoints — I compared all 29 changed citations across the 9 merged records through `extractCitations`. Each changes the coordinate only: the anchor is byte-identical, the file is the same and the range keeps its width. Each was verified at `efffb35`, reads `moved` at the tip under its old coordinate and reads verified at the tip under its new one. No citation was added or dropped, and all 9 records carry a dated 2026-09-28 Log line whose per-record count matches.
- **checked, no finding** · CRLF coverage: I enumerated 17 sites and ran 14 of them on LF and CRLF input — the three extractors, the target read and anchor match, and the CLI in `citations.mjs`; `checkRecord`; `hasGateRecord` and `parseFrontmatter`; `checkReview`; and `validateFirstLine`, `planInsertion`, `locateInsertedBlock` and `locateGateBlock`. At the tip all 14 match, except `parseFrontmatter` and the mixed-line-ending case of `locateGateBlock` (the low above). At `efffb35`, 10 differed: the three extractors, which the branch fixes directly, and seven callers it repairs through them — the CLI, `checkRecord`, `hasGateRecord`, `checkReview`, `planInsertion`, `locateInsertedBlock`, and `locateGateBlock` when both files share line endings. A CRLF target file was already read correctly at `efffb35`: 2 verified and 1 moved on both commits. Read but not run: the pinned-rev reader, `checkDisplacement`, and `insertSection` with `normalizeForDiff`.
- **dropped** · The new CLI test calls `spawnSync` without `shell: false`. It passes an argument array and no user input, the same form as the 44 existing `spawnSync` calls in that file at `efffb35`. The scan at `packages/core/test/spawn-safety.test.ts@efffb35:78 "every file that spawns says"` checks only `spawn(`. Not a defect of this branch.
- **dropped** · The CLI test leaves its temp directory behind when an assertion fails. Earlier tests in the file use the same unconditional `rmSync`, and it only matters on a red run.
- **findings** · code-review at medium over `efffb35...dcc7880` returned 10: 8 carried (1 med and 7 lows, the lows in 4 bullets), 2 dropped.
- Invariants: no shell ✓, no `console` ✓, `node:` builtins ✓. There is no new package, tsconfig reference or Dockerfile edit. Skipped because this diff cannot touch them: contracts, `AppError`, redaction, SSRF, progress and cross-tool imports.
- NFR: security ✓ — no new spawn in either script · performance n/a · reliability ✓ — a CRLF record is no longer silently out of scope · maintainability — the med and the lows above.
- Preflight with the proposed `fix(repo)` title exits 0. Every path is under `scripts/` or `docs/work/`, and `release-please-config.json` lists only `tools/*` packages, so `fix` routes no changelog. Unmeasured: the Windows CI leg on the new tests.

### Gate 2

**Gate: PASS** — 2026-09-29 · `dcc7880..9ed3e6d` · code-review at medium, this round only

Re-gate of the round `dcc7880..9ed3e6d` (18 files), base `efffb35` unchanged. `origin/main` moved to `278d288` (#315) during the review; the preflight scratch merge that includes it is clean over 136 records. Coordinates introduced by the branch resolve against `9ed3e6d`. The Done-when rows stand as gate 1 gave them. Re-run at the tip: the two spec files pass 194 of 194 (112 + 82), `npx vitest run --project repo` passes 568 of 568, spawn-safety passes 5 of 5, `node scripts/citations-gate.mjs --against origin/main` exits 0 (130 enforced, 0 failing), and preflight exits 0 with the proposed title.

Gate 1 findings:

- **med** (CLI test tied to a live coordinate) · **fixed** — `scripts/test/citations.test.ts@2ffb72a:3021 "const anchorText ="` now reads the expected coordinate from the record it loads. Re-running the gate 1 `sed` on repo-79 (1091 to 1092) leaves 3 of 3 CRLF tests green, where it made 1 of 3 red at `dcc7880`. With the `efffb35` `citations.mjs` swapped in, the test is still red, on its empty-stdout assertion.
- **low** (two CRLF readers) · **fixed** — `scripts/review-record.mjs:618 "splitLines(sectionText)[0]"` and `scripts/status.mjs:118 "const lines = splitLines(text);"`. With `gate1-probe2.mjs`, the CRLF section now resolves to block 14–15, the same as its LF twin, and `parseFrontmatter` reads SAME. Reverting each fix makes its own new test red: `scripts/test/review-record.test.ts:926 "heading when the section text is CRLF"` (1 of 36) and `scripts/test/status.test.ts:1720 "parseFrontmatter reads a CRLF-terminated ticket"` (1 of 130).
- **low** (npm abbreviations) · **fixed** — `scripts/preflight.mjs:633 "if (canonicalize(raw).split("`. Through `deriveExtraCiCommands`, `npm install-clea`, `npm isntall-cl`, `npm cit` and `npm install-ci-test` all throw, while `npm ic` and `npm ci` still return nothing to spawn. Disabling the guard makes `scripts/test/preflight.test.ts:1880 "throws on npm install-clea, npm isntall-cl and npm cit"` red (1 of 82). A new low below covers how wide the guard is.
- **low** (Log counts) · **fixed** — I measured 27 (the `+257,27` hunk at `dcc7880`), 8 (the `+451,8` hunk) and 29 (my own per-citation count). The Logs of repo-48, repo-50, repo-52 and repo-60 now say 27, repo-51 says 8, and this ticket says 29. No stale 28 remains in them.
- **low** (docblock placement) · **fixed**, verified by reading — the alias map has its own docblock above `scripts/preflight.mjs:432 "const NPM_ALIASES"`, and the `COVERED` docblock sits directly above `scripts/preflight.mjs:489 "const COVERED = ["`. A docblock cannot fail a test.

This round:

- **low** · Two findings, one mechanism — the Log entry for this round misstates what it ran and what it cites. (a) It gives `citations.test.ts` as 113 of 113 with 1 new test, but a verbose run counts 112, and this round adds no test to that file; the four touched spec files total 360 (112, 36, 130, 82), and the project is 568, as the entry itself says. (b) It attributes the rule for a change nothing can fail to `common.md`; the rule is in `.claude/skills/orchestrate-tickets/roles/fixer.md@efffb35:38 "changing anything. When nothing can fail"`.
- **low** · The npm guard refuses every `npm` step it cannot name exactly, not only steps shaped like an install. `npm test` and `npm run lint` in the check job both throw (measured), with a message that blames npm abbreviations and aliases for a step that has neither. The width is deliberate and disclosed at `scripts/preflight.mjs:605 "step throws too, never falls through to a real spawn"`, and the current `ci.yml` check job is unaffected (`deriveExtraCiCommands` on the real file returns its two `node` steps). A future `npm test` step would stop every preflight until this file learns it, and the message would send the reader to the alias table.
- **checked, no finding** · Repoints — 12 of 12 changed `## Review` citations, across repo-51 (3), repo-64 (1), repo-67 (1), repo-75 (1) and repo-79 (6). Each changes the coordinate only, with the anchor byte-identical and the range width kept (`908-909` to `936-937`). Each old coordinate verified at `dcc7880` and reads moved at `9ed3e6d`; each new one verified at `9ed3e6d`. All 5 records carry dated Log lines ending at the final coordinate. My extractor comparison also flagged 5 prose `record line` mentions in the Logs of repo-52 and repo-60: the rewrapped text above them pushed each down one physical line, their numbers are unchanged, and none is in a `## Review`.
- **findings** · code-review at medium over `dcc7880..9ed3e6d` returned 3: 3 carried as 2 low bullets, 0 dropped. Gate 1: 8 of 8 findings fixed.
- NFR: security ✓ — the guard closes the last spawn path for npm spellings · performance n/a · reliability ✓ · maintainability — the lows above.

## Log

- 2026-09-28 — Built. Filed and built in the same branch on the owner's
  decision to fix now (see Why); ship authority withheld by the dispatch, so
  this ticket is left `ready` rather than `done` — the landing sets that and
  commits the `## Review` record, per `roles/builder.md`'s "Leave `status` as
  it is until the landing."

  **Reproduction 1, the regex, re-run**:
  `node -e 'console.log(/^(#{1,6})[ \t]+(.*\S)[ \t]*$/.exec("## Review\r"))'`
  → `null`.

  **Reproduction 1, through the real gate functions, not only the regex**:
  built a scratch git repo with one ticket record citing
  `` `src/thing.ts:1 "export const one = 1;"` `` under `## Review`, then
  inserted a line above the cited one so the anchor moved to line 2.
  `citations-gate.mjs`'s `checkRecord` against the **LF** record: `{ "counts":
{ "moved": 1 }, "failing": 1, "passed": false }`. The same record converted
  to CRLF, checked with `origin/main`'s `citations.mjs`/`citations-gate.mjs`
  (`efffb35`): `{ "skipped": true }` — the record silently drops out of the
  gate entirely, which is what "clean over 0 record(s)" means at the
  corpus level. The same CRLF record, checked with this branch's
  `citations.mjs`/`citations-gate.mjs`: `{ "counts": { "moved": 1 },
"failing": 1, "passed": false }` — correctly caught.

  **Reproduction 2, `npm ci --help`, re-run**: `npm ci --help` prints
  `aliases: clean-install, ic, install-clean, isntall-clean`. Before the fix,
  `deriveExtraCiCommands` over a `ci.yml` fixture running `npm ic`, `npm
install-clean` and `npm isntall-clean` returned all three as commands to
  spawn (none matched any guard); after, `[]`.

  **How many places `citations.mjs` splits or matches lines, CRLF-blind**:
  three call sites split a record's markdown into lines
  (`extractCitations`, `extractDeclarations`, `extractSections`, all now via
  the new `splitLines` helper), and two of the regexes matched against those
  lines are end-anchored and therefore CRLF-blind: the heading regex in
  `extractSections` (the reproduction above), and `DECLARATION` — used both
  by `extractCitations` (to skip a declaration's own locations, so they are
  not double-counted as live citations) and by `extractDeclarations` itself
  (so a real evidence declaration on a CRLF line was silently unread,
  leaving the citations it was meant to excuse to fail instead). Every place
  a _cited target file_ is read (`makeReader`, used by `locateAnchor` and by
  the "text" a moved/verified reason prints) already tolerated CRLF, because
  `normalize()` collapses `\s+` — which matches `\r` — to one space before
  matching; that is why the ticket's Why names only the record parser, not
  the target-file reader, and the reproduction above bears that out (the
  fixed record correctly reports the target-file citation as `moved`, not as
  some new CRLF-only state).

  **Tests**: `npx vitest run scripts/test/citations.test.ts` — 112 of 112
  (3 new, appended at the end); all 3 confirmed red against `efffb35`'s
  `scripts/citations.mjs` (restored after) before being made green again.
  `npx vitest run scripts/test/preflight.test.ts` — 81 of 81 (1 new, appended
  at the end); confirmed red against `efffb35`'s `scripts/preflight.mjs`
  (restored after). `npx vitest run --project repo` — 565 of 565.

  **Citations repointed** (content already on `main`, only the line moved by
  this branch's edits, anchor text unchanged in every case — coordinate
  only, per `records.md`): 9 merged records, 29 citations total (measured by
  summing the per-record breakdown below; 22 was miscounted here first) —
  `repo-51` (3), `repo-52` (3), `repo-60` (6), `repo-64` (1), `repo-67` (2),
  `repo-75` (1), `repo-79` (6), `repo-48` (2), `repo-50` (5). Each is named,
  with its old and new line, in a dated 2026-09-28 Log line of the ticket it
  repoints. `node scripts/citations-gate.mjs --against origin/main`: 9
  records failing before the repoints (130 enforced, 9 failing), 0 failing
  after (130 enforced, 0 failing; 6 grandfathered, 0 raised).

  **Commands, this round**: `npx vitest run scripts/test/citations.test.ts`
  112 of 112; `npx vitest run scripts/test/preflight.test.ts` 81 of 81;
  `npx vitest run --project repo` 565 of 565; `npm run check` exit 0;
  `packages/core/test/spawn-safety.test.ts` — covered by the `--project repo`
  and full-suite runs, no shell spawned by either changed file (both were
  already `spawnSync(..., { shell: false })` throughout, and this ticket adds
  no new spawn site); `node scripts/citations-gate.mjs --against origin/main`
  exit 0, 130 enforced, 0 failing, 6 grandfathered, 0 raised (read directly,
  never through a pipe).

- 2026-09-28 — Fixer round on gate 1's findings (CONCERNS: 1 med, 4 low
  bullets), dispatched as a fixer per the orchestrator's judgement that every
  finding was mechanical. **Provenance of scope**: the owner decided,
  2026-09-28 via `AskUserQuestion` on the orchestrator's recommendation
  (overriding none), to fix the med and all four lows in one fresh-fixer
  round before the record lands, rather than fixing only the med or landing
  now with everything disclosed — the gate's own suggested "fix at landing"
  was not offered, since its record cites the test's lines and a fix after
  the record would break it. No gate record committed this round; the gate
  re-issues its section against this round's tip.

  **med, fixed.** `scripts/test/citations.test.ts`'s CLI test no longer
  hard-codes `scripts/preflight.mjs:1063` for the `"exited ${added.status}"`
  citation; it now reads the expected coordinate out of
  `extractCitations(source)` on the record text the test already loads.
  Reproduction: `sed`ed repo-79's own record, moving that one citation's line
  from 1063 to 1064 — red at `dcc7880` (`toContain` failed on the
  hard-coded 1063), green after the fix (the derived coordinate follows the
  edit); the record was restored byte-for-byte after (`git diff` empty).

  **low, CRLF readers, fixed.** `scripts/citations.mjs`'s `splitLines` is now
  exported and reused in the two callers the gate named: `review-record.mjs`'s
  `locateGateBlock` (`sectionText.split("\n", 1)[0]` kept a trailing `\r`,
  so a CRLF section resolved to the wrong `### Gate <n>` heading when two
  headings shared a title prefix) and `status.mjs`'s `parseFrontmatter`
  (`lines.indexOf("---", 1)` never matched a CRLF-terminated closing line, so
  a CRLF ticket threw "the frontmatter is never closed"). Both fixes are
  one-line, same line count, no repoint needed for either file. Reproduction:
  the gate's own `gate1-probe2.mjs` against a pre-fix checkout of `dcc7880`
  (`git archive`, node_modules symlinked in) printed
  `{"start":10,"end":13}` for the CRLF section against `{"start":14,"end":15}`
  for its LF twin — the gate's own measured mismatch, reproduced — and
  `SAME`/`DIFF` for `status.parseFrontmatter` flipped from `DIFF` (CRLF threw)
  to `SAME`. New tests at the end of `review-record.test.ts` and
  `status.test.ts`: both confirmed red against the pre-fix source (reverted
  in place, restored after) and green after.

  **low, npm abbreviations, fixed.** `deriveExtraCiCommands` now throws,
  naming the step, for any `npm …` command that does not exactly canonicalize
  to `"npm ci"` or `"npm run check"` — rather than falling through to a real
  spawn. `NPM_ALIASES` only ever rewrote its four exact spellings; npm's own
  prefix resolution also accepts an unambiguous abbreviation of any of them
  (`npm install-clea --help` and `npm isntall-cl --help` both print "Clean
  install a project", npm 10.9.9, measured), and `npm cit` is a fifth,
  unrelated alias (`install-ci-test`) this file never named. The real
  `ci.yml` check job runs only `npm ci` and `npm run check`, so this is safe
  against `deriveExtraCiCommands(REAL_CI_YAML)`'s own test, unchanged. New
  test at the end of `preflight.test.ts`: red at `dcc7880` (all three raw
  commands reached `assertSpawnable`/`tokenize` and would have been spawned,
  `toThrow` failed with "expected [Function] to throw" — reverted in place,
  restored after), green after.

  **low, wrong counts, fixed.** Measured, not assumed: this ticket's own
  "22 citations total" corrected to 29 (the breakdown already summed to 29);
  repo-48/50/52/60's "28 lines" for the `splitLines` docblock corrected to 27
  (`git diff origin/main -- scripts/citations.mjs`'s hunk is `-254,6 +254,33`,
  delta 27); repo-51's "a 5-line docblock" for the `NPM_ALIASES` paragraph
  corrected to 8 (`git diff origin/main -- scripts/preflight.mjs`'s first
  hunk is `-448,9 +448,22`, and the object literal accounts for 5 of that
  hunk's other lines, leaving 8 for the docblock paragraph — the earlier
  entry's own "net +13" stays right).

  **low, docblock placement, fixed.** The single docblock above
  `NPM_ALIASES` — which described `COVERED`, carried `COVERED`'s own
  `@type`, and had the `NPM_ALIASES` paragraph appended into it rather than
  split out — is now two: a focused docblock above `NPM_ALIASES` with only
  the alias-table paragraph and `@type {Record<string, "ci">}`, and the
  original `COVERED`-describing docblock moved to sit directly above
  `const COVERED = [`, with its own unchanged `@type
{{guard: (raw: string) => boolean, exact: string}[]}`. No test: a docblock
  has none to fail, per `common.md`'s "when nothing can fail... say so."

  **Repoints, this round.** The npm-guard addition and the docblock split
  each moved code below them in `scripts/preflight.mjs`; `node
scripts/citations-gate.mjs --against origin/main` was run after each
  source edit and named every citation it displaced. Repointed, coordinate
  only, anchor text unchanged, range width kept: `repo-51` (3, twice — once
  per edit), `repo-64` (1, twice), `repo-67` (1, twice), `repo-75` (1,
  twice), `repo-79` (6, twice, including `NPM_ALIASES`'s own declaration
  line, which moved _up_ on the second edit since the split leaves less text
  above it than the misplaced docblock had). Each is named, old line to new,
  in a dated 2026-09-28 Log line of the ticket it repoints. `node
scripts/citations-gate.mjs --against origin/main`: 0 failing after every
  repoint, each time re-verified before moving to the next edit.

  **Commands, this round**: `npx vitest run scripts/test/citations.test.ts`
  113 of 113 (1 new); `npx vitest run scripts/test/review-record.test.ts` 36
  of 36 (1 new); `npx vitest run scripts/test/status.test.ts` 130 of 130 (1
  new); `npx vitest run scripts/test/preflight.test.ts` 82 of 82 (1 new);
  `npx vitest run --project repo` 568 of 568; `npm run check` exit 0;
  `npx vitest run packages/core/test/spawn-safety.test.ts` 5 of 5; `node
scripts/citations-gate.mjs --against origin/main` exit 0, 130 enforced, 0
  failing, 6 grandfathered, 0 raised (read directly, never through a pipe);
  `node scripts/preflight.mjs --base origin/main --title "fix(repo): read
CRLF files in citations.mjs and cover every npm ci alias in preflight
(repo-82)"` exit 0 (after `git fetch origin`, needed for `mergeTree`'s two
  open release-please heads).
