---
id: repo-112
tool: repo
title: agent-cost estimates the subagent output the transcript no longer records
kind: fix
status: ready
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

    Haiku runs low. It is priced at $0.50/M output, so it moves no total that
    matters, and one shared table is kept.

    An earlier Python pass measured the signature fit on all dates: r 0.95 on
    Opus 5.5 and 0.94 on Sonnet 5.5.

  - **Mutations**, each against `npx vitest run scripts/test/agent-cost.test.ts`
    and each restored after:
    - Making every response final (`so.final = true`): 11 tests failed.
    - Taking the estimate even when it is lower (`if (true)`): 18 tests failed.
    - Restored: 60 of 60 pass.
  - **Real files.** A 2.1.301 builder, `196311b6…/agent-a74f778b39702b54b`, now
    reads `output=97363 … output estimated for 87 of 102 responses, recorded
24532`. A 2.1.296 gate, `1e178417…/agent-a001f077f5a08f22b`, prints no
    estimate note: every response there has a final record.
  - **Checks.** `npm run check`: exit 0. The seven existing `toEqual` shapes
    and one hand-built `FileTotals` gained the three new fields. What they
    assert about the existing fields is unchanged.
  - **Not fixed here.** The transcript regression itself is Claude Code's. A
    report upstream is the owner's to file.

### Calibration script

Run from a worktree:
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
