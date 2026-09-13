---
id: pl-46
tool: planner
title: Revising a plan is proven through a browser, across the reload
kind: work-package
status: ready
milestone: P4
depends_on: [pl-44, pl-45]
difficulty: standard
---

# pl-46 — Revise through the browser

**Packages:** `e2e`: one new spec, plus the sentence in
`.claude/rules/planner-e2e.md` that counts the suite.

## Why

**P4 reads "Pin, re-plan a slice, read the diff", and after pl-44 and pl-45 each
half of it is proven only at a mocked seam.**

- `web/test/**` proves the controls. It fakes `src/api/plan.ts` wholesale, which
  is this tool's rule and not a shortcut: the fake is the API client module,
  never `fetch`.
- `api/test/**` proves the writes: the route, the run, the append and the diff.

The claim spans both halves, and they compose only if the client module does
what its type says. That is exactly the gap [pl-19](./pl-19-pin-through-the-browser.md)
closed for pinning, and `e2e/pin.spec.ts`'s header argues it at length.

**Revision crosses more seams than pinning did.** A re-plan answers 202 and
continues as a run over SSE, and `RunView` has to hand back to the plan page. An
edit answers a `PlanView` synchronously. Every change appends a revision that has
to be read back, and the diff is derived on the server and rendered by the
client. A fake client passes all of those with a server that never wrote
anything.

The owner decided on 2026-09-13 to file this as its own ticket rather than fold
it into pl-44 or pl-45, which were cut to run in parallel. pl-19 stands in the
same relation to pl-10.

## Build

1. **`e2e/revise.spec.ts`: one spec, one walk.** Reuse `pin.spec.ts`'s
   `draftAPlan` and `reopenFromTheList`, lifted into a shared helper module if
   two specs now need them, rather than copied. The walk:
   1. Draft a plan from a fresh intake (`intake-walk.ts`). Read the title and
      one item's heading off the page, as `pin.spec.ts` does.
   2. **Re-plan one day with no specialists named.** This is deterministic
      under the scripted provider: no model call, and a re-pack of existing
      candidates. Wait for the run view's finished state, then open the plan.
      The crumb line now reads version 2 of 2.
   3. **Move** an item read off the page to another day, through the keyboard
      controls pl-45 builds. The crumb reads version 3 of 3, and the diff
      section names that item as moved.
   4. **Reload** (`reopenFromTheList`). The crumb still reads version 3 of 3,
      the item is on its new day, and the diff is still there. **The reload is
      the assertion**: everything before it could pass against React state that
      never left the tab.
   5. **Pick version 1 and restore it.** The crumb reads version 4 of 4, and the
      item is back on its first day. Reload once more and assert the same.
2. **Every value is read off the screen**, per the rules file: no question ids,
   no item titles, no day contents written into the spec. Count versions from
   the crumb line, since that text exists for exactly this.
3. **Never read the database.** "A revision was appended" is the crumb line;
   "it persisted" is the reload.
4. **Update `.claude/rules/planner-e2e.md`'s count.** "It is four specs over two
   paths on purpose" becomes five specs over three paths, and the added sentence
   names revision as the third path and the seam it crosses. That file is
   copied into `tools/planner/CLAUDE.md` in summary, so update the summary too.
5. **The timeout is `pin.spec.ts`'s `RUN_TIMEOUT`**, shared rather than restated.
   A zero-specialist re-plan is faster than a draft, so no longer timeout is
   warranted.

## Traps

- **Do not name specialists in the re-plan.** A named specialist makes model
  calls, and the scripted provider's answers are keyed on the shape and the
  specialist. That is deterministic too, but the diff it produces is content,
  and asserting on content is what the rules file forbids. A zero-specialist
  re-pack may legitimately change nothing; if it does, the diff is empty (pl-43
  _Traps_), so the spec asserts the version count and not the diff there.
  **The move is what asserts the diff**, because its entry is known from the
  action taken.
- **Suppose the step-2 re-pack reshuffles the day the move targets.** The spec
  would then move the wrong item. So read the item's heading **after** the
  re-plan, not before.
- **`e2e/pin.spec.ts` asserts the crumb line's full text across its own reload**
  (`toHaveText(version)`). If pl-45 changed that line's text, pin.spec is the
  first thing that goes red. Run both.
- **The suite does not run locally in this repo's container by default**
  (`npm run e2e:install` first), and the gate is `planner.yml`'s `e2e` job. A
  local green is worth stating; a missing local run goes in the gate as
  `unproven (gate)`, not as green.

## Done when

- `e2e/revise.spec.ts` walks draft, then a zero-specialist re-plan, then a
  move, then a reload, then a restore, then a reload. Each step asserts through
  the page:
  - the version count on the crumb line;
  - the moved item's day, before and after each reload;
  - the diff naming the moved item.
- The spec names no question id, item title or plan title, and reads no
  database.
- `.claude/rules/planner-e2e.md` and `tools/planner/CLAUDE.md` count five specs
  over three paths.
- `npm run e2e:planner` passes locally with its output quoted in the Log, or
  the gate records the row as `unproven (gate)`. Either way,
  `.github/workflows/planner.yml`'s `e2e` job passes on the pull request.
- `npm run check` passes.

## Log

**2026-09-13 — filed**, beside pl-42 to pl-45, on the owner's answer to pl-45's
open question about where the browser proof belongs. Checked at filing, at
`323eaa7`:

- The suite pins `MODEL_PROVIDER: "scripted"` in `playwright.config.ts`'s
  `webServer.env`, so no ambient variable can change the provider.
- `pin.spec.ts` defines `draftAPlan`, `reopenFromTheList` and `RUN_TIMEOUT`
  locally.
- `.claude/rules/planner-e2e.md` counts "four specs over two paths on purpose".
- The `e2e` job in `planner.yml` is the only place the suite runs in CI.
