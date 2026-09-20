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
  silently folded in. The previously-refused file now prices at `$16.8048`
  with `(1 synthetic record skipped)`; the settled file
  (`ac9491c3ec452c459.output`, which has none) is unaffected and still
  gives exactly `$32.7305`. Added
  `scripts/test/fixtures/agent-cost/synthetic.jsonl` (the `opus.jsonl` pair
  with one synthetic record between them) and three tests: the grouped sum
  with the skip counted, the CLI's row and skip note, and a file with no
  synthetic records printing no skip note at all.

  Gates re-run: `npm run check` exit 0; `npx vitest run
scripts/test/agent-cost.test.ts` (26/26 — three net new tests over gate
  3's 23); `npx vitest run --project repo` (372/372).
