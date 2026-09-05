---
id: repo-21
tool: repo
title: The orchestration skill has outgrown its loop, and nothing re-verifies it
kind: chore
status: ready
milestone: null
depends_on: [repo-18]
difficulty: hard
---

# repo-21 — The orchestration skill has outgrown its loop

**Packages:** `.claude/skills/orchestrate-tickets/` (`SKILL.md` and
`reference/history.md`), `.github/workflows/ci.yml`.

## Read this first — three branches move these files before you start

This ticket must not begin until `docs/record-2026-09-04-orchestration-batch`
lands. That branch (tip `479b7b3`, **no PR as of filing**) rewrites `SKILL.md`,
`reference/records.md`, `reference/dispatching.md` and `reference/history.md`,
and files `repo-20`. Starting before it merges guarantees a conflict across the
whole page.

It is not in `depends_on` because `repo-20`'s file does not exist on `main`, and
a `depends_on` naming a ticket the branch cannot see fails
`node scripts/status.mjs --json`, which is a CI gate. The sequencing is prose on
purpose.

Two more open branches change what this work has to do:

| Branch / PR                                          | What it changes here                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `docs/record-2026-09-04-orchestration-batch` (no PR) | Rewrites `SKILL.md`. **Blocking.** Everything below is measured against its tip, not `main`              |
| `repo-18-citation-anchors` (#146)                    | Ships `citations.mjs --require-anchors`. **Build step 1 cannot be done without it** — hence `depends_on` |
| `repo-19-needs-decision-status` (#145)               | Adds a `needs-decision` status. Retires most of step 2's decision-grep bullet — see Build step 6         |

**Every line number in this ticket refers to `479b7b3`'s tree and will be wrong
by the time you read it.** Locate provisions by their quoted opening phrase, not
by number. The line numbers are given so the sizes can be re-derived, not so they
can be followed.

## Why

`.claude/skills/orchestrate-tickets/SKILL.md` is written by appending. Each
session that runs the loop adds what it learned, and nothing has ever removed a
line or re-checked one. Measured on `origin/main@c37cab9`:

```
$ wc -l .claude/skills/orchestrate-tickets/SKILL.md .claude/skills/orchestrate-tickets/reference/*.md
   464 SKILL.md
   196 reference/concurrency.md
   217 reference/defect-shapes.md
   351 reference/dispatching.md
   115 reference/history.md
   257 reference/records.md
   250 reference/sizing.md
   271 reference/worktree-hygiene.md
  2121 total
```

At `479b7b3` the same command gives **2555**, with `SKILL.md` at **570**. Inside
it, `## The loop` is 12 steps in 225 lines (34–258) and `## Decisions` is
**259 lines (304–562) — larger than the loop it exists to serve**. Lines matching
`grep -ciE 'measured|20[0-9]{2}-[0-9]{2}-[0-9]{2}'` went 21 → 31.

**That growth is the evidence, not a complaint about it.** Every line
`479b7b3` added is correct and was earned by a real failure; the branch is good
work. The defect is that a page written this way has no mechanism by which a
later session can tell a rule it must obey from a story explaining why the rule
exists — so the only safe edit is to append, and the page grows monotonically
whether or not it gets better. A 570-line instruction read in full by every
orchestrator is also a direct cost on the one context the skill's own opening
paragraph says must survive the batch.

### The reproduction: three defects, all in the skill's own instructions

All three were found in one session (2026-09-04) by agents told to distrust the
brief they were handed. Two are the class that only appending produces.

**1. A claim about another file that stopped being true.** `SKILL.md` step 4 said
a `mechanical` ticket puts a **Sonnet** builder in a batch, and drew from that the
consequence that the gate's model "cannot be set once". `.claude/agents/builder.md`
maps `mechanical` to **`haiku`** — verified at `.claude/agents/builder.md:22`, ``| `mechanical`
| `haiku` |``. The skill was right when written; `builder.md` changed underneath
it, and the sentence went on being read as current for as long as nobody
re-checked. Nothing could have caught this, because nothing checks it.

**2. A prescribed command that is wrong in both directions.** Step 2 offers
`grep -nE '^#{2,4} .*([Dd]ecision|[Oo]pen question)'` over the `--ready`
candidates as the cheap way to see how much of the board is blocked. Re-run here
against the six that `--ready` returns on `c37cab9`:

```
$ npm run status -- --ready                     # dl-32 dl-37 repo-15 repo-16 repo-18 repo-19
$ grep -nE '^#{2,4} .*([Dd]ecision|[Oo]pen question)' <those six>
repo-18:84:## Open question — do not settle it here
repo-15:241:## The decisions this ticket poses, which it does not settle
repo-19:100:## The decision this ticket poses, and does not settle
dl-37:37:## The decision, answered 2026-09-03 — not open
dl-32:73:## The decision this ticket exists to force
```

Five matched. Five are genuinely blocked. **They are not the same five.** `dl-37`
matches on a heading that says the decision is _answered_; `repo-16` is missed
because its open decision is a paragraph under `## Build` — _"Nothing here is a
code fix, and the deliverable is a decision. Do not settle it inside the
implementation"_ — under no matching heading, and its `#` H1 is outside the
`#{2,4}` range anyway. **The two errors cancel into a correct total**, so no
downstream check could catch it.

**3. A rule the page falsified on the way in.** Commit `a980d5e` wrote into
`SKILL.md` that the pre-merge CI look is one _"nobody in the loop is positioned"_
to take — written by an orchestrator that had taken exactly that look, with one
`gh run list`, twenty minutes earlier. Corrected two commits later by `62cb999`,
entirely inside the same branch. Premises true, conclusion false, and the page
already documents that shape twice elsewhere.

### What `479b7b3` already did, which this ticket must not redo

Checked against that branch rather than assumed. **All three defects above are
already handled there**, and two of the six changes below have partly landed:

| Already on `479b7b3`                                                                                                                            | Still open                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Defect 1 — step 4 now says `haiku`, and `ticket-reviewer.md`'s pin is cited                                                                     | Neither claim is machine-checked; nothing stops the next drift (Build 1)                                                      |
| Defect 2 — a _"Read the matches, do not count them"_ bullet with this measurement                                                               | The grep itself is unchanged, which is right; but it and its two bullets are 13 lines that `repo-19` mostly retires (Build 6) |
| Defect 3 — `62cb999` reframes it as a division of labour and gives the `--json` command                                                         | —                                                                                                                             |
| Build 4's rule — step 3 already says _"Then pass that model explicitly rather than letting it inherit"_                                         | The apparatus around it is still 24 lines explaining what a background dispatch does not return (Build 4)                     |
| Build 5 entirely — both failure modes are written, with the `grep '^## Review'` discriminator and the 2026-09-04 gate-declines-PASS measurement | They arrived as ~20 more lines inside the loop; the work left is placement and compression, not authorship (Build 5)          |

So **this ticket is the structural cleanup, and only that.** Do not re-file, re-argue
or re-measure any of the five rows above.

## Build

Work against `main` **after** `docs/record-2026-09-04-orchestration-batch` has
merged. Six changes. They are independent enough to commit separately and should
be.

### 1. Make `SKILL.md`'s cross-file claims machine-checkable

Defect 1 is exactly the class `citations.mjs --require-anchors` (repo-18, #146)
catches: a claim about another file that still _resolves_ while no longer _saying_
what was claimed. **#146 was built over its own builder's recorded objection that
nothing in the tree would consume the flag. This is the consumer.**

Verified against `origin/repo-18-citation-anchors` by running its `citations.mjs`
from a scratch copy, not from its documentation:

- The syntax is `path:line` (optionally `-end`) followed by a straight-double-quoted
  anchor; the anchor must _start_ on a line inside the range. Markdown links do
  **not** parse as citations, so today `SKILL.md` has effectively none.
- Writing defect 1's own sentence as a citation reports
  `MOVED  .claude/agents/builder.md:22 "| \`mechanical\` | \`sonnet\` |"`with
*"not in 22, and not anywhere in the file"*, exit **1**. The true wording, and`.claude/agents/ticket-reviewer.md:6 "model: sonnet"`, both report `ok`— exit
**0** with`--require-anchors`. **The check would have caught defect 1 and does
  not fire on the corrected text.**
- Working-tree mode uses `git ls-files`, so it needs no history: it is safe in
  `check`'s depth-1 clone with no `fetch-depth`.

Do:

1. Convert `SKILL.md`'s cross-file _claims_ to anchored citations. At `479b7b3`
   there are exactly two — the `builder.md` difficulty table in step 3 and the
   `ticket-reviewer.md` `model: sonnet` pin in step 4. **Pointers to
   `reference/*.md` siblings are not claims** and stay ordinary links; converting
   them would pin a dozen line numbers for no protection.
2. Fix the false positive that makes the file fail today. `## The loop` step 8
   uses `file.test.ts:88` as an _illustration_ of what a good verdict names, and
   the checker parses it as a citation and reports it `unresolvable`:
   `node scripts/citations.mjs .claude/skills/orchestrate-tickets/SKILL.md` exits
   1 on `main` right now. **Reword the illustration so it does not parse** — the
   grammar needs a slash or a known extension, so naming the file without one
   suffices. Do not make it a real citation into a test file: that pins a line in
   an unrelated suite and turns any edit there into a red CI run on this page.
3. Add one step to `ci.yml`'s `check` job, beside the existing
   `node scripts/status.mjs --json > /dev/null`, and comment it the way that line
   is commented — say what it catches and name defect 1:

   ```
   node scripts/citations.mjs .claude/skills/orchestrate-tickets/SKILL.md --require-anchors
   ```

   `check` is filtered by nothing, markdown included, which is what this needs.
   **Scope it to `SKILL.md` only.** The `reference/` pages carry the narrative and
   are full of prose that would parse as citations; widening is a separate ticket
   if anyone wants it.

4. **Prove the gate before trusting it**: with the step wired, edit one anchor to
   something false, confirm the command exits non-zero, revert. Say in the Log
   that you did, with the output.

### 2. Split every provision three ways

The page mixes three kinds of sentence with no visual or structural difference
between them, which is why nothing can be removed. Give each provision:

- **Instruction** — imperative, 1–3 lines. Stays in `SKILL.md`.
- **Measurement** — one dated parenthetical. Stays. This is what stops a future
  session re-litigating a settled rule, and it is the reason a bare instruction
  list would be worse than what exists now. **Do not delete the numbers.**
- **Narrative** — the story of the session that found it. Moves to
  `reference/history.md`, which already tells its reader _"read it only if you
  are revising this skill"_ and is therefore the right home.

Note the four `measured` claims on `main` that carry **no date at all** —
`SKILL.md`'s _"Measured before this line existed"_, _"Measured: a reviewer that
reported only 'findings sent'"_, _"was unmeasured, and a ticket's own baseline"_,
and _"the builder's measured answer beats both gates"_. A measurement with no date
cannot be re-verified and is narrative wearing a measurement's clothes. Date them
from `git log` where the commit says, and demote them where it does not.

### 3. Collapse the laundering family into one table

`## Decisions` states one rule in many costumes. The page notices this once — _"All
three failures are one mistake in different costumes: compressing something the
receiving agent needed in full"_ — and applies the observation to three of them
while leaving the rest standing. At `479b7b3` there are **eleven distinct failure
shapes** under that one rule, listed here by opening phrase so you can find them
after the lines move:

1. _"Read the options out of the ticket yourself…"_
2. _"An option's stated mechanism is a proposal, not a fact…"_
3. _"Do not launder subagent claims."_
4. _"Cheaper than marking a claim unverified: run it."_
5. _"…mark relayed claims as unverified in the relay itself."_
6. _"And do not launder your own summaries downstream."_
7. _"The hardest finding to relay safely is one whose premises are all true."_
8. _"Its mirror is worse… a relay's citation can be wrong while its conclusion is right."_
9. _"Ask for the mechanism, not the fix."_
10. _"Make the builder reproduce a finding before accepting it."_
11. _"Paste the artifact; never describe it."_

Add the twelfth, which currently sits in `## After a merge` rather than with its
family: **reading a result at a glance and reporting the reading as the
measurement** — `cancelled` is a _completed_ run and a glance counts it as green,
which is why that section now insists on `--json`.

Replace all of it with **one section and one table**: failure shape / one-line
instance / date. Two of the eleven (_"So separate the outcome from the route…"_
and _"So check the rule you are about to cite…"_) are remedies attached to their
neighbours rather than shapes of their own — keep them as the instruction the
table's rows point at, not as rows. The long worked examples go to `history.md`
under change 2.

### 4. Retire the model-check apparatus, keeping the rule

The rule landed on `479b7b3`; only the scaffolding is left. Step 4 still spends
24 lines establishing what is knowable, what a backgrounded dispatch does not
return, and what to write in a record when you had to infer. **Passing `model`
explicitly on every dispatch makes all of that unnecessary**: the resolution is
fixed at dispatch time by the dispatcher, so there is nothing to observe
afterwards and nothing to infer.

- Step 3 already says to pass it for the builder. Say the same for the **gate**:
  `ticket-reviewer.md` pins `model: sonnet`, so pass `model` explicitly there too,
  including when Sonnet is what you wanted.
- Delete the `resolvedModel` apparatus and the "say you inferred it" fallback.
  Keep the one-line consequence — a dispatcher that names both models can state
  the pairing as fact — and keep the _"11 tickets, 22 gates, none gated by a
  different model than built it"_ measurement.

**One open question, deliberately not settled here, being checked separately:
whether a subagent can alter its own model or agent type after dispatch.** If it
can, "fixed at dispatch time" is false and this change needs the observation step
back in some form. **Fold the answer in before implementing this step**; do not
implement around the uncertainty and do not resolve it yourself.

### 5. Give the two new failure modes their tests, and get them out of the loop

Both were authored on `479b7b3` and neither needs writing again. What is missing
is that each is prose inside a loop step rather than a named failure with a
command:

- **Stalled exchange** — a finished pair and a stalled pair are identical from the
  orchestrator's seat: `npm run status` reads `done`, the branch is pushed, both
  reports say finished. Discriminator, one command per ticket:
  `git show <branch>:<ticket-path> | grep '^## Review'` — empty means still open.
  `^## Review` is correct for a _live_ branch because `.claude/agents/ticket-reviewer.md`
  says the gate returns _"a `## Review` section"_; be aware it under-matches
  historical tickets, where `## Gates` and `## Gate 1 — …` also occur (52 files
  match `^#{2,3} (Review|Gates?)` against 36 for `^## Review$`). Say which you
  mean. **Do not let this ticket produce a second grep that is wrong in both
  directions** — that is defect 2, and it would be a poor joke to repeat it here.
- **Owner-decision provenance** — a relayed decision must carry _how it was taken_
  (question, options, which was chosen, whose recommendation it overrode), because
  no agent can verify authority from inside its own sandbox. Its test is the
  record, not a command: a relay that names a decision without those four fields
  is incomplete on its face. Cost of its absence, 2026-09-04: a reviewer correctly
  refused to extend a PASS over a commit whose only warrant was a builder's
  _"the owner directed this"_, and the round was lost.

Move both to a named list beside the other failure shapes. The loop step keeps one
line and a pointer.

### 6. The loop as a bare checklist

Reduce `## The loop` to roughly **30 imperative lines** — twelve steps, each a
sentence or two, each pointing into `reference/` for the part that needs
explaining. Everything that explains _why_ a step is what it is moves down the
page or out to `reference/`.

Two specifics:

- Step 2's decision-grep bullets are 13 lines. **If `repo-19` (#145) has landed,
  `--ready` excludes `needs-decision` tickets and the grep is a fallback for
  unmigrated tickets, not the primary move** — verified on
  `origin/repo-19-needs-decision-status`, which adds `needs-decision` to
  `STATUSES` and excludes it from `UNSTARTED`. Rewrite the bullet to match
  whichever is true when you build, and say in the Log which you found.
- The `## Reference` table at the top already does the pointing. Do not build a
  second index; point at it.

**Target: `SKILL.md` from 570 to roughly 180 lines.** This is a target for sizing
the work, **not an acceptance criterion** — a page that hits 180 by deleting
measurements is worse than the 570 it replaced, and no `Done when` line below
mentions a count.

## Done when

1. `node scripts/citations.mjs .claude/skills/orchestrate-tickets/SKILL.md --require-anchors`
   exits **0**, with every citation reported `ok` and none `unanchored`, `moved`
   or `unresolvable`. (Today it exits 1 on one unresolvable prose false positive.)
2. The same command runs in `ci.yml`'s `check` job, and the Log records the
   deliberate-failure check from Build 1.4: the command's non-zero exit and
   message with one anchor falsified, and the revert.
3. Every claim `SKILL.md` makes about a file outside
   `.claude/skills/orchestrate-tickets/` is an anchored citation. Checkable:
   `grep -noE '\]\(\.\./[^)]*\)' SKILL.md` returns nothing that is not also
   covered by a citation on the same line.
4. `grep -c` for `^#{3,4} ` inside `## Decisions` shows the laundering family
   reduced to **one** section, whose body contains a table with one row per
   failure shape and a date in every row. The twelve shapes listed in Build 3 each
   appear as exactly one row; none has been dropped.
5. `## The loop` contains twelve numbered steps and no paragraph longer than three
   lines. Checkable by `awk` over the span between `^## The loop` and the next
   `^## `.
6. Every dated measurement present in `SKILL.md` at the merge-base is still
   somewhere in the skill — `SKILL.md` or `reference/history.md`. Checkable:
   extract each `20[0-9]{2}-[0-9]{2}-[0-9]{2}` occurrence with its sentence from
   the merge-base, and `grep` each in the new tree. **This is the line that
   protects against a cleanup that hits its size target by deleting evidence.**
7. `SKILL.md` contains no `resolvedModel`, and both step 3 and step 4 instruct
   passing `model` explicitly. The open question in Build 4 has been answered and
   the answer is recorded in this ticket's Log.
8. `npm run check`, `npm run format` (oxfmt formats markdown) and
   `node scripts/status.mjs --json > /dev/null` all pass.

## Log

- **2026-09-05 — filed.** Every number in this ticket was re-measured against
  `origin/main@c37cab9` and `origin/docs/record-2026-09-04-orchestration-batch@479b7b3`
  rather than taken from the filing brief. Four things came back different from
  how they were briefed, and all four are in the text above:

  1. **The baseline is 570, not 464.** The brief sized the work against `main`.
     `479b7b3` is a blocking dependency and grows `SKILL.md` by 106 lines, so the
     464 → ~180 target is really 570 → ~180. `## Decisions` grows 217 → 259 and
     the loop 187 → 225.
  2. **Build 5 has already landed in full**, not partly. Both failure modes are on
     `479b7b3` with the exact `grep '^## Review'` discriminator and the
     gate-declines-PASS measurement. The residual work is placement, so the step
     was rewritten from "add" to "give them tests and move them".
  3. **Build 4's rule has landed too** — step 3 on that branch already says to
     pass the model explicitly. What remains is deleting the apparatus the rule
     made redundant.
  4. **Defect 2 is documented on `479b7b3` as well**, under _"Read the matches, do
     not count them"_. The brief presented defects 1 and 3 as the ones being fixed
     there. All three are.

  Net: the branch is not a partial fix this ticket completes — it is the clearest
  evidence for the ticket, because one session added 106 correct lines and could
  not remove any.

- **The `--require-anchors` behaviour was executed, not read.** `citations.mjs`
  was extracted from `origin/repo-18-citation-anchors` to a scratch path and run
  three times: over `SKILL.md` (1 citation, unresolvable, exit 1); over a probe
  carrying defect 1's original wording (`MOVED`, _"not anywhere in the file"_,
  exit 1); over a probe with both true anchors (2 verified, exit 0 with the flag).
  The exit codes were taken from `$?` on an unpiped invocation, after a first
  attempt through `| tail` read `tail`'s status instead.

- **This ticket fails its own citation run, on purpose.**
  `node scripts/citations.mjs docs/work/repo-21-…md` reports `5/6 resolve`, exit 1.
  The failing one is Build 1.2's verbatim quotation of `SKILL.md`'s illustrative
  test reference, kept as written because it _is_ the false positive Build 1.2
  asks you to remove. `citations.mjs` prints the rule that covers this: _"a
  citation that is a finding's own evidence … must stay as written."_ The other
  five (`.claude/agents/builder.md:22` ×3 and `.claude/agents/ticket-reviewer.md:6`
  ×2) all verify against their anchors. Nothing in CI reads tickets with
  `citations.mjs` today, so no gate is red. **Re-run this before gating** — the
  first draft of this bullet said `3/4` and was falsified by the commit that
  added it, which is the drift the skill's own records section warns about.

- **`kind: chore`, not `fix`.** It carries a reproduction, but the deliverable is
  a restructure of documentation rather than a corrected behaviour, and the three
  defects it reproduces are already fixed on `479b7b3`.

- **`difficulty: hard`, rating the build and not the blockage.** There is no open
  decision in this ticket. The rating is for the work itself: deciding
  instruction-versus-measurement-versus-narrative over ~2,500 lines, and
  collapsing twelve provisions into one table without losing a rule, is judgement
  that cannot be checked by the diff. The one unknown — Build 4's
  subagent-model question — is being answered separately and is not what earns the
  rating.

- **Id.** `repo-21` confirmed free against both lists `docs/01-TICKETS.md`
  requires. `docs/work/` tops out at `repo-19`; `repo-20` is taken by a ticket
  that exists **only on the unmerged `docs/record-2026-09-04-orchestration-batch`**,
  so `main` alone is not the whole picture. A `repo-2[0-9]` sweep across `docs/`,
  `tools/`, `scripts/` and `.claude/` on `main` returned nothing; the same sweep
  on each of the seven remote branches returned only `repo-20`'s own file and the
  two `history.md`/`dispatching.md` lines naming it. `gh pr list --state all`
  names no `repo-2x` id in any title. The looser `repo-[0-9]+` sweep's higher hits
  — `repo-40`, `repo-80`, `repo-90`, `repo-99`, `repo-404`, `repo-808`, `repo-901`,
  `repo-999` — are all fixtures in `scripts/test/status.test.ts`.

- **`depends_on: [repo-18]` only.** `repo-20` and the recording branch are
  sequencing, not dependency, and naming a ticket absent from this branch's tree
  would fail `status.mjs --json`, which is the CI gate. The constraint is stated
  at the top of the page instead, where an orchestrator reading the opening
  section will see it.
