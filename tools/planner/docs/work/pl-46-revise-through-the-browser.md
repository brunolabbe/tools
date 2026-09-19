---
id: pl-46
tool: planner
title: Revising a plan is proven through a browser, across the reload
kind: work-package
status: done
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

**2026-09-19 — built (dispatched as Sonnet).** Branched from `origin/main` at
`02ab751`. pl-44 and pl-45 were both `done` on that base, so nothing here
needed a rebase.

**What landed.**

- `e2e/plan-walk.ts`: `draftAPlan`, `reopenFromTheList` and `RUN_TIMEOUT`,
  lifted out of `pin.spec.ts` unchanged (moved, not rewritten) since two specs
  now need them. `pin.spec.ts` imports them instead of defining its own copy.
- `e2e/revise.spec.ts`: one spec, one walk — draft, a zero-specialist re-plan
  of day 1, a move, a reload, a restore of version 1, and a second reload.
  Every value (the moved item's title, its day, the version count) is read off
  the page; nothing is written down from the intake tree or the scripted
  provider's script.
- `.claude/rules/planner-e2e.md` and `tools/planner/CLAUDE.md`'s summary now
  count five specs over three paths, naming revision as the third and the
  seams it crosses (a re-plan's run over SSE, an edit's synchronous write).

**What the brief did not say, found by actually running the spec.** The Build
section's step 3 says "move an item … to another day" with no guidance on
_which_ day. A fixed destination (`toDayIndex = fromDayIndex === 0 ? 1 : 0`)
failed the very first time it ran, against a real `PLAN_INFEASIBLE`: the
scripted provider's road-trip brief packs most days close to
`itinerary/limits.ts`'s pace ceiling, so day 2 already held enough activity
that the moved item overfilled it. `.claude/rules/planner-unchecked-constraints.md`
and pl-44's own `PLAN_INFEASIBLE` mapping are both working as built — this is
the spec choosing an unsafe move, not a defect. Fixed by reading every day's
item count off the page first and moving to whichever day (other than the
source) currently holds the fewest — the emptiest day is the one a real user
would also reach for, and it happens to line up with this brief's last two
days, which the packer leaves empty on a five-night, six-day trip.

**Fold-in considered and declined.** Nothing else already-specified turned up
free while building this — the ticket's own instruction to update the rules
file and its summary is folded into the same commit rather than left as a
second step, but that is this ticket's own Build item 4, not a fold-in.

**Verification.**

- `npx playwright test -c tools/planner/playwright.config.ts e2e/revise.spec.ts --reporter=list`
  (equivalent to `npm run e2e:planner -- e2e/revise.spec.ts`): **1 passed**,
  3.0s.
- The full suite together, to prove `pin.spec.ts`'s extraction did not move
  anything it depends on: `npm run e2e:planner`: **5 passed** — 2
  `intake.spec.ts`, 2 `pin.spec.ts`, 1 `revise.spec.ts`.
- **The reload is the assertion, shown red.** A scratch mutation of
  `api/src/runs/revise.ts`'s `edit()` skipped the `persist(...)` call and
  fabricated the response from `appendRevision` in memory instead of
  re-reading the database, the way a regression that fakes success without
  writing would look. `revise.spec.ts` passed every assertion through the
  move — the crumb read "Version 3 of 3", the item's new day, and the diff
  naming it moved, all against the fabricated response — and failed only at
  the first reload, still expecting "Version 3 of 3" and reading back
  "Version 2 of 2 · Re-packed day 1 from what was already proposed." Reverted
  immediately after (confirmed byte-identical to the pre-mutation file); the
  unmutated spec is green again above.
- `npm run check`: exit 0. `npm test -- --project planner`: 71 files, 1,184
  tests, none failing. This branch adds no `.test.ts` file — `revise.spec.ts`
  runs only under Playwright — so this count is unchanged by anything here;
  it is quoted to show the rest of the suite is undisturbed, not as evidence
  of new coverage.

**Not run, and said so rather than reported green: `npm run e2e:install`
itself.** It shells out to `playwright install --with-deps chromium`, which
needs `sudo` for the OS package half and failed on it in this container
(no terminal for a password prompt). The Chromium binary Playwright needs was
already present at `/ms-playwright` — this container's own devcontainer setup,
not this session's doing — so `npx playwright test` ran directly against it.
A worktree without that binary already unpacked would need the install step
to actually reach the network for the browser download, which this container
also cannot do; that gap is the sandbox's, not this branch's, and is the same
one `pl-45`'s Log names for its own missing `@anthropic-ai/sdk` packages.
`.github/workflows/planner.yml`'s `e2e` job runs `npm run e2e:install` on a
runner with no such restriction, so CI is the place this ran for real —
verify with `gh pr checks` once the pull request is open, per this ticket's
own `Done when`.
