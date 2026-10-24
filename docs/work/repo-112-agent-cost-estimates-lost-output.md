---
id: repo-112
tool: repo
title: agent-cost estimates the subagent output the transcript no longer records
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-112 — agent-cost estimates the subagent output the transcript no longer records

## Why

`scripts/agent-cost.mjs` prices each response from the largest `output_tokens`
among its streamed records. That figure was the true billed count while the
transcript kept the stream's final record. Since Claude Code 2.1.300
(2026-10-15), subagent transcripts mostly do not. A response is logged as one
record per content block. Each record carries the stream's opening count, often
8 or 16. The final record, which held the real count and a non-null
`stop_reason`, is missing.

Measured on 2026-10-18 over every subagent transcript under
`~/.claude/projects/-workspaces-tools/*/subagents/`, as the share of responses
that have any record with a non-null `stop_reason`, by first-record date and
CLI version:

| Date       | Version | Responses | With a final record |
| ---------- | ------- | --------- | ------------------- |
| 2026-10-08 | 2.1.291 | 990       | 99%                 |
| 2026-10-10 | 2.1.294 | 2395      | 99%                 |
| 2026-10-12 | 2.1.296 | 5193      | 99%                 |
| 2026-10-13 | 2.1.296 | 1493      | 100%                |
| 2026-10-15 | 2.1.300 | 1257      | 8%                  |
| 2026-10-16 | 2.1.300 | 830       | 14%                 |
| 2026-10-17 | 2.1.301 | 2918      | 8%                  |
| 2026-10-18 | 2.1.301 | 3745      | 8%                  |

The main session's own transcript is not affected. Session `196311b6` had 90
responses, and all 90 have a final record. One of its gates,
`agent-a9d94ce78be6abd3d`, has a final record on 1 of 57.

The content blocks are all still written; only the count is lost. Two readings
from one request of that gate show it: `(8, thinking)` then `(8, tool_use)`,
with no third record. A 2.1.296 file has the same layout and adds the final
record, `(260, tool_use, stop_reason tool_use)`.

The parent's `Agent` result does not fill the gap. Its `usage` is the last turn's
only: `output_tokens: 6261` for a whole seam-mapper run.

What the gap costs, from this ticket's own estimate (Build) over the ten
orchestrator sessions of 2026-10-15 to 10-18: about $86 of subagent output went
unpriced, on $371 that `agent-cost.mjs` reported. Most of it is redacted
thinking. Every accounting table in `history.md` from 2026-10-15 on is low by
about that share. The tables from before are not.

## Build

1. A response is _unfinished_ when none of its records carries a non-null
   `message.stop_reason`. For each response, sum what its records show:
   - the characters of text blocks;
   - the characters of each tool call's name plus its compact JSON input;
   - the characters of any thinking that is not redacted;
   - the signature length of each redacted thinking block.
2. Estimate an unfinished response's output from what it shows. Characters count
   at a fitted characters-per-token rate. Redacted thinking counts at a fitted
   tokens-per-signature-character rate, less a fitted offset, never below zero.
   Use the estimate only when it exceeds the recorded count; it never lowers one.
   A response with a final record keeps its recorded count.
3. Fit the three constants on subagent responses that do carry a final record,
   up to 2026-10-10. Measure with the script's own function, not a
   re-implementation, because `JSON.stringify` and Python's `json.dumps` count
   characters differently. Check the fit per file on 2026-10-11 to 10-13, with
   every response estimated as if unfinished.
4. Label it. Every row and total whose figure rests on an estimate names how
   many responses it raised, out of how many, and the recorded figure beside it.
   A file with nothing raised prints exactly as before.
5. Keep `output` as the priced figure. Add `recordedOutput`,
   `unfinishedResponses` and `estimatedResponses` to `FileTotals`.

## Done when

1. An unfinished response is priced at its estimate when that exceeds its
   recorded count, and at its recorded count otherwise. A response with a final
   record keeps its count, however much content it shows.
2. `visibleOutput` and `estimateOutput` give hand-computed figures on blocks of
   every kind the Build names.
3. A row and the total that rest on an estimate print
   `output estimated for N of M responses, recorded R`, from the CLI too. A row
   with nothing raised prints no such note.
4. The constants, the fit and the held-out per-file check are in the Log, with
   the command that reproduces them.
5. `npm run check` passes, and `npx vitest run scripts/test/agent-cost.test.ts`
   passes with every existing test unchanged in what it asserts.

## Review

**Gate: PASS** — 2026-10-18 · `335efcd4..70b62745` (base `335efcd4f2cc57c85388343056219297c02cc7bb`, head `70b627452308451dbd6347dd55f9da216508cd2b`) · Sonnet 5.5, depth medium

| Done when                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. An unfinished response is priced at its estimate when that exceeds the recorded count; a finished one keeps its count                                           | `scripts/test/agent-cost.test.ts` › "a response with no final record is raised to its estimate; one with a final record keeps its count" (asserts outputs `[111, 50]`; req_b's `Write` input is far longer than 50 tokens) ✓, › "an estimate below the count already recorded never lowers it" ✓, › "the estimate prices the response: Sonnet 5.5 at 20 input and 161 output tokens" ✓ |
| 2. `visibleOutput` and `estimateOutput` give hand-computed figures on every block kind the Build names                                                             | `agent-cost.test.ts` › "visibleOutput counts text, a tool call's name and JSON input, and a redacted thinking block's signature" (`{chars: 28, signature: 50}`: text, tool name plus compact JSON, visible thinking, redacted thinking) ✓, › "estimateOutput adds characters at the fitted rate and thinking past the signature offset" (111, 100, 0) ✓                                |
| 3. A row and the total that rest on an estimate print `output estimated for N of M responses, recorded R`, from the CLI too; a row with nothing raised prints none | `agent-cost.test.ts` › "render names the estimate on the row and the total, with the recorded figure beside it" ✓, › "render prints no estimate note when nothing was raised" (its companion `toContain` fails on empty output) ✓, › "the CLI labels an estimated row and still exits 0" ✓. Also run by hand on a real `--agent` row and an `orchestrator` row                         |
| 4. Constants, fit, held-out per-file check and their command are in the Log                                                                                        | **verified** — the Log's command reproduces the constants, the fit sizes (19,252 / 7,450 / 11,801) and the table (19 / 60 / 9 files, medians 0.96 / 0.95 / 0.83, ranges), and so does a recomputation with the shipped `estimateOutput`; the check's limit is F1, and F3 is two Log figures that do not reproduce                                                                      |
| 5. `npm run check` passes; the agent-cost spec passes with every existing test unchanged in what it asserts                                                        | **verified** — `npm run check` exit 0; `npx vitest run scripts/test/agent-cost.test.ts` 60 of 60; the test diff is 115 insertions and 0 deletions; the base spec run against head's source fails 7 of 52, each by the three added keys alone (no expected line differs). PR #566 at this head: all 8 checks pass, the informational Windows leg included                               |

- **low** · no `Done when` line depends on it · F1 · the held-out check runs on files the shipped code would not touch, and the Log does not say so. Every file in the 2026-10-11 to 10-13 test set has all responses finished, so the code raises nothing in them; the 38 files of that window with an unfinished response are excluded by the rule. Ground truth in the regime the estimate serves does exist: 760 subagent responses from 2.1.300 or later carry a final record (120 files). Estimated as if unfinished they read 1.20 (Opus 5.5, 240 responses), 1.13 (Sonnet 5.5, 424) and 1.14 (Haiku 5.5, 96) of recorded in aggregate, and 1.21 / 1.12 / 1.11 per-file median over 10 / 40 / 11 files of at least 2,000 recorded tokens, against the Log's 0.96 / 0.95 / 0.83. They are not typical of the unfinished ones (mean visible characters 1,951 against 972; 759 of 760 are not the last response of their file), so this is a bound, not a measurement: matched on content class and recorded-size bucket, 2.1.300 or later reads 0 to 0.17 higher than before it (most for responses of 400 tokens or more), and level under 400. The estimate may therefore run some percent high on the unfinished population, which no data here can settle; direction: overstates cost, and the figure is labelled. The Log should state the limit and put the post-2.1.300 reading beside its table.
- **low** · no `Done when` line depends on it · F2 · shipped text stale or too broad, all in the safe direction. The module doc says "every main-session response kept its own"; 6 of 9,642 main-session responses have no final record (a thinking block plus one short block, counts 3 to 8). `sumUsage`'s own doc still says it "keeps each group's largest output_tokens … only the kept, deduplicated figures are summed", which `output` no longer is when raised. The module doc's "r 0.95 on Opus 5.5 and Sonnet 5.5" is 0.95 and 0.94 in the Log; the correlation of signature length with output minus characters/1.797 on final responses up to 2026-10-10 is 0.944 and 0.935.
- **low** · no `Done when` line depends on it · F3 · two Log figures do not reproduce. "Real files": the 2.1.301 builder `agent-a74f778b39702b54b` reads `output=97363` in the Log and 98157 at head (87 of 102 responses and recorded 24532 do match; unrounded constants give 98281, no tool names 97891, nothing gives 97363). The Log's embedded calibration script prints only median, p10 and p90, so the table's Range column and the fit sizes come from a different copy of the script.
- **low** · no `Done when` line depends on it · F4 · `visibleOutput` throws on a `null` entry in `message.content` (`TypeError: Cannot read properties of null (reading 'type')`), where the base never looked at `content`; the CLI then exits 1 with a message that does not name the file and prints no row for it. No live call site: the scan of every subagent and session transcript ran `visibleOutput` over all of them without error.
- **low** · no `Done when` line depends on it · F5 · the constants are fitted on three models and applied to every model in `RATES`. Opus 5, Sonnet 5 and Haiku 4.5 files from before 2.1.300 had 140 responses raised; Fable 5.1 ($50/M output) appears only in main sessions, where its final-bearing responses read 1.11 to 1.14 of recorded; Haiku 5.5 has no redacted-thinking response in the fit window. The Log's "priced at $0.50/M, so it moves no total that matters" holds for half of the raised Haiku 5.5 responses: 461 of 924 are on the $2.50/M long-prompt card ($0.89 of $1.04). Immaterial against the +$92.25 the estimate adds to the post-2.1.300 subagent files.
- **low** · no `Done when` line depends on it · F6 · missing tests: a Haiku 5.5 response on the long-prompt card with a raised output, cold-restart detection unchanged under an estimate, a mixed run of an estimated and a plain row, and the label on a `--agent` row and the `orchestrator` row (the CLI test passes the fixture as a file path and checks a substring that the row and the total both contain). All four were checked by command and are correct (see the report); the code paths are shared.
- **low** · no `Done when` line depends on it · F7 · the one-sided rule ("use the estimate only when it exceeds the recorded count") raises a recorded count that is a full one whenever the estimate is higher. Among 47,997 subagent responses from before 2.1.300, 289 have no non-null `stop_reason` and all 289 are raised (+176,523 tokens, 0.52% of recorded). 287 of them have an estimate at least 1.86 times the count (median 42.8), outside the 1.46 that 99% of finished responses stay under, so they are lost final records. Two are not obviously so: single-record text replies recorded at 843 and 828 tokens, raised to 1,233 and 1,525 (+1,087 tokens in all). After 2.1.300, 4 of 8,601 unfinished responses sit within 1.46 times of their estimate (recorded 17 to 39, raised by 1 to 13 tokens each).
- **dropped** · the mutation `so.final ||= …` to `so.final = …` (a `stop_reason` on the last record only) survives the spec. Equivalent on real data: in all 58,111 responses that carry a `stop_reason`, it is on the last record. Not a defect.
- **dropped** · "double counting inflates `chars` or `signature`". Measured and absent: across about 67,000 responses (subagents and main sessions, both sides of 2.1.300) no tool id or redacted signature is repeated, no `apiBlockIndex` repeats, no text is a prefix of another, and every stop-bearing record carries exactly one block. The detector fires on a planted duplicate.
- **dropped** · "responses with two `stop_reason` records are counted twice". 342 subagent responses (339 before, 3 after 2.1.300) and 6,924 main-session responses have two or more; the output on their stop-bearing records is identical in every one, `output` is a maximum and `final` a flag, so nothing is summed.
- **dropped** · `SKILL.md`'s accounting-table instruction and `history.md`'s `cost` field say nothing about carrying the new label forward. A process choice outside the ticket's Build, not a defect of this change.
- **findings** · the hunt returned 11; 7 carried, 4 dropped.
- NFR: security ✓ (local read-only script; no shell, no network) · performance ✓ (one `JSON.stringify` per tool call; 785 transcripts priced in 15 to 33 s at base and head over two interleaved runs on a shared machine, noise dominates and no slowdown was isolated) · reliability — F4, F7 · maintainability — F2, F3, F6.

## Log

- 2026-10-18 — Filed and built in one session, outside an orchestrated batch.
  The owner chose the labelled estimate over a floor or a ticket-only filing.
  The cost audit that found the gap is the artifact
  `https://claude.ai/artifact/CYzYZzrYda4voAKdUrrQmw`.
  - **Id.** `node scripts/next-id.mjs repo` printed `next free: repo-111`.
    repo-111 was already held, though, by a local branch with no commits,
    `repo-111-fresh-gate-2-and-a-concurrency-cap`. It is checked out in a live
    agent's locked worktree, `agent-a97d5c888dab55fa0`. `next-id.mjs` does not
    read local branches in other worktrees, so it cannot see a claim that has
    not been pushed. This ticket took repo-112.
  - **Fit.** Done with the calibration script below, on 19,252 final responses
    from Opus 5.5, Sonnet 5.5 and Haiku 5.5, up to 2026-10-10:
    - Characters per token: 1.797, from 7,450 responses with no thinking and
      at least 50 output tokens, pooled.
    - Thinking tokens per signature character: 0.2771.
    - Offset: 266, from an ordinary least-squares fit of output minus
      characters/1.797 against signature length, over 11,801 responses with
      redacted thinking.

    Rounded to `charsPerToken: 1.8`, `thinkingTokensPerSignatureChar: 0.277` and
    `thinkingSignatureOffset: 266`.

  - **Held-out check.** Run with the rounded constants on files from
    2026-10-11 to 10-13 whose responses all carry a final record and record at
    least 2,000 output tokens. Each row is estimate ÷ recorded, per file:

    | Model      | Files | Median | p10  | p90  | Range        |
    | ---------- | ----- | ------ | ---- | ---- | ------------ |
    | Opus 5.5   | 19    | 0.96   | 0.91 | 1.06 | 0.89 to 1.07 |
    | Sonnet 5.5 | 60    | 0.95   | 0.85 | 1.12 | 0.77 to 1.29 |
    | Haiku 5.5  | 9     | 0.83   | 0.73 | 1.00 | 0.73 to 1.00 |

    Haiku runs low. Half of its raised responses are on the $2.50/M long-prompt
    card, but every raised Haiku response together comes to about $1, so one
    shared table is kept.

    **The limit of this check.** Every file in the test set has all its
    responses finished, so the shipped code raises nothing in them; the 38
    files of that window with an unfinished response are excluded by the rule.
    The responses from 2.1.300 on that kept their final record are ground truth
    in the regime the estimate serves. Estimated as if unfinished, gate 1 read
    them at 1.20 (Opus 5.5, 240 responses), 1.13 (Sonnet 5.5, 424) and 1.14
    (Haiku 5.5, 96) of recorded, pooled, and 1.21 / 1.12 / 1.11 per-file median.
    They are longer than the unfinished ones (mean visible characters 1,951
    against 972), so this is a bound, not a measurement. The estimate may run
    some percent high on the population it raises. That overstates cost, and
    the figure is labelled.

    An earlier Python pass measured the signature fit on all dates: r 0.95 on
    Opus 5.5 and 0.94 on Sonnet 5.5.

  - **Mutations**, each against `npx vitest run scripts/test/agent-cost.test.ts`
    and each restored after:
    - Making every response final (`so.final = true`): 11 tests failed.
    - Taking the estimate even when it is lower (`if (true)`): 18 tests failed.
    - Restored: 60 of 60 pass.
  - **Real files.** A 2.1.301 builder, `196311b6…/agent-a74f778b39702b54b`, now
    reads `output=98157 … output estimated for 87 of 102 responses, recorded
    24532`. A 2.1.296 gate, `1e178417…/agent-a001f077f5a08f22b`, prints no
    estimate note: every response there has a final record.
  - **Checks.** `npm run check`: exit 0. The seven existing `toEqual` shapes
    and one hand-built `FileTotals` gained the three new fields. What they
    assert about the existing fields is unchanged.
  - **Not fixed here.** The transcript regression itself is Claude Code's. A
    report upstream is the owner's to file.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F1, F2, F3 and F4.
  - F4 — "`visibleOutput` throws on a `null` entry in `message.content`". A
    null or non-object entry is now skipped, and the spec gained "visibleOutput
    skips a null or non-object content entry instead of throwing".
    `npx vitest run scripts/test/agent-cost.test.ts` → `Tests 61 passed (61)`.
  - F2 — "`sumUsage`'s own doc still says it keeps each group's largest
    output_tokens", "every main-session response kept its own" and "r 0.95".
    `sumUsage`'s doc now names the raise. The module doc says 6 of 9,642
    main-session responses lost theirs, and gives r as about 0.94.
    `grep -c "every main-session response" scripts/agent-cost.mjs` → `0`.
  - F3 — "the builder reads output=97363 in the Log and 98157 at head" and "the
    embedded script prints only median, p10 and p90". The Real files bullet
    reads 98157, and the Calibration script section says what its copy prints.
    `awk '/^## Log/{exit} {print}'` is not the scope here, since both fixes
    are in the Log itself.
  - F1 — "the Log should state the limit and put the post-2.1.300 reading
    beside its table". Done under Held-out check, with gate 1's figures.

### Calibration script

This copy prints the medians, p10 and p90. The Range column and the fit sizes
in the Log came from a longer scratch copy that also printed the minimum, the
maximum and the counts. Run from a worktree:
`node calibrate.mjs scripts/agent-cost.mjs 2026-10-10 2026-10-11 2026-10-13`
fits the constants and checks them. Appending `1.8 0.277 266` checks fixed
constants instead.

```js
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
const [mod, fitTo, testFrom, testTo, ...fixed] = process.argv.slice(2);
const { visibleOutput } = await import(path.resolve(mod));
const root = path.join(homedir(), ".claude", "projects", "-workspaces-tools");
const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const files = [];
for (const s of readdirSync(root, { withFileTypes: true })) {
  const d = path.join(root, s.name, "subagents");
  if (!s.isDirectory() || !existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith(".jsonl")) files.push(path.join(d, f));
}
function groups(file) {
  const g = new Map();
  let day = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type !== "assistant" || !MODELS.has(r.message?.model)) continue;
    day ??= (r.timestamp ?? "").slice(0, 10);
    const k = r.requestId ?? r.message.id;
    const x = g.get(k) ?? { model: r.message.model, out: 0, final: false, chars: 0, signature: 0 };
    x.out = Math.max(x.out, Number(r.message.usage?.output_tokens ?? 0));
    x.final ||= r.message.stop_reason != null;
    const v = visibleOutput(r.message.content);
    x.chars += v.chars;
    x.signature += v.signature;
    g.set(k, x);
  }
  return { day, rs: [...g.values()] };
}
const data = files.map((f) => ({ f, ...groups(f) })).filter((x) => x.day && x.rs.length);
const fit = data
  .filter((x) => x.day <= fitTo)
  .flatMap((x) => x.rs)
  .filter((r) => r.final);
let cpt, slope, offset;
if (fixed.length === 3) [cpt, slope, offset] = fixed.map(Number);
else {
  const plain = fit.filter((r) => r.signature === 0 && r.out >= 50);
  cpt = plain.reduce((a, r) => a + r.chars, 0) / plain.reduce((a, r) => a + r.out, 0);
  const th = fit.filter((r) => r.signature > 0).map((r) => [r.signature, r.out - r.chars / cpt]);
  const mx = th.reduce((a, [x]) => a + x, 0) / th.length;
  const my = th.reduce((a, [, y]) => a + y, 0) / th.length;
  slope =
    th.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) /
    th.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  offset = -(my - slope * mx);
}
console.log({ cpt, slope, offset });
const est = (r) =>
  Math.round(r.chars / cpt + (r.signature > 0 ? Math.max(0, r.signature * slope - offset) : 0));
const byModel = {};
for (const x of data.filter((x) => x.day >= testFrom && x.day <= testTo)) {
  if (!x.rs.every((r) => r.final)) continue;
  const act = x.rs.reduce((a, r) => a + r.out, 0);
  if (act < 2000) continue;
  (byModel[x.rs[0].model] ??= []).push(x.rs.reduce((a, r) => a + est(r), 0) / act);
}
for (const [m, v] of Object.entries(byModel)) {
  v.sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))].toFixed(2);
  console.log(m, v.length, "median", q(0.5), "p10", q(0.1), "p90", q(0.9));
}
```
