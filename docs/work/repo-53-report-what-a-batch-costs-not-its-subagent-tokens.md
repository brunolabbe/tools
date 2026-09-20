---
id: repo-53
tool: repo
title: Report what a batch costs from the task output files, not from subagent_tokens
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-53 — Report what a batch costs from the task output files, not from `subagent_tokens`

## Why

Every `cost` row on the orchestration history page converts `subagent_tokens`
at a rate measured once, on 2026-09-02. That figure excludes cache reads, and
cache reads are 94 to 97% of the bill: the tenth session's own measurement was
152,659 subagent tokens against 3.9 M and 5.8 M tokens all-in for a builder and
its reviewer. The `standard` trial in `repo-28` reported an "8% saving" from
the subagent figure that was wrong by an order of magnitude once cache reads
were counted, and its pairing decision was taken on the corrected number.

So the accounting table `SKILL.md` requires at the end of every batch, and the
`cost` field the history schema requires, both report a number that is not the
cost. Every efficiency decision this loop has made — which model builds, how
many gate rounds, whether to resume or re-dispatch — was argued from it.

The real figures exist. A backgrounded `Agent` dispatch hands the orchestrator
a task output file, and `dispatching.md` records that it carries
`cache_read_input_tokens`, `input_tokens` and `output_tokens` per request, plus
`/message/model`; the tenth session read one to confirm a reviewer's model. No
script reads them.

## Build

Add `scripts/agent-cost.mjs <output-file>...` that, for each file:

- sums `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
  and `output_tokens` **one row per billed API response, grouped by request
  id, since a streamed response is logged once per content block** — not over
  every assistant record, which double- and triple-counts a streamed
  response;
- reads the model from `/message/model` and refuses a file where more than one
  value appears, naming both;
- prices the sums with a rate table keyed by model id, kept in the script with
  the date each rate was read, and prints the date beside the total;
- prints one row per file — model, four token sums, dollars — and a total row.

Then change the accounting table in `SKILL.md`'s _Reporting to the user_ and
the history schema's `cost` field to take their figures from this script, and
say that `subagent_tokens` is kept only as the series the earlier rows are in.

## Done when

- The script over a fixture of two short output files, one Sonnet and one
  Opus, prints the expected sums and dollars, grouped by billed API response
  rather than by raw assistant record, and a test asserts them against
  hand-computed values.
- A file with two model ids is refused with both named, tested.
- A rate that is missing for a model id fails loudly rather than pricing at
  zero, tested.
- The accounting table and the history schema name the script as the source
  of `cost`.
- One real batch's table is produced with it and the difference from the
  subagent-token conversion is recorded in this Log.

## Review

**Gate 1: FAIL** — 2026-09-20 · `f9d981f...ef5eb31` · defect hunt run in-agent (ticket-reviewer, Opus) at medium depth

- **high** · `sumUsage` summed every `assistant` record, but one billed API response is logged once per streamed content block plus a final record. On the real file this ticket's Log names, 438 records for 223 `requestId`s: `$60.8104` against a real `$32.7305`, 1.858× overstated — in the same direction as the `subagent_tokens` defect this ticket exists to retire. No fixture carried `requestId`, `message.id` or `stop_reason`, so nothing could fail this way. **Fixed at `4a2c218`.**
- **med** · `status` moved to `done` with two Done when lines outstanding. **Superseded at gate 2, resolved at gate 3.**
- **low** · `processFile`'s doc said "nothing here adds a fourth" while sitting on the fourth guard. **Fixed at `4a2c218`.**
- **verified** · Every rate re-read from the `claude-api` skill on disk: Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5, Fable 5.1 $10/$50 with a flat $0.25/MTok cache read; cache write 1.25× and cache read 0.1× from the prompt-caching Economics section. Nothing unverified. The 1-hour-TTL-is-zero claim holds — 1,947,455 tokens at 5m against 0 at 1h.
- **judgement** · The `noAssistantRecords` guard beyond the ticket is the fold-in exception, not scope widening: three lines on machinery already being added, closing the same "do not zero-price a bad file" hole, declared in the Log.
- **dropped** · A usage error exits 1, colliding with `EXIT.unreadableFile: 1` — `citations.mjs` has the identical collision; established pattern.
- **dropped** · `Number(...)` on a malformed `usage` field would print `$NaN` — no such field in any real file inspected.
- **findings** · 5 returned, 3 carried, 2 dropped.

**Gate 2: CONCERNS** — 2026-09-20 · `f9d981f...4a2c218` · defect hunt run in-agent (ticket-reviewer, Opus) at medium depth

- **med** · Two findings, one mechanism. The Log claimed `orchestrate-skill-sweep` "already carries" the wiring at `811b8f6`; `git grep -n -i 'agent-cost' origin/orchestrate-skill-sweep` returned only this ticket's own Build line, and `reference/history.md`'s `cost` row still named the retired conversion. That sentence was the stated justification for `status: done`. **Both corrected at `c2e0e34`; the wiring landed — see gate 3.**
- **low** · The streamed fixture's comment said the sum was `0.3125` where it is `0.31246`, and the assertion spent 80% of its tolerance. **Fixed at `c2e0e34`.**
- **low** · A test read a session-scoped absolute scratch path and returned silently when absent, asserting nothing on any other machine. **Dropped at `c2e0e34`.**
- **verified** · The grouping fix's load-bearing assumption, across all eight task output files then present (1,823 assistant records, 1,026 groups): **0** groups where the `input`/`cacheWrite`/`cacheRead` triple differs within a group, **0** ambiguous max-`output_tokens` ties, **0** records lacking both ids. A **third** site carrying the retired conversion, `reference/sizing.md`, was found and passed up; the Done when line named only two.
- **dropped** · The keep-first tie-break could take the triple from the wrong record if a group's largest `output_tokens` were tied across records with differing triples — 0 such groups in 1,026 measured.
- **findings** · 4 returned, 3 carried, 1 dropped.

**Gate 3: PASS** — 2026-09-20 · `f9d981f...c2e0e34` · defect hunt run in-agent (ticket-reviewer, Opus) at medium depth

- **low** · A comment attributed the sandbox-measuring failure mode to `.claude/rules`, which states it nowhere. **Fixed at `871bbd9`** — now cites `review-ticket/SKILL.md`'s actual line and says it is a different mechanism.
- **low** · The Log claimed two Done-when lines were satisfied where one is, and named `main` as the merge target rather than `orchestrate-skill-sweep`. **Fixed at `871bbd9`.**
- **verified** · The `.claude/` wiring landed on the base branch and was read by content at three sites: `SKILL.md`'s accounting table gains a **Cost** column sourced from `node scripts/agent-cost.mjs`, `reference/history.md`'s `cost` row is reworded off the retired conversion with pre-repo-53 rows kept as floors, and `reference/sizing.md` marks the old rate retired.
- **dropped** · Whether removing the real-file test left anything uncovered: the grouping mutation still turned 4 tests red, all guards still bit. Not a finding.
- **findings** · 3 returned, 2 carried, 1 dropped.

**Gate 4: PASS** — 2026-09-20 · `f9d981f...871bbd9` (fix round `c2e0e34..871bbd9`) · defect hunt run in-agent (ticket-reviewer, Opus) at medium depth

| Done when                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonnet + Opus fixture sums and dollars, **grouped by billed API response**, hand-computed | `scripts/test/agent-cost.test.ts:77 "dollars: expect.closeTo(0.0065, 9)"` · `scripts/test/agent-cost.test.ts:91 "dollars: expect.closeTo(0.3425, 9)"` · `scripts/test/agent-cost.test.ts:113 "expect(lines[2]).toContain(formatDollars(0.349))"` · grouping: `scripts/test/agent-cost.test.ts:151 "output: 303, // not 8 + 8 + 303 = 319"` · `scripts/test/agent-cost.test.ts:171 "expect(naiveOutput).toBe(1519);"` · `scripts/test/agent-cost.test.ts:177 "expect(priced.dollars).toBeCloseTo(0.31246, 9);"` ✓ |
| A file with two model ids is refused with both named, tested                              | `scripts/test/agent-cost.test.ts:255 "carries more than one model — claude-opus-5, claude-sonnet-5"` · `scripts/test/agent-cost.test.ts:261 "expect(result.status).toBe(EXIT.multipleModels);"` ✓                                                                                                                                                                                                                                                                                                                |
| A missing rate fails loudly rather than pricing at zero, tested                           | `scripts/test/agent-cost.test.ts:279 "no rate for model"` · `scripts/test/agent-cost.test.ts:338 "expect(result.stdout).not.toContain(unknownModelFixture)"` ✓                                                                                                                                                                                                                                                                                                                                                   |
| The accounting table and the history schema name the script                               | **verified** at gate 3 — landed on the base branch this PR targets, read by content at three sites. Not citable as `file:line` here: those lines are not in this branch's tree                                                                                                                                                                                                                                                                                                                                   |
| One real batch's table, and the difference from `subagent_tokens`                         | **unproven** — the orchestrator's at close-out, by the dispatch's scope carve-out. `status: done` asserts it ahead of that                                                                                                                                                                                                                                                                                                                                                                                       |

- **low** · The new Log entry priced `afa05eee485fb7cef.output` at `$16.8048`; it now gives **`$18.7025`**, reproduced independently. Not an error at the time — that file is a live transcript still being written (mtime `2026-09-20T14:05:26Z`, 1,519,452 bytes), so the figure moves. A reader who reruns the command will not get the recorded number. The `$32.7305` beside it is reproducible and should stay. **Fixed: the stale figure removed from the Log entry; see the entry dated after this gate.**
- **low** · `scripts/agent-cost.mjs:228 "synthetic session-limit record"` — the skip-count suffix on the `noAssistantRecords` refusal is untested; replacing its condition with `false` leaves the suite 26/26 green. The refusal and its exit bit are covered; only the wording is not. Verified by hand instead: an all-synthetic file exits **8** with `no assistant records with a model id found (1 synthetic session-limit record skipped)`. **Fixed: a test over an all-synthetic fixture closes it; see the entry dated after this gate.**
- **verified** · The synthetic fix checked across every task output file on this machine, not one: three distinct `message.model` values over 2,936 assistant records — `claude-sonnet-5` ×1486, `claude-opus-5` ×1445, `"<synthetic>"` ×5 — and **all five** synthetic records carry all-zero usage, so the skip drops nothing billed (the mirror of gate 1's defect, and it does not occur). Five of nine files carry one. All five guards mutation-tested at this tip, control 26/26 green, each restored to an empty `git status --porcelain`: synthetic → 2 red, grouping → 4, mixed-model → 3, missing-rate → 4, no-assistant → 2. The settled file is byte-unaffected at `$32.7305`. Gates: `npm run check` exit 0, agent-cost 26/26, `--project repo` 372/372, full `npm test` 176 files / 3178 tests.
- **out of range** · The base branch now tells the builder to land this record with `scripts/review-record.mjs`, which exists in neither tree — `git ls-tree -r --name-only origin/orchestrate-skill-sweep | grep review-record` exits 1, and it was added only on repo-55's unmerged branch. Raised to the orchestrator; not a finding against this commit.
- **standing note, no severity** · `status: done` is recorded while the fifth acceptance line is outstanding. Raised at gates 1 and 2, decided by the orchestrator, recorded here so a later reader sees it rather than inferring completeness from the frontmatter.
- **note on the verdict** · The fifth acceptance line is `unproven`, ordinarily FAIL. It is graded `unproven` without failing on the dispatch's explicit scope carve-out. Nothing above `low` remains, so the gate is PASS with that line standing open.
- NFR: security n/a (local file reads, no network, no credential or URL logged) · performance ✓ (`readFileSync` on a 2.2 MB file; one `Map` entry per billed response) · reliability ✓ (gate 1's high fixed and mutation-proven; the synthetic skip proven not to drop billed tokens) · maintainability — the two lows above; the rate table stays single-sourced with `RATES_READ_ON` printed beside every figure.
- **findings** · 3 returned, 2 carried, 1 dropped.

**Builder's disclosure, post-gate-4**: both of gate 4's lows reproduced for
me exactly, including a _third_ distinct dollar figure on the still-growing
file (`$18.9528` here, against the reviewer's `$18.7025` and my own earlier
`$16.8048`) — corroborating rather than contradicting the reviewer's
diagnosis that the file itself was moving, not that either of us mismeasured
it. Both fixed in the same round as this section, though the gate said
neither was a condition of the PASS: the stale figure is removed from the
Log rather than replaced with another that would also go stale, and a new
`all-synthetic.jsonl` fixture plus test closes the untested branch —
confirmed by mutating the same condition the reviewer named and watching
exactly that one new test fail, then restoring the source. Gates re-run
after both fixes: `npm run check` exit 0, `npx vitest run
scripts/test/agent-cost.test.ts` 27/27, `npx vitest run --project repo`
373/373. The "out of range" note about `scripts/review-record.mjs` is
accurate and not mine to resolve; this section was still spliced in by
hand, via `scripts/citations.mjs` and `npx oxfmt`, per the reviewer's
"keep doing what you have done."

Folding the low that added `all-synthetic.jsonl` inserted two lines and one
test above the ten `scripts/test/agent-cost.test.ts` coordinates gate 4's
table cited against `871bbd9`, moving all ten by exactly one or thirteen
lines. `scripts/citations.mjs --require-anchors --require-distinct-anchors`
caught all ten as `MOVED` before this commit and `0 moved` after; every
coordinate in the gate 4 table above is re-resolved against this commit's
own tip, not `871bbd9`, since folding the fix is what moved them. Every
changed line number, named as old line number to new line number so
neither reads as a citation on its own: line 76 became line 77, line 90
became line 91, line 112 became line 113, line 150 became line 151, line
170 became line 171, line 176 became line 177, line 242 became line 255,
line 248 became line 261, line 266 became line 279, and line 325 became
line 338. `scripts/agent-cost.mjs`'s line 228 (gate 4's one non-test
citation) was not touched this round and needed no change. Gates 1
through 3's citations are prose only (shas and file names, no
`file:line`), so none of them needed re-resolution.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  which found no cost decision in twenty-three sessions taken on the bill.
- 2026-09-20 — Built `scripts/agent-cost.mjs` plus
  `scripts/test/agent-cost.test.ts` and its fixtures under
  `scripts/test/fixtures/agent-cost/`, on branch `repo-53-agent-cost` off
  `orchestrate-skill-sweep` (`f9d981f`). Sums the four `usage` fields over
  every assistant record per file (verified against a real task output file,
  `agent-ac9491c3ec452c459.jsonl`, whose 438 assistant records were all one
  model — the multi-model and no-assistant-record fixtures had to be built by
  hand since no real file on this machine exercises either), refuses a file
  with two model ids or an unrated model id (both tested, both exit loudly
  rather than pricing at zero), and refuses a file with no assistant records
  too — a guard the ticket did not ask for but that the same "don't zero-price
  a bad file" reasoning covers for free, so it is folded in here rather than
  filed separately. Rates for `claude-opus-5`, `claude-sonnet-5`,
  `claude-haiku-4-5-20251001` and `claude-fable-5-1` read 2026-09-20 from the
  `claude-api` skill's cached table plus `shared/prompt-caching.md`'s
  Economics section (cache write 1.25× input at the default 5-minute TTL,
  cache read 0.1× input except Fable 5.1's flat $0.25/MTok) — recorded as
  `RATES_READ_ON` in the script and printed beside every row's dollar figure,
  not split by cache TTL since the ticket's summed field doesn't distinguish
  them either.

  **Scope was narrowed by the dispatch, not by this ticket**: I was told not
  to touch anything under `.claude/`, so `SKILL.md`'s accounting table and
  `reference/history.md`'s `cost` field are _not_ changed here — that wiring
  is the orchestrator's to do after this branch merges. The text I would have
  written, for the orchestrator to use or adjust:

  - `SKILL.md`'s accounting table (`### End every batch with a per-agent
accounting table`): add a **Cost** column, priced by running
    `node scripts/agent-cost.mjs <task-output-file>` over each agent's own
    output file rather than converting `subagent_tokens`; keep the **Tokens**
    column and its three caveats exactly as they are, but add a line saying
    `subagent_tokens` is now kept only as the series the pre-repo-53 rows are
    already in, not as a cost proxy.
  - `reference/history.md`'s schema table: reword the `cost` row from "the
    conversion measured 2026-09-02 was $0.0182 per 1k subagent tokens" to
    something like _"actual dollars from `scripts/agent-cost.mjs` over the
    batch's task output files, with the date `agent-cost.mjs` printed beside
    its own total — not a `subagent_tokens` conversion, which `repo-53`
    retired because it excludes cache reads (94–97% of the bill)."_
  - The last "Done when" line — one real batch's table produced with the
    script, and the difference from the old `subagent_tokens` conversion
    recorded here — needs a real task output file from a live batch, which a
    narrowed-scope build dispatch does not have; that is the owner's to do
    once this merges and the `.claude/` wiring lands, not left silent.

  Gates run in this worktree: `npm run check` (exit 0 after fixing one
  `unicorn/no-array-sort` lint error and adding `agent-cost.mjs` to
  `scripts/test/tsconfig.json`'s `include`, both fixed here — the `tsconfig`
  omission is the kind next-id.mjs's own comment already warns about), `npx
vitest run scripts/test/agent-cost.test.ts` (19/19 passed),
  `npx vitest run --project repo` (365/365 passed), full `npm test` (exit 0;
  176 files, 3171 tests, all passed — run because `scripts/test/tsconfig.json`
  is shared config).

- 2026-09-20 — **The Build line was wrong, and gate 1 caught it**: "sums ...
  over every assistant record" double- and triple-counts. A backgrounded
  `Agent` dispatch logs one billed API response once per streamed content
  block plus a final record, all sharing one `requestId` and `message.id` and
  carrying identical `input_tokens`/`cache_creation_input_tokens`/
  `cache_read_input_tokens` — only `output_tokens` climbs across them, ending
  at the true figure on the final record. On the real file this ticket's own
  Log names (`ac9491c3ec452c459.output`), that is **438 assistant records for
  223 billed responses**: the script priced it at $60.8104 against the real
  $32.7305, an 1.858× overstatement — in the same direction, on the very first
  file it was pointed at, as the `subagent_tokens` defect this ticket exists
  to retire. The reviewer's premises all reproduced exactly (byte-identical
  sums, byte-identical dedup-by-`requestId` total, byte-identical worked
  example at that file's lines 10/11/13); this was not a disagreement, only a
  brief that needed correcting once a real streamed file was checked against
  it — no fixture in the original build carried `requestId`/`message.id`, so
  nothing could have caught this before a real file was tried.

  Fixed `sumUsage` to group assistant records by `requestId ?? message.id`
  (a record with neither is its own group, by line number, rather than
  merging with an unrelated one) and keep each group's largest `output_tokens`
  plus that same record's other three fields, summing only across groups.
  `stop_reason` was considered and rejected as the grouping key, per the
  reviewer's measurement: its non-null count disagreed with the `requestId`
  count on two of the four sampled files (91-vs-89, 148-vs-150), where
  `requestId` and `message.id` agreed exactly on all four. Amended the Build
  and first Done-when lines above to say so. Added
  `scripts/test/fixtures/agent-cost/streamed.jsonl` (three records sharing one
  `requestId`, built from the real worked example's 8/8/303 output-token
  shape, plus a second distinct response) and four tests: the grouped sum on
  an inline three-record stream, the fixture's grouped sum against a
  naive/ungrouped sum shown to disagree (1503 vs 1519), the priced dollar
  figure, the CLI's own output, and — when the scratch file is present on the
  machine running the suite — a direct check against the real file's numbers
  ($32.7305, `input=446 cacheWrite=627777 cacheRead=48194756 output=188291`),
  skipped rather than failed where that file is absent.

  Also fixed the reviewer's low: `processFile`'s doc comment said "three ways
  this can fail ... nothing here adds a fourth" while sitting directly on the
  fourth (`EXIT.unreadableFile`).

  **`status` stays `done`, on the orchestrator's direction, not reverted to
  `in-flight` as the reviewer's med recommended.** The two lines that
  recommendation was about — the accounting table and history schema wiring,
  and the real-batch table — are meant to land on `orchestrate-skill-sweep` in
  the same pull request before anything merges. (Whether that wiring already
  existed there at the time of this entry is corrected in the entry below,
  after gate 2 checked it and found it did not yet.)

  Gates re-run after the fix: `npm run check` exit 0; `npx vitest run
scripts/test/agent-cost.test.ts` 24/24 passed; `npx vitest run --project
repo` 370/370 passed. Full `npm test` not re-run a second time in this round
  — no shared config changed beyond the prior round's `tsconfig.json` entry,
  already covered.

- 2026-09-20 — Gate 2 independently re-verified the fix against the exact
  file (`$32.7305`, byte-identical) and mutation-tested it on top, and found
  two things I got wrong. First, a false factual claim in the entry above:
  I wrote that `orchestrate-skill-sweep` "already carries" the `SKILL.md`/
  `reference/history.md` wiring at `811b8f6` — it does not, which I
  reproduced myself with `git grep -n -i 'agent-cost'
origin/orchestrate-skill-sweep` (one hit: this ticket's own Build line) and
  `git show origin/orchestrate-skill-sweep:.claude/skills/orchestrate-tickets/reference/history.md`
  (its `cost` row still names the retired subagent-token conversion). That
  sentence is corrected above rather than left standing; the false claim
  originated in a premise handed to me, not something I checked before
  writing it down. Second, two lows in the streamed-fixture test I added:
  the hand-computed comment said `0.3125` where the real figure is `0.31246`
  (fixed, and tightened the assertion to `toBeCloseTo(0.31246, 9)` to match
  the other two fixtures' precision), and a fifth test that read the real
  scratch file directly returned silently rather than failing on any machine
  where that session-scoped path is absent — dropped, since the fixture
  already gives equivalent coverage without depending on a path this suite
  cannot guarantee.

  One more thing gate 2 found and flagged as not mine to fix, for whoever
  writes the `.claude/` wiring: the retired "$0.0182 per 1k subagent tokens"
  conversion also lives in a third place the Done-when line does not name,
  `reference/sizing.md:26` on `orchestrate-skill-sweep`.

  Gates re-run after these fixes: `npm run check` exit 0; `npx vitest run
scripts/test/agent-cost.test.ts` (23/23 — one net fewer test, the dropped
  real-file check); `npx vitest run --project repo` (369/369).

  **Resolved**: the "already carries" claim was wrong when written (the
  wiring was in the orchestrator's own working tree, not pushed), and the
  orchestrator has since pushed it for real. `orchestrate-skill-sweep` is now
  at `56d5564`, confirmed by me with `git fetch origin` +
  `git grep -c agent-cost origin/orchestrate-skill-sweep -- .claude`, which
  returns exactly three files —
  `.claude/skills/orchestrate-tickets/SKILL.md` (a **Cost** column sourced
  from `node scripts/agent-cost.mjs`),
  `.claude/skills/orchestrate-tickets/reference/history.md` (the `cost` row
  reworded off the retired conversion, with pre-repo-53 rows kept as
  historical floors on the old unit), and
  `.claude/skills/orchestrate-tickets/reference/sizing.md` (the third site
  gate 2 found, now marked "Retired by repo-53 on 2026-09-20"). `status:
done` on this ticket now rests on a landed fact, not a premise — **one** of
  the two previously-outstanding Done-when lines (the accounting table and
  history schema naming this script) is satisfied once this branch and
  `orchestrate-skill-sweep` both merge — this branch merges into
  `orchestrate-skill-sweep`, not directly into `main`. The other, the fifth
  Done-when line (one real batch's table, and the difference from the
  subagent-token conversion recorded here), remains the orchestrator's to
  produce at close-out, as recorded above — gate 3 flagged that `status:
done` still asserts it ahead of that happening, which is accurate and
  left standing rather than reverted, per the orchestrator's repeated
  direction on this line.

- 2026-09-20 — Gate 3 passed at `c2e0e34` (both gate-2 lows fixed correctly,
  the wiring verified by content at all three sites, nothing above `low`),
  and flagged two new lows, folded into this round rather than opened as a
  fourth: the dropped-test comment cited `.claude/rules` for a failure mode
  stated nowhere there (`grep -rn -i 'measure the sandbox' .claude/rules/`
  exits 1) — corrected to point at
  `.claude/skills/review-ticket/SKILL.md`'s actual nearby statement, noting
  it is a different mechanism; and this Log's own closing paragraph said
  "the two previously-outstanding Done-when lines are satisfied" one
  sentence before naming a still-outstanding fifth — one is satisfied, not
  two, and this branch merges into `orchestrate-skill-sweep`, not `main`
  directly. Both fixed above and in `scripts/test/agent-cost.test.ts`.

  Separately, the orchestrator ran the script for real over this session's
  own task output files and found a fourth guard the ticket never
  anticipated: **the brief assumed every assistant record names a billed
  model**, and one does not. A request that hits the account's session
  limit (HTTP 429) is logged as an assistant record with
  `message.model: "<synthetic>"` and all-zero usage — not a second model,
  an error marker — and the multiple-model guard was refusing any file a
  limit touched mid-session, which reproduced exactly:
  `node scripts/agent-cost.mjs afa05eee485fb7cef.output` refused with
  `carries more than one model — <synthetic>, claude-opus-5` before this
  fix. Fixed by skipping a `"<synthetic>"` record from both the model check
  and the grouped sums, counting it, and printing the count beside its row
  (`(N synthetic records skipped)`) and the total row — visible rather than
  silently folded in. The previously-refused file — a still-growing live
  transcript at the time — priced with `(1 synthetic record skipped)`
  instead of refusing; its dollar figure moves with the file and is not
  recorded here for that reason (gate 4 caught the first recording of it
  going stale within the hour). The settled file
  (`ac9491c3ec452c459.output`, which has none) is unaffected and still
  gives exactly `$32.7305`. Added
  `scripts/test/fixtures/agent-cost/synthetic.jsonl` (the `opus.jsonl` pair
  with one synthetic record between them) and three tests: the grouped sum
  with the skip counted, the CLI's row and skip note, and a file with no
  synthetic records printing no skip note at all.

  Gates re-run: `npm run check` exit 0; `npx vitest run
scripts/test/agent-cost.test.ts` (26/26 — three net new tests over gate
  3's 23); `npx vitest run --project repo` (372/372).

- 2026-09-20 — Gate 4 passed at `871bbd9` (the synthetic fix verified across
  all nine task output files on the reviewer's machine — three distinct
  `message.model` values over 2,936 assistant records, and all five
  synthetic records carrying all-zero usage, so the skip drops nothing
  billed), and found two lows. First, the `$16.8048` this Log recorded for
  `afa05eee485fb7cef.output` did not reproduce — the reviewer got
  `$18.7025`, and I reproduced neither: a third run here gave `$18.9528`.
  All three of us were right at the moment we ran it; that file is a live
  transcript still being written (the reviewer measured its mtime moving),
  so the figure is not a fact about the script, it is a fact about a file
  mid-write. Removed the stale number from the entry above rather than
  replace it with a fourth one that would also go stale; the reproducible
  `$32.7305` beside it, against the settled file, stays. Second, the
  skip-count wording on the `noAssistantRecords` refusal
  (`scripts/agent-cost.mjs`'s `syntheticSkipped > 0` branch) was untested —
  mutating it to `false` left the suite green, reproduced here exactly.
  Added `scripts/test/fixtures/agent-cost/all-synthetic.jsonl` (one
  synthetic record, nothing else) and a test asserting both the refusal
  message and its exit bit; confirmed the same mutation now fails exactly
  that one test before restoring the source.

  Gates re-run: `npm run check` exit 0; `npx vitest run
scripts/test/agent-cost.test.ts` (27/27 — one net new test over gate 4's
  26); `npx vitest run --project repo` (373/373).

- 2026-09-20 — Orchestrator, closing the fifth Done when line after the merge into `orchestrate-skill-sweep`: `node scripts/agent-cost.mjs` over the nine subagent transcripts of the batch that built this ticket gives **$195.40** (input 4,250 · cache write 8,792,557 · cache read 476,993,037 · output 1,469,529; five synthetic session-limit records skipped; rates read 2026-09-20). The same nine agents sum to about 2.75 M `subagent_tokens` as last observed, which the retired conversion priced at about $50 — the old figure was roughly a quarter of the bill, in the direction the Why predicts. One Opus gate of four rounds alone came to $32.73. The table is in #281's body.
