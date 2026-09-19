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

## Review

**Gate: CONCERNS** — 2026-09-19 · `fb15bc9...0b941b8` (the branch's merge-base with `origin/main`; first pass at `b667b78`, repair at `0b941b8`) · defect hunt run by the reviewer itself (Opus, dispatched as `ticket-reviewer`) at code-review's medium depth. The four lows the first pass raised are all repaired at `0b941b8` and re-run below. Only the CI half of the e2e row holds this at CONCERNS, and that half cannot exist until the pull request does.

| Done when                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The walk is draft, zero-specialist re-plan, move, reload, restore, reload            | `tools/planner/e2e/revise.spec.ts:129 "Re-plan these days"` (no specialist named), `tools/planner/e2e/revise.spec.ts:153 "Move here"`, `tools/planner/e2e/revise.spec.ts:178 "Restore this version"`; both reloads go through `tools/planner/e2e/plan-walk.ts:69 "page.reload()"`, a real page reload, then re-navigate from the list at `tools/planner/e2e/plan-walk.ts:74 "ul.plans button.link"` — **verified** (local e2e)                                                                                                                                                                                                                                                  |
| Each step asserts the crumb line's version count                                     | `tools/planner/e2e/revise.spec.ts:121 "Version 1 of 1"`, `tools/planner/e2e/revise.spec.ts:138 "Version 2 of 2"`, move `tools/planner/e2e/revise.spec.ts:153-155 "Move here"`, reload `tools/planner/e2e/revise.spec.ts:163-168 "What separates a revision that reached SQLite"`, restore `tools/planner/e2e/revise.spec.ts:178-180 "Restore this version"`, reload `tools/planner/e2e/revise.spec.ts:189-192 "Reload once more"` — **verified** (local e2e)                                                                                                                                                                                                                    |
| Each step asserts the moved item's day, before and after each reload                 | on exactly one day, visible there and count 0 on every other: `tools/planner/e2e/revise.spec.ts:106-112 "async function expectItemOnlyOnDay"`, called after the move `tools/planner/e2e/revise.spec.ts:153-156 "Move here"`, its reload `tools/planner/e2e/revise.spec.ts:163-169 "What separates a revision that reached SQLite"`, the restore `tools/planner/e2e/revise.spec.ts:178-181 "Restore this version"`, its reload `tools/planner/e2e/revise.spec.ts:189-193 "Reload once more"` — **verified** (local e2e)                                                                                                                                                          |
| Each step asserts the diff naming the moved item                                     | move `tools/planner/e2e/revise.spec.ts:158-160 "const diff = plan.locator("`, its reload `tools/planner/e2e/revise.spec.ts:163-173 "What separates a revision that reached SQLite"`, restore `tools/planner/e2e/revise.spec.ts:182-187 "The restore's own revision has a diff too"`, its reload `tools/planner/e2e/revise.spec.ts:189-197 "Reload once more"`; the page shows only the shown revision's diff (`tools/planner/web/src/plan/PlanView.tsx:412 "view.diffs.find((each) => each.revisionId === shownRevision.id)"`), so the restore's assertion reads revision 4's diff and not the move's. The re-plan is exempt by the brief's own Trap — **verified** (local e2e) |
| Names no question id, item title or plan title; reads no database                    | plan title read at `tools/planner/e2e/plan-walk.ts:56 "return (await plan.getByRole("`, item title read after the re-plan at `tools/planner/e2e/revise.spec.ts:143 ".first().innerText()"`; a grep of both files for `#field`, `sqlite`, `better-sqlite` and `.db` finds only the header comment — **verified**                                                                                                                                                                                                                                                                                                                                                                 |
| Rules file and tool `CLAUDE.md` count five specs over three paths                    | `.claude/rules/planner-e2e.md:20 "It is five specs over three paths on purpose"`, `tools/planner/CLAUDE.md:181 "and **it is five"`, and the third copy, `tools/planner/e2e/README.md:5 "Five specs over three paths."`; the rules file is tracked (`check-ignore` exits 1, `ls-files` lists it) — **verified**                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run e2e:planner` passes locally, and `planner.yml`'s `e2e` job passes on the PR | local at `0b941b8`: **verified**, 5 passed (intake 2, pin 2, revise 1), and `revise.spec.ts` alone passed 3 of 3 runs. CI: **unproven (gate)** — no pull request yet; `planner.yml`'s path filter covers `tools/planner/e2e/**`, and its `e2e` job ran green on #264                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run check` passes                                                               | **verified** — exit 0 at `0b941b8`; `npm test -- --project planner` 71 files, 1,184 tests passed, unchanged by this branch (it adds no `.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **low, repaired at `0b941b8`** · `e2e/README.md` counted four specs over two paths and listed neither `plan-walk.ts` nor `revise.spec.ts`. It now reads five over three and lists both.
- **low, repaired at `0b941b8`** · The Log named `02ab751` as the base; the branch was cut from `fb15bc9` (#269). The Log now says `fb15bc9` and why the earlier number was wrong.
- **low, repaired at `0b941b8`** · The day assertions checked presence only, so a copy would have passed them. `expectItemOnlyOnDay` now requires count 0 on every other day. The builder reports that a copy-instead-of-move mutation in `itinerary`'s edit is refused upstream as `INTERNAL` and fails the spec at the post-move crumb before the new check is reached, so the new check is defence in depth rather than the only catch. That is the builder's measurement; the reviewer did not re-run it.
- **low, repaired at `0b941b8`** · The restore and the second reload asserted no diff. Both now assert the `Moved` heading and the item's line.
- **dropped** · The destination is chosen from page state, which could in principle adapt around a defect. It does not here: the pick is a pure function of the rendered counts, ties go deterministically to the later day (`<=`), measured counts after the re-plan were `[2,2,2,1,0,0]` (day 1 to day 6), and the four breaks below each fail it.
- **dropped** · `reopenFromTheList` picks the first same-titled plan in the list, and the full suite leaves three with one title. It relies on the list ordering by `updatedAt`; a wrong pick fails loudly on the crumb rather than passing. Pre-existing, and not a defect.
- **positive controls, run at `b667b78` and reverted** · (1) the builder's break, `edit()` fabricating its answer without `persist`: every pre-reload assertion passed, and it failed at the first reload's crumb check reading `Version 2 of 2`. (2) `GET` of a plan drops the latest revision once there are three: failed at the same check reading `Version 2 of 3`. (3) `GET` keeps the count but serves the previous revision's days: failed at the first reload's day check. (4) `restore` restores the latest revision instead of the one asked for: failed at the restore's day check. The repair only strengthens those checks, so these were not re-run at `0b941b8`.
- **merge** · `merge-tree --write-tree` of `0b941b8` is clean against `origin/main` at `4463431` and against `pl-47-edit-dates-and-budget` at `ced256c`; a scratch merge of `b667b78` with `ced256c` passed the full planner e2e suite, 5 of 5, and the repair since touches only `e2e/` and this ticket. `node scripts/citations-gate.mjs --against origin/main` exits 0 at `0b941b8`.
- **findings** · 6 returned, 4 carried (all repaired), 2 dropped.
- NFR: security n/a (spec only) · performance ✓ (3–15 s per run) · reliability ✓ (3 of 3, deterministic tie-break) · maintainability ✓ — the helper lift is byte-identical to the removed bodies, and the README now matches.

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
`fb15bc9` — what `git fetch && git checkout -B ... origin/main` actually
resolved to at the moment this session ran it, ahead of the `02ab751` this
session's own environment snapshot showed at conversation start; corrected
here on the gate's own finding rather than left standing. pl-44 and pl-45 were
both `done` on that base, so nothing here needed a rebase.

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

**2026-09-19 — gate round one (Opus, `b667b78`): CONCERNS, held only by the CI
half of the e2e row (no pull request existed yet to check). Nothing above
low.** Fixed:

- **The base sha was wrong.** The Log above said `02ab751`; `git rev-parse
b667b78^` is `fb15bc9` (#269), which is also this branch's merge-base with
  `origin/main`. `02ab751` was this session's own environment snapshot from
  conversation start, taken before the fetch — corrected above rather than
  left standing.
- **`e2e/README.md` was a third, stale copy of the suite's own count**
  ("Four specs over two paths", no mention of `plan-walk.ts` or
  `revise.spec.ts`, `intake-walk.ts` called "shared by both specs"). Updated
  to five specs over three paths, with an entry for each new file.
- **Presence-only day assertions.** Added `expectItemOnlyOnDay`, which checks
  every day rather than only the destination, so a bug that left the item on
  its old day (or duplicated it onto a third) fails rather than passing on
  the destination check alone. Applied at all four points the item's day is
  asserted: after the move, after its reload, after the restore, after its
  reload. **Tried to reproduce the "copy instead of move" case directly**, by
  changing `itinerary/src/edit.ts`'s `applyOperation` to keep the source day's
  list instead of splicing the moved item out — the same one-line mutation
  the finding described. It does not reach a silent duplicate: the compose
  path already refuses it, and the write answers `INTERNAL` (visible in the
  server log) rather than succeeding, so the spec fails at the existing
  post-move crumb assertion before `expectItemOnlyOnDay` is ever reached.
  Reverted (confirmed byte-identical). The new assertions are still worth
  keeping — they check a real property the old ones did not — but they are
  defense in depth here rather than the thing that closes this specific gap;
  said plainly rather than claimed as a reproduction of what the finding
  described.
- **The restore's own diff.** Added an assertion, after the restore and after
  its reload, that `section.diff` still names the moved item under "Moved" —
  read off the page rather than assumed, and confirmed correct by running the
  spec before writing the assertion down.
- Re-verified: `revise.spec.ts` alone 3 of 3 (2.7–4.0s each); the full suite
  5 of 5; `npm run check` exit 0; `npm test -- --project planner` 71 files,
  1,184 tests, none failing.

**2026-09-19 — the `## Review` section above was transcribed verbatim from
the reviewer's own text for `0b941b8`.** Nothing in it was altered beyond
what `npm run format` did to the table's padding — no wording, no citation,
no finding count. Committed after both sessions agreed the four lows from the
first pass were repaired and re-verified, with the CI half of the e2e row
left `unproven (gate)` on purpose: no pull request existed yet to check it
against.
