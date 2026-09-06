---
id: repo-20
tool: repo
title: The reviewer's setup order builds the wrong tree
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-20 — The reviewer's setup order builds the wrong tree

## Why

`.claude/agents/ticket-reviewer.md` tells a gate to set its worktree up **before
it measures anything** — `worktree-farm.sh`, then `npm run build`, "in that order,
before any test or check" — in a section at the very top of the file. The section
that tells it to `git fetch origin` and `git checkout --detach <sha>` is roughly a
hundred lines further down, under _Getting the branch under review_.

A reviewer that reads the file top to bottom therefore builds **before** it has
the branch, which builds the base rather than the work under review. The ordering
is wrong for exactly the audience the file is written for: an agent following it
in order.

**This is not hypothetical, and it is the deliverable.** On 2026-09-04 dl-37's
reviewer did exactly this. It built `main`, and caught it only because `dist/` was
missing a file the branch adds — an accident of that particular branch, not a
check. It flagged the ordering itself, unprompted.

**Nothing downstream catches it**, and the same file already says why, two
paragraphs after the checkout instruction it is out of order with: a reviewer of
the wrong tree "does not fail loudly. It produces a fluent, correctly formatted
gate that marks every acceptance line `unproven`, which reads exactly like a
review that ran and found the work wanting — and nothing downstream catches it,
because the section still names a range and still cites the ticket." A branch
whose `dist/` happens to be a superset of the base's would have produced a clean,
wrong gate with no tell at all.

**The stopgap that exists today is habit-dependent, which is the argument for
fixing it here.** `.claude/skills/orchestrate-tickets/reference/dispatching.md`
carries a clause telling an orchestrator to write _fetch, detach onto the sha,
then farm and build_ into every gate prompt. That works only when an orchestrator
remembers it, on every gate, forever, and it costs a sentence each time. Per
`CLAUDE.md`, a convention that must happen every time without exception does not
belong in prose that a caller has to remember — and the agent definition is the
place the instruction is already loaded from, for free, into every reviewer. One
section move retires the reminder.

## Build

1. **Reorder `.claude/agents/ticket-reviewer.md` so the checkout falls between the
   fetch and the build.** Today the file runs: _Set your worktree up before you
   measure anything_ (top) → … → _Getting the branch under review_ (fetch,
   detach, confirm the tree). The order an agent must actually follow is fetch →
   detach → farm → build → measure.

   **Only `npm run build` is strictly order-dependent, and say so wherever the
   instruction lands.** `node_modules` is gitignored, so `worktree-farm.sh` may
   run on either side of the checkout and survives it; `dist/` is the artefact
   that is wrong if it is built from the base. A reader who does not know which
   half matters will guess, and half of the guesses are the current bug.

2. **Keep both existing warnings attached to their instruction**, because each one
   is the only thing that makes its step non-obvious:
   - the farm/`npm install` warning ("skipping this does not fail loudly" — Node
     walks up to the shared checkout and resolves workspace packages there);
   - the wrong-tree warning already under _Getting the branch under review_ ("a
     fluent, correctly formatted gate that marks every acceptance line
     `unproven`"). After this change those two warnings describe one sequence, so
     they should read as one, not as two unrelated cautions in different sections.

3. **Then narrow the skill's stopgap rather than deleting it.**
   `.claude/skills/orchestrate-tickets/reference/dispatching.md` has a section
   _And say the checkout comes before the build_. Once the agent definition is
   fixed, the prompt clause is redundant; the **record of the defect** is not.
   Reduce it to the measurement and the reason, and point at this ticket, so a
   future orchestrator does not re-add a clause for a bug that no longer exists.

4. **A second, smaller edit that wants doing at the same time, in
   `.claude/agents/builder.md`.** Its opening section is titled _Why the
   frontmatter does not pin a model_ and says the builder "inherit[s] the
   orchestrator's". Since 2026-09-04 the `orchestrate-tickets` skill's step 3
   tells an orchestrator to **pass the model explicitly**, naming its own model
   where the table says inherit — because a backgrounded dispatch returns no
   `resolvedModel`, so inheriting is the one setting that leaves the builder's
   model unobservable to everyone afterwards, the builder included.

   The two are not in conflict — the `difficulty` table still governs, and
   "inherit" is now spelled out as the orchestrator's own model rather than left
   implicit — but the paragraph reads as though inheriting is what happens, and a
   reader reconciling the two files has to work that out. Say it in one clause
   where the paragraph already explains the choice. **Do not restate the skill's
   reasoning here**; the mapping table stays the single source, as `repo-17`
   established.

**Do not widen this into a rewrite of either file.** Both are long, both are
load-bearing for every dispatch, and every line costs every future session. This
is a section move, a clause and a trim.

## Done when

1. `.claude/agents/ticket-reviewer.md` instructs fetch → detach → farm → build →
   measure in that reading order, and a reader following the file top to bottom
   cannot build before checking out.
2. The file says explicitly that `npm run build` is the order-dependent step and
   that the farm may run on either side of the checkout.
3. Both existing warnings survive the move, attached to the steps they explain.
4. `dispatching.md`'s _And say the checkout comes before the build_ no longer asks
   an orchestrator to write the clause into every gate prompt, and cites `repo-20`
   as the durable fix.
5. `.claude/agents/builder.md` reconciles its "you inherit the orchestrator's"
   paragraph with the skill's explicit-model dispatch, in one clause, without
   restating the mapping table.
6. `npm run check` exits 0. (`npm run format` will not touch any of these files —
   `.claude/` is in `.oxfmtrc.json`'s `ignorePatterns` — so the structure of every
   edited page must be proofread by eye rather than trusted to the formatter.)

## Review

**Gate: PASS** — 2026-09-05 · `origin/main...9389612` (06d905b base, same diff at current tip 4a4cc4f) · defect hunt run myself, medium depth (no code-review dispatch — running as ticket-reviewer subagent)

| Done when                                                                                      | Proof                                                                                                           |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. fetch→detach→farm→build→measure, single reading order, cannot build before checkout         | `ticket-reviewer.md:20-31` — verified by reading; single ordered list under one heading                         |
| 2. explicit statement that only `npm run build` is order-dependent                             | `ticket-reviewer.md:33-36` — verified by reading                                                                |
| 3. both existing warnings survive the move, attached to their steps                            | `ticket-reviewer.md:38-51` — verified by reading; merged into one sequence per Build step 2's own instruction   |
| 4. dispatching.md's stopgap clause retired, cites repo-20                                      | `dispatching.md:127-143` — verified by reading + grep sweep, no dangling anchor references anywhere in the tree |
| 5. builder.md reconciles "inherit" with explicit-model dispatch, one clause, no restated table | `builder.md:16-18` — verified by reading; premise (`SKILL.md:84-86`) checked and holds                          |
| 6. `npm run check` exits 0                                                                     | verified — ran it on the committed tree, exit 0                                                                 |

- **Citations checked, not just trusted.** Every line the builder cited (`ticket-reviewer.md:22,25,27,31,33-36,38-52`; `dispatching.md:127,129,139`; `builder.md:16-18`) was opened and matches the claim made about it. `:25` cites the "confirm tree" step rather than literally "detach", but it sits correctly between detach and farm in the reading order, so the citation supports the claim it's attached to.
- **Heading-rename collision (repo-21 risk).** Re-ran and widened the builder's grep: `grep -rn "checkout comes before the build"`, `grep -rni "and-say-the-checkout"`, `grep -rn "dispatching.md#"` across all `.md` — zero dangling references under any spelling, no anchor links into the file at all. Confirmed clean.
- **Section-move judgment (angle 3) — I agree it's a wording call, not a decision.** Pushing the old top section down vs. pulling the bottom section up produces an identical reading order for the four numbered steps; the acceptance lines don't depend on which section sits physically first. Nothing contract-adjacent, no scope widening. Not escalating.
- **Brief's false parenthetical (Done-when 6) — reproduced and confirmed true.** Positive control: corrupted the ticket file's frontmatter fence, `npx oxfmt --check` on it → exit 1 (docs/ is checked); same corruption on a `.claude/` file → oxfmt refuses with "no target files" (exit 2, ignored). Builder's Log correction is accurate. Does not affect the outcome since `npm run check` exits 0 on the tree as committed regardless.
- **Positive control (angle 5):** the two `oxfmt --check` corruptions above — confirmed the check tooling can fail before trusting it passed clean.
- **Diff scope matches the brief** — read the full `git diff 06d905b...HEAD` for all three `.claude/` files: a section merge/move, one clause in `builder.md`, and the `dispatching.md` trim. Nothing wider.
- **Commit message** `docs(repo): reorder the reviewer's setup so the checkout precedes the build (repo-20)` passes `node scripts/commit-message.mjs --text "..."` (exit 0).
- **Unverified, flagged rather than skipped:** no live sub-reviewer was dispatched against the new `ticket-reviewer.md` text before this gate (builder's Log discloses the same gap — "Not run"). This gate is the first actual exercise of the new file's setup section, by virtue of my following it myself, and it worked as written.
- **findings** · defect hunt at medium depth returned 0; 0 carried, 0 dropped.
- NFR: security n/a · performance n/a · reliability ✓ (this is the ticket's whole point, improved) · maintainability ✓ (single source of truth, duplicate stopgap removed).

## Log

- **2026-09-05** — Filed from the 2026-09-04 orchestration batch's close-out,
  which recorded the defect in
  `.claude/skills/orchestrate-tickets/reference/history.md` as its seventh entry
  and added the stopgap clause to `dispatching.md` in the same commit.

  **The reproduction is dl-37's reviewer**, reported rather than re-run here: it
  ran `npm run build` before `git checkout --detach`, built `main`, and noticed
  only because `dist/` lacked a file the branch adds. The _ordering_ in
  `ticket-reviewer.md` was verified directly — the setup section is at the top of
  the file and _Getting the branch under review_ is far below it — and that is the
  half this ticket fixes.

  **Filed rather than folded in** on the owner's decision, over reordering the
  agent definition on the recording branch. The reasoning is `CLAUDE.md`'s: this
  is a defect, so the reproduction is the deliverable, and a defect earns a ticket
  even when the fix is small.

  **Id.** `repo-20` confirmed free against both lists `docs/01-TICKETS.md`
  requires. `docs/work/` tops out at `repo-19`; a tree-wide grep for `repo-2[0-9]`
  across `docs/`, `tools/`, `scripts/` and `.claude/` returned nothing, and the
  looser `repo-[0-9]+` sweep's only higher hits are `repo-40`, `repo-80`,
  `repo-90`, `repo-99`, `repo-404`, `repo-808`, `repo-901` and `repo-999`. **None
  is a filed ticket**, which is the thing that matters here: `repo-404` is a
  fixture in `scripts/test/status.test.ts` and `docs/01-TICKETS.md`'s
  dangling-`depends_on` example, and the other seven appear **only as example ids
  inside other tickets' own prose** — `repo-3`, `repo-6`, `repo-7`, `repo-8`,
  `repo-15`, `repo-16`, `repo-17`, `repo-18` and `repo-19` — several of them
  discussing this same sweep, and `repo-8` proposing a "-9xx band" convention that
  was never implemented. The three open feature branches (`dl-37`, `repo-18`,
  `repo-19`) name no `repo-2x` id in any Log or gate record, and no pull request
  in any state names one.

  **Corrected during this branch's gate, and the correction is worth more than the
  sentence.** The first wording said all eight "are all fixtures in
  `scripts/test/status.test.ts`", which is false for seven of them. The cause was
  the command, and both halves are here because the trap is invisible in the
  output:

  ```
  $ grep -rlnE 'repo-(40|80|90|99|404|808|901|999)' scripts packages
  scripts/test/status.test.ts

  $ grep -roE 'repo-(40|80|90|99|404|808|901|999)' scripts packages | sort -u
  scripts/test/status.test.ts:repo-404
  ```

  The `sort -u` is not decoration and is the reason that line is the whole output:
  the bare `-o` run prints **eight identical lines**, one per occurrence of
  `repo-404`, and the first draft of this block showed one of them with no `sort`
  and no ellipsis — an abridged transcript presented as the output, inside the
  code block documenting abridgement. Caught on a last read-through. Print what
  the command prints, or change the command until it prints what you show.

  **`-l` reports files rather than matches, so an alternation under `-l` cannot
  answer the question it looks like it answered.** The first run is a truthful
  answer to "which files contain any of these eight"; I read it as an answer to
  "where does each of these eight live", and those differ by exactly the
  information `-l` is defined to discard. Only `repo-404` ever matched. Re-run per
  id — `grep -rl "<id>\b"` eight times — and the eight ids resolve to **eleven
  files**: the nine `docs/work/repo-*.md` tickets listed above, plus
  `docs/01-TICKETS.md` and `scripts/test/status.test.ts`, both of which carry
  `repo-404` only. Nothing in the first output hints that seven ids are missing
  from it. That is
  the fourth instance on this branch
  of the move it exists to record — reading a result at a glance and reporting the
  reading as the measurement — and the first committed by the agent writing the
  record of the other three. `repo-16` and `repo-19` had both got this right in
  their own filings; flattening their wording is what produced the error.

- **2026-09-05** — Built. `ticket-reviewer.md`'s two setup sections are now one,
  at the top of the file, in the order fetch → detach → confirm → farm → build;
  `dispatching.md`'s stopgap is a measurement that tells the next orchestrator not
  to re-add the clause; `builder.md` defines _inherit_ in the clause that
  introduces the table.

  **Which direction the section moved was left open by the brief, and both
  readings satisfy it.** Build step 1 gives the order to reach, not whether to
  push the setup paragraphs down to _Getting the branch under review_ or pull that
  section up to the top. I pulled it up and merged the two, which leaves one setup
  section instead of two and keeps the file's first instruction the reader's first
  action — pushing the setup down would have opened the page on _You send your
  findings to the builder_, a reporting rule, which is worse for the audience the
  ticket names. Recorded rather than escalated: the ticket fixes a reading order
  and both options produce the required one, so this is a wording call, not a
  decision with two different outcomes.

  **The trim in step 3 was pre-specified by the file itself**, which is worth
  knowing before anyone re-argues it: the section already ended "When that lands,
  keep the measurement and drop the clause — a reminder for a bug that no longer
  exists is worse than no reminder." The edit is that instruction carried out, not
  a judgement about how far to cut.

  **Step 4's premise was verified rather than transcribed.**
  `.claude/skills/orchestrate-tickets/SKILL.md` step 3 does say "pass that model
  explicitly rather than letting it inherit, naming your own model where the table
  says inherit", with the backgrounded-`resolvedModel` reasoning attached. So the
  clause added to `builder.md` defines the table's word and cites the step; the
  reasoning stays where `repo-17` put it.

  **What the brief had wrong, in one place.** `Done when` 6 says `npm run format`
  "will not touch any of these files — `.claude/` is in `.oxfmtrc.json`'s
  `ignorePatterns`". That is true of the three edited pages and false of the
  fourth file this branch edits: `docs/` is not ignored, so this ticket is
  formatted by oxfmt and `npm run format` has to run before `npm run check` will
  pass. Read as written — "no formatting on this branch" — it breaks the check it
  appears in.

  **Not run:** no reviewer was dispatched from this branch's copy of
  `ticket-reviewer.md`, so the new ordering is proofread rather than exercised.
  The gate on this branch reads the merged `main` version, which is the old one.
