---
id: repo-5
tool: repo
title: Decide whether the dev server's HOST resolution lifts to packages/
kind: chore
status: ready
milestone: null
depends_on: []
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
  split it before writing it, not after.
- Do not fold this into a `dl-` or `pl-` ticket. It is repo-wide by definition
  and would otherwise appear in one tool's changelog as if it belonged there.
- **This really does depend on dl-22, and `depends_on` is empty anyway.** It was
  written as `depends_on: [dl-22]` first, and that breaks the board. The status
  script validates every id against the ticket files _on the current branch_,
  and dl-22 is still in review, so it exits 1 and prints **nothing at all** — not
  a warning beside a table, the whole view. A ticket merged before the one it
  names would do that to everyone on main. So `depends_on` can only name tickets
  that have already landed, and a forward reference belongs in prose, which is
  what the first line of **Why** is. Worth its own ticket if anyone minds; the
  fix is presumably to degrade to a warning rather than to exit.
- `tools/planner/web/test/tsconfig.json` omits `../vite.config.ts`, so the
  planner's config is in no tsconfig project and is not typechecked — the mirror
  of what dl-22 fixed for the downloader. Related, but **not this ticket**; it is
  being filed separately. If it is still open when this is built, a lift would
  move code out of an unchecked file into a checked one, which is a reason to
  sequence them rather than a reason to merge them.

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
