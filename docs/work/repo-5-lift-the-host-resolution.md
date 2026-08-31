---
id: repo-5
tool: repo
title: Decide whether the dev server's HOST resolution lifts to packages/
kind: chore
status: done
milestone: null
depends_on: [dl-22]
---

# repo-5 — Decide whether the dev server's HOST resolution lifts to `packages/`

## Why

Once dl-22 lands there are two real consumers of the same dev-server `HOST`
resolution, and the root `CLAUDE.md` names that moment specifically:

> Shared code moves to `packages/` on the second real consumer, not the first
> guess.

The duplication is not approximate. `tools/planner/web/vite.config.ts` and
`tools/downloader/web/vite.config.ts` carry a **byte-identical 15-line block** —
a 14-line docblock and `const HOST = process.env["HOST"] ?? false;` — verified by
diffing the two after dl-22. Four further lines, the `strictPort` comment, differ
only in the port number they cite (5174 vs 5184).

This ticket exists because dl-22 declined the lift and said why in its Log, and a
declined lift that is written down nowhere else is indistinguishable from one
nobody noticed. It is filed to be **decided**, not to be assumed: the answer may
well be "leave it", and that is a result worth recording once rather than
rediscovering at the third tool.

The finding underneath it is worth keeping even if the lift never happens. The
container sets `HOST=0.0.0.0`; `api/src/config.ts` honoured it and
`web/vite.config.ts` did not — **a tool's two halves read the same environment
variable and only one obeyed it**. The planner had already diagnosed this in a
comment, so the knowledge existed inside the repo and simply never crossed to the
tool that needed it next. That shape — a fix that stays in the tool that found it
— is the thing a shared home would actually prevent, more than the four lines are.

## Build

Decide first, build second. The decision is the deliverable; if it comes out
"leave it", steps 2–4 do not happen and the Log records why.

1. **Weigh it against what `packages/` is for.** Today `packages/` holds exactly
   one workspace, `core`, and it is code the tools _ship_ — error machinery, job
   transitions, redaction. A dev-server config helper would be the first entry
   that ships in nothing, and that is the real question here, not the line count.
   The costs are concrete and worth stating in the Log whichever way it goes:
   a new workspace needs a `tsconfig.json`, a reference from the root
   `tsconfig.json`, a vitest project or a deliberate note that it has no tests,
   and it enters the graph that `packages/core/test/image-closure.test.ts` walks
   — for four lines that no container ever runs.
2. If lifting: put it in a package that is honestly named for what it is
   (build/dev tooling, not `core`), export the `HOST` resolution, and have both
   configs import it.
3. **Carry the docblock, do not summarise it.** It names both failure modes —
   the `::1` bind and the port walk — and the reason the symptom is silent. It is
   the reason this bug was diagnosable the second time; a paraphrase that loses
   the IPv4/IPv6 detail costs the next reader the afternoon dl-22 cost.
4. Keep `port` and the `strictPort` comment in each tool's own config. The ports
   differ deliberately (5173 vs 5183, so both tools can run at once) and that
   comment cites its own port. Only the `HOST` resolution is genuinely shared.

Traps:

- **A lift is a change to the planner as well**, which means a commit touching
  two tools — the root `CLAUDE.md` calls that the tell that it should have been
  two commits, and the changelog line lands under one tool's name. Decide how to
  split it before writing it, not after. **Answered below**: it landed as one
  pull request, because the constraint is the type and not the paths.
- Do not fold this into a `dl-` or `pl-` ticket. It is repo-wide by definition
  and would otherwise appear in one tool's changelog as if it belonged there.
- **`depends_on: [dl-22]` is safe now, and was not when this was filed.** The
  original trap here said naming dl-22 would break the board outright — the
  status script validated every id against the ticket files on the current
  branch, found dl-22 unmerged, exited 1 and printed **nothing at all**. That is
  no longer true twice over: dl-22 merged, and repo-12 made the interactive
  views warn beside the table and reserved the non-zero exit for `--json`
  (`scripts/status.mjs`, `EXIT_ON_PROBLEMS = ["json"]`). The surviving rule is
  the narrow one: `depends_on` may only name tickets that have already landed,
  because `--json` is still the CI gate and it still exits 1 on a dangling id.
  A forward reference belongs in prose.
- **The planner's `vite.config.ts` is typechecked now.** The original trap said
  `tools/planner/web/test/tsconfig.json` omitted `../vite.config.ts`, leaving
  the config in no project. pl-31 added it and pl-32 gave it a behavioural test;
  both are `done`. So both tools' configs are checked and both are pinned, which
  is part of why the lift buys less than it looks like it would — the thing a
  shared home would have protected is already protected, per tool.

## Done when

- The Log records the decision and the reasoning, whichever way it went.
- If lifted: both configs import the shared resolution, neither redefines it, and
  `npm run check` and `npm test` pass.
- If lifted: `npm run dev:downloader:web` and `npm run dev:planner:web` each
  still bind `0.0.0.0` inside the container and `false` with `HOST` unset — the
  behaviour dl-22 pinned must survive the move, proven by the tests that pinned
  it rather than by hand.
- If not lifted: the reason is written where the next person will meet it, which
  is a comment in both configs pointing at this ticket — not this file alone.

## Gates

### Gate 1 — 2026-08-31 · **PASS**

Reviewed at `2b06404`. The gate reproduced the mutation sweep independently
rather than reading it off the Log — the fixture tool, the vacuity guard and the
`strictPort` flip — and got the same messages, including
`expected 1 to be greater than or equal to 2`. Every citation in this file
resolved. It confirmed off `release-please-config.json` that `chore` and `test`
both carry `"hidden": true`, so the three-path spread costs no changelog line and
one pull request is correct.

It confirmed the near-miss the build flagged: `HOST_READ` and `HOST_FALLBACK` use
`(?:process\.)?env\[…\]`, which accepts both spellings, and a regex written for
`process.env` alone would have passed the API half in silence — the API configs
take `env` as a parameter.

**Two low findings, one taken.**

1. **Taken.** The disclosed text-matching boundary was documented with a
   contrived example (a host computed through a helper the scan cannot see). The
   gate found a mundane one that needs no helper: change `host: HOST` to
   `host: "127.0.0.1"` in a web config and leave the `const` sitting unused above
   it, and this scan passes. Reproduced here before writing it up — the scan went
   green, and `tools/planner/web/test/vite-config.test.ts` failed the same tree
   on **two** assertions, `expected '127.0.0.1' to be '0.0.0.0'` and
   `expected '127.0.0.1' to be false`. The docblock in
   `packages/core/test/host-resolution.test.ts` now carries that example instead,
   and states the boundary as what it is: the scan checks the resolution is
   present and spelled right, never that it is wired into `server.host`. That is
   the division of labour with the per-tool tests, not a hole — but it had to be
   stated in the shape someone will actually hit.
2. **Not taken, and nothing to fix.** The `two-origin-tls.test.ts` failure
   reported from the first `--project downloader` run did not reproduce at either
   commit across several run shapes. It is a pre-existing flake risk under load —
   a 60 s hook timeout in a spec that takes 4.4 s alone, on a box running four
   agents. Recorded rather than filed, since nothing here caused it and there is
   no reproduction to hand a ticket.

The docblock edit for finding 1 is the only change after `2b06404`; the diff is
otherwise the tree the gate read.

## Log

- Filed 2026-08-23 out of dl-22, which fixed the downloader's blank dev-server
  page and created the second consumer in the act of fixing it.
- Measurement, so the next reader does not have to redo it: the `HOST` docblock
  and its `const` are byte-identical across the two configs (15 lines, `diff`
  clean); the `strictPort` comment differs only in the port it names; `port`
  itself differs deliberately. So the genuinely shared surface is 15 lines, and
  the rest only looks shared.
- dl-22 declined the lift on the grounds that `packages/` is for what the tools
  ship. That is a position, not a verdict — this ticket is where it gets tested
  properly, with the cost of a new workspace weighed against the cost of the next
  tool repeating the bug.

### 2026-08-30 — decided: it does not lift, and a scan replaces the copies

**The decision.** The `HOST` resolution stays duplicated in both
`tools/*/web/vite.config.ts`. Both configs now carry a paragraph saying so and
naming this ticket, and `packages/core/test/host-resolution.test.ts` is what the
copies were traded for. **Why** above says the block is 15 lines; it is 25 now,
still byte-identical, because the decision was written into it — which makes the
docblock-to-code ratio the decision turned on worse, not better, and says so.

**What decided it, and it is not the line count.** The measurement that settled
it: with a lifted `@webtools/*` dependency's `dist` missing, Vite refuses to
start at all, behind an esbuild stack blaming a `package.json`. Today the same
broken state starts the server and prints an error naming the exact source line.
The file being argued over is the one whose whole failure mode is silence — a
blank page and a terminal reporting ready — and putting it behind a build step
that fails by pointing somewhere else makes the next dl-22 harder to diagnose,
not easier. The workspace costs from the brief (a `tsconfig.json`, a root
reference, a vitest project or a note, entry into the `image-closure` graph) are
all real and all secondary to that.

**The HOST asymmetry, recorded here rather than filed.** Chasing the lift turned
up that there are **four** readers of `HOST`, not two, in **two incompatible
shapes**. Both web configs resolve `string | false` — `false` is Vite's own
"localhost only" sentinel and the right default off a container. Both
`tools/*/api/src/config.ts` resolve `string`, defaulting to `127.0.0.1` via
`API_DEFAULTS.host`, because `false` is not something you can hand to `listen`.
So the thing that actually wanted sharing was never the four lines; it was the
_question_ — does this half of the tool obey `HOST`, and does it say what it does
when `HOST` is unset. A scan can ask that of both halves. An import cannot, since
their answers legitimately differ. The two shapes are therefore asserted as two
tests, not flattened into one rule; the cross-shape mutations below are what make
that separation load-bearing rather than decorative.

**Why a scan and not just the two existing tests.** dl-22 and pl-32 already pin
each tool's dev-server behaviour by evaluating its config, which is stronger than
a text match. But they only exist for tools somebody remembered to write them
for. The scan is the one that fails for a tool it has never seen, which is the
failure this ticket was actually about: the planner had diagnosed the `::1` bind
in a comment and the knowledge never crossed to the tool that needed it next.

**Mutations run, each reverted and re-confirmed green.** What went red, and with
what message:

- `strictPort: true` deleted from `tools/downloader/web/vite.config.ts` →
  `tools/downloader/web/vite.config.ts: no strictPort: true`
- `?? API_DEFAULTS.host` dropped from `tools/planner/api/src/config.ts` →
  `reads env["HOST"] with no ?? default`
- `?? false` dropped from `tools/planner/web/vite.config.ts` →
  `HOST falls back to nothing, not Vite's false`
- the two shapes swapped — web falling back to `"0.0.0.0"`, api falling back to
  `false` → both tests red, each naming the other contract's fallback
- **a fixture tool the scan had never seen**, `tools/zzprobe/`, with a
  `vite.config.ts` that ignores `HOST` and an `api/src/config.ts` that ignores it
  → `does not read env["HOST"]`, `no strictPort: true`, and
  `tools/zzprobe/api: nothing under src reads env["HOST"]`. Then the same fixture
  with its `vite.config.ts` removed entirely → `no such file`.
- the vacuity guard, measured rather than assumed: `tools/planner` moved out of
  `tools/` → `expected 1 to be greater than or equal to 2` on both tests.

**One pull request, and the type is why.** This branch touches
`tools/downloader`, `tools/planner` and `packages/core`, which the root
`CLAUDE.md` names as the tell for two pull requests. Read off
`release-please-config.json`'s `changelog-sections`: the non-`hidden` types are
`feat`, `fix`, `perf` and `revert`; `chore` and `test` are both `hidden`. Nothing
here changes behaviour, so the title is a `chore`, release-please renders an
empty changelog and skips both tools, and the cross-tool paths cost nothing —
`docs/03-RELEASING.md` measures exactly this. `node scripts/commit-message.mjs
--text "chore(repo): …(repo-5)"` exits 0.

**On the three stale claims in this file** — the status-script trap, the tsconfig
trap, and `depends_on` being empty. None was stale when written; each was
falsified by a later merge (repo-12, pl-31, pl-32, dl-22), and nothing links a
merging ticket back to the tickets citing it. The general sweep-harder fix does
not exist and is not worth inventing. But these were load-bearing prose making
_falsifiable claims about code_, and this repo already owns the instrument for
that: a claim about `status.mjs`'s exit behaviour belongs in a test on
`status.mjs`, not in a ticket's prose. **Carry less prose about the world, rather
than sweeping it more often.** The corollary this build adds: that is exactly what
part C does for the claim this ticket was making. "Both web configs resolve `HOST`
the same way" was a sentence in a ticket for a week and rotted the moment a third
tool could exist; it is now an assertion that fails. Where a trap cannot become a
test, it should shrink to the fact that survives — which is what the rewritten
`depends_on` trap is, one narrow rule left where a paragraph used to be.

**What was left out.** The scan reads text; it does not evaluate a config, so it
proves the resolution is present and spelled right and never that it reaches
`server.host`. Gate 1 supplied the concrete case and the docblock now carries it.
That is the boundary rather than a defect — the per-tool tests evaluate the config
and own what it resolves to — and teaching this file to evaluate TypeScript is a
parser, which the neighbouring scans deliberately are not.
