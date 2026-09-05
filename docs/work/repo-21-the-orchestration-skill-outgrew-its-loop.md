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

**Packages:** `.claude/skills/orchestrate-tickets/` (`SKILL.md`,
`reference/history.md`, `reference/records.md`), `.github/workflows/ci.yml`.

## Read this first — three branches move these files before you start

This ticket must not begin until `docs/record-2026-09-04-orchestration-batch`
lands. That branch — **PR #148** — rewrites `SKILL.md`, `reference/records.md`,
`reference/dispatching.md` and `reference/history.md`, and files `repo-20`.
Starting before it merges guarantees a conflict across the whole page.

**It moved four times while this ticket was being filed and gated** — `479b7b3` →
`0d62b5e` → `87f93f3` → `69327da` → `7e1fbc1`, with the PR opening partway
through. **Every measurement and reproduction below is pinned to `87f93f3` by
sha, not to the branch name**, so a re-run answers the question that was asked.
Two of them are known to have changed since; both say so where they appear. Re-run
all of them against the merged text before you build.

It is not in `depends_on` because `repo-20`'s file does not exist on `main`, and
a `depends_on` naming a ticket the branch cannot see fails
`node scripts/status.mjs --json`, which is a CI gate. The sequencing is prose on
purpose.

Two more open branches change what this work has to do:

| Branch / PR                                         | What it changes here                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `docs/record-2026-09-04-orchestration-batch` (#148) | Rewrites `SKILL.md`. **Blocking.** Everything below is measured against its tip, not `main`              |
| `repo-18-citation-anchors` (#146)                   | Ships `citations.mjs --require-anchors`. **Build step 1 cannot be done without it** — hence `depends_on` |
| `repo-19-needs-decision-status` (#145)              | Adds a `needs-decision` status. Retires most of step 2's decision-grep bullet — see Build step 6         |

**Every line number in this ticket refers to `87f93f3`'s tree and will be wrong
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

At `87f93f3` the same command gives **2586**, with `SKILL.md` at **567**. Inside
it, `## The loop` is 12 steps in 225 lines (34–258) and `## Decisions` is
**259 lines (301–559) — larger than the loop it exists to serve**. Lines matching
`grep -ciE 'measured|20[0-9]{2}-[0-9]{2}-[0-9]{2}'` went 21 → 31.

**That growth is the evidence, not a complaint about it.** Every line
`87f93f3` added is correct and was earned by a real failure; the branch is good
work. The defect is that a page written this way has no mechanism by which a
later session can tell a rule it must obey from a story explaining why the rule
exists — so the only safe edit is to append, and the page grows monotonically
whether or not it gets better. A 567-line instruction read in full by every
orchestrator is also a direct cost on the one context the skill's own opening
paragraph says must survive the batch.

### The reproduction: four defects, all in the skill's own instructions

The first three were found in one session (2026-09-04) by agents told to distrust
the brief they were handed. The fourth surfaced while this ticket was being
filed. Three are the class that only appending produces, and **the fourth is the
one that proves the point: #148 rewrote the sentence, carried the error through
the rewrite, and only fixed it when this filing pointed at it.**

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
`gh run list`, twenty minutes earlier. Corrected by the very next commit,
`62cb999` (`git rev-list --count a980d5e..62cb999` = 1),
entirely inside the same branch. Premises true, conclusion false, and the page
already documents that shape twice elsewhere.

**4. A false claim about the harness, which #148 rewrote without fixing.** On
`main`, `SKILL.md` step 4 says a backgrounded dispatch _"returns an agent id and
nothing else"_. **That is false.** A background `tool_response` also carries
`status`, `description`, `prompt`, `outputFile` and — the field the whole
paragraph is about — **`resolvedModel`**. It lacks only the usage, token and
duration fields. What is true is narrower: the _dispatching model_ does not see
it, because the parent receives only the subagent's final text result.

`#148` rewrote that paragraph and **the claim survived the rewrite in a new
spelling** — pinned by sha, because the branch is moving and the command must not
silently answer a different question when you run it:

```
$ git show 87f93f3:.claude/skills/orchestrate-tickets/SKILL.md | grep -n 'resolvedModel'
86:   inherit. A backgrounded dispatch returns no `resolvedModel`, so inherit is the
99:   and neither needs `resolvedModel`** — which a backgrounded dispatch does not
```

Line 86 was the strong version — it concluded the builder's model is _"unobservable
to everyone afterwards"_ — and three documented verification paths falsify it (see
Build 4). **This is why the page needs a mechanism rather than another careful
reader**: the branch whose PR title is _"correct ten skill defects"_ rewrote this
exact sentence and reproduced its error, because rewriting prose does not re-check
it.

**Then it was fixed, which is the ending this defect wanted.** `69327da` — filed
against the same branch, in reaction to this ticket, with a commit message saying
so — replaced both lines with the true narrower statement. At the current tip the
same file reads _"A backgrounded dispatch's `resolvedModel` never reaches **you**"_
and _"which the backgrounded dispatch **does** carry but never shows you"_, which
is what Build 4 step 2 asks for. **So expect defect 4 to be gone from `main` by the
time you build, exactly as defects 1–3 are — verify it before doing Build 4 step 2,
and if it is gone, say so in the Log and do only the compression.** The defect
stays written here because the reproduction is the deliverable and because a
sentence that was rewritten twice before being re-checked is the whole argument.

### What `87f93f3` already did, which this ticket must not redo

Checked against that branch rather than assumed. **Defects 1–3 are already handled
there; defect 4 is not, and that branch carries it forward.** Two of the changes
below have partly landed:

| Already on `87f93f3`                                                                                                                            | Still open                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Defect 1 — step 4 now says `haiku`, and `ticket-reviewer.md`'s pin is cited                                                                     | Neither claim is machine-checked; nothing stops the next drift (Build 1)                                                      |
| Defect 2 — a _"Read the matches, do not count them"_ bullet with this measurement                                                               | The grep itself is unchanged, which is right; but it and its two bullets are 13 lines that `repo-19` mostly retires (Build 6) |
| Defect 3 — `62cb999` reframes it as a division of labour and gives the `--json` command                                                         | —                                                                                                                             |
| Build 4's rule — step 3 already says _"Then pass that model explicitly rather than letting it inherit"_                                         | The apparatus around it is still 24 lines, **two of them defect 4** (Build 4)                                                 |
| Defect 4 — fixed at `69327da`, **after** this ticket was filed and in reaction to it; not fixed at `87f93f3`                                    | **Re-verify before Build 4 step 2.** If it is gone from the merged text, do only the compression and say so in the Log        |
| Build 5 entirely — both failure modes are written, with the `grep '^## Review'` discriminator and the 2026-09-04 gate-declines-PASS measurement | They arrived as ~20 more lines inside the loop; the work left is placement and compression, not authorship (Build 5)          |

So **this ticket is the structural cleanup, and only that.** Do not re-file,
re-argue or re-measure the first five rows above. The sixth is work.

## Build

Work against `main` **after** `docs/record-2026-09-04-orchestration-batch` has
merged. Seven changes. They are independent enough to commit separately and should
be.

**Every "already on the branch" claim above was true at `87f93f3` and the branch
has moved three times since.** Re-run the reproductions against the merged text
before starting any step. Where a step's premise has already been fixed, do the
structural half and record the finding — do not re-fix it, and do not delete the
step's reasoning, which is what the next reader needs.

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

1. Convert `SKILL.md`'s cross-file _claims_ to anchored citations. At `87f93f3`
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
  `reference/history.md`, which is already scoped for exactly this readership:
  `.claude/skills/orchestrate-tickets/SKILL.md:17` sends the reader there with _"read it only if you are revising
  this skill"_. (The sentence is in `SKILL.md`'s own preamble describing
  `history.md`, not inside `history.md` — worth knowing before you go looking for
  it there.)

**And state the rule the three-way split is an instance of, once, because the
cleanup applies it in three files and never says it:** an instruction lives in
**exactly one file, and everywhere else is a pointer to it.** That is why
narrative moves rather than being duplicated, why Build 7 puts one generalisation
in `records.md` instead of a third warning beside two others, and why the
`## Reference` table exists. Without it written down, the next session's honest
move is to add the sentence where it is needed rather than link to it, which is
how this page reached 567 lines.

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
while leaving the rest standing. At `87f93f3` there are **eleven distinct failure
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

Add a thirteenth, measured on this ticket's own gate and written up under
_Gate 2_ above: **a disposition is a relay, and "accepted" is the word that hides
an unmeasured one** — the same shape as "addressed" in a finding. The builder here
answered a finding about a section being too narrative by rewording it, wrote
_"the reasoning is gone"_ into a committed gate record, and shrank the section by
**one line**; the reviewer caught it only because it measured the fix instead of
reading the disposition. The instruction is one clause: **gate a disposition by
measuring what it claims changed.**

Replace all of it with **one section and one table**: failure shape / one-line
instance / date. Two of the eleven (_"So separate the outcome from the route…"_
and _"So check the rule you are about to cite…"_) are remedies attached to their
neighbours rather than shapes of their own — keep them as the instruction the
table's rows point at, not as rows. The long worked examples go to `history.md`
under change 2.

### 4. Retire the model-check apparatus, and correct defect 4

The rule landed on `87f93f3`; the scaffolding around it is wrong as well as
redundant. Step 4 still spends 24 lines establishing what is knowable and what to
write in a record when you had to infer, and two of those lines are defect 4.

**The open question is closed: a subagent cannot alter its own model or type after
dispatch.** So the resolution is fixed at dispatch time and there is nothing to
observe afterwards. **Every harness fact in this step is relayed, not verified by
the filer** — how it was obtained, what the guide's reasoning was, and what is
inference rather than documentation, are in the Log's second-pass entry. Read that
before you write any of these into `SKILL.md`, and if implementing turns one up
false, that finding is worth more than the change.

The facts to write in, and nothing else from this block belongs on the page:

| Claim                                                                                                              | Status                                           | Consequence for the page                      |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| A subagent cannot self-initiate a model change; the only input is `model` at dispatch                              | verified (relayed)                               | passing `model` fixes the pairing at dispatch |
| A subagent cannot change its type or widen `tools:`                                                                | verified (relayed)                               | the gate cannot become the thing it gates     |
| Fallback chains can move a subagent's model mid-run, at the harness's initiative                                   | verified (relayed)                               | say "dispatched as", not "ran as"             |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, an `availableModels` allowlist, and `fork` each override an explicit `model` | verified (relayed)                               | one sentence naming all three                 |
| The default is `CLAUDE_CODE_SUBAGENT_MODEL`, an env var, not a settings key                                        | verified (relayed); repo-local half checked here | a settings grep proves nothing either way     |
| A subagent's "You are powered by the model named X" line is **not guaranteed to exist**                            | **inferred**, and marked so by its source        | never a verification path — see below         |

**Write the three qualifications in.** A rule stated without them is the
overclaiming this page keeps producing.

**And write the last row as an application of a rule this repo already measured,
not as a new claim**: `reference/dispatching.md` says _"Ask an agent to **call** a
tool, not to tell you whether it has one"_, off a builder that listed eight tools
where its frontmatter grants thirteen. Same failure, one field over.

So do:

1. Step 3 already says to pass `model` explicitly for the builder. Say the same
   for the **gate**: `ticket-reviewer.md` pins `model: sonnet`, so pass it
   explicitly there too, including when Sonnet is what you wanted.
2. **Fix defect 4.** Delete both `resolvedModel` sentences. Replace with the true,
   narrower statement: a background dispatch's `tool_response` does carry
   `resolvedModel`; the _dispatching model_ does not see it, because the parent
   receives only the subagent's final text result.
3. Name the three documented override paths in one sentence, so a dispatcher that
   writes "gated by Sonnet" knows what could make that false.
4. Give the verification paths that do work, rather than the apparatus that does
   not: a **`PostToolUse` hook** on the `Agent` tool can read `resolvedModel` and
   feed it back via `hookSpecificOutput.additionalContext`, and **`/tasks`** names
   the model per subagent row. A per-subagent transcript exists at
   `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl` —
   its existence is documented, but **whether it records the model per turn is
   inferred, not verified**, so write it as the weakest of the three or leave it
   out.
5. **Do not offer "ask the agent what model it is" as a path**, and say in one
   clause why, citing `dispatching.md`'s tool-list rule.
6. Keep the _"11 tickets, 22 gates, none gated by a different model than built
   it"_ measurement.

**This step is now a rewrite with a factual claim in it, which is what earns this
ticket its `hard` rating.** If you cannot verify a line here, say which and mark
it — do not silently promote a relayed claim to a stated one on a page whose whole
subject is that failure.

### 5. Give the two new failure modes their tests, and get them out of the loop

Both were authored on `87f93f3` and neither needs writing again. What is missing
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

Three specifics:

- **Step 7 gains one clause, and must not gain a section.** The skill argues the
  different-model gate as blind-spot coverage — two models are unlikely to eyeball
  the same thing. True, and the weaker version. The stronger one, from #148's own
  gate exchange: **describing _how_ you checked surfaces defects that describing
  _what_ you concluded cannot.** Three phrases in that gate each carried a defect
  the conclusion did not — _"only `repo-404` matched, 8 times"_ (an abridged
  transcript), _"once I read it as the nine ticket files"_ (a count with no
  denominator), _"I ran it against a `git archive` snapshot"_ (an incomplete
  search tree). Two found errors in the builder's work; the third found one in the
  reviewer's own. **None was framed as a finding; all three found something.** So
  step 7 should ask both agents for their method, not only their verdict. One
  clause. It is free, and it will be tempting to grow it.
- Step 2's decision-grep bullet is **16 lines** at `87f93f3` (55–70), and 22 with
  the seam-mapper bullet that follows it (55–76). `main` is not the baseline here:
  it lacks the _"Read the matches, do not count them"_ measurement entirely, which
  arrives with the record branch. **If `repo-19` (#145) has landed,
  `--ready` excludes `needs-decision` tickets and the grep is a fallback for
  unmigrated tickets, not the primary move** — verified on
  `origin/repo-19-needs-decision-status`, which adds `needs-decision` to
  `STATUSES` and excludes it from `UNSTARTED`. Rewrite the bullet to match
  whichever is true when you build, and say in the Log which you found.
- The `## Reference` table at the top already does the pointing. Do not build a
  second index; point at it.

**Target: `SKILL.md` from 567 to roughly 180 lines.** This is a target for sizing
the work, **not an acceptance criterion** — a page that hits 180 by deleting
measurements is worse than the 567 it replaced, and no `Done when` line below
mentions a count.

### 7. One generalisation in `records.md`, replacing three warnings

`reference/records.md` already carries one member of a family without naming it:
_"Measure that exit code without a pipe: `$?` after `| tail` is"_ the pipe's
status. Two more of the same shape surfaced in #148's gate, and both reproduce
here:

```
$ grep -rlnE 'repo-(40|80|90|99|404|808|901|999)' scripts packages
scripts/test/status.test.ts                  # reads as "all eight are there"
$ grep -rhoE 'repo-(40|80|90|99|404|808|901|999)' scripts packages | sort -u
repo-404                                     # only one of the eight matched

$ grep -rlnE 'repo-(40|404)' scripts nosuchdir
ugrep: warning: nosuchdir: No such file or directory      # stderr
scripts/test/status.test.ts                               # stdout — real matches
$ echo $?
2
```

`-l` under an alternation cannot say _which_ alternative matched, and a missing
search path still prints the matches from the paths that exist — so an incomplete
search is indistinguishable from a complete one on stdout alone. In both cases
**the flags and the exit code carry what the output cannot, and the habit of
reading the matching line discards them.** Write that generalisation once and
point the three instances at it, rather than adding a third warning.

**Put it in `records.md`, not `defect-shapes.md`.** The existing `$?`-after-a-pipe
member is already there; `defect-shapes.md` is about what a gate hunts for in
_code_, while this is about an agent misreading its own command and writing the
misreading down — which is what `records.md` governs. Splitting a three-member
family across two files is precisely what this cleanup exists to stop.

The `-l` instance has a full worked reproduction in `repo-20`'s Log at `87f93f3`,
including why `sort -u` is load-bearing in the `-o` transcript. **Cite it; do not
restate it.** The missing-path instance is the third comment on #148.

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
   failure shape and a date in every row. The thirteen shapes listed in Build 3 each
   appear as exactly one row; none has been dropped.
5. `## The loop` contains twelve numbered steps and no paragraph longer than three
   lines. Checkable by `awk` over the span between `^## The loop` and the next
   `^## `.
6. Every dated measurement present in `SKILL.md` at the merge-base is still
   somewhere in the skill — `SKILL.md` or `reference/history.md`. Checkable:
   extract each `20[0-9]{2}-[0-9]{2}-[0-9]{2}` occurrence with its sentence from
   the merge-base, and `grep` each in the new tree. **This is the line that
   protects against a cleanup that hits its size target by deleting evidence.**
7. **Defect 4 is gone and did not come back.**
   `grep -n 'resolvedModel' SKILL.md` returns either nothing, or only lines that
   say the field _is_ returned and is invisible to the dispatching model — never a
   line saying a background dispatch does not return it. Both step 3 and step 4
   instruct passing `model` explicitly, and the three override paths
   (`CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `availableModels`, `fork`) are each named
   once. **Check this against `#148`'s merged text, not against `main`** — `#148`
   rewrites the paragraph and reintroduces the claim in a new spelling.
8. `SKILL.md` offers no verification path that consists of asking an agent what
   model it is, and says in one clause why not.
   `grep -in 'powered by the model' SKILL.md` returns nothing, or returns only the
   clause explaining that the line is not guaranteed for subagents.
9. `reference/records.md` contains one generalisation covering all three
   reading-discards-information instances, and `grep -c` shows the `$?`-after-a-pipe
   warning is no longer a standalone provision. `SKILL.md` step 7 asks for method
   as well as verdict, in **one** clause — checkable by reading the step, which
   `Done when` 5 already bounds to three lines.
10. `npm run check`, `npm run format` (oxfmt formats markdown) and
    `node scripts/status.mjs --json > /dev/null` all pass.

## The gate on this filing

`## The gate on this filing` rather than `## Review`, on `dl-29`'s precedent and
`repo-16`'s and `repo-20`'s: this diff files a ticket and builds nothing. The
distinction is also mechanical — `scripts/status.mjs`'s `hasGateRecord` matches
`/^##\s+Review\b/` only, so a `ready` ticket carrying this heading passes
`status --json` where one carrying `## Review` would fail `reviewedButReady`.

### Gate 1 — reviewer's record, verbatim as sent

### Gate: CONCERNS — 2026-09-05 · `origin/main...HEAD` (`6c0ee2e`) · own defect hunt, no `code-review` dispatch (subagent has no `Skill` tool), Sonnet against an Opus build

Checked out `6c0ee2e` via `git fetch origin && git checkout --detach 6c0ee2e`. `git log --oneline -1` matches; `git diff --stat origin/main...HEAD` shows one file, 658 insertions across two commits (`1cc2ca0`, `6c0ee2e`). This diff files a ticket only — no implementation exists. Gated on what it is: a dispatchable brief, per dl-29's precedent, not mechanically FAILed for ten unproven `Done when` lines. All ten are checkable by a named command or described mechanical process; the 567→~180 target is explicitly sizing, not acceptance, and no `Done when` line mentions a count.

**What I verified**: `npm run check`/`npm run format`/`node scripts/status.mjs --json`/`-- --show repo-21` all exit 0 at `6c0ee2e`; `git check-ignore` on the ticket file exits 1 (commits fine); id-freedom (`grep -rhoE '^id: repo-[0-9]+' docs/work/*.md | sort -u -t- -k2 -n` tops at `repo-19` on main; all 10 remote branches and `gh pr list --state all` swept, only `repo-20` on the unmerged record branch); `depends_on` reasoning reproduced by making it fail first (a scratch `depends_on: [repo-18, repo-20]` ticket makes `status.mjs --json` exit 1, reverted); baseline numbers (567/2586/259/225/31) independently re-measured against `87f93f3` and matching exactly; `citations.mjs --require-anchors` behavior on `main`'s `SKILL.md` and both Build-1 probes reproduced exactly as described; the ticket's own deliberate `citations.mjs` failure (6 citations, 1 verified/1 moved/3 unanchored/1 unresolvable, exit 1) reproduced; all 11 laundering shapes plus the 12th ("glance-reading") located verbatim at `87f93f3`.

#### Findings

- **med** · The ticket's sharpest claim (defect 4) is going stale live. The record branch moved past the cited `87f93f3` to `69327da` ("a backgrounded resolvedModel exists, it just never reaches you") during this review; re-running the ticket's own reproduction (`git show origin/docs/record-2026-09-04-orchestration-batch:.claude/skills/orchestrate-tickets/SKILL.md | grep -n resolvedModel`) no longer returns the quoted lines — the branch already carries the corrected wording Build 4 step 2 asks a future builder to write, and its commit message says explicitly it is reacting to this ticket. Once the record branch merges (required before this ticket's Build begins), defect 4 will likely already be gone from `main`, same as defects 1-3, but the "Why" narrative and the "What 87f93f3 already did" table assert the opposite, with no re-verify caveat. Recommend pinning the reproduction to a sha and adding one sentence to re-check defect 4's existence before Build 4 step 2.
- **med** · Build 4 (90 of the Build section's 301 lines, by far the largest of 7 steps) does not follow the ticket's own instruction/measurement/narrative split — much of the "Inferred, not stated" block is story rather than instruction+citation. Recommend compressing to a citation plus the resulting bullets.
- **med** · No general "an instruction lives in exactly one file, everywhere else is a pointer" rule is stated, despite `Packages` now spanning three files and Build 7 relying on exactly that principle for its own placement. Recommend one sentence, most naturally in Build 2.
- **low** · "Corrected two commits later by `62cb999`" — `git rev-list --count a980d5e..62cb999` = 1, the very next commit.
- **low** · "`citations.mjs` prints the rule that covers this" — that sentence is a source comment (`scripts/citations.mjs:730-732`), never printed at runtime. Substance unaffected.
- **low** · "`reference/history.md`, which already tells its reader..." — that sentence is in `SKILL.md`'s own Reference table, not inside `history.md`.
- **low** · "Step 2's decision-grep bullets are 13 lines" — counted 15 (lines 55-69); flagged at low confidence in case a different span was meant.
- **dropped** · none.
- **findings** · own defect hunt returned 7; 7 carried, 0 dropped.

NFRs: security n/a · performance n/a · reliability n/a directly, though the two structural `med` findings are instances of exactly the property this ticket argues for · maintainability — strong citation discipline, weak self-application in the two places named.

### Gate 1 — builder's dispositions, each with the command that settled it

Six accepted, one refuted, one corrected further than either of us had it. The
reviewer also self-corrected its own last finding before I acted on it.

| #   | Finding                              | Disposition                                                                       | Command that settled it                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | defect 4 going stale                 | **accepted**, remedy (a)                                                          | `git log --oneline 87f93f3..origin/docs/record-2026-09-04-orchestration-batch` → two more commits (`69327da`, `7e1fbc1`); `git show 87f93f3:…SKILL.md \| grep -n resolvedModel` still reproduces the defect                                                                                                                                                                                                                                                                                      |
| 2   | Build 4 fails the ticket's own split | **accepted — then my first fix failed its own disposition, and gate 2 caught it** | `### 4.`→`### 5.` spans: **90** at `6c0ee2e`, **89** at `2220501`, **62** now. The `2220501` pass reworded the narrative instead of moving it, while the disposition claimed the reasoning was "gone". Gate 2 measured it and was right. The guide's reasoning now lives in the Log's second-pass entry and Build 4 carries a six-row fact table and the `So do` list — instruction only. Build section 302 → 304, which grew only because Build 3 gained the thirteenth row this round produced |
| 3   | no general one-file rule             | **accepted**                                                                      | `grep -niE 'exactly one file\|single home\|everywhere else is a pointer'` → no match                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | "two commits later"                  | **accepted**                                                                      | `git rev-list --count a980d5e..62cb999` → 1                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | "`citations.mjs` prints the rule"    | **refuted, and the finding improved anyway**                                      | `sed -n '430,440p' scripts/citations.mjs` → the sentence is inside a `process.stderr.write`, and it is the tail of the ticket's own reproduced run. It **is** printed on `main`. It is a comment at `:730-732` in the **`repo-18`** version the reviewer read — which this ticket depends on, so the verb goes false when `#146` merges. Both halves now recorded                                                                                                                                |
| 6   | `history.md` self-declaration        | **accepted**                                                                      | `grep -n "revising this skill"` → `.claude/skills/orchestrate-tickets/SKILL.md:17`, no hit in `history.md`                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | "13 lines"                           | **accepted, and both counts were wrong**                                          | bullet 1 is `55–70` = **16** lines; `sed -n '71p'` is the next bullet's first line. Pair with the seam-mapper bullet = `55–76` = 22. The reviewer's self-correction that `main` lacks this content entirely is confirmed: `grep -n "Read the matches, do not count them" SKILL.md` exits 1 on `main`                                                                                                                                                                                             |

**Two-sided model check.** The reviewer quoted _"You are powered by the model named
Sonnet 5. The exact model ID is `claude-sonnet-5`."_ Mine reads **"You are powered
by the model named Opus 5 (1M context). The exact model ID is
`claude-opus-5[1m]`."** So the gate ran a different model from the build, checked
from both sides rather than from the dispatch parameter alone. **This does not make
self-report a verification path**, and Build 4 still forbids it: the claim it
rests on is that the line is not _guaranteed_, and one prior agent found none.
Two more observations of the line existing do not bear on whether a third will
have it. Recorded in Build 4 as three of four.

**Reviewer's collateral finding, checked and already closed.** `bb6b8f4` was
indeed dangling; `git cat-file -t bb6b8f4` → `fatal: Not a valid object name`. The
record branch's next commit, `7e1fbc1` _"a commit cannot cite its own sha"_,
already turned it into a documented instance. No action, and nothing for the
orchestrator to file.

### Gate 2 — the round that caught a disposition claiming more than it did

Two exchanges, and the second is the one worth keeping.

**Finding 5 conceded by the reviewer, on its own re-run.** It re-ran
`sed -n '425,440p' scripts/citations.mjs` against `main` and confirmed the
sentence is emitted from `process.stderr.write` on the `bad.length > 0` path. Its
own account: it had tested exclusively against the `repo-18` extraction throughout
its pass and never re-checked that claim against the current tool. It also
re-ran the ticket's own `citations.mjs`, got `8/10` and exit 1 matching the table,
**including its own citation now showing `FAIL` for the reason given**. No
disagreement went up.

**Finding 2 reopened by the reviewer, and it was right.** The orchestrator had
asked it to measure whether Build 4 actually shrank, separately from whether the
finding was marked accepted. It measured 90 lines at `6c0ee2e` and 89 at
`2220501` — **one line** — and diffed the block I claimed to have removed: the
guide's reasoning was still stated inline, reordered and reworded rather than
moved. My disposition had said _"the `claude-code-guide`'s reasoning is gone, the
conclusion and its provenance stay"_. **That was false, and it was false inside a
gate record answering a finding about exactly this.** Re-measured here: 90 → 89 →
**62** — a 31% cut, where the previous pass managed 1% — with the reasoning now in the Log's second-pass
entry and Build 4 holding a six-row fact table plus the `So do` list.

**The generalisable part, which is why this is in the record and not only the
Log.** A disposition is a claim like any other, and "accepted" is the word that
hides an unmeasured one — the same shape as "addressed" in a finding. The
reviewer's first pass accepted my numbers because they were measurements; its
second pass caught me because it measured the _fix_ rather than reading the
disposition. **Gate a disposition by measuring what it says changed, not by
checking that the finding is marked closed.**

## Log

- **2026-09-05 — filed.** Every number was measured against `origin/main@c37cab9`
  and the record branch rather than taken from the filing brief. The record branch
  was at `479b7b3` for this pass and `87f93f3` by the second; **the figures quoted
  below and above are the `87f93f3` ones**, re-taken, not the originals. Four
  things came back different from how they were briefed:

  1. **The baseline is 567, not 464.** The brief sized the work against `main`.
     `87f93f3` is a blocking dependency and grows `SKILL.md` by 106 lines, so the
     464 → ~180 target is really 567 → ~180. `## Decisions` grows 217 → 259 and
     the loop 187 → 225.
  2. **Build 5 has already landed in full**, not partly. Both failure modes are on
     `87f93f3` with the exact `grep '^## Review'` discriminator and the
     gate-declines-PASS measurement. The residual work is placement, so the step
     was rewritten from "add" to "give them tests and move them".
  3. **Build 4's rule has landed too** — step 3 on that branch already says to
     pass the model explicitly. What remains is deleting the apparatus the rule
     made redundant.
  4. **Defect 2 is documented on `87f93f3` as well**, under _"Read the matches, do
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
  `node scripts/citations.mjs docs/work/repo-21-…md` reports `8/10 resolve`,
  exit 1, and **both failures are deliberate**. One is Build 1.2's verbatim
  quotation of `SKILL.md`'s illustrative test reference, kept as written because
  it _is_ the false positive Build 1.2 asks you to remove. The other is the
  reviewer's own citation into `citations.mjs`, inside its verbatim record above:
  it must not be edited to make a checker happy, and it is the very citation the
  dispositions table refutes, so repointing it would erase the finding it is
  evidence for. **Both are the carve-out the tool names and cannot check.** `main`'s `citations.mjs` **prints** the rule that covers
  this on the `unresolvable` path — `scripts/citations.mjs:435-436`, inside a
  `process.stderr.write`, reproduced as the tail of the run above: _"a
  citation that is a finding's own evidence … must stay as written."_ The other
  five (`.claude/agents/builder.md:22` ×3 and `.claude/agents/ticket-reviewer.md:6`
  ×2) all verify against their anchors. Nothing in CI reads tickets with
  `citations.mjs` today, so no gate is red. **Re-run this before gating** — the
  first draft of this bullet said `3/4` and was falsified by the commit that
  added it, which is the drift the skill's own records section warns about.

  **`repo-18` removes that printed trailer**, demoting the sentence to a source
  comment on the `unresolvable` path, so this paragraph's "prints" becomes false
  the day `#146` merges — which this ticket depends on. Surfaced by the gate,
  which read the `repo-18` version and reported the sentence as never printed; it
  is printed today and is not printed there, and both halves matter. Whoever
  builds this should re-read this bullet against the merged `citations.mjs` and
  correct the verb.

- **2026-09-05, fourth pass — gate 2, and a disposition of mine that did not
  survive being measured.** The reviewer conceded finding 5 on its own re-run and
  reopened finding 2, correctly: my "accepted" had shrunk Build 4 by one line
  while claiming the narrative was removed. Fixed properly — Build 4 is 90 → 62,
  the guide's reasoning moved into this Log's second-pass entry rather than being
  reworded in place, and the false disposition is corrected in the table rather
  than quietly replaced. **The failure is now a thirteenth row in Build 3's
  table**, because it is a new shape and it was measured here: a disposition is a
  relay, and gating one means measuring what it claims changed. If the cleanup
  drops that row, the ticket has thrown away the only defect its own process
  produced.

- **2026-09-05, third pass — gate 1 answered.** Six of seven findings accepted,
  one refuted with a reproduction, one corrected past both parties' numbers; the
  record and the dispositions are above. Two things worth keeping out of the
  table: the record branch moved **twice more** during the gate (`87f93f3` →
  `69327da` → `7e1fbc1`), so every reproduction in this ticket is now pinned by
  sha rather than by branch name; and defect 4 was **fixed on that branch in
  reaction to this filing**, which is the outcome the ticket wanted and does not
  retire it — Build 4's structural half stands either way, and the step now says
  to re-verify before doing its step 2.

- **2026-09-05, second pass — the open question closed, and a fourth defect.** The
  orchestrator put the subagent-model question to the `claude-code-guide` skill and
  relayed the answer. It both confirms Build 4 and corrects a premise the ticket
  had inherited, so Build 4 was rewritten rather than amended. **The relayed block
  is marked as relayed and its verified/inferred split preserved** — no network
  reaches this sandbox and none of it is checkable against this tree, so promoting
  it to a stated fact would be the exact failure the ticket is about.

  **How it was obtained, which Build 4's table points here for rather than
  carrying.** The question went to the `claude-code-guide` skill, which read
  Claude Code's own documentation rather than summaries of it. The
  verified/inferred marks in that table are the guide's own, kept deliberately —
  the point of the answer is knowing which half is guaranteed.

  The verified rows rest on: the only model input being the `model` parameter at
  dispatch, with every model-switch event a host action (`/model`, the picker,
  `/config`, fast-mode, an SDK `set_model`) and none reachable from a subagent's
  tool loop; and `tools` being a hard allowlist enforced before the turn runs,
  where an empty resolved set refuses to launch rather than falling back.

  **The one inferred row, and the reasoning behind it, because a future reader
  will want to re-test it rather than re-derive it.** `sub-agents.md` says a
  subagent receives "only this system prompt plus basic environment details… not
  the Claude Code system prompt", and the enumerated startup-content list contains
  no model-identity line. The conclusion — that the "You are powered by the model
  named X" line is not guaranteed — is the guide's inference from those two
  adjacent facts, and the guide says so. **Observations to date: three of four
  agents had the line, one searched and found none.** The two most recent are this
  ticket's own builder and gate, which quoted _"Opus 5 (1M context) …
  `claude-opus-5[1m]`"_ and _"Sonnet 5 … `claude-sonnet-5`"_ respectively — a
  useful two-sided confirmation that the gate ran a different model than the
  build, and **no evidence at all about the rule**, since the claim is that the
  line is not _guaranteed_ and two more instances of it existing cannot test that.
  Recorded here so nobody later reads the tally as support for self-reporting.

  **The repo-local half of the env-var row I did check**, and it is the only line
  in that table I can stand behind directly: `.claude/settings.json` and
  `~/.claude/settings.json` contain no `env` block, no `CLAUDE_CODE_SUBAGENT_MODEL`
  and no `availableModels`, and `.claude/settings.local.json` does not exist. Which
  proves nothing either way — the variable can be set outside any settings file.

  What I verified myself, and it is only this:

  1. **#148 repeats the `resolvedModel` claim in a new spelling** — its step 3 says
     a backgrounded dispatch "returns no `resolvedModel`" and its step 4 says it
     "does not return" it. `main`'s wording was "returns an agent id and nothing
     else". A branch titled _"correct ten skill defects"_ rewrote the sentence and
     kept the error, which is now defect 4 and the sharpest argument in the Why.
  2. **`reference/dispatching.md` already holds the same rule one field over** —
     _"Ask an agent to **call** a tool, not to tell you whether it has one"_, with
     its own measurement (a builder reporting eight tools against thirteen in its
     frontmatter). Build 4 cites it rather than making a new claim.
  3. **No `env` block, `CLAUDE_CODE_SUBAGENT_MODEL` or `availableModels`** in
     `.claude/settings.json` or `~/.claude/settings.json`;
     `.claude/settings.local.json` does not exist. So a settings grep proves
     nothing here either way, and Build 4 says so rather than implying the
     variable is unset.

  I did **not** verify: fallback chains, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`,
  `PreModelSwitch`, `/tasks`, the `PostToolUse` hook path, the subagent transcript
  path, or the `tool_response` field list. All are relayed.

- **2026-09-05, second pass — two items carried from #148's gate**, at the
  orchestrator's request and reproduced here before accepting: Build 7 (the
  reading-discards-information generalisation) and Build 6's step-7 clause. Both
  `grep` reproductions in Build 7 were run in this worktree, including the
  missing-path case, which exits **2**, warns on stderr, and still prints real
  matches to stdout — so with stderr discarded an incomplete search is
  indistinguishable from a complete one. **Neither was left as an open decision.**
  The one judgement call the orchestrator delegated — `records.md` or
  `defect-shapes.md` — is answered in Build 7 with its reason, as asked.

- **What I left out, and why.** Nothing. Both additions were kept: the family
  generalisation because the cleanup is already rewriting `records.md` and a
  fourth standalone warning is the disease, and the step-7 clause because it is one
  sentence in a step this ticket is already rewriting. Neither is a defect in
  `repo-21`; both are Build content it is the cheapest home for.

- **`kind: chore`, not `fix`.** It carries reproductions, but the deliverable is a
  restructure of documentation rather than a corrected behaviour. Defects 1–3 are
  already fixed on `87f93f3`; defect 4 is a live correction this ticket makes, and
  it is the one line that argues for `fix`. `chore` stands because the fix is two
  sentences inside a rewrite of the whole page.

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
  are `repo-40`, `repo-80`, `repo-90`, `repo-99`, `repo-404`, `repo-808`,
  `repo-901` and `repo-999`; **none is a filed ticket**, which is what matters.
  `repo-404` is a fixture in `scripts/test/status.test.ts` and
  `docs/01-TICKETS.md`'s dangling-`depends_on` example; **the other seven occur
  only as example ids inside other tickets' prose** (`repo-3`, `repo-6`, `repo-8`
  and others). The check that actually settles it:
  `grep -rhoE '^id: repo-[0-9]+' docs/work/*.md | sort -u -t- -k2 -n` tops out at
  `repo-19`.

- **The sentence above was wrong when I first committed it, and I had transcribed
  it.** The first wording said all eight ids "are all fixtures in
  `scripts/test/status.test.ts`", which is false for seven of them. I took it from
  `repo-20`'s Log — **which had already been corrected upstream** at `87f93f3`,
  where the same sentence is quoted as the error and reproduced in full. I copied
  a pre-correction wording, and the conclusion (`repo-21` is free) stayed true
  while its stated evidence was false. That is the `SKILL.md` provision _"a relay's
  citation can be wrong while its conclusion is right"_, committed by the filer
  into a ticket about laundering. Caught by running `-o` in place of `-l` rather
  than by re-reading, which is Build 7's whole point:

  ```
  $ grep -rlnE 'repo-(40|80|90|99|404|808|901|999)' scripts packages
  scripts/test/status.test.ts
  $ grep -rhoE 'repo-(40|80|90|99|404|808|901|999)' scripts packages | sort -u
  repo-404
  ```

- **`depends_on: [repo-18]` only.** `repo-20` and the recording branch are
  sequencing, not dependency, and naming a ticket absent from this branch's tree
  would fail `status.mjs --json`, which is the CI gate. The constraint is stated
  at the top of the page instead, where an orchestrator reading the opening
  section will see it.
