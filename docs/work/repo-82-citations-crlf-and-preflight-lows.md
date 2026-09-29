---
id: repo-82
tool: repo
title: citations.mjs reads a CRLF file the same as its LF form, and preflight covers every npm ci alias
kind: fix
status: ready
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
