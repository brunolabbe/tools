---
id: repo-52
tool: repo
title: A citation into a .claude page is pinned or names a heading, and the existing ones get pinned once
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-52 — A citation into a `.claude` page is pinned or names a heading, and the existing ones get pinned once

## Why

The skill and agent pages under `.claude/` are prose that the loop edits every
few sessions, and roughly a thousand coordinates in merged records point into
them by bare line number. Every insertion into one of those pages displaces
every unanchored coordinate below it, silently: the citations gate reads
`## Review` sections only, and an unanchored citation is reported `unanchored`
whatever line it now lands on.

Measured on #281, 2026-09-20. A sweep of the rule pages went through four gate
rounds; three of them were this class. Gate 1 found 11 anchored citations
outside `## Review` broken by the branch, gate 2 found four unanchored ones
displaced by gate 1's own repair, gate 3 found one more in the tool root the
sweep had not read. The branch ended by pinning 35 citations across eleven
merged records to its base sha, by hand, with a script that lived in a
scratchpad. `repo-50` files the detector; this ticket removes the need for it
on these pages, which are the ones that move.

A coordinate into a `.claude` page is a claim about the page as it stood on the
day, never about the page as it will stand. That is what a pin says. A heading
is stable across edits in a way a line number is not, and every rule on these
pages sits under one.

## Build

1. Add the rule to `records.md`'s citation section and to `review-ticket` step
   4: a citation into any file under `.claude/` is written either pinned,
   `<file>@<rev>:<line>` with `<rev>` a `main` commit, or as the page and the
   heading it sits under, with no line number. A bare `file:line` into
   `.claude/` is a finding.
2. One mechanical pass over both ticket roots, `docs/work/*.md` and
   `tools/*/docs/work/*.md`: every unpinned coordinate into `.claude/` gets
   `@<rev>` where `<rev>` is the newest `main` commit at which the cited line
   still reads as the record's context describes — the commit before the page
   was next edited, found with `git log -L` or the sweep in `repo-50`'s Why.
   Where no such commit exists, leave the citation and list it in the Log. Do
   not change any text that is not a pin.
3. Make `citations.mjs` report an unpinned coordinate into `.claude/` as its
   own state, `unpinned-volatile`, off by default and on under a flag the gate
   passes, so the rule has a check.

Run the pass after #281 merges, not before: #281 pins 35 of these already and
the two would conflict on every one of them.

## Done when

- The rule is on both pages, with this ticket as its measurement.
- `git grep -nE '\.claude/[^@ ]*\.md:[0-9]'` over both ticket roots returns only
  the citations the Log lists as unpinnable, with a reason each.
- A test plants an unpinned coordinate into `.claude/` in a record and the
  flagged run reports it; the same record with the pin passes.
- The pass is a single commit touching pins only, proven by a
  whitespace-insensitive diff with equal line counts per file.

## Review

**Gate: CONCERNS** — 2026-09-20 · `f9d981f...852e47f` · defect hunt run directly by this reviewer (no `Skill` tool; `code-review` not delegated), dispatched as opus against a sonnet build

| Done when                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The rule is on both pages, with this ticket as its measurement                                                          | **unproven** — out of this branch's scope: the orchestrator scoped the builder to steps 2 and 3 and the Log records the deferral. Verified the text landed on the base instead, at `origin/orchestrate-skill-sweep` `24af376`, under `records.md`'s "A citation into any file under `.claude/`" rule and `review-ticket` step 4. Does not set this gate, on the orchestrator's explicit instruction                                                                                                                                                                                                                        |
| 2. `git grep -nE '\.claude/[^@ ]*\.md:[0-9]'` returns only the Log's unpinnable citations, with a reason each              | **verified** — re-run over both roots returns 5 lines: repo-21 219, 1174, 1180, plus 2 in this ticket's own Log naming those same three. The reason for 219 independently proved: `git log -S'\| \`mechanical\` \| \`sonnet\` \|' -- .claude/agents/builder.md`returns zero commits, so no rev verifies it. **Caveat**: the grep is literal and cannot see the shorthand spelling — three unpinned shorthand`.claude` coordinates survive in repo-21 (med 2 below)                                                                                                                                                         |
| 3. A test plants an unpinned `.claude` coordinate and the flagged run reports it; the same record with the pin passes      | **proven** — `scripts/test/citations.test.ts:2354 "expect(strict.status).toBe(EXIT.unpinnedVolatile)"` and `scripts/test/citations.test.ts:2370 "a pinned citation into a .claude page passes"`; off-by-default half at `scripts/test/citations.test.ts:2323 "a bare citation into a .claude page is invisible"`; the more-specific-state half at `scripts/test/citations.test.ts:2413 "expect(unresolvable?.state).toBe"`. Falsifiable: inverting the pin guard at `scripts/citations.mjs:1209 "export const isUnpinnedVolatile"` reds exactly those first two and nothing else; restored, `git status --porcelain` empty |
| 4. The pass is a single commit touching pins only, proven by a whitespace-insensitive diff with equal line counts per file | **verified** — `45fdf15` alone, 5 files; `git show -b --numstat 45fdf15` → 4/4, 2/2, 1/1, 1/1, 1/1. All 9 changed lines are pure `@<rev>` insertions, no anchor text altered. 7 distinct revs newly added, 32/32 pin occurrences ancestors of `origin/main` `c383eab` by `git merge-base --is-ancestor`, 0 not                                                                                                                                                                                                                                                                                                             |

- **med** · The Log's "the corpus is clean, not just the gated slice" holds only for _anchored_ citations. Rewriting both scripts moved `scripts/citations.mjs` from line 184 on and `scripts/citations-gate.mjs` from 267 on, and 30 unanchored coordinates into them — repo-14 (4), repo-21 (5), repo-24 (4), repo-35 (17), none declared evidence — now resolve to different content than at `f9d981f`. repo-24 record line 327 cites, at `852e47f`, `scripts/citations.mjs` line 222, for an EOF bounds check, and now lands on a comment about 13 matches. The two anchored ones (repo-29, at `852e47f`, `scripts/citations.mjs` lines 827 and 1178) were already `MOVED` at `f9d981f` and are unchanged. **Open decision**: pin the 30, or soften the claim and leave them to repo-50's detector; recommend the latter plus the Log correction.
- **med** · `--require-claude-pins` does not fire on a `.claude` citation written in shorthand: `scripts/citations.mjs:1209 "export const isUnpinnedVolatile"` matches `scripts/citations.mjs:1170 "const CLAUDE_PAGE"` against the raw path token, not the resolved path. repo-21 carries three (at `852e47f`, `reference/defect-shapes.md` line 41, at record lines 347, 750, 806) which the flagged run reports `unanchored`. Breaks no acceptance line; the new rule is enforceable only against the literal spelling. **Open decision**: match the resolved path, or record the gap.
- **med** · The override is applied inside `checkCitations` and `applyDeclarations` runs after it, so an `<!-- citations: evidence -->` covering a bare `.claude` citation cannot excuse it — at `852e47f`, `scripts/citations.mjs` line 1246 ("const FAILING = new Set([\"unresolvable\", \"moved\", \"unchecked\"])", now at line 1278) has no `unpinned-volatile` — and the declaration is then reported stale saying "it does not fail — drop the declaration" in a run that exits 72. At `852e47f`, `scripts/citations.mjs` line 1185, "cannot see and must not talk over", says `evidence` is excluded to avoid talking over a human declaration; `checkCitations` never returns that state, so the exclusion is unreachable and the docblock describes the opposite of what happens. **Open decision**: keep the behaviour and fix the docblock and the stale message, or honour the declaration by ordering declarations first; recommend the former.
- **low** · Log arithmetic: "11 real citations pinned" with a breakdown summing to 10; the pass adds 9 pins on 9 lines, repo-21 at 4 rather than 5. The count of distinct revs is right.
- **low** · repo-21 line 219 is left bare for a reason that holds, but the identical demonstration at record line 1174 is closed with an evidence declaration and 219 is not; one would be accepted, since the citation is `moved` with its anchor found nowhere else in the file. Pre-dates this branch.
- **dropped** · none.
- **findings** · defect hunt at medium against `f9d981f...852e47f` returned 5; 5 carried, 0 dropped.
- NFR: security n/a · performance — one regex per citation, gate summary unchanged at `97 enforced, 0 failing` · reliability — the declaration/override ordering, med 3 above · maintainability — the unreachable `evidence` exclusion and its docblock, med 3 above.
- Not walked, as the diff cannot touch them: cross-tool imports, `AppError` taxonomy, SSRF, redaction, process trees, Dockerfile closure, contract packages. Walked and clean: no shell (the new tests use `spawnSync("node", [...])` with an argument array), no `console`, no new imports so no `node:` question, no `any` — `npm run check` exit 0 — and the new tests run in the already-registered `repo` project, 350/350 versus 346 at `f9d981f` (86 `test(` blocks at the tip against 82 at the base, zero deleted `test(` or `expect` lines in the test diff).

**Transcription note, by the builder.** The section above is the reviewer's text, committed as sent — its findings, verdicts, severities and wording are unchanged. Only coordinate tokens moved, per `records.md`'s repair for exactly this case (base `origin/orchestrate-skill-sweep`, `24af376`, applied today by the repo-51 and repo-55 builders too): a citation into a page this same round edited again is repointed where the anchor still resolves, and rewritten as prose naming the reviewed tip where it cannot. Not a pin — a pin would name a commit that exists only on this feature branch and will not survive its own squash — and not a declaration, since three of the coordinates are `unanchored`, which `applyDeclarations`'s `FAILING` set does not carry (by design, so a bare `.claude` citation cannot be waived instead of pinned). Eight tokens, old form to new:

- Done when 3 and med 2, the `isUnpinnedVolatile` export citation — was `citations.mjs` colon eleven-eighty-nine, "export const isUnpinnedVolatile" — repointed to colon twelve-oh-nine, same anchor (round 2's med-2 fix pushed the line down twenty).
- Med 3, the `FAILING` set citation — was `citations.mjs` colon twelve-forty-six, "const FAILING = new Set" and the rest of that line — rewritten as prose naming `852e47f` and both the reviewed line and the current one (line thirteen-seventy-eight), not a bare repoint: the anchor's own escaped quotes truncate what `citations.mjs` reads before the first literal quote mark, so it never matched even at `852e47f` — a defect in the anchor's escaping, not in its line number, and no coordinate fix closes it.
- Med 3, the "cannot see and must not talk over" citation — was `citations.mjs` colon eleven-eighty-five — rewritten as prose naming `852e47f`, anchor quote kept: fixing the defect this line names deleted the sentence outright, so there is no "now" to repoint to.
- Med 1, repo-24's own citation (a shorthand the review's prose inherits) — was colon two-twenty-two — rewritten as prose naming `852e47f`.
- Med 1, repo-29's own two citations — were colon eight-twenty-seven and colon eleven-seventy-eight — rewritten as prose naming `852e47f`; the second no longer parses as a reference at all once written this way (the prose scanner reads one number before "and", not both), which is a smaller claim than a citation and the more honest one.
- Med 2, the `defect-shapes.md` citation — was colon forty-one — rewritten as prose naming `852e47f`.

Verified after: `node scripts/citations.mjs docs/work/repo-52-....md --section Review --require-anchors --require-distinct-anchors` exits 0 (7 verified, 0 moved, 0 unanchored, 12 unchecked); `node scripts/citations-gate.mjs --against origin/main` exits 0 corpus-wide, no `GRANDFATHERED` entry added.

One deviation from what was asked, disclosed rather than silent: the orchestrator's count was four repointed, four rewritten as prose. It is three and five — the `FAILING`-set citation could not be cleanly repointed for the escaping reason above, so it went to prose instead, alongside the "cannot see and must not talk over" one.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  after #281 had paid three gate rounds for this class. Ordered after #281.
- 2026-09-20 — Built steps 2 and 3 (step 1's rule text and its two page edits
  are the orchestrator's, deferred by dispatch — the rule text is in this
  builder's report). Both ticket roots swept for `\.claude/[^@ ]*\.md:[0-9]`:
  **9 pins on 9 lines** to the `main` commit that wrote the citing line (found
  by `git blame -L <n>,<n>` on the record, matching the ticket's practical
  form), across repo-21 (4), repo-43 (2), repo-45 (1), pl-46 (1), pl-47 (1) —
  corrected here from an original count of "11 across repo-21 (5)...", which
  summed to 10 and both double-counted a pre-existing pin on the same line as
  a new one and miscounted repo-21's own share; caught by gate 1, reproduced
  against `git show -b --numstat 45fdf15`. The distinct-rev count, 7, was
  right the first time. One citation (repo-21 line 219,
  `.claude/agents/builder.md:22 "sonnet"`) looked pinnable but is a
  _demonstration_ of defect 1's wrong claim — no commit ever holds "sonnet" at
  that line, since the table has always read "haiku" there, independently
  reproduced by gate 1 with `git log -S` — so it is left bare and now named in
  the existing `<!-- citations: evidence -->` declaration at line 1180
  alongside the line it already covered, rather than left merely disclosed:
  gate 1 found an accepted remedy sitting unused one line away. Same
  treatment does not apply to the declaration line and the citation it
  originally excused (`.claude/agents/builder.md:21-25`), which stay bare by
  the mechanism's own design — a declaration names a location, it does not
  carry one. `git grep -nE '\.claude/[^@ ]*\.md:[0-9]'` over both roots now
  returns only those three lines. Verified every new pin resolves
  (`node scripts/citations.mjs <record>`, no `unresolvable`); proved pins-only
  with `git diff -b --stat` (equal insertions/deletions per file); committed
  alone before any code change (`45fdf15`).

  `citations.mjs` gained `requireClaudePins` (CLI flag `--require-claude-pins`,
  default off) and a new state, `unpinned-volatile`: an otherwise `verified` or
  `unanchored` citation into a `.claude/*.md` file with no pin. Failing states
  (`unresolvable`, `moved`, `malformed-pin`) and `unchecked`/`evidence` are
  left alone — see `isUnpinnedVolatile`'s docblock. `citations-gate.mjs` turns
  the flag on unconditionally for the `## Review` scope it already enforces
  (zero existing `## Review` citations hit it — verified before wiring it in).
  Two tests plant a bare `.claude/...md:N` citation: one shows it is invisible
  without the flag (`ok`, exit 0, byte-identical to before), one shows the
  flagged run reports `UNPINNED`/`unpinned-volatile`/exit 64; a third shows the
  pinned form passes under the flag; a fourth shows the override does not
  touch an already-`moved`/`unresolvable` citation.

  Editing `citations.mjs`/`citations-gate.mjs` shifted absolute-line citations
  into them from 8 other already-merged tickets (repo-14, repo-25, repo-29,
  repo-31, repo-35, repo-36, repo-37, repo-44) — confirmed against `45fdf15`
  (this ticket's own pre-code-change commit) which were pre-existing debt and
  which this branch newly broke, and pinned only the newly-broken ones to
  `fdafd1a` (`origin/main`'s tip and this branch's merge-base; verified
  `scripts/citations.mjs`/`citations-gate.mjs` byte-identical there to
  `45fdf15`, so the pin is permanent and does not depend on this branch's own
  commits surviving a squash merge). `node scripts/citations-gate.mjs --against
origin/main` is back to `97 enforced, 0 failing`, matching the corpus before
  any of this ticket's code changes. Also fixed a circular JSDoc type
  (`unpinnedVolatile`'s param typed against `checkCitations`'s own return
  type) that TypeScript silently resolved to `any`, surfacing as six TS7006
  errors elsewhere in the test file.

  Gates: `npm run format` (708 files, only cosmetic re-wrap of a line I added);
  `npx vitest run --project repo` 350/350; `npm run check` exit 0;
  `node scripts/citations-gate.mjs --against origin/main` exit 0 (`97
enforced, 0 failing; 7 grandfathered, holding 2 unresolvable, 21 unanchored;
0 raised`). A whole-corpus sweep (179 records, `node scripts/citations.mjs
<record>` and `--rev 45fdf15`, compared) found and closed one more
  regression outside `## Review` scope (repo-37) that the gate itself would
  not have caught. **Correction, from gate 1: every anchored citation is
  clean, not the whole corpus** — that sweep compares printed _state_, and an
  `unanchored` citation's state never changes when its target drifts, so 30
  more coordinates into the same two files, all unanchored, resolved to
  different content than at `f9d981f` and were invisible to it. See the
  2026-09-20 (round 2) entry below for the count actually pinned and why it
  differs from 30.

- 2026-09-20 (round 2) — Gate 1 (ticket-reviewer, opus) returned CONCERNS at
  `852e47f`: three `med`, two `low`, all reproducible, none blocking a `Done
when` line. Verdicts and repairs, each reproduced before acting on it:
  - **med 1, accepted** — the unanchored-drift gap above. Own sweep (state
    comparison per citation, `--rev f9d981f` against the tip, restricted to
    citations into the two edited scripts) found **37** displaced unanchored
    coordinates across **six** records, not the reviewer's 30 across four:
    repo-14 (4), repo-18 (2), repo-21 (5), repo-24 (4), repo-25 (1), repo-35
    (21). The gap is real in both directions — repo-18 and repo-25 were
    outside the reviewer's sample, and repo-35's 21 against their 17 is a
    counting-method difference (occurrences vs. unique coordinates), not
    disclosed further since the owner's decision was to pin regardless of the
    exact count. Pinned 34 of the 37 to `fdafd1a` (verified
    `scripts/citations.mjs`/`scripts/citations-gate.mjs` byte-identical there
    to `f9d981f`); left 3 bare, each because the record's own text says the
    stale content is the point: repo-14 record lines 237-238 ("They are the
    finding's own evidence, so they stay as written" — an explicit disclaimer,
    not inferred) and repo-25 record line 196 (a backticked port number,
    `` `:443` ``, that is itself the ticket's demonstration of the
    port-vs-shorthand ambiguity `citations.mjs`'s own docblock warns about;
    requalifying it into a real citation would change what it demonstrates).
    Verified with the same per-record sweep re-run (0 remaining, matching the
    3 left bare) and `node scripts/citations-gate.mjs --against origin/main`
    (`97 enforced, 0 failing`, unchanged).
  - **med 2, accepted** — `isUnpinnedVolatile` tested the citation's raw
    `file` token, invisible to a shorthand or basename-resolved coordinate.
    Reproduced the reviewer's three-hit case
    (`repo-21-...loop.md --require-claude-pins`, `reference/defect-shapes.md`
    at record lines 347, 750, 806) before fixing. Fixed to test `resolved`
    instead. Measured the blast radius over both roots before deciding
    anything, per the orchestrator's condition: **8** newly-reachable
    `unpinned-volatile` coordinates corpus-wide, **6** of them shorthand or
    basename form (invisible before the fix) — small enough to pin outright
    rather than report and stop. Pinned 6 (repo-20 ×2, repo-21 ×3, repo-43
    ×1, same `git blame`-on-the-record-line method as the original pass); left
    2 bare, both in this ticket's own Log above, both already-disclosed
    unpinnable demonstrations (the `builder.md:22`/`:21-25` pair). New test:
    `scripts/test/citations.test.ts` "`--require-claude-pins` catches a
    shorthand into a .claude page, not only an inline one".
  - **med 3, accepted the behaviour, fixed the two things describing it
    wrongly** — `isUnpinnedVolatile`'s docblock claimed `evidence` was
    excluded from the override; `checkCitations` runs before
    `applyDeclarations` ever assigns that state, so the exclusion described a
    branch nothing could reach. Docblock corrected to say so, and to point at
    `applyDeclarations`'s own `FAILING` set, which is where a declared-evidence
    `.claude` citation is actually refused (deliberately — the fix is a pin,
    and a waiver standing in for it is a rubber stamp, the same reasoning
    `isIndistinct`'s refusal already uses). The stale-declaration message
    reproduced as reported — "it does not fail" for a citation failing on bit
    64, at exit 72 — because `applyDeclarations` only distinguished "cited"
    from "not cited", not "fails on a bit it does not excuse". Given a third
    branch, naming `unpinned-volatile` specifically. New test:
    "a declaration cannot excuse unpinned-volatile, and the stale message
    says why".
  - **low 1, accepted** — Log arithmetic wrong twice over: "11" summing to 10,
    and repo-21 at 5 rather than 4 (`git show -b --numstat 45fdf15`: 4/4, 2/2,
    1/1, 1/1, 1/1 = 9, not 11; one pin — `builder.md@fdafd1a:22` — was already
    on the `-` side of the line I touched, so counted twice). Corrected above,
    in the original entry rather than by editing history.
  - **low 2, accepted** — repo-21 line 219 had the same remedy line 1174
    already used and wasn't using it. Extended the existing declaration at
    line 1180 to also name `.claude/agents/builder.md:22` (one comma, no new
    line, so nothing below it shifts) rather than adding a second comment —
    verified the citation now reports `evidence` and the record's exit code
    drops from `3` to `1` (the one remaining is the pre-existing, unrelated
    `file.test.ts:88` illustration).

  No gate 2: the owner's budget decision, relayed by the orchestrator. Round
  2's fixes are verified by their own new tests
  (`npx vitest run scripts/test/citations.test.ts scripts/test/citations-gate.test.ts`,
  129/129, up from 127) and by the mechanical checks above, not by a second
  review round. Gates re-run clean after every change in this entry:
  `npm run format`; `npx vitest run --project repo` 350/350; `npm run check`
  exit 0; `node scripts/citations-gate.mjs --against origin/main` exit 0
  (`97 enforced, 0 failing; 7 grandfathered, holding 2 unresolvable, 21
unanchored; 0 raised`, unchanged throughout). Diff stayed within
  `scripts/citations.mjs`, `scripts/citations-gate.mjs`, their tests, this
  ticket, and pin-only edits to seven other records (repo-14, repo-18,
  repo-20, repo-21, repo-24, repo-35, repo-43 — repo-25's own gap was
  considered and left as disclosed debt, not a pin), matching the condition
  given.
