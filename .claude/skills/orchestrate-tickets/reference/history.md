# What the sessions cost

Provenance for the rules on this page's parent, kept out of `SKILL.md` because it
is evidence rather than instruction, and because everything at the top of
`SKILL.md` is what survives a compaction.

This skill is written from six sessions, each applying the last one's lessons:
~4 M subagent tokens across 21 agents and 16 gates; then ~2.7 M across 17
invocations and 6 gates; then 2.86 M across 12 agents and 18 invocations, five
tickets to five merged pull requests, 8 gates and 8 that returned landable
findings; then **2.04 M across 10 agents and 16 invocations, four tickets to four
pull requests, 6 gates and 6 that returned findings, every builder producing a
complete branch on its first round, and no branch ever needing a rebase**; then
**877 k across 6 agents and 12 dispatches-or-messages, three tickets to three
pull requests, 3 gates, again every builder complete on its first round and no
rebase — and a batch whose whole output was 266 non-documentation lines — 104 of
them `src/`, the rest tests, a fixture and one config line — against 1,113 of
documentation. That 4.2:1 is the fifth session's real lesson and the reason two
of the entries in `reference/sizing.md` are about cost rather than correctness.**

Then **~2.13 M across 12 agents and 21 dispatches-or-messages, three tickets to
three pull requests, 8 gates, and four further tickets filed.** Twelve builder
invocations across three tickets, and the sixth session's lesson is *why*, because
three of them were the orchestrator's fault and none was the work's:

- **Three rounds were the orchestrator's own errors.** Two were compression —
  relaying a gate's *conclusion* rather than its evidence, which cost a round of
  refutation; and *describing* a gate record the builder was asked to commit, which
  cost a round to nothing. Both are now rules on `SKILL.md`. The third was an
  omission found only by auditing at close-out: a relay asked for a gate's fixes
  and a push and never asked for its **record**, so one of four went uncommitted
  and unposted. Nothing catches that — a missing record leaves no trace, and
  `npm run status` reads frontmatter. **A gate whose findings you act on is not
  finished until its record is filed**, the same way a ticket is not finished
  until its Log is appended.
- **Three rounds were structural and correct**: a post-PR gate's result and a
  user's decision each arrived after the previous round had closed. That is the
  price of the post-PR gate pattern and it is worth paying.

The other measurement worth carrying: **two of eight gate findings were wrong**,
and both were caught only because the relay said *reproduce this before accepting
it*. One had **every premise true and its conclusion false** — the shape that
survives an orchestrator's own check and dies on contact with a running test. The
count that matters is not gates-that-found-something; it is that no wrong finding
reached a commit.

## The schema, from the seventh session on

The six entries above are prose and are not comparable to each other: one counts
"agents", another "invocations", another "dispatches-or-messages", and only the
first names its unit. **Every session from here appends a row in this shape**, so
the series can be read rather than re-derived. Leave a field blank rather than
estimating it, and say `not recorded` rather than guessing — a wrong number here
outlives the session that wrote it.

| Field | What it means |
| --- | --- |
| `tickets` | tickets taken from ready to a gated branch |
| `agents` / `dispatches` | distinct agents spawned / total dispatches **and wakes** — a wake costs a context reload, so it belongs in the second number |
| `builder rounds` | and **how many were the orchestrator's own fault**, which is the number that improves |
| `gates` | and how many **returned findings**, which is not the same count |
| `wrong findings` | findings that did not survive a builder's reproduction — and whether any reached a commit |
| `subagent tokens` | the unit this page has always counted in. **Not** the whole volume a request moves: cache reads dwarf it and are essentially the entire bill |
| `cost` | actual dollars from `node scripts/agent-cost.mjs` over the batch's task output files, with the rate date the script prints beside its total. **Not a `subagent_tokens` conversion**: repo-53 retired that on 2026-09-20 because the figure excludes cache reads, 94 to 97% of the bill. Rows before repo-53 carry the old conversion, **$0.0182 per 1k subagent tokens** measured 2026-09-02, and read as floors on a different unit |
| **`what the skill got wrong`** | **the field that earns this page.** What was missing, unperformable, or misleading. Ask every agent for it explicitly at dispatch — it does not arrive on its own |

**Why the last field is mandatory.** On 2026-09-02 a single orchestrated ticket
surfaced six defects in this skill: `resolvedModel` unobtainable on a backgrounded
dispatch though step 4 calls the check load-bearing; no wake when a child finishes,
so an unattended orchestrator stalls silently; reports arriving as summaries when
step 5 asks for them in full; three mechanisms assuming a pull request that the
skill's own default has not created yet; a `trap`-based restore that cannot span a
per-call-shell harness; and `ticket-reviewer.md` never mentioning how to populate
`node_modules`, which fails silently by resolving to the shared checkout. **All six
came from asking. None would have been recorded by a session that merely
succeeded** — and five earlier sessions had the same signal available and did not
capture it.

**And since 2026-09-20 the row is not the deliverable; the rule change is.**
Every item in the last field edits the page that holds the rule in the same pull
request, or files a ticket carrying the reproduction — `SKILL.md` step 12 says
so. Eight rows between 2026-09-12 and 2026-09-18 carried about seventy items and
changed no rule page; the sweep of 2026-09-20 folded them in, and each rule it
touched carries the item's date as its measurement. **Head new rows by date and
base sha** — `## Session 2026-09-20 — base fdafd1a` — not by ordinal. The ordinals
below stand as written. Two sessions appending from one base would both compute
the same ordinal: the twenty-third row avoided it only by stacking on #268 and
drafting (2026-09-18), and the twelfth was dispatched as the eleventh
(2026-09-07). That is what the scheme change is for.

**And the row's shape is fixed, since repo-54 (2026-09-20).** A row is the
schema table; then `what the skill got wrong` as one bullet per item, each
ending with the page and heading the fix landed under, or the ticket id it was
filed as; then, optionally, `what went right` as one line per entry. No
subsection runs past one paragraph, and a measurement worth keeping goes on the
rule's page as a dated clause that the bullet points at. The rows before this
note are in the older shape: 100 to 300 lines each, written by records-only
dispatches costing 100 k to 250 k subagent tokens (the eighteenth session's
author reported 175,595, the sixteenth's 251,529), on a page that had reached
3,900 lines and could no longer be read at the step that needed it. The row is
written by a maintenance dispatch on Haiku from the orchestrator's account and
its accounting table, and the verification the records-only dispatches did is
kept as a checklist rather than a narrative: re-read each verdict and each
frontmatter status out of `git show <branch>:<ticket>`, re-add the token total,
re-run `--ready` at the base, and say per field whether it was measured here or
relayed.

### Citations on this page are historical, and four of them are pinned

An entry's citations are a claim about the tree that session read, and
`scripts/citations.mjs` resolves against the working one — so a correct entry
turns `moved` the moment its own subject merges. The twelfth session measured
that here and proposed the checker's own `--rev` as the remedy.

**`--rev` cannot pin one citation, and that is a property of this page rather
than of the flag.** It resolves *every* citation in a record against one commit,
which fits a gate record describing one branch; this page's entries each describe
a different tree. Measured 2026-09-08 at `4901cd6`: the plain run reported
`15 verified, 3 moved, 1 unanchored` and exit 2, and the same run at
`--rev b142a4a` — the tenth session's own base — reported `7 verified, 6 moved,
5 unresolvable`, breaking five citations to repair one.

**So a citation that must stay as written is pinned to the rev it was true at**,
written inside its location as `<file>@<rev>:<line>` (repo-35). A pin is checked
at that rev on every run, so it keeps the check: from 2026-09-08 until repo-35
these four were carried by evidence declarations instead, which bought exit 0 by
no longer checking them at all. Each rev was re-read with `git show <rev>:<path>`
before the declaration was written, and the pins name the same revs:

- The tenth session's defect 1, correct at `b142a4a`, that entry's own base:
  `dispatching.md@b142a4a:206 "Probed on 2026-09-01"`
  and `:209` "carry `ListAgents` and `SendMessage`".
  `repo-21` then rewrote the section around them, and when this note was written
  the same two lines were `dispatching.md@b384033:230` "Probed on 2026-09-01"
  and `:233` "carry `ListAgents` and `SendMessage`" — moved, not reworded.
- The eleventh session's `tickets` row, correct at `9b426c8`, that entry's own
  base: `docs/work/repo-30-the-id-sweep-cannot-see-repo-tickets.md@9b426c8:6 "status: ready"`.
  That line now reads `status: done`, which is the ticket landing rather than the
  citation being wrong.
- The eleventh session's defect 3, correct at `9b426c8`:
  `tools/downloader/e2e/sniffer/mse-page.spec.ts@9b426c8:102 "toHaveCount(5)"`.
  `dl-43` deleted the assertion, which is what that entry says it existed to do,
  so the anchor is nowhere in the file and there is nothing to repoint it to.

**The shorthand in the first of those carried no anchor, and the one it carries
now was added here rather than by the tenth session.** It was read out of
`b142a4a`, not out of the line that occupies that coordinate today, which is a
different claim: an anchor taken from the current tree would have made the
citation verify while asserting something that session never wrote. Nothing else
on this page was repointed, reworded or withdrawn.

**These four are an interim, and the gap is the grammar rather than this page.**
A declaration is a verification somebody performed, recorded with the rev it was
performed at, where a bare `moved` records nothing — but it stops the check as
well as the failure. `docs/work/repo-35-a-citation-cannot-be-pinned-to-a-commit.md`
carries the reproduction and the open decision behind that, and a reader who
arrives at either of the declarations below should arrive there.

## Seventh session — 2026-09-03/04

| Field | Value |
| --- | --- |
| `tickets` | **4** taken from `ready` to a gated branch (`repo-14`, `dl-33`, `dl-34`, `dl-35`) → PRs #140–#143, plus one **unticketed** skill branch → #139. Zero file overlap across all five, measured with `git diff --name-only` per branch |
| `agents` / `dispatches` | **10** agents (1 seam-mapper, 4 builders, 5 reviewers) / **25** dispatches-or-messages (10 spawns, 15 `SendMessage`) |
| `builder rounds` | **~13**, of which **1** was the orchestrator's fault — a wrong verbatim-transcription rule it had itself just written, which stopped a builder mid-ship until it was reversed. A whole **gate** was also lost to orchestrator error; see below |
| `gates` | **7** completed passes across 5 reviewer agents; **4** returned findings. One further gate ran 2 h without reporting and was killed |
| `wrong findings` | **1**, and it never reached a commit: a gate reported `options.onFailed` "not reachable" from a throw site. The builder built the naive fix with probes and refuted it — the callback *is* in lexical scope; a `settled` flag set six lines earlier swallows it. The gate's practical conclusion survived, its stated reason did not. The reviewer then re-verified the refutation from scratch and found something neither had: the naive fix is *silently worse* than the bug, converting a loud crash into a 65 s hang with nothing in the logs |
| `subagent tokens` | **~2.15 M** measured. The killed gate reported **no usage on termination**, so up to 2 h of spend is unmeasured — this is a floor |
| `cost` | **≈ $39** at the 2026-09-02 rate of $0.0182/1k, and a floor for the same reason. Split: builders 49%, gates 47%, intake 4% |

**what the skill got wrong** — eleven, all now fixed on this branch:

1. **`dispatching.md` told gates to `ToolSearch` for `SendMessage`.** Neither agent type has `ToolSearch`; both carry `SendMessage`. The same file recorded the refuting measurement thirty lines below.
2. **No step for a board that is mostly unbuildable.** `--ready` returned nine and **eight carried an open decision their own page forbids a builder from settling**. Step 2 asks which *tickets* to batch when the answer was which *slices*.
3. **The 41 s directory figure did not reproduce**, and "the directory" varies **12x within the repo** (2.4 s vs 28 s). Caught by a builder pushing back on a number the orchestrator relayed.
4. **"You are not woken when a child finishes" did not hold** — six or more unprompted wakes. Both measurements now recorded rather than one overwritten.
5. **A rule added *this session* contradicted `docs/01-TICKETS.md`.** The orchestrator wrote that a reviewer's `## Review` block must be pasted verbatim; the convention says *"the reviewer reports and the builder writes the section down"*. Caught by a builder citing the document back. **Check the repo's conventions before writing a skill rule that governs them.**
6. **The reviewer-worktree removal condition cannot be evaluated.** Tested twice — from "the PR exists", and from *both agents reporting closed* — and both times the exchange resumed. Rule changed: hold it until merge, like the builder's.
7. **The acceptance rubric has no row for a sliced ticket**, so a deliberate slice always reads FAIL by the letter. A reviewer hit this and named the judgment aloud instead of quietly reinterpreting it.
8. **The seam-mapper removes the ticket-reading cost, not the decision-reading cost** — 87.6 k for the map, then seven decision sections read anyway, because an *option* put to a user cannot travel as a paraphrase.
9. **"Accept the baseline" is rarely zero work** — the zero-work option still left an ADR amendment "required whichever option wins".
10. **An option's stated mechanism is a proposal, and answering the decision does not verify it.** The `onFailed` route above came from a builder's own option text, relayed unchecked.
11. **Nothing warned against telling a gate to install.** The orchestrator wrote `npm ci` into a gate prompt; this repo forbids installing in a worktree, which is what `worktree-farm.sh` exists for. That gate ran two hours without reporting and was killed. **Its replacement, given the correct setup and scoped to three checks, returned a sharper result in a fraction of the time** — including reading zod's source to establish that an ordering hazard was intrinsic rather than assumed. Gate yield tracks prompt specificity, not runtime, and this is the cleanest measurement of it the page has.

**A twelfth, found after the batch closed and worth its own line.** The slice
pattern above told builders to hold `status: ready` while committing a gate record.
**That combination is forbidden by CI**, in two places — `reviewedButReady` sets a
non-zero exit and `scripts/test/status.test.ts:197 "reviewedButReady(readTickets(REPO))"`
asserts the set is empty (written as a bare filename and line 180, which the
checker rejects as ambiguous — two tracked files carry that basename — and which
the assertion has since moved off; re-resolved to the same assertion 2026-09-06)
— and the pull
request went red in the `check` job and the unit matrix on both platforms. The
skill defect was written *and* deployed in the same session, and only a merge check
caught it: no gate did, because each gate correctly reviewed the branch it was
given and none of them owns the board invariant. **A new orchestration pattern is
not proven by its branches passing their gates**; it is proven by the merge.

**What went right, and is worth copying.** Every builder corrected the orchestrator at least once — a stale timing figure, an unmerged capability claimed as landed, a laundered mechanism, and a rule that contradicted the repo. Two agents *deleted their own tests* for passing on something the old code also satisfied. Two reviewers ran controls nobody asked for: a pure order-swap to isolate an ordering claim rather than a removal, and a simulated **over**-narrowing to prove the suite catches the mirror defect. And a builder with unconditional ship authority declined to upgrade its own gate's CONCERNS to PASS, on the grounds that doing so would be transcribing a better verdict onto its own work.

## Eighth session — 2026-09-04/05

**Written by a builder, not by the orchestrator that ran the batch**, on the
orchestrator's dispatch and against the branches in the tree — so the table below
has two provenances and says which is which. **Counts and token figures were
supplied by the orchestrator and are observations, not measurements**: they are
last-observed values from completion notifications, one of them still rising when
it was read, and the rounds figure is explicitly an estimate. **Everything else
was re-verified here** against commits, files and re-runs rather than transcribed,
which is how four of the ten defects below were found — none reported by the
session, and none visible in any outcome. What could not be checked from a
worktree is marked where it appears: another session's transcript, and any agent's
statement about its own context.

| Field | Value |
| --- | --- |
| `tickets` | **3** dispatched concurrently off `origin/main@c37cab9` — `dl-37`, `repo-18`, `repo-19` — plus this **unticketed** skill branch. PRs #146 (repo-18) and #145 (repo-19) open at close; `dl-37` still gating. **3** further tickets filed — `dl-38` and `dl-39` out of dl-37, and `repo-20` out of this row's own seventh entry. `dl-32`'s decision was reported answered by the owner and held for a later batch — **and at `c37cab9`, the base this row is measured against, it was not written down**: the ticket's decision section still read "deliberately not ranked here" and its Log ended 2026-08-31. That is `dispatching.md`'s _An answered decision has to be recorded even when you do not build it_, unapplied, on the one ticket that was answered but not dispatched. Flagged, not fixed here — and **since fixed elsewhere**: `dl-32` landed via #152 (`5f6e92c`) while this branch sat open, and its decision section now reads "Answered 2026-09-05: option D" with `status: done`. The observation is pinned to the base, not to the tree this row lands in |
| `agents` / `dispatches` | **9** agents — 1 seam-mapper, 4 builders (three tickets plus the one that wrote this row), 4 reviewers, one of which was an **Opus second opinion** on repo-18 — and **9 spawns**. The schema's second number is spawns *and wakes*, and **the wakes were not tallied**, so this row is short one figure rather than reporting 9 as the total; the rounds row below is the nearest available proxy and is larger |
| `builder rounds` | **~15** — dl-37 ~4, repo-18 ~5, repo-19 ~5, this row 1 — counting each `SendMessage` resume that produced work. **Approximate and marked so by the orchestrator, which kept no strict tally**; it is the one number here that is an estimate rather than an observation. One round is attributable to the orchestrator by name: two round trips on a single dl-37 decision, caused by framing a defect as one to *defer* without saying the file was one dl-37 itself introduces (`api/src/tls-rejections.ts`, added by `8245721`). The correction reached the builder mid-revert; it stopped, reconstructed from backups rather than memory, re-ran its mutation checks and disclosed the reconstruction as the thing most worth independent scrutiny |
| `gates` | **6 rounds across 4 reviewers** — dl-37 ×2, repo-18 ×3 (including the Opus second opinion), repo-19 ×1. **All returned findings.** Three are committed on the tree and were read here: repo-18's `## Review` and `### Gate 2`, both PASS, and repo-19's PASS; dl-37's is uncommitted, still gating at close, its `TlsRejectionLog` finding already folded in at `4f46415` |
| `wrong findings` | **No gate finding was refuted this session**, and the schema's row does not fit what happened instead: the wrong claim ran **builder → gate**, not gate → builder, and it *did* reach a commit. See the fourth entry below |
| `subagent tokens` | **≈ 2.30 M**, and these are **last-observed cumulative values from completion notifications, not a measurement** — dl-37's reviewer was still running when its figure was read, so its 232,573 is a floor and so is the total. Split: seam-mapper 66,698 · dl-37 builder 624,082 · dl-37 reviewer 232,573 (floor) · repo-18 builder 357,063 · repo-18 reviewer 325,032 · repo-18 second opinion 96,505 · repo-19 builder 213,666 · repo-19 reviewer 222,453 · this row 164,899 |
| `cost` | `not recorded` — never observed. At the 2026-09-02 rate of $0.0182/1k this would be ≈ $42, which is an arithmetic conversion of a floor and not a bill |

**Board shape at intake, which the skill had already anticipated — and re-measured
here, because this branch was cut from that same base** (it has since been rebased
onto a later `main`, which is why the pin below is a sha and not "this branch").
`npm run status -- --ready` at `c37cab9` returns **six**, and **five carry an open
decision their own page forbids a builder from settling** (`dl-32`, `repo-15`,
`repo-16`, `repo-18`, `repo-19`; `dl-37`'s was answered on 2026-09-03). So the
batch question was "which decisions to answer", not "which tickets to run",
exactly as step 2's second bullet says. Recorded because the anticipation was
written on one session's evidence — nine and eight, on 2026-09-03 — and this is
the second.

**But step 2's own grep got two of the six wrong, in opposite directions, and the
errors cancelled.** `grep -nE '^#{2,4} .*([Dd]ecision|[Oo]pen question)'` matched
five files: it counted `dl-37`, whose heading reads *"answered 2026-09-03 — not
open"*, and it missed `repo-16` entirely, because that ticket's open decision is a
**paragraph in its Build section** — *"Nothing here is a code fix, and the
deliverable is a decision. Do not settle…"* — under no matching heading. Five
matched, five blocked, and the two are **not the same five**: one false positive
and one false negative, cancelling into a correct total. **The count above is
right by accident**, and an orchestrator that had trusted it would have carried
`dl-37` into the "must answer this first" pile and left `repo-16` out of it, while
the number it reported to the user was exactly right. This is the session's own
theme arriving in the skill's own instruction — **the right answer for wrong
reasons**, in the step whose entire job is to see the board, and nothing
downstream can catch it because the output that would betray it is the output that
matches. The bullet now says to read the matches rather than count them. Found by
re-running the grep here, not reported by the session; the same is true of entry 6
below.

**what the skill got wrong** — ten, all fixed on this branch. Seven are numbered
below; the other three are recorded where they were found — step 2's grep, above;
the missing carrier for an answered-but-undispatched decision, in the `tickets`
row; and **step 9 assuming a ticket exists**, found by this branch not having one.
Step 9 says the builder commits the gate record onto the ticket, and an unticketed
branch has none — `repo-20` is something this branch *files*, not something it
built, so putting a gate of the whole branch there would tell the next reader that
ticket had been started. The pull request thread is the record instead, said out
loud in the PR body; the rule is in `records.md`.

1. **Step 6 covered a pair that agrees too easily and not its opposite: a pair
   that agrees and then both stop.** repo-19's builder and reviewer settled the
   substance and each treated the gate record as the other's next move. Nothing
   went red — `npm run status` read `done`, the branch was pushed, both reports
   said finished — so a stalled exchange and a completed one were identical from
   the orchestrator's seat. Caught by looking at the remote for a `## Review`
   heading that was not there, which is now the documented one-command
   discriminator.
2. **Nothing said an owner decision must travel with its provenance.** repo-18's
   reviewer declined to extend its PASS over `82ad6ab` because the builder's only
   warrant was "the owner directed this", which it cannot verify from inside its
   sandbox — correctly. The orchestrator is the only participant who can supply
   that and had not. The fix is to relay the question, the options, the choice,
   **and whose recommendation it went against**.
3. **Step 4 told you to state what you inferred a model from, and that is where a
   wrong citation entered a permanent record.** The orchestrator told repo-19's
   reviewer the builder's model was read off `builder.md`'s `hard` row. repo-19
   carries no `difficulty` at all; `hard` was **dl-37's**, a different ticket in
   the same batch. The reviewer transcribed it because it was given as fact, and
   it reached the committed gate record — corrected at `fc9a4fb` with an
   attributed inline note rather than a silent rewrite. The generalisable half:
   **a relay's citation can be wrong while its conclusion is right**, and because
   both difficulty rows resolve to the same model, nothing in the outcome could
   have caught it.
4. **Nothing distinguished "quotes something plausible" from "quotes something
   actually present".** repo-18's builder reported that its own system context
   "states directly" it was Sonnet 5, propagated that to its reviewer and into a
   commit (`0301099`), corrected the reviewer's hedged attribution on that basis
   and escalated a same-model-review concern to the orchestrator. Asked to **quote
   the line**, it looked, found neither that sentence nor the model list it might
   plausibly have misread, and retracted in full at `5251fd0` — unprompted and
   against its own interest. Its own sentence is the finding: *"Everything else in
   this ticket was measured before it was written … The one claim I did not run a
   check against was the one about myself, because it did not feel like a claim."*
   The discipline was not weak; it did not **engage**, because a statement about
   the speaker does not present itself as a claim. That is a category boundary,
   which is why "be more careful" is not the fix and **asking *where*, not just
   *what*** is — named as a data-quality rule by repo-18's reviewer. **This is a
   different failure from the dispatch-visibility gap in the next entry** and
   collapsing them loses the useful half: that one is the orchestrator unable to
   observe a fact, this one is an agent reporting a check it did not run. **And it
   was not an isolated event** — it was the first of **four** instances of one
   move across this batch, whose general form is under _The move under entry 4_
   below. Read alone it looks like an agent hallucinating its own identity, which
   is not a usable lesson.
5. **Half of step 4's model check was redundant and the other half was
   unobservable — and the skill said neither.** `.claude/agents/ticket-reviewer.md`
   pins `model: sonnet` in frontmatter, so the gate's model was always two file
   reads and never needed `resolvedModel`; passing `model: "sonnet"` on every gate
   was belt-and-braces. The builder's model is unobservable **to the dispatcher**
   under a backgrounded dispatch, which is how `concurrency.md` says to dispatch a
   batch — and entry 4 is what that costs. **This branch re-derived `main`'s wrong
   version of that sentence while rewriting it**, in two places and in fresh
   wording: the `tool_response` does carry `resolvedModel`; what it does not do is
   reach the parent, which sees only the subagent's final text. Corrected at
   `69327da`, relayed and unverified from a sandbox with no network. **The finding
   is worth more than the fix — rewriting prose does not re-check it.** A branch
   titled "correct ten skill defects" reproduced one of them inside the sentence it
   lived in, and neither its gate nor its orchestrator caught it; `repo-21`'s filer
   did, by reading the text. That correction then cited a sha that did not exist,
   which is the self-naming problem below rather than a separate lapse. Step 3 now says to **pass the builder's model
   explicitly**, naming your own model where the table says inherit, which makes it
   knowable by construction for one parameter. Confirmed this session: dl-37's and
   repo-19's builders both quote *"You are powered by the model named Opus 5 (1M
   context)"*, all three reviewers *"Sonnet 5"* — all reported-not-verified, since
   another agent's context cannot be read from here — and repo-18's builder is
   **unknown**, per entry 4.
6. **Step 4 was stale in two linked ways, found while checking entry 5 rather than
   reported by the session.** It said a `mechanical` ticket "puts a **Sonnet**
   builder in a batch where every sibling is Opus"; `builder.md`'s table has mapped
   `mechanical` to **`haiku`** since the head-to-head that page records. The
   consequence drawn from it — that the gate's model "cannot be set once" —
   followed from the Sonnet mapping and does not follow from the Haiku one: under
   an Opus orchestrator no builder resolves to Sonnet, so the pinned Sonnet gate
   differs from every builder in the batch. The rule survives in weaker form (the
   builder's model does vary inside a batch; check the pairing per ticket) and the
   `model: "opus"` case is now stated for what actually produces it — **you** being
   Sonnet and a ticket inheriting.
7. **The documented reviewer setup order omits where the checkout goes.**
   `ticket-reviewer.md` puts "farm, then `npm run build`" many sections above "then
   `git checkout --detach <sha>`". dl-37's reviewer read it in order and **built
   `main`**, catching it only because `dist/` was missing a file the branch adds,
   and flagging it unprompted. Nothing downstream would have: that page already
   documents that a reviewer of the wrong tree produces a fluent gate marking every
   acceptance line `unproven`. `dispatching.md` carries a gate-prompt clause as a
   **habit-dependent stopgap**; the durable fix is the agent definition's ordering
   and is **filed as `repo-20`** on this branch, on the owner's decision to file
   rather than fold in — the reproduction is the deliverable, which is `CLAUDE.md`'s
   own test. `repo-20` also carries the one remaining inconsistency entry 5
   introduced: `builder.md` still explains that a builder "inherit[s] the
   orchestrator's" model, which is now what step 3 tells you not to rely on.

**The move under entry 4, and why it is this session's argument for two models.**
Entry 4 read as a freak event while it was one incident. It was the first of
**three on one ticket, and a fourth on this one**; repo-18's builder named the
shape itself in the Log
it committed at `cfae096` — quoting the **ticket file**,
`docs/work/repo-18-citations-resolve-is-not-correct.md`, not that commit's
*message*, which says the same thing in different words: *"the model claim, the
load-bearing reason with no test, and now
a status summary that skipped a state. All three were the same move: reading a
result at a glance and reporting the reading as the measurement. The tooling this
ticket adds catches it for citations only; nothing catches it for prose, which is
why the two reviewers did."*

The other two: a copy-paste argument written into a docblock as the **reason** for
a design decision, with no test behind it — *"a reason that cannot fail is a
justification, not a measurement"* — which the second opinion mutated until it did
fail, and which is now pinned by a test rather than asserted; and "every completed
run on the branch is `success`", refuted by `--json status,conclusion` at **15
runs: 13 `completed`/`success`, 1 `completed`/`cancelled`, 1 `in_progress`**. A
cancelled run *is* completed, so the sentence was false as written. **So the
failure is not fabrication, it is glance-reading, and it lands wherever a check
does not reach**: that branch's citations were fine, because the ticket had just
built the tool that resolves them, and its prose failed three times.

**A fourth instance, committed by the agent writing the record of the other
three.** repo-20's Log claimed eight high `repo-` ids "are all fixtures in
`scripts/test/status.test.ts`". Seven are not; they appear only as example ids in
other tickets' prose. The cause was the command:
`grep -rlnE 'repo-(40|80|90|99|404|808|901|999)' scripts packages` prints the one
filename `scripts/test/status.test.ts`, and **`-l` discards which alternative
matched** — only `repo-404` did. A file list was read as an answer to a per-id
question. Caught by this branch's own gate, which did the thing that separates the
two readings: it ran `grep -rl` once **per id** and got nine files. **The lesson is
about the flag, not the care** — `-l` is designed to discard exactly the
information an alternation is asking for, so an alternation under `-l` cannot
answer the question it looks like it answered. Two earlier tickets had worded this
correctly; flattening their wording is what produced the error.

**Both models committed it, which is the stronger version and the reason this is
not "a second model catches blind spots".** The reviewer reported that it had read
the same run table by eye and repeated `in_progress` and `cancelled` without
tallying either — *"a pattern found twice, by two different models, each having
half-committed it, is stronger evidence than one found by a clean observer"*
(relayed from its message; unlike the builder's half this is committed nowhere,
checked with `git grep` across that branch and `main`). The two-model split does
not work because one party is a clean observer. It works because two models are
unlikely to eyeball **the same thing**, and each measured what the other had
glanced at.

**One rule fell out of the third instance, and it is not about care.** *"Any commit
that corrects a status claim invalidates the status claim"* — the builder wrote
one, the correction became a commit, the commit moved the tip, and the corrected
claim was stale on arrival. A record can never assert its own branch is green,
because writing the assertion changes the branch. That is now a bullet in
`records.md`, and `SKILL.md`'s `## After a merge` carries the look it implies.

**The same shape, one field over: a commit cannot cite its own sha.** This branch
wrote *"Corrected at `bb6b8f4`"* into the commit that made the correction. No such
object exists — the gate caught it with `git cat-file -t`. At write time it could
not have existed, because the citation precedes the object it names, so any value
there is fabricated or a placeholder. **A record cannot name a state that its own
writing creates.** Cite the *previous* commit, or record the sha in a follow-up.
It is also the batch's sixth instance of the glance-reading family and its purest
— a specific, checkable, plausible identifier corresponding to nothing, which is
structurally what repo-18's builder did with a model line. **The difference is
that one had no excuse and this one had a real trap**, and both are worth saying:
the trap does not make the fabrication acceptable, and calling it carelessness
would hide the mechanism that guarantees it recurs.

**The first wording of that rule was too strong, and it was refuted within the
hour by the orchestrator doing the thing it said nobody could do.** It read
*"nobody in the loop can take the pre-merge look"*. The premises were true — a
builder stops before the PR and moves the sha by recording the check; a gate stops
before the merge and writes earlier still — and the conclusion was false, because
the orchestrator is alive at merge time and is not writing to the branch. It ran
one `gh run list --json` call and established #145 green at `fc9a4fb`. **The
correct rule is a division of labour, not an impossibility**, which is the useful
form: "nobody can" tells a future session to give up on something one command
settles. This is the third time on this page that all-true premises carried a
false conclusion, and the first where the person who wrote it refuted it himself.

**Reproducing that refutation caught a second thing, and it is the rule eating its
own messenger.** The relay carrying the correction also reported repo-18's tip as
`cfae096` with `CI` still `in_progress`. Re-run rather than transcribed: the tip
was already `02197ea`, where all three workflows are `completed`/`success`, and
`cfae096`'s own `CI` is `completed`/`cancelled`, superseded by that push. **The
status claim was true when taken and false when read** — inside the message
teaching that status claims go stale. So the orchestrator's look decays exactly as
a record's does; what makes it usable is not privilege but that it is *last*, and
that it names a sha.

**And this branch demonstrated the rule on the commit that added it.** Asked for
its own CI state, it declined to assert it and said unobserved — on the grounds
that writing "green at `a980d5e`" would itself produce the commit that falsifies
`a980d5e`. Then it ran the call above, on someone else's branch, where it is
sound.

**What went right, and is worth copying.**

- **Measure while a decision is open; do not commit the mechanism.** dl-37's
  builder built a concurrency fix while its remedy was an open owner decision. Its
  own reasoning generalises: the Chromium reproduction was needed under *every*
  candidate answer, "do nothing" included, so running it was never a bet. Building
  on it was, and it paid — it converted "we could fix this" into "the fix exists,
  measured and reviewer-validated", which is the fact that changed the owner's
  answer. Kept safe by committing and pushing nothing while either decision was
  open, so the tree each party inspected was never ambiguous.
- **Two owner decisions went against a builder's recommendation and each exposed a
  real pre-existing defect.** `--require-anchors` was added over repo-18's
  builder's advice, and implementing it revealed that `parseArgs` consumed
  `argv[++i]` for *every* flag — the first valueless flag would have swallowed its
  file argument — and that the existing flag-consistency test matched with
  `/--[a-z]+/g`, reading `--require-anchors` as `--require` in all three sources at
  once and comparing them equal. Folding dl-37's `vcodec: null` fix in revealed
  `YtDlpFormat` declaring `vcodec?: string` for a field that arrives JSON `null`
  from the real binary's generic extractor — a lie the compiler then enforced on
  every reader, which is why nothing caught it, and whose failure mode was worse
  than a crash: `INTERNAL` stops the resolver chain where the `NO_MEDIA_FOUND` that
  tier is meant to degrade to would have fallen through to the browser tier.
- **The tool under review, run on its own gate record.** repo-18's builder ran the
  pre-fix `citations.mjs` over the `## Review` section of the ticket that fixes it:
  `10/10 resolve, exit 0`, with two anchors landing on `: "";` and a stray `*/`.
  The branch's own tool over the identical section: `2 verified, 8 moved`, each
  named. Both reproduced independently by the reviewer.
- **How a retraction is recorded is itself the practice.** Nothing was deleted: the
  wrong paragraph was marked `WITHDRAWN — do not cite this paragraph` and left
  standing with the retraction directly beneath, the reviewer's original hedged
  paragraph was restored as the standing statement, and the earlier Log entry that
  had stated the claim as fact got a forward-pointer. And it declined to
  over-correct — *unknown from where the builder sits; Opus likely on other agents'
  evidence about themselves; not established here* — on the grounds that swapping
  one unsupported claim for another is the same failure in different clothes.
- **Upward wakes worked, every time** — every completion delivered a notification
  and sideways `SendMessage` worked throughout. That is three sessions to one on
  the disagreement `SKILL.md` records, which is a tally and not a resolution.

## Ninth session — 2026-09-05/06

**Written by a builder on the orchestrator's dispatch, from the orchestrator's
own account plus what could be re-measured from the six branches in the tree.**
The orchestrator marked its own hedges and asked that none be upgraded, so the
table below says of every number whether it is a measurement made here, an
observation relayed, or `not recorded`. **Four of the schema's seven fields were
not supplied**, and only some were recoverable — see the gap note under the
table, which is itself the kind of thing this page exists to keep.

| Field | Value |
| --- | --- |
| `tickets` | **7** taken from `ready` to a gated branch, measured here as `ready`→`done` frontmatter transitions across the six branches: `repo-20` (#156), `repo-23` (#157), `dl-41` (#158), `dl-42` (#159), `dl-38` **and** `dl-39` (#160 — one branch, `dl-39` closed as decided-against), `repo-22` (#161). All six pull requests open against `main` at close, all gated PASS, **none merged** — merging is the owner's. **The orchestrator's account said nine, and nine does not reproduce**: the `dl-41` branch *files* `dl-44` (`status: ready`, not closed), and the `repo-23` branch amends two already-`done` tickets (`repo-1`, `dl-32`) with citation-line repairs. 7 closed + 2 amended = the 9 *touched*, which is the likeliest origin of the count. Twelve candidates were `ready` at intake (`dl-38`…`dl-43`, `repo-20`…`repo-25`); five were not started — `repo-21` and `dl-43` blocked behind branches in this same batch, `repo-24` and `repo-25` on owner decisions, `dl-40` on a sample URL the owner has not supplied |
| `agents` / `dispatches` | distinct agents **`not recorded`** — the orchestrator reported one combined figure of **~17 dispatches-or-resumes** across seam-mapper, builders and gates, and did not split spawns from wakes. **That figure does not sit easily beside the gate records**, which carry 13 gate passes on their own (below); either several passes ran inside one wake, or the 17 is low. Recorded as the tension it is rather than reconciled |
| `builder rounds` | **`not recorded`** as a count. What is recorded is the attribution, which is the half that improves: **two rounds were the orchestrator's own fault by its own account** — a builder-reported line number relayed without running the one command that checks it (and that citation was stale *before* the branch existed, so the "correction" it passed on was also wrong), and a claim about *delivery* rather than content, entry 1 below. **Three builders and two gates corrected the orchestrator this session**, every correction landing because the dispatch said reproduce rather than transcribe |
| `gates` | **13 passes across 6 gate records**, measured here from the committed `## Review` sections: `repo-20` 1, `repo-23` 1, `dl-41` 2, `dl-42` 2, `dl-38` 2, `repo-22` 5. **All six records are committed and were read here**; all PASS. **Five of the six returned findings** — `repo-20`'s is the 0-finding one |
| `wrong findings` | **at least 3, none reached a commit**, measured from the records rather than reported: `dl-41`'s gate raised a retention-hours caveat and **retracted it** after the builder pointed at a clamp that puts every reachable value at 6× the TTL; `repo-22`'s gate mis-framed its own round-1 finding as an inherited limitation and corrected it to *a regression the fix introduced*, after measuring `origin/main` silent on the repro; `repo-22`'s round 4 flagged a claimed third regression that **did not reproduce as branch-introduced** and turned out inherited from `origin/main`, correcting the Log's attribution rather than its count. Two *builder* Log claims were also wrong and were reproduced-and-corrected in place (`dl-38`'s "8 failures" and "five…page.example") — the builder→gate direction the eighth session's row noted has no home in this field |
| `subagent tokens` | **floors, not a total, and deliberately not summed.** The values available are **cumulative per agent and only last-observed**; several agents' finals were never reported, because their last turn ended in a cross-session message rather than a completion. Largest first: `repo-22` builder ~320 k · `dl-38` builder ~256 k · `dl-42` builder ~219 k · `dl-41` builder ~166 k · `repo-22` gate ~146 k (an early value; its later passes are unmeasured) · seam-mapper ~142 k · `dl-41` gate ~124 k · `repo-23` builder ~122 k · `repo-23` gate ~111 k. **Do not add these up** — the set is incomplete and every entry is a floor |
| `cost` | `not recorded` — never observed, and no conversion is offered here, because converting an incomplete set of floors produces a number that reads like a bill |

**What the schema asked for and the dispatch did not supply**, recorded because
the gap is itself a finding: distinct **agent count** and any **wake tally** (one
combined ~17 instead), **builder rounds** as a number, **gate count** (recovered
here), **wrong findings** as a count (recovered here), and **cost**. Two of those
were recoverable from the tree and three were not. **The recoverable ones were
recoverable because of step 9**: a gate record committed on the ticket is the only
artifact of this loop that outlives the session's own bookkeeping, and it carried
the two counts the orchestrator had lost.

**what the skill got wrong** — nine from the orchestrator, plus the ticket-count
discrepancy in the table above.

1. **A relayed claim about *delivery* is laundering, and the page only warns about
   content.** It is emphatic that a description of an artifact is not the artifact.
   It does not say that *"the reviewer sent you the text"* is the same class of
   claim. The orchestrator asserted exactly that to `dl-41`'s builder; the send had
   in fact been cut by a rate limit, and the builder refused to reconstruct the
   record and held — **the second time it held on the orchestrator over that family
   of claim**. The rule needs extending: **you cannot relay that a message arrived;
   only the recipient can confirm that.**
2. **Echo-before-commit does not verify a committed record, and this batch measured
   why twice, with different reasons.** `dl-42`'s gate asked its builder to echo the
   record's heading and gate line before committing; the builder then found `oxfmt`
   had rewritten the committed section anyway, and reported "format reflowed
   nothing" off a `diff --stat`, **which structurally cannot show a whitespace-only
   rewrite**. Its explanation was that oxfmt rewrites tables and leaves prose alone.
   **`repo-22`'s builder falsified that reason**: on its branch oxfmt rewrote 12
   table lines *and one prose line* (`*shared*` → `_shared_`). So the correct rule is
   stronger than either builder stated — **compare the committed section against the
   sent text after formatting, normalising only table padding and rule width. Prose
   is not safe either.**
3. **A structural gap in the review apparatus, found by `repo-22`'s gate and then
   demonstrated by accident.** A session working in an isolated worktree resolves
   `PreToolUse` hooks from the **shared** checkout's `.claude/settings.json`, not
   from its own worktree copy. So a newly added *or newly fixed* hook is invisible
   to every session, builder and reviewer alike, until the branch merges — not
   "inconclusive, not loaded yet" but structurally unobservable pre-merge. It then
   demonstrated itself: `repo-22`'s builder had its own commit message blocked
   (exit 2) by the shared checkout's escape-blind copy of the very hook its branch
   fixes, and reworded the message rather than working around the guard. **Any
   ticket that ships or fixes a hook is in this position**, and the worktree-hygiene
   page says nothing about it.
4. **Rate-limit recovery is undocumented and better than it looks.** A session limit
   killed five in-flight agents with HTTP 429, after which `ListAgents` showed **no
   subagents at all** — and every one resumed successfully by `agentId`, with
   nothing lost, because each branch had been pushed. **`ListAgents` returning empty
   is not evidence an agent is gone**, which is the same shape as the standing rule
   that `completed` is not a closed channel.
5. **A killed builder can strand an unpushed commit carrying a finding nobody has
   seen.** `repo-22`'s first builder pushed `e065878`, kept working, and was killed
   holding `5cecf43` — a strict superset with nine extra Log lines recording a
   citation finding it never got to report. Recovered by inspecting the worktree's
   HEAD against the pushed tip. **Check a killed builder's worktree HEAD against its
   remote branch before re-dispatching**, or you rebuild work that already exists
   and lose a finding with it.
6. **The decision-shape the skill is missing, and it changed this batch's best
   outcome.** `repo-22` hit one defect mechanism three times — an anchor misfiring
   because a text-shortening transformation moved survivors adjacent — and each fix
   introduced the next instance. Its builder twice offered the owner a costed list
   of options, and **every option in each list was a patch to the single shape most
   recently found**. The owner declined to pick and required an *invariant* instead:
   *no deletion may create an adjacency the raw text did not have*. The builder
   implemented it as substitution rather than deletion, then built a 21-shape
   battery aimed at the fix, which found **two more instances neither party had ever
   observed**. The rule: ***an option list built from instances can only produce an
   instance fix, however carefully it is costed.*** The tell is already on the page
   — a mechanism recurring, with the fixes creating the recurrences. **When a defect
   recurs, do not ask the owner to choose a patch; ask whether to close the class.**
7. **The decision-grep at step 2 stays unreliable, in the direction the page
   predicts.** Across twelve candidates it missed **two** (`dl-38`, `dl-39`) whose
   open decisions lived as prose inside their Build sections, and flagged
   `repo-21`'s gate-record heading as a decision when it was not. The seam-mapper
   caught both misses when asked to report decision **locations** only. **Asking the
   mapper for decision location — not content — is a good instrument; the grep alone
   is not.** This is the third session running in which that grep is wrong in both
   directions at once.
8. **The instruction to reproduce rather than transcribe is doing the work the page
   claims for it.** Five corrections of the orchestrator landed this session — three
   from builders, two from gates — and by the orchestrator's own account every one
   is attributable to that clause. Recorded as a measurement, not as praise: it is
   the only clause on the page carrying a per-session count.
9. **The best findings all came from one technique, and none from reading harder.**
   `dl-42`'s silent-data-loss path (a regression that downloads video only and exits
   0), `dl-38`'s unfalsifiable test, and `repo-22`'s two manufactured-block
   regressions were **all** found by mutating a changed line and watching nothing go
   red. `dl-42`'s most severe finding needed a *second* pass over the same diff with
   a rule, having survived both the gate's sweep and the builder's. The builder's
   own mechanism for why: some of its edit sites came from a failing test or a
   compiler error and all of those were covered; the rest came from a `grep`, and
   **nothing converts a grep hit into an obligation** — and every uncovered edit
   carried a comment asserting why it was right. ***A comment is where a claim goes
   to not be checked.*** (The relayed figures were "five of its eight edit sites"
   from tests or the compiler and "four" from a grep, which do not add up against
   eight; the counts are left out rather than picked between.)

**Two one-line lessons from builders, kept because each names a shape rather than
an incident.** `dl-41`'s builder, on why a clean tool report convinced it: ***a
totals line that mixes "checked and fine" with "not checked" in one row is the
shape to distrust*** — `citations.mjs` reported `0 moved, 0 unresolvable` while
seven citations pointed at unrelated code, all of them `unanchored`. And `dl-38`'s
builder, on why two of its Log claims were wrong: ***a number in a report is a
claim and needs its own command***, and `| tail` is not that command.

**What went right, and is worth copying.**

- **An owner who refused a costed option list got the best outcome of the batch.**
  Entry 6 is the sharpest thing this page has recorded about decisions: the skill
  tells you to surface options with their costs, and here the *option format
  itself* was the defect, because every option was drawn from the instance in front
  of the builder. The invariant the owner demanded instead found two unobserved
  instances.
- **A builder held twice against the orchestrator** rather than reconstruct a
  record it had not received, and was right both times.
- **Every gate record in this batch is committed**, which is the only reason the
  `gates` and `wrong findings` rows above could be recovered after the
  orchestrator's own counts were lost.
- **Cross-model gating held in both directions on every branch** — builders on
  Opus, every reviewer on Sonnet, stated in each committed record. The reviewer
  half is a file read rather than a report, since `ticket-reviewer.md` pins it in
  frontmatter; the builder half is still each agent's statement about itself, which
  the eighth session's entry 4 is about.

## Tenth session — 2026-09-06

**Written by a builder on the orchestrator's dispatch, from the orchestrator's
own account.** The account was supplied as prose and is not itself gated; what
could be checked from a worktree was re-run here against `origin/main@b142a4a`
and the three branches, and **two supplied claims did not reproduce and are
corrected below rather than transcribed**. Every figure says whether it is a
measurement made here, an observation relayed, or `not recorded`. The probed
video is referred to only as *the reported video*: naming it is the owner's
constraint and it binds this page too.

| Field | Value |
| --- | --- |
| `tickets` | **3** taken from `ready` to a gated branch, none merged at close: `repo-24` (#166), `repo-25` (#168), `dl-40` (#169). All three carry `difficulty: standard` — verified on `main`, and the **first batch in which every built ticket was rated**. Six were `ready` at intake and the same six still are, because none merged: `dl-40`, `dl-43`, `dl-44`, `repo-21`, `repo-24`, `repo-25` — re-measured here with `npm run status -- --ready`. Three further candidates were withheld as `status: needs-decision` (`repo-15`, `repo-16`, `repo-26`), which is the board carrying a blocker in frontmatter rather than in prose. **Two records travelled on a sibling's branch**: `dl-43`'s answered decision at `e7fd0ce` and the newly filed `dl-45` at `7bb3b62`, both on `dl-40`'s |
| `agents` / `dispatches` | **9** agents — 1 seam-mapper, 3 builders, 3 reviewers, and **2 closing builders killed by a session rate limit** — / total dispatches-and-wakes **`not recorded`**. The builder half is recoverable and is in the next row; the gate half is not |
| `builder rounds` | **12 resumes across 3 builders** — `repo-24` 2, `repo-25` 5, `dl-40` 5 — relayed, not measured here. **Two are the orchestrator's own by its account**, both the same move and both caught by a builder rather than a gate; see _Orchestrator errors_. **A `standard` rating predicted nothing about cost this batch** (n=3): the three ordinary-rated tickets ran 2, 5 and 5 resumes and 160 k, 442 k and 423 k tokens. `builder.md` reads `standard` as "somebody read the work and said it is ordinary. Same dispatch, different statement" — this is the first evidence that the second half is the only half that holds. **`repo-27` (#170) does not disturb this**: read here from the diff rather than relayed, it moves the **`hard`** row only, from `inherit` to `opus`; `absent`, `standard` and `mechanical` are untouched, so all three of this batch's builders were dispatched under the mapping still in force. A peer is separately trialling `standard` against Sonnet in `repo-28` (#171), which is **not read here** and is named only so a later reader of this row does not think the n=3 above is all the evidence there is |
| `gates` | **3 records, all PASS, all committed and read here.** Pass counts: `repo-24` 1; `repo-25` **4**, relayed; `dl-40` not stated as a count. **All three returned findings.** The pass structure is not recoverable from the records — see defect 7 |
| `wrong findings` | **No gate finding was refuted.** What happened instead ran in two other directions and neither has a home in this row. **Orchestrator → builder**: two relayed details were wrong, a builder caught both, neither reached a commit. **Reviewer → its own report**: an off-by-two coordinate the reviewer corrected upward unprompted, closed in `dl-40`'s record at `9925874` rather than silently repaired |
| `subagent tokens` | **1,840,153 across the 7 agents that reported; 2 reported nothing.** Last-observed cumulative values, so every entry is a floor — an agent whose last turn ends in `SendMessage` delivers no usage block. `repo-25` builder 442,412 · `dl-40` builder 422,835 · `repo-25` gate 260,588 · `repo-24` gate 252,377 · `dl-40` gate 205,865 · `repo-24` builder 159,694 · seam-mapper 96,382. Split (arithmetic on the floors, checked here): builders **55.7%** · gates **39.1%** · intake **5.2%** |
| `cost` | **≈ $33.49** at the 2026-09-02 rate of $0.0182/1k — an arithmetic conversion of a set of floors with two agents missing, so a floor and not a bill |

**Two supplied claims did not reproduce, and both are more useful once
corrected.**

- **"Gates cost less than builders on every branch" is false on one of the
  three.** `repo-24`'s gate cost **+58.0%** against its builder (252,377 vs
  159,694). It holds on the other two — `repo-25` **−41.1%**, `dl-40`
  **−51.3%** — so the observation is two of three, not a pattern, and the
  branch that inverts it is the one whose builder needed fewest resumes. The
  nearest prior comparable is the seventh session's 49/47 builder/gate split,
  which is not a "usual pattern" for this to invert.
- **The id-sweep on `reference/concurrency.md` does not contain `2>/dev/null`,
  and never has** — a `-S` search over that file's history returns nothing, and
  the string appears nowhere in the skill or in either agent definition. The
  failure the session actually hit is real and the mechanism is different, and
  arguably worse than a redirect: the `for` loop's stdout feeds a pipeline
  ending in `sort | tail -1`, so a failing `gh pr diff` **writes to stderr and
  has its exit status discarded**. The sweep still degrades to *fewer ids* and
  the only signal is a stderr line sitting above a confident one-line answer.
  Deleting a redirect that is not there would fix nothing. **And this is the
  smaller of that command's two defects** — a peer session found a structural
  one underneath it, re-measured here and recorded as defect 5.

**what the skill got wrong** — eight, none fixed here: this commit is scoped to
this file.

1. **The tool list an agent definition declares is not the tool list it is
   given, and `dispatching.md` states the declared one as a probed fact.**
   Under `dispatching.md@b142a4a:206 "Probed on 2026-09-01"`, three lines down at
   `:209` "carry `ListAgents` and `SendMessage`", the page says both agent types carry `ListAgents` and `SendMessage`
   directly. Two builders reported this batch that they had
   no `ListAgents`, one distinguishing it from an unreliable self-report on the
   ground that it is *not in the function schema*, so invoking it would be a
   fabricated call. **This row's own builder is the third**: its delivered
   schema is exactly `Read, Write, Edit, Bash, WebFetch, Skill, SendMessage`,
   while `.claude/agents/builder.md:4 "tools: Read, Write, Edit, Grep, Glob"`
   declares six more that never arrived — `Grep`, `Glob`, `TodoWrite`,
   `ListAgents`, `EnterPlanMode`, `ExitPlanMode`. The consequence for the loop is
   that **a builder cannot find its reviewer's id and the orchestrator must
   supply it**; both builders that tried correctly failed on `SendMessage` to
   the agent-*type* name. **Rewriting the prose will not fix it**, which is the
   part worth carrying: the mismatch is between a declaration and a delivery,
   and the page can only ever record which one it saw. Whether the harness
   drops them or this particular dispatch restricted them is **not established
   from here**. One datum in the other direction, committed in the tree:
   `repo-24`'s gate line records "subagent has no `Skill` tool", which agrees
   with `ticket-reviewer.md`'s declaration rather than contradicting it. **It is
   the strongest evidence the two agent types differ** — the reviewer's delivered
   set matched its declaration on the entry it was asked about, where the
   builder's does not.

   **Answered 2026-09-07 — fold the prose correction into `repo-21`**, which
   already rewrites `dispatching.md`. That is against the recommendation, which
   was to file the reproduction as its own ticket, **and the objection is not
   retired by the answer**: `repo-21` will be correcting a sentence whose
   underlying cause is unestablished, which is the eighth session's entry 5 in
   this row's own terms — *rewriting prose does not re-check it*. So both halves
   travel to whoever builds `repo-21`. **Nobody has probed the reviewer's
   delivered tool set**, only its behaviour on one entry, so "the harness
   delivers less than the frontmatter declares" remains an **observation of one
   agent type**, not a finding about both. The check that would convert it is a
   reviewer asked to print its own function schema, and it costs one dispatch.
2. **There is a rule against reporting a verification you did not run, and none
   against reporting a *determination* you did not establish.** `dl-40`'s Build
   step 1 reads, verbatim, "**Determine the cause before changing anything.**"
   Its builder reached ~85% confidence on a cause the ticket required to be
   established; what stopped it was the unrelated rule about surfacing
   decisions, not anything about evidence. Its own diagnosis generalises and is
   the fix: *"determine the cause" names an outcome, not a standard of
   evidence, and an outcome word is satisfied by whatever process ends in a
   confident answer.* So **for anything that must be established, name the
   artifact that establishes it and the substitute that does not count.** "From
   the manifest, not from the picker's output" cannot be satisfied by being
   clever; `determine`, `confirm` and `verify` all can.
3. **A ticket that needs an artifact must record the artifact at filing time.**
   `dl-40`'s reproduction died with the session that saw it — the URL was typed
   into a running web UI and never into a transcript — and the ticket then sat
   `ready` across two batches on an owner-supplied input that no page named.
4. **No step exists for a decision that is answered but not dispatched when the
   answer has no carrier.** `dl-43`'s answer was folded onto `dl-40`'s branch
   (`e7fd0ce`). It worked, and the eighth session's row is why it was done at
   all — an answered decision left unwritten evaporates. But it **coupled
   `dl-43`'s record to `dl-40`'s timeline**, and `dl-40` was then blocked for
   hours on defect 3's missing URL. Say the trade out loud where the step goes:
   **recording an answer on a sibling branch buys evaporation-safety with
   schedule coupling**, and the sibling you pick is a scheduling decision, not
   a filing convenience.
5. **The id-sweep on `concurrency.md` has two defects, and the one the session
   noticed is the smaller.** Found by a peer session; **every measurement below
   was re-run here** rather than relayed.

   **The structural half: for a `repo-` prefix the snippet's `git ls-tree` half
   reads zero, permanently.** Substituting the prefix into the documented
   command literally gives
   `git ls-tree origin/main tools/repo/docs/work/ --name-only`, and there is no
   `tools/repo` — `origin/main` has `tools/downloader` and `tools/planner` and
   nothing else. Repo-wide tickets live in `docs/work/`, which the snippet never
   names: that path returns **26** ids, highest `repo-26`. So **the command
   cannot see the merged half of the `repo-` board at all**, and the open-PR
   loop is the only half doing any work. This is the first fix; it is not a
   transient.

   **The transient half is the discarded exit status**, corrected under _Two
   supplied claims_ above. It sits on top of the structural one, which is why a
   sweep can be wrong twice over.

   **Two collisions in one session, from one command.** The sweep returned
   `repo-26` as highest while `repo-27` sat in an open PR's diff (#170, open
   against `main`); this session reserved `repo-27` on that basis; the filing
   agent then died to a rate limit and only the re-check on resume caught it.
   The replacement filing took `repo-28` — **and collided again**, with a peer's
   #171, which had been commitless minutes earlier. It is now `repo-29` (#172),
   and the rename is visible in the tree: **#172's branch is still named
   `repo-28-anchor-citations` while its title and its file say `repo-29`.** The
   second collision was caught only because an agent read the **per-PR lines**
   rather than the maximum, which is what the page should ask for.

   **And a timing property no fix addresses.** A sweep taken minutes earlier
   sees a claimant that does not exist yet. Reading per-PR output fixes the
   silent-failure half and nothing fixes the race except **sessions telling each
   other**, which is what resolved this one — `concurrency.md` already says to
   ask a peer which ids it holds, and this is the measurement behind that
   sentence rather than a new rule. The defect belongs to the peer session,
   which holds the reproduction and is filing it; recorded here, not filed here.
   Same family as the `tools/*/docs/work` pathspec in _What went right_: **a
   command that fails by returning less, rather than by failing** — and this one
   does it twice, structurally and transiently.
6. **Step 2's decision-grep was wrong in both directions for the fourth session
   running** — re-run here over this batch's six candidates, which is the
   cheapest check on this page. Four matches. Three true
   (`repo-24:144`, `repo-25:61`, `dl-43:111`); one false positive,
   `repo-21:688`, a **gate-record** heading — *the same false positive the
   ninth session recorded on the same ticket*, so the page now has a named,
   reproducible instance rather than a tendency; and one false negative,
   `dl-40`, whose decision is a `###` prose section headed "The warning on
   collapsing". That miss was not harmless: it is the decision the owner
   answered mid-batch, and answering it is what filed `dl-45`. **And there is a
   second class of blocker the grep cannot see at all** — `dl-40`'s other
   blocker was a *missing artifact*, which is not a decision and matches no
   wording. A blocked board has at least two shapes and step 2 detects one.
7. **A committed gate record preserves the verdict and loses the pass
   structure.** `repo-25`'s four passes appear in its record as a **single**
   `Gate: PASS` line over `origin/main...c983c28`; `dl-40`'s reads its three
   commits as one sequence, "not restarted". The ninth session's row leaned on
   committed records to recover counts the orchestrator had lost, and that
   works for *records* and not for *passes* — this row could recover neither
   gate count from the tree. If pass count is worth having, `records.md` has to
   ask for a line per pass, which `repo-21`'s own gate section already does.
8. **Nothing checks this page.** `.claude/` is the first entry in
   `.oxfmtrc.json`'s `ignorePatterns`, so `oxfmt` neither formats nor checks
   any of it, and `npm run check` passing on this commit says nothing about
   this file. The page carrying the schema is the one file in the loop with no
   tool behind it.

**Orchestrator errors, both its own by its own account.**

- **It dispatched `dl-40`'s gate and, in the same message block, told the
  builder to fold in an edit.** The reviewer gated `7bb3b62` while the tree
  moved to `effeb02` and then `6061bc6`. Disclosed immediately and handled as a
  narrow additional range rather than a restart, costing one small pass instead
  of a round — the committed record's own Gate line is the corroboration, since
  it names the full `7bb3b62 → effeb02 → 6061bc6` sequence and says it was not
  restarted. The correct sequence was to hold the fold-in.
- **It twice relayed an unverified detail as fact, and a builder caught it both
  times — never a gate.** (i) It said the master playlist carried the
  credential parameters; they are in the yt-dlp capture. (ii) It repeated a
  reviewer's quoted *line contents* for two citations. **The second chain is
  worth tracing in full because three parties touched it**: the reviewer read a
  multi-line `sed -n '105,110p'` and attributed line 105's content to line 107
  — an off-by-two, its own words, tip drift explicitly ruled out; the
  orchestrator repeated it as fact; the builder caught it; both re-verified
  with `sed -n '107p'`. **Two lessons, not one.** *A verified premise does not
  make a quoted detail verified* — the orchestrator had checked that the
  citations were **stale**, not what sat at them. And *reading a multi-line
  result is itself a step that can fail*, so *prefer the addressed form when
  the answer goes into a record*: `sed -n '107p'` cannot be misread the way a
  six-line window can. The reviewer corrected itself upward unprompted: *"a
  coordinate restated in a report becomes someone else's claim, and I'd rather
  correct it myself than have it discovered a third time."*

**And this row reproduced that error inside the sentence describing it, which is
the eighth session's shape arriving again.** Writing the entry above, its builder
read `sed -n '205,216p'` of `dispatching.md`, took the first printed line as 205
and cited it — but 205 is blank and the harness trimmed it, so the real
coordinate was 206. `citations.mjs` caught it, and `sed -n '206p'` settled it.
**Rewriting prose about an off-by-N does not immunise you against an off-by-N**,
and the window that produced this one was three lines shorter than the one it was
describing. The same run also caught a coordinate this row had aimed into an
unmerged branch. Two of the three citations here were wrong before a tool read
them, in a row whose subject is coordinates going wrong.

- **Both closing steps died to a session rate limit having committed nothing** —
  the history row and a ticket filing — and both had to be re-dispatched. Worth
  its own line because of what they have in common: **the two steps with
  nothing forcing them are the two that get cut when a session runs out.** No
  gate, no CI job and no frontmatter field notices either one missing.

**What went right, and is worth copying.**

- **Asking a reviewer to break the builder's own work, saying in advance that a
  successful break outranks everything else in the range**, produced the
  batch's only med. It broke on the first attempt; narrowing the scope put ten
  real signals back and cost nothing.
- **Four gate passes on `repo-25`, each scoped to a commit range, all earned.**
  Pass 2 existed only because the reviewer refused to extend a PASS over
  commits it had not read; pass 3 found the med. **The economy is in scope, not
  in count** — which is the same lesson as the seventh session's "gate yield
  tracks prompt specificity, not runtime", arrived at from the other end.
- **Two independent constructions agreeing beats one confirmation.** `dl-40`'s
  reviewer wrote its own mutants and its own 28-needle leak list against the
  builder's 34, and got identical results — exactly 3 and 7 mutant failures, 0
  hits. **And a leak sweep proves absence while a shape check proves method**:
  the same reviewer compared the fixture's field set to the real capture's,
  testing the allowlist *claim* rather than the output.
- **A premise inferred from a tool's output, written down as a manifest fact,
  and falsified by a probe.** `dl-40`'s brief said the manifest declared twenty
  renditions. It declares **ten**: five distinguishable rungs, ×2 for CDN
  mirrors in the manifest, ×2 again in the yt-dlp tier from a play-options
  balancer returning byte-identical URLs under two keys. The wrong sentence
  stood in the ticket until 2026-09-06 and is marked in place near the top of
  `dl-40`'s brief on branch `dl-40-rendition-rows` (PR #169) rather than
  deleted — named as a branch and not as a `file:line`, because a coordinate
  into an unmerged branch resolves against the working tree and lands on
  unrelated text. This row's first draft cited it as a coordinate and
  `citations.mjs` caught it. **The tell on the original error was that the
  number came from the picker — the thing under repair — and was recorded as
  coming from the source.**
- **A peer session supplied what this batch could not get itself.** The owner
  had opened the container firewall from the WSL host; a peer probed live and
  produced the falsification above. **The orchestrator then re-put the material
  scope decision to the owner rather than accept the peer's report that it was
  settled, because a peer cannot carry the owner's approval** — and the peer's
  account proved accurate on every point that was checked. Both halves matter:
  the peer was trusted for measurements and not for consent.
- **Three self-corrections were kept as two shapes rather than forced into one
  root**: a claim whose scope quietly exceeded a real measurement, and a claim
  with no measurement where familiarity stood in. ***Scope the sentence to the
  command, not to the topic***, and ***familiarity with code is not a
  measurement of it***. The tell was on its own screen — a 17,150-reference
  corpus printed beside a claimed 760, and the 22× gap attributed to the
  variable being changed rather than to the constant.
- **A pathspec of `tools/*/docs/work` matches zero tracked files**, so a
  *combined* pathspec degrades silently to its working half instead of
  erroring. Re-measured here: listing `docs/work` together with
  `tools/*/docs/work` returns **26** files, and the same listing with the
  trailing `/*` returns **107**. So the combined form saw **24%** of the work
  corpus and reported a total. (The session's own figure was "a sixth",
  measured in references rather than files; that unit is not re-derived here.)
  This is defect 5's shape again in a different tool.
- **A builder refused to compose a `## Review` from the orchestrator's
  paraphrase**, correctly, costing a round worth paying — the ninth session's
  entry 1 holding for a third time.
- **A builder declined to silently improve its reviewer's citations**, leaving
  two off-by-a-line coordinates as written with the corrections in a disclosed
  note beneath.
- **A leak tripwire fired on the builder's own prose**, on the sentence naming
  the parameters it documented. Nothing had leaked; it rewrote the sentence
  anyway, because *a detector that reports true on its own documentation is one
  nobody trusts next time*.
- **The tool `repo-25` built caught its own gate record.** A tight markdown list
  has no blank line, so it is one paragraph, so a shorthand citation in one
  bullet inherits from the bullet above and turns fatal. That mechanism is now
  in `citations.mjs`'s docblock, via an authorised doc-only post-gate commit.

## The worked examples behind `SKILL.md`'s rules

Moved here by `repo-21` on 2026-09-07 rather than deleted. `SKILL.md` had grown to
674 lines by appending, with no structural difference between a rule you must obey
and the story explaining why it exists — so nothing could ever be removed. The
split it now holds to is **instruction and one dated measurement stay there, the
narrative comes here**, and each heading below names the provision it belongs to so
a reviser can get from one to the other.

Nothing in this section is an instruction. If you are running a batch, you do not
need this page.

### Step 1 — read the opening section, not the status line

A ticket in the second session read `status: ready` while its own first section was
titled "Read this before picking it up" and said the work must not be pulled
forward. `--ready` is a projection of frontmatter, and frontmatter can disagree with
the page it sits on.

The other half of that step is `git fetch` before dispatch: `main` moved between the
status call and the dispatch, landing a commit that deleted machinery three builder
prompts went on to reference. Harmless that time; it need not be.

### Step 2 — a board can be mostly unbuildable

Measured 2026-09-03: `--ready` returned nine and **eight carried an open decision
their own page forbids a builder from settling**. Offering the user a choice of
batches out of that set buys a round that ends in "this ticket says I may not
answer this". When it holds, the question becomes **which slices**, not which
tickets — see _Slice a blocked ticket_ in `reference/sizing.md`. `repo-19`'s
`needs-decision` status later moved that answer into the status call itself, which
is why `SKILL.md` now carries the grep as a fallback rather than the primary move.

### Step 3 — the builder that asserted its own model

On 2026-09-04 a builder stated its own model, drawn from a line that turned out not
to exist. That is one of the observations behind _Never ask an agent what model it
is_: an inherited model is unstated at the point the decision is made, including by
the agent it is about.

### Step 6 — upward wakes, where two sessions disagree

**Sideways wakes work.** Confirmed again 2026-09-03: a builder that needed the
reviewer's record woke it from `completed`, and it came back with the text
re-resolved against the new tip, with no orchestrator hop.

**Upward wakes are disputed, so check rather than plan around either reading.**
2026-09-02 recorded, three times, that you are *not* woken when a child finishes —
sitting `completed` beside a finished agent until something outside nudged you,
with "no completion signal to wait for". **2026-09-03 measured the opposite, six or
more times**: every finishing subagent delivered a `<task-notification>` that woke
the orchestrator unprompted, and a reviewer's `SendMessage` to `main` arrived the
same way. **2026-09-04 agreed with the later reading a third time.** All three
sessions ran this skill in this repo, so two-to-one is a tally rather than a
resolution: do not retire the earlier reading on it. Whether the harness changed
between them or the earlier reading was wrong cannot be settled from inside either.
Plan the batch so a missed wake is survivable, and if you do find yourself idle
beside finished work, say so in your report rather than letting a stalled batch read
as a quiet one.

### Step 8 — glance-reading, and the claim that did not feel like a claim

Asking *where* a quote is, rather than only what it says, catches **glance-reading**
— taking a result in at a glance and reporting the reading as the measurement. Four
instances turned up across one batch in 2026-09, in prose every time and in
citations never, because a tool covered those. The sharpest of them was an agent
that had measured every other claim on its branch and fabricated the one about
itself: *"the one claim I did not run a check against was the one about myself,
because it did not feel like a claim."* A statement about the speaker does not
present itself as needing evidence, which is why "be careful" is not the fix.

The step's last clause is the counterweight: an acceptance step that always finds
something is a relay wearing a different hat.

### Step 10 — why "the exchange is over" cannot be evaluated

The reviewer's worktree used to come down earlier, once its record was pushed and
its exchange with the builder had ended. That condition was tested twice on
2026-09-03, once from "the PR exists" and once from *both agents reporting closed*,
and both times the exchange resumed — a builder can always push one more commit and
wake its reviewer, and neither is lying when it says it is done. The second removal
landed mid-`npm run check` and cost a verification round. Holding costs ~18 MB;
removing early costs an agent its tools mid-command. From inside, a removal and the
documented auto-reclaim are indistinguishable, which is why an early removal has to
be announced.

### Step 12 — the post-PR gate that found something

The fourth session opened a PR on its documentation branch under conditional ship
authority and took one narrow gate afterwards, scoped to the corrections alone. That
gate found a real defect the correction pass had introduced. The ordering costs one
cheap gate instead of a whole builder round and gives up no gating at all, because
the orchestrator controls the merge.

### After a merge — the job that had never once succeeded

In the reference repo a job that only runs on `push` to `main` had never succeeded:
branch protection rejected its push with `GH013 — changes must be made through a
pull request`, so a generated file it maintained sat a week stale while listing a
merged ticket as open and omitting a live security ticket entirely. Every pull
request stayed green throughout, because nobody was looking at `main`.

### Decisions — the exception that pays best

Measured 2026-09-03: a slice dispatched as "steps 1–2 only, the ticket stays open"
was widened to the full ticket by a single message, because the answer arrived
before the builder stopped. Say in the message which part of the original dispatch
you are reversing.

### Decisions — why the overridden recommendation is a field

Both decisions that overrode a builder's own recommendation in the 2026-09-04
session exposed a real pre-existing defect that only implementing the overridden
option could have found — a CLI parser that consumed a value for every flag,
including the first one that takes none, and a contract declaring a field non-null
that arrives `null` from a real binary. A recommendation is an argument, not a
measurement.

### Decisions — hold a question until you can bring a measurement

In the fourth session the open question was whether a fix should widen to a
neighbouring row. The gate was asked to *measure* whether it could, came back with
one failing test out of 732 — and that one the row already pinned as a defect — and
the user decided on that rather than on two plausible arguments. The delay was one
gate the branch was taking anyway.

The companion case, 2026-09-04: a builder whose remedy was still an open owner
decision ran the reproduction anyway. It was needed under *every* candidate answer,
"do nothing" included, so running it was never a bet. Building the mechanism on top
of it was the bet, and it paid, because it converted "we could fix this" into "the
fix exists, measured and reviewer-validated", which is the fact that changed the
owner's answer. What kept it safe was committing and pushing nothing while either
decision was open, so the tree each party inspected was never ambiguous.

### Decisions — "accept the baseline" is rarely zero work

Measured 2026-09-03: a four-option decision was answered with the zero-work option,
and the ticket's own Build still required amending an ADR "whichever option wins"
and clearing an outstanding alert "whichever way this goes" — the second explicitly
noting that no option retires it retroactively, *do nothing included*. So the answer
converted a blocked ticket into a small dispatchable one rather than closing it.

### Decisions — parallelise at intake

In the reference session two tickets overlapped and the question brought to the user
was *how to reconcile them* — never *whether to run them concurrently at all*. By
then both were half-built and every option was bad; three rebases followed.

### Relaying — a relayed option

Measured 2026-09-03: the seam map's extraction of a ticket's options was faithful
and still corrected the orchestrator's own count on the way past, which is the
argument for reading the options yourself, not against it. Cost is a few `sed` calls
against the decision headings.

### Relaying — an option's stated mechanism

The sharpest laundering route on `SKILL.md`, because it does not feel like relaying
at all. A ticket or a subagent writes an option as *"do X by doing Y"*; you put it
to the user faithfully; the user picks it; and Y arrives in your dispatch as an
instruction that nobody ever checked. The faithfulness of the relay is what
disguises it — you were careful with the words, and the words carried an unverified
claim.

Measured 2026-09-03. A builder surfaced a decision whose option A read "guard that
call and **route failure to `options.onFailed`**". The user chose to fold the work
in, and the orchestrator relayed `onFailed` as the mechanism. A gate then
established it is **not reachable** from that call site — it is wired to a different
handler on the same socket, and the throw is a synchronous exception in the success
path, not an event that socket emits. The builder's own proposal had been wrong
about its own file, the orchestrator had repeated it without checking, and only the
gate stopped it being built.

Hence the remedy attached to that row: say what must be true — *a failure here must
fail fast with a typed code instead of escaping* — and say explicitly that the
mechanism named in the option is unverified and the builder should choose the route.
That costs one sentence and it puts the decision's *purpose* beyond the reach of its
*guess*.

### Relaying — a caveat where a command would do

The value is not catching the reviewer; in the fourth session none of these checks
found a reviewer wrong. It is the difference between "the reviewer says" and "I
checked", which is what lets a finding travel as fact without the relay becoming the
middle link in a laundering chain.

The worked example is a count of the files one commit touched, published wrong in a
document: `git show --name-only <sha>` settles it in one line, and the same line
settled it a second time two passes later when the published number had drifted
again. Note the object — a *branch's* touched-file count is
`git diff --name-only <base>...<tip>`, a different command, and reaching for the
wrong one gives a confident wrong answer.

### Relaying — an unmarked relay

In the third session a ticket asserted that a file contained a word, the
orchestrator repeated it in a brief without running the one-line `grep` that same
brief demanded, and the builder repeated it from the orchestrator. Three links, and
the middle one was the only place it was cheap to stop. The same orchestrator later
relayed a peer session's claims explicitly flagged as unrun, and that one did not
propagate — the builder verified them against merged code instead.

### Relaying — your own summary, sent downstream

In the second session the orchestrator passed a reviewer's framing of a guard as
"prototype-pollution defence" down to the builder as an instruction; it was wrong —
the value reached a `Map` key, so that route was already closed, and the real risk
was key collision. The builder refused to transcribe it, wrote the test for the
collision it could demonstrate, and the next gate upheld the builder. **Three
separate builders corrected an orchestrator error in one session** — an id, a
ticket's status, and a diagnosis. In the fourth session all four builders corrected
something: a brief's fixture tree that would have passed against the CLI it was
testing, a brief's claim that an option "removes the whole class", an orchestrator
framing that treated a choice as settled when its premise was unmeasured, and a
ticket's own baseline.

### Relaying — a finding whose premises are all true

In the sixth session a gate reported that two call sites logged a request context
unredacted, and every premise held: the sites do log it raw, the headers are
documented as carrying `Cookie` and `Authorization`, and the redactor that exists
for exactly that shape is called at neither. The orchestrator checked the premises,
found them sound, and relayed the conclusion as work to do. The conclusion was false
— the logger recognises that field structurally and redacts on the way out, by
design, so a call site is **not** supposed to redact, and adding one would have
taught the next reader the opposite of the intended pattern. The builder reproduced
it first, refuted it, applied nothing, and wrote the regression test the finding had
actually been pointing at.

### Relaying — a wrong citation under a right conclusion

Measured 2026-09-04. An orchestrator told a gate that the builder's model was
inferred off `builder.md`'s `hard` difficulty row. The ticket carried no
`difficulty` at all — `hard` was a *sibling's*, in the same batch — and both rows
resolve to the same model, so the error was invisible in the answer and reached a
committed gate record. The reviewer transcribed it because it was given as fact,
which was correct of it. The record has to show which link failed, or the next
reader blames the gate; how to withdraw a claim that reached a record is in
`reference/records.md`.

### Relaying — a described artifact

In the sixth session the orchestrator described a gate record instead of pasting it:
its verdict, its method, seven of its citations, accurately. The builder searched its
worktree, the ticket, `git status` and `origin`, found no such text, and **stopped**,
on the grounds that composing a reviewer's record from a summary is fabricated
evidence. It was right, and the round was lost. A description is not a smaller
version of a record; it is a different object, and no amount of accuracy converts one
into the other. The tell is the verb: if the relay asks the builder to *commit*,
*post* or *quote* something, that something has to be in the relay.

The shape to avoid is the opposite one: relaying a finding as an instruction to
apply. That gets it applied and learns nothing, and when the reviewer is wrong it
gets a wrong thing applied confidently.

### Relaying — a disposition marked "accepted"

Measured 2026-09-05 on `repo-21`'s own gate. A builder answered a finding about a
section being too narrative by rewording it, wrote *"the reasoning is gone"* into a
committed gate record, and shrank the section by **one line**. The reviewer's first
pass accepted the disposition because the numbers beside it were measurements; its
second pass caught it by measuring the *fix* instead of reading the disposition —
90 lines before, 89 after, against 62 once it was done properly.

### When two gates disagree

In the fourth session gate A rated a rule's type enumeration a real defect; gate B
rated the same thing acceptable. Relayed as an open disagreement, the builder
rejected both framings and proposed a third: read the mechanism off the `hidden`
flag rather than off a list of type names, so *enumerating type names was itself the
defect*. An answer neither gate proposed, and the instruction it wrote — read the
test off the config — does not go stale when a type is added.

**And then a later gate corrected the builder in turn, which is the part not to
lose.** That third answer was an *inference*, not a measurement: only two types were
ever run, and both results are equally consistent with a hardcoded releasing list.
It shipped because it **errs safe** — if the hypothesis is wrong the new rule
over-warns, where the enumeration it replaced under-warned. So the lesson is not
"the builder's measured answer beats both gates" (2026-08-24, as written); it is
that relaying the split produced a better *hypothesis* than either gate held, and
that a further gate was still needed to say what kind of claim it was. Repeating a
builder's self-description as measurement is the laundering `SKILL.md` forbids, and
the orchestrator did exactly that in the first draft of that paragraph.

Often the builder has run the mechanism and the reviewers have not — though not
always: one gate in that session reproduced a release-please dry run end to end,
which is more than the builder's own claim rested on. Say which gate found what,
keep both attributions, and let whoever is closest to the measurement decide.

### Reporting — what the accounting table showed that prose hid

All three from the 2026-09-05/06 batch:

- **Where the cost actually went.** One branch — `repo-22`, PR #161 — took roughly
  a third of that batch, and **its gate cost about what its own builder did**:
  411,966 against 406,732, last-observed cumulative figures 1.3% apart, which is a
  tie and not a ranking. The comparison that carries weight is the other one — that
  gate cost **roughly 60% more than the next most expensive builder in the batch**
  (256,418). Either way it inverts `sizing.md`'s "builder round-trips cost more than
  gates", which is true per *round* and stops being true when one branch takes six
  gate rounds.
- **Whether the model-difference rule held**, per branch rather than as a claim. A
  Model column turns compliance into something a reader can audit at a glance.
- **What an interruption cost.** A replaced agent sits in its own row beside its
  replacement instead of vanishing into a total.

## Eleventh session — 2026-09-07

**Written by a builder (Sonnet 5, dispatched explicitly) from the orchestrator's
own account of a batch it ran on Opus 5 (1M context), with no gate on this
branch** — the orchestrator states it is the only participant who watched the
session end to end and will verify this row itself, so no `ticket-reviewer` was
dispatched against it. What could be checked from this worktree, against the six
branches and `origin/main`, was checked rather than transcribed; the rest is
marked as supplied.

| Field | Value |
| --- | --- |
| `tickets` | **6 pull requests against `origin/main`, one merged.** `#175` (`docs/dl-44-dl-45-decisions`, decision records for `dl-44`/`dl-45`) · `#176` (`repo-30-id-sweep-repo-tickets`, a second round on `repo-30` — its first fix had already merged the same day as `#174`/`24e5bf7` and left `status: ready`, re-verified here: `docs/work/repo-30-the-id-sweep-cannot-see-repo-tickets.md@9b426c8:6` "status: ready" still reads that way on `main`, because the sweep's own exit-code test had never observed what it claimed to — see item 2) · `#177` (`docs/repo-decisions-2026-09-07`, four decision records: `repo-15`, `repo-16`, `repo-26`, `repo-29`) · `#178` (`dl-43-gate-progress-on-what-actually-happened`, built, plus filed `dl-46`) · `#179` (`repo-21-orchestration-skill-loop`, `repo-21` + `repo-28`, **merged as `9b426c8`**, the base this row is measured against) · `#180` (`repo-windows-ci`, filed `repo-31`, `status: needs-decision`). The supplied summary reads **"5 tickets built + 2 bookkeeping branches + 1 filing."** The two bookkeeping branches (`#175`, `#177`) and the one filing (`#180`) match the diffs exactly. **The five built tickets do not reconcile**: `git diff --name-only origin/main...<branch>` on all six names exactly four built tickets — `repo-21`, `repo-28` (both `#179`), `repo-30` (`#176`), `dl-43` (`#178`) — and `dl-46` is filed, not built, on its own branch's own diff. Re-run here, `npm run status --ready` returns exactly the four tickets this batch built or attempted (`dl-43`, `dl-44`, `dl-45`, `repo-30`) plus the four it recorded decisions for (`repo-15`, `repo-16`, `repo-26`, `repo-29`) — this batch touched every ticket that was `ready` or `needs-decision` on the board at once, which is worth recording on its own. Left as an unreconciled count rather than silently rounded to five |
| `agents` / `dispatches` | **13 agents** — 1 seam-mapper, 7 builder dispatches across the 6 branches (one each, except `#180`'s filing, which took two: an Opus builder killed by a session rate limit before committing anything, and a Sonnet replacement that filed `repo-31` — the tenth session's same shape, a builder round lost to the session itself rather than to the work), and 5 ticket-reviewers (`#175`–`#179`; none dispatched against `#180`, consistent with a filing having no implementation to gate). Total dispatches-and-wakes `not recorded` beyond this table |
| `builder rounds` | Not given as a count. Qualitatively: `dl-43` (gate rounds, a CI fix, and filing `dl-46`), `repo-21`/`repo-28` (a fold-in plus a stall recovery — item 1) and `repo-30` (a CI fix after its first gate, run as its own commit range `6a5944b...4e1e325`) each took more than one round; the two decision-record branches and `#180`'s filing read as single-pass. One round was lost outright rather than spent: `#180`'s first builder was killed by a session rate limit having produced nothing, and had to be re-dispatched from zero |
| `gates` | **5 gate agents, covering every branch but `#180`'s filing.** Pass structure as supplied: `dl-43` ×4 plus an out-of-band e2e check; `repo-30` ×3 on its still-open branch (one of them volunteering a finding against an earlier pass of itself — item 2); `repo-21`/`repo-28` 2, verified here against the merged tree — `CONCERNS` at `928e3ac`, `PASS` at `5065aed`; the two decision-record gates (`#175`, `#177`) are not stated as counts. **Returned findings:** at least 3 of 5 (`dl-43`, `repo-21`/`28`, `repo-30`) — the two decision-record gates are not stated to have found anything, so this is "at least 3," not "exactly 3" |
| `wrong findings` | **None refuted this session, per the supplied data.** What happened instead runs the same direction the eighth and tenth sessions already recorded: a reviewer found a gap in its own earlier verification and wrote it into its own record unprompted, rather than being caught by a builder or a later gate — `repo-30`'s reviewer, on its still-open branch: *"my `6a5944b` gate's 'verified' line for Done-when 2 had the same blind spot this CI run exposed… Recorded here rather than silently carried forward."* A third instance of the same shape, changing no verdict |
| `subagent tokens` | **2,635,387 across the 12 agents that reported; 1 (the killed `#180` Opus builder) reported nothing** — summed here from the per-agent figures supplied, matching the orchestrator's own "~2.64 M" to within rounding: seam-mapper 75,025 · `dl-43` builder 464,151 · `dl-43` reviewer 289,790 · `repo-21`/`28` builder 370,737 · `repo-21`/`28` reviewer 246,492 · `repo-30` builder 276,923 · `repo-30` reviewer 221,284 · 4-record builder (`#177`) 171,000 · 4-record reviewer 130,087 · `dl-44`/`45` builder 114,913 · `dl-44`/`45` reviewer 113,707 · `#180` replacement builder 161,278. Split on these floors: builders **59.2%** · gates **38.0%** · intake **2.8%** |
| `cost` | **≈ $47.96** at the 2026-09-02 rate of $0.0182/1k — an arithmetic conversion of a set of floors with one agent's spend entirely unmeasured, so a floor and not a bill, same caveat as the ninth and tenth sessions' cost rows |

**what the skill got wrong** — seven, none fixed on this branch, which is scoped
to this file alone:

1. **A stalled exchange can be a message sent and never received, not only a
   pair that agreed and stopped.** `SKILL.md`'s documented case (2026-09-04) is
   two agents each treating the record as the other's move. This session's
   version is narrower: `repo-28`'s reviewer answered an open question about
   literal pipes breaking a two-column markdown table into five cells, chose to
   reword rather than escape — and **the answer never reached the builder**.
   Both then reported the exchange closed, accurately, from where each stood:
   the reviewer had sent its answer, the builder had done everything not
   blocked on it. `npm run status` read `done`, the branch was pushed, and
   nothing went red. The existing discriminator —
   `git show <branch>:<ticket-path> | grep '^## Review'`, empty — caught it
   **unaltered**, because it tests the artefact on the remote rather than
   either agent's account of it.
   `docs/work/repo-21-the-orchestration-skill-outgrew-its-loop.md:1360` "not evidence of a delivered one"
   states the generalisation directly — a claim about a channel has to be
   checked from outside it, and the orchestrator is the only participant
   standing there. No rule needed changing; the value is in the reproduction,
   not a fix.
2. **Two verifications that share an environment are one verification.**
   `repo-30`'s exit-code test, on its still-open second branch (`#176`), passed
   three times on the builder's machine and twice on the reviewer's, and had
   never once observed what its own name described: a default
   `actions/checkout` creates no remote-tracking refs, so `git ls-tree
   origin/main` dies with exit 128 before `gh` is ever spawned. Both machines
   carried the same assumption — a checkout with `origin/main` already
   present — so five agreeing runs were five instances of one blind spot, not
   five independent checks. The reviewer volunteered the correction against its
   own prior gate record, unasked: *"my `6a5944b` gate's 'verified' line for
   Done-when 2 had the same blind spot this CI run exposed… Recorded here
   rather than silently carried forward."* Changed no verdict — the production
   code was always correct — only what either party had actually proved.
3. **Add e2e to the "narrowest thing that can fail" guidance, with its inverse
   stated beside it.** `dl-43`'s builder skipped the e2e suites, reasoning that
   the unit suites already covered the analysing panel's features. CI
   disagreed: `tools/downloader/e2e/sniffer/mse-page.spec.ts@9b426c8:102` "toHaveCount(5)"
   — the five-stages-at-once list this ticket exists to
   remove — asserted the exact defect the ticket fixed. Its own diagnosis is
   the guidance's missing half: *"a test's value is not the feature it covers,
   it is the assertions it makes… A component rewrite invalidates every
   assertion about its markup, wherever that assertion lives, and grep finds
   those; reasoning about coverage does not."* Two minutes of
   `grep -rn "listitem" e2e/` would have found it before CI did.
4. **The pre-merge look has to read job conclusions, not run conclusions, and
   a `cancelled` run can be hiding a real failure underneath it.** `main` was
   red on `windows-latest` for most of a day after `repo-25` (`#168`,
   `4bc3e66`) merged: that push's own run was **cancelled** — superseded by the
   next merge landing on top of it — so it never reported a `test` conclusion
   at all, and the two merges immediately after were markdown-only, so
   `ci.yml`'s `changes`-gated matrix **skipped** `test` on both while each run
   still read `success`. Only the ungated `schedule` trigger ran the real
   matrix, and it failed. `dl-43`'s own Log names the identical mechanism
   independently, on the same sha: *"the push CI run at `24e5bf7` reported
   success while the scheduled run at the same sha failed on windows-latest,
   because `ci.yml`'s test matrix is gated by its `changes` job and that merge
   was markdown-only… a suite that does not run is indistinguishable from a
   suite that passes."* The orchestrator read the run list early in this
   session, saw the `cancelled` rows, called them routine, and reported `main`
   green — the exact misread this page already warns against, made by the
   agent that had just relayed the warning.
5. **Counting red jobs over-counts a single defect.** The orchestrator's own
   mid-session framing — "Windows is the dominant source of red — 7 of 8
   failures were Windows-only" — went to the owner as-is. `repo-31`'s filing
   (`#180`), reading each failed job's log rather than its conclusion,
   established that **all eight failures fail on the identical assertion** —
   `scripts/test/citations.test.ts@fdafd1a:1334` "This record exists at that rev and cited something different there",
   reached from `scripts/test/citations.test.ts@fdafd1a:1333` "expect(pinned.stdout).toMatch(" — one unfixed regression
   in the repo's own citation checker, counted eight times by run count. Its
   own distinction is the reusable one: *"'Windows is the dominant source of
   red' and 'the team has looked at eight different Windows failures' are
   different claims, and only the first is true."* Classify failures by cause
   before characterising a platform, not after.
6. **A relayed fact is a claim even when it feels like recall.** Three of the
   orchestrator's own relayed facts about
   `.claude/skills/orchestrate-tickets/reference/records.md` changed under
   checking this session, each settled by a builder's command rather than by
   one the orchestrator ran first: it said "this branch's `records.md`" (wrong
   — the file lives on `main`, untouched by any branch in this batch),
   corrected to "repo-21's `records.md`" (wrong again, for the same reason —
   repo-21 edits the file, it does not own it), and paraphrased its
   withdraw-in-place rule loosely enough that a builder went and read the real
   text and implemented something more prescriptive than the paraphrase asked
   for. Builders corrected the orchestrator this way five times across the
   session, every time producing something sharper than what was sent — the
   ninth and tenth sessions' "Relaying" entries holding again, this time on
   the page that names the rule.
7. **An answered decision with no carrier needs its own dispatch, and this
   session shows it scales.** The eighth session's row named the pattern for
   one decision on one sibling branch; this session ran it twice at once —
   `#175` carries `dl-44` and `dl-45`'s answered decisions, `#177` carries four
   (`repo-15`, `repo-16`, `repo-26`, `repo-29`) on a single branch. Both were
   cheap and both worked: the four-decision branch cost 171,000 builder tokens
   and converted four `needs-decision` tickets off the blocked list in one
   round — re-run here, `npm run status --ready` no longer withholds any of the
   four. The new datum is that the pattern does not need one branch per
   decision to hold.

**Owner decisions taken: 11, three against a written recommendation — and, on
the three re-checked here, each produced a better artefact than the
recommendation would have.**

- **`repo-28`: `standard` → `sonnet`, against the ticket's own filed
  recommendation** to leave it at `inherit`. Confirmed in the ticket's own
  Decision section: *"Whose recommendation it overrode — This ticket's own."*
- **`repo-30`: fold the `next-id.mjs` script lift into this branch now,
  against both the builder's and the orchestrator's recommendation** to file
  it separately. Confirmed on the still-open branch: *"This was folded in
  against the recommendation of both the builder and the orchestrator, who
  each argued for a separate ticket; the repo's owner was given that argument
  in those terms and chose to fold it in."* What the recommendation would have
  produced was an untested twenty-line snippet; what shipped is a script
  behind a mutation-verified 8-guard test suite (seven at first pass, an
  eighth added once CI found the gap the seven missed).
- **`repo-13`: amend a `done` ticket in place, against the orchestrator's
  recommendation** to record the answer on `repo-16` only and leave the closed
  ticket alone. Confirmed on `repo-16`'s still-open branch — and worth
  flagging precisely, because it is not the mismatch it first looked like:
  **the amendment itself has not happened yet.** `repo-16`'s own text says so —
  *"Not done on this branch: the amendment is repo-16's build work"* — and
  `docs/work/repo-13-codeql-false-positives-recur.md` is unchanged on `main`
  and on every branch checked in this batch. The decision is recorded; its
  reproduction is deferred to whoever builds `repo-16`.

**Also worth carrying forward, not concluding from.** This batch's own numbers
are the first data built under repo-28's newly merged `standard`→`sonnet`
mapping. Two Sonnet builder dispatches ran under it this session — `#180`'s
replacement filing (161,278 tokens) and this row's own dispatch — and a filing
is not a representative `standard` build, so this is a datum for the next
session to add to, not a second trial.

## Twelfth session — 2026-09-07

**Written by a builder (Opus 5 (1M context), dispatched explicitly) from the
orchestrator's own account of a batch it ran on Opus 5 (1M context), with no gate
on this branch** — ship authority was conditional on `npm run check` and
`status --json` exiting 0 with the diff confined to this file, and the
orchestrator states it is the only participant that watched the session end to
end. What could be checked from a worktree was re-run here against
`origin/main@e9054c5` and the three branches; everything else is marked as
supplied.

**The dispatch called this the eleventh session and it is the twelfth.** The
entry above — `## Eleventh session — 2026-09-07` — was added by `e9054c5` (#181),
which the dispatch referred to as the tenth; `## Tenth session — 2026-09-06` is a
separate, earlier entry. Two batches ran on 2026-09-07, which is what makes the
off-by-one cheap to commit: this is the second of them, based on the merge that
closed the first. Numbered from the sequence in the file rather than from the
dispatch, and recorded because a duplicated heading is the one error this page
cannot absorb.

| Field | Value |
| --- | --- |
| `tickets` | **3** taken from `ready` to a gated branch, none merged at close: `repo-15` (#182, tip `a2c5b0a`), `dl-44` (#183, tip `b94f9bf`), `repo-16` (#184, tip `14703b5`) — every tip and PR number re-checked here with `git ls-remote --heads origin` and `gh pr view --json headRefOid`, all three open against `main`. Around them: **one ticket closed without being built** (`repo-26`, `status: done` on `repo-15`'s branch, closed as already built by `repo-22`/#161 — confirmed on `main`, where `36be01b` carries it), **one filed** (`repo-32`, `status: needs-decision`, no `## Review` heading, on `repo-16`'s branch), and **two held tickets amended on a sibling's branch** (`dl-46` on `dl-44`'s, `repo-29` on `repo-16`'s). Both amendments re-verified additive-only by `--numstat` (+24/−0 and +46/−0) and frontmatter-identical by hunk position — the added hunks open at 105 and 140, and at 387 and 653, none of them inside a nine-line frontmatter block. **Board at intake: 7 `ready`, 1 withheld**, re-measured at the base with `npm run status -- --ready` — `dl-44`, `dl-45`, `dl-46`, `repo-15`, `repo-16`, `repo-26`, `repo-29` ready, `repo-31` withheld as `needs-decision`; all four `depends_on` blockers among them (`dl-40`, `dl-41`, `dl-43`, `repo-13`) read `done`. **All three built tickets carry `difficulty: hard`, and all three were built on Opus and gated on Sonnet**, stated in each pull request body — the first batch to run entirely under `repo-27`'s pinned `hard` row, `.claude/agents/builder.md@fdafd1a:25` "a contract, a security claim, a seam with reach" |
| `agents` / `dispatches` | **7** agents — 1 seam-mapper, 3 builders, 3 reviewers — / **11** dispatches-and-wakes: 7 dispatches plus 4 orchestrator `SendMessage` wakes. Supplied; nothing in the tree records either half |
| `builder rounds` | **8 across 3 builders** — `repo-15` 2, `repo-16` 2, `dl-44` 4 — supplied. **Zero caused by orchestrator error**, which is the half the schema asks for. It is the **first zero** among the sessions that stated an attribution at all — seventh 1, eighth 1, ninth 2, tenth 2, and the eleventh stated none. `dl-44`'s fourth round was the Windows CI defect below: structural, not a relay failure. One orchestrator error did harden a gate finding into an instruction, and cost no round only because it rode an existing relay — see _Orchestrator errors_ |
| `gates` | **3, all returned findings**, every verdict read out of `git show` on the branch rather than from the account. `repo-15` **PASS**, 3 low, none changing a `Done when` verdict. `repo-16` **CONCERNS** — its own defect hunt at medium returned **0**, and the concern is one acceptance line unprovable before merge: the dismissal step has never run, and the live alert state is unreachable because `gh api` is denied. `dl-44` **CONCERNS → PASS**, 2 med both closed plus 1 low, the final record re-verifying at `992ac2e` |
| `wrong findings` | **Five, spread across four different links, and exactly one reached a commit** — and the one that did was the **builder's**, not a gate's, withdrawn in place the same day at `009072d`. The per-link attribution is the part worth carrying and is in the table below; "findings were wrong" is the summary that destroys it |
| `subagent tokens` | **1,502,839 across all 7 agents, none missing** — last-observed cumulative, so each is a floor. `dl-44` builder 299,804 · `repo-16` builder 298,695 · `dl-44` reviewer 233,894 · `repo-16` reviewer 231,057 · `repo-15` builder 182,864 · `repo-15` reviewer 165,799 · seam-mapper 90,726. Re-added here; the supplied total is exact. Split on the floors: builders 781,363 (**52.0%**) · gates 630,750 (**42.0%**) · intake 90,726 (**6.0%**), from 51.99/41.97/6.04 before rounding. **A full report from every agent is itself the datum** — the ninth, tenth and eleventh sessions each lost between one and two agents' figures to a last turn that ended in `SendMessage` |
| `cost` | **≈ $27.35** at the 2026-09-02 rate of $0.0182/1k, recomputed here from the total above. An arithmetic conversion of a set of floors with cache reads excluded, so a floor and not a bill — the same caveat the three rows above carry |

**Where the five wrong findings came from.** Every row was checked against the
committed record on its branch, and one of them is filed against a different link
than the account filed it against.

| Link | What was wrong | Reached a commit |
| --- | --- | --- |
| `repo-15` gate → builder | 2 of 3 findings refuted by the builder and the refutations accepted. One was an arithmetic reading: the builder's `7 failed, 24 passed` and `13 of 31` were real prints against an intermediate **31-test** file, and the gate compared them against the 33-test tip. The other was a proposed reword, "11 of 12 covered" — which would have asserted that one of twelve measured command strings was uncovered, and none is; the workflow-edit gap is a non-command row a Bash matcher structurally cannot see | No |
| `repo-16` gate → builder | 4 of 12 `file:line` citations in the gate record were short or loose, all in the same direction, and were repointed before the record was committed. Both sides converged by re-running single-line `awk 'NR==n'` rather than reading a range; the record names one of the four as **the builder's miss**, listed as already-correct in the first pass and caught only on the second | No — repointed pre-commit |
| `repo-16` **builder** → its own gate note | The note claimed a post-gate comment rewrap preserved a thirteen-line range in the branch's `security.yml` because it preserved the comment's line count. True of the single line, **false of the range**: the same edit added three words. `--numstat` reports `3 3` and the two slices' md5sums differ | **Yes**, at `ff9c64b`; withdrawn in place at `009072d` |
| `dl-44` gate → its own PASS record | Two citations in the record the reviewer wrote were defective: a bare shorthand naming only a line range inherited the previous citation's filename and resolved into a different file, and `schema.ts` is repo-wide ambiguous because `tools/downloader` and `tools/planner` both carry `api/src/db/schema.ts`. Caught by `node scripts/citations.mjs` refusing the record, not by either agent | No — refused before commit |
| orchestrator → builders, ×3 | See _Orchestrator errors_ | One false pass, in the orchestrator's own verification |

The account files the third row under "`repo-16` gate". The withdrawal commit
itself attributes it to the builder — *"Attribution: the builder"* — and names
the reviewer's run as what caught it. Corrected here rather than transcribed,
because which link failed is the whole content of this table. The account also
reports the `repo-16` reviewer miscounting "thirteen citations" for twelve in its
closing summary and correcting itself; the committed record reads **twelve**
throughout, which is consistent with the correction landing but is not
independent evidence of the miscount. Supplied.

**The batch's own defect: no platform diversity, and what is and is not Windows
evidence.**

`dl-44`'s pull request failed on `test (windows-latest)` with
`EBUSY: resource busy or locked, unlink ... jobs.sqlite`, inside **its own new
test** — `pipeline.test.ts > the preview a job keeps > a restart does not lose the
preview of a job whose file survived it`. Three independent gates had been green
and none could see it: a mutation-verified build, a reproduce-everything review
that wrote its own mutants and returned two meds of its own, and a ship-condition
check. Builder, reviewer and orchestrator all ran Linux.

The orchestrator relayed a hypothesis — the first app's handle still open —
**labelled as a hypothesis to verify rather than a diagnosis to implement**, and
it was wrong about which handle. The builder measured instead, and the two halves
of the evidence are different in kind and must not be merged:

- **A Linux proxy.** Counting `/proc/self/fd` at the unlink line found 3
  descriptors open — `jobs.sqlite`, `-wal`, `-shm`, so WAL mode — belonging to the
  **second** app, which the test never shuts down because `afterEach` disposes it
  only after the `finally` that unlinks. POSIX unlinks an open file happily, so
  the count is a proxy for the condition Windows enforces, not a reproduction of
  the failure. The commit says so itself: *"Not verified here that the Windows leg
  passes; only CI can show that."*
- **The only Windows evidence is CI.** The leg at `5a40543` reads **2 failed /
  2247 passed**, the `EBUSY` plus an inherited failure; the leg at `b94f9bf` reads
  **1 failed / 2248 passed**, the inherited failure alone. Both read here from
  `gh run view --json jobs` and `--log-failed`, never from the run table.

The fix was ordering inside the `finally` — shut the second app down before
removing anything — with **no source change** and the acceptance untouched: still
two instances over one database, and explicitly not skipped on Windows.
**No Windows machine was available to any agent in this batch**, and no claim here
should be read as one.

**Pre-merge CI: `main` is red, and all three branches inherit it.** At
`origin/main@277a182` the `test (windows-latest)` leg fails on
`scripts/test/citations.test.ts`, the test named *"--rev names which record it
read, and says when that record cited something else"*, on a path-separator
assertion — the expected string comes back as `2 references in ..\..\..\..\..\RUNNER…`.
Re-run here: 1 failed / 2239 passed, and it is the same single assertion behind
`dl-44`'s remaining red. `repo-31` is the parked ticket for it.

**what the skill got wrong** — three, none fixed on this branch, which is scoped
to this file alone. Four candidates were offered and two are dropped below with
the line that already covers them.

1. **`skipped` is the same class as `cancelled`, and the entry above already
   proved it without the rule moving.** `main`'s most recent run at `e9054c5`
   reads `conclusion: success`; that commit was all-markdown, so `ci.yml`'s
   `changes` job gated the unit matrix off and `gh run view --json jobs` reads
   `test  skipped`. A workflow-level `success` whose matrix job never ran is
   indistinguishable from a green one in `gh run list`. The glance-reading row
   at `.claude/skills/orchestrate-tickets/SKILL.md@fdafd1a:261` "and a glance counts it as green"
   still names only `cancelled`. **What is new is not the mechanism** — the entry
   directly above this one records exactly it, on the same workflow, from the
   previous batch — **it is that recording it changed nothing.** A defect written
   into this page one commit earlier was re-committed by the next session, because
   the page it was written on is not the page an orchestrator reads at step 8. The
   lesson is about the propagation, not the flag: **a defect that stops at the
   history entry has not been fixed**, and the cheap test is whether the rule it
   belongs to changed in the same commit.
2. **A batch with no platform diversity has a blind spot no gate on any of these
   pages can close.** Three green gates — one mutation-verified build, one
   reproduce-everything review with its own mutants, one ship-condition check —
   and the defect was visible only on the platform nobody was running. None of
   *reproduce the finding*, *ask for a positive control* or *enumerate rather than
   spot-check* reaches it, because all three are checks on **reasoning**, and this
   was a gap in **execution surface**. Nothing in `SKILL.md` or `reference/` names
   a platform at all outside one incidental mention in `sizing.md`. The remedy is
   not a new gate: it is that a branch whose tests touch the filesystem, process
   trees or path separators **has no pre-merge verdict until its own CI matrix has
   run**, and a gate that says PASS before that has said something narrower than
   it sounds. This batch also shows the cost is bounded — one extra builder round,
   caught by CI on the pull request, before any merge.
3. **A history entry's citations are a claim about a past tree, and the checker
   reads the present one — so a correct entry rots the moment its own subject
   merges.** Measured at the base, before this row was added:
   `node scripts/citations.mjs` on this file exits **2** with *5 verified, 3
   moved, 1 unanchored, 0 unresolvable, 3 unchecked — of 12 references*. All three
   `moved` were correct when written, and **two of them drifted precisely because
   the work they describe landed**: the eleventh session cited `repo-30`'s
   frontmatter as `status: ready` and that line now reads `status: done`, and it
   cited `toHaveCount(5)` in `tools/downloader/e2e/sniffer/mse-page.spec.ts` as
   the assertion `dl-43` existed to remove — which `dl-43` removed, so the anchor
   is nowhere in the file. The third drifted when `repo-21` rewrote
   `dispatching.md`. **Nothing reports this**: `npm run check` does not run the
   checker at all, and CI runs it on exactly one file —
   `.github/workflows/ci.yml:151` "--require-anchors" — scoped that way on
   purpose, `.github/workflows/ci.yml:142` "alone, on purpose". So the page
   carrying the schema every session must append to is failing its own checker at
   the base, and each session inherits a red baseline it has no way to see. The
   tenth session's entry 8 said *nothing checks this page*; this is the
   measurement under it, and it points at a specific remedy the checker already
   supports — **pin a history citation with `--rev` and say so**, because a
   coordinate into a tree that has since been fixed is not stale, it is correctly
   describing something that no longer exists.

**Two candidates were offered and are dropped, each against the line that already
covers it.**

- **"`worktree-hygiene.md` has no test for *and it has stopped working*"** —
  it does. `.claude/skills/orchestrate-tickets/reference/worktree-hygiene.md@fdafd1a:74` "Retire a reviewer when its record is pushed"
  continues *"**and** the exchange
  has ended — not on the record alone"*, and the paragraph above it says the
  exception is now the common case rather than the rare one. The reviewer here had
  explicitly said it was staying live for follow-up, so the existing rule already
  forbade the removal. This is a rule violated, not a rule missing, and it belongs
  below with the other orchestrator errors — filing it as a page defect would have
  put a fix on a page that did not need one.
- **"The seam-mapper found something step 2 does not ask for"** — its own brief
  asks for it verbatim. `.claude/agents/seam-mapper.md:53` "a Build section that describes work"
  sits in the bullet headed *Anything the
  frontmatter got wrong*, with *"State these as findings, not corrections"*
  attached. `SKILL.md` step 2 mentions only the collision matrix, which is
  probably where the impression came from — but the agent reads the definition,
  not the step. It is kept below as the first recorded instance of that bullet
  paying for itself, which is worth more than a false novelty claim.

**Orchestrator errors, three, all its own by its own account.**

- **It reclaimed `dl-44`'s reviewer worktree mid-verification, after saying it
  would hold it.** The reviewer got one command out and then every Bash call
  refused; it flagged the round **partial** rather than reporting it done, and the
  builder closed the gap itself at the same tip. The rule it broke is quoted
  above. Two things generalise past the violation: the reviewer's failure mode was
  the good one — a tool that stops working is legible from inside in a way a
  removed worktree's *silent* auto-reclaim is not — and **a stated intention to
  hold is itself a promise another agent plans against**, which is the half no
  page covers because no page expects the orchestrator to reverse itself
  unannounced.
- **It relayed the `repo-15` gate's arithmetic finding as established, and
  instructed the builder to correct its Log.** It was the gate's error and not the
  builder's, and one `wc -l` against the intermediate file would have settled it.
  The builder pushed back rather than transcribing, and the gate withdrew its
  reading. It cost no round, because it was batched into a relay already going
  out — but the shape is `SKILL.md`'s *relaying a finding as an instruction to
  apply*, which gets the wrong thing applied confidently, and the only reason it
  did not is that a builder refused. That is the ninth session's entry 1 holding
  again, and the fourth or fifth consecutive session in which a builder is the
  link that caught an orchestrator.
- **Its own verification produced a false pass.** Checking that `repo-29`'s
  amendment was frontmatter-identical, it guessed the ticket's filename wrong —
  the file is `docs/work/repo-29-citations-carry-no-anchor.md` — so both `git show` calls failed, `diff` compared two empty outputs, and the check printed
  **IDENTICAL**. Caught only by noticing the `fatal:` lines sitting above the
  result. This is `defect-shapes.md`'s *verification harness that cannot fail*,
  committed by the orchestrator inside a one-line check, which is where that shape
  is least expected and cheapest to write. **A comparison of two empty results is
  not a pass**, and the guard is to assert the inputs are non-empty before
  comparing them — the same discipline a test fixture gets. Re-run here with the
  correct path, the claim it was checking is true.

**What went right, and is worth copying.**

- **The seam-mapper flagged `repo-26` as already built on `main` by `repo-22`/#161,
  with the coordinates** — verified independently by the orchestrator, then the
  ticket's decision section read to confirm scope. That saved a whole builder
  dispatch on a ticket whose frontmatter read `ready` with unstruck Build steps,
  and it is the **first recorded case of the *anything the frontmatter got wrong*
  bullet paying for itself**. Confirmed here: `36be01b` is on `main`, the
  process-spawning assertions it added are in `scripts/test/commit-message.test.ts`,
  and the gate's own words are *"It performed no work on `repo-26` — the ticket
  closes as already built."* One intake dispatch at 90,726 tokens returned that,
  a collision matrix, and 6.0% of the batch.
- **A hypothesis relayed as a hypothesis survived being wrong.** The orchestrator
  was wrong about which app held the handle and said in the same message that this
  was to be verified rather than implemented. The builder measured, contradicted
  it, and the wrong guess cost nothing — the counterfactual is the row above,
  where a finding relayed as established cost a builder an argument.
- **A false claim that reached a commit was withdrawn in place, with its
  propagation named.** `009072d` keeps the original paragraph struck through and
  marked *do not cite*, states which half was true and which false, checks each
  half separately instead of predicting from the edit's shape, and attributes it
  to the builder. Its commit message names the mechanism generally: *"line count
  preserved"* was a measurement written as though it entailed *"range
  unchanged"*, which is a prediction.
- **Every agent's token figure arrived.** Seven of seven, against 7 of 9, 12 of 13
  and unrecorded totals in the three entries above. Whatever produced that is
  worth finding and repeating; the account does not say what it was.

## Thirteenth session — 2026-09-07

**Written by a builder (Opus 5 (1M context), dispatched explicitly) from the
orchestrator's own account of a batch it ran, as a records-only dispatch scoped
to this file — no ticket, no code, and no `ticket-reviewer` gate on this
branch.** Everything checkable from a worktree was re-run here against
`origin/main@4fad5f8` and the batch's five branches; everything else is marked
as supplied. **The third batch to run on 2026-09-07**, and the numbering is taken
from this file's own sequence rather than from the dispatch, per the entry above.

| Field | Value |
| --- | --- |
| `tickets` | **5 pull requests, none merged**, every one branched off `origin/main@4fad5f8` — re-confirmed with `git merge-base` per branch, all five returning that sha — and with **zero file overlap**, measured with `git diff --name-only origin/main...<branch>` on all five (3, 4, 15, 22 and 1 paths, no path in two of them). #186 `repo-36`, filed **and** built in one branch. #187 `repo-31`, option D. #188 `dl-46`. #189 `dl-45`. #190 `repo-29`, records-only and ungated. **Board at intake, re-measured at the base**: `npm run status -- --ready` returns exactly 3 — `dl-45`, `dl-46`, `repo-29` — with `repo-31` and `repo-32` withheld as `needs-decision`. **The batch took all three, answered one of the two withheld, and filed a fifth ticket it then built**, which is a complete sweep of the board in one round. Around them: `repo-34` and `dl-47` filed new (`status: ready`, on #187's and #189's branches), and `repo-32` moved `needs-decision` → `ready` on #187's — that one was **answered, not filed**, and existed at the base. Every id and status read out of `git show` on the branch rather than from the account |
| `agents` / `dispatches` | **10** agents — 1 seam-mapper, 5 builders, 4 reviewers — / total dispatches-and-wakes `not recorded` beyond the 10 spawns |
| `builder rounds` | **Not given as a count**, and the account supplies reviewer rounds instead. What is derivable from the committed records: `repo-36` **4** gate rounds over 6 commits, `dl-45` **3** passes over 3 tips plus a separate docs-only gate on its decision record, `repo-31` recorded across 3 tips, `dl-46` **1**, `repo-29` none. **Orchestrator's fault: the account attributes none, and one is legible in the tree** — `repo-36`'s round four exists only to correct a relayed claim that the Windows runner's drive layout varies between runs, and its own record says so. It produced a strictly better test anyway; see below |
| `gates` | **4 reviewers over 5 branches**, #190 ungated by the orchestrator's own authorisation as records-only. **Every verdict PASS**, all five records read out of `git show` rather than from the account. Findings: `repo-36` 1 in round one and 1 in round three, both resolved, 0 in round four; `repo-31` 2, both **dropped** as already fixed in a later commit on the same branch before the record was written; `dl-46` 4 returned, 2 carried and 2 dropped; `dl-45` 1 carried — the finding that narrowed the branch — plus 0 on its decision-record gate |
| `wrong findings` | **Five, across four links, and none reached `main` because nothing merged.** Two are the orchestrator's relayed claims, refuted by a builder each. One is a gate's reading of `citations.mjs`'s exit codes, refuted by the builder committing its record. One is a stale count inside a gate record, caught by the gate itself. One is advice that a builder disproved by building it — see the two lists below |
| `subagent tokens` | **2,019,787 across all 10 agents, none missing** — last-observed cumulative, so every figure is a floor and the total is a floor. `dl-45` builder 412,457 · `repo-36` builder 276,856 · `repo-31` reviewer 213,774 · `dl-46` reviewer 206,179 · `dl-45` reviewer 199,585 · `repo-31` builder 194,572 · `dl-46` builder 193,356 · `repo-36` reviewer 165,138 · `repo-29` builder 103,556 · seam-mapper 54,314. Re-added here; the supplied total is exact. Split: builders 1,180,797 (**58.5%**) · gates 784,676 (**38.8%**) · intake 54,314 (**2.7%**). By model: Opus 1,235,111, Sonnet 784,676. **It is a floor for a second reason the account states plainly** — several agents kept working after their last usage report, and a final turn that ends in a `SendMessage` delivers no usage block at all |
| `cost` | **≈ $36.76** at the 2026-09-02 rate of $0.0182/1k, recomputed here from the total above. An arithmetic conversion of floors with cache reads excluded, so a floor and not a bill — the same caveat the four rows above carry |

**Every model claim in this row is on the artefact, which is new.** The account
calls each model a recorded dispatch parameter; that is checkable here without
trusting it, because all five pull request bodies name both models in their own
words — #186 *"Built on Claude Opus 5 (1M context). Gated on Claude Sonnet, four
rounds, verdict PASS"*, #187, #188 and #189 the same shape, and #190 *"Built by
Claude Opus 5 (1M context) as a records-only dispatch. No reviewer gate"*. Each
also says why it has to be written down: the `Co-Authored-By` trailer is built
once per session tree from the orchestrator's model. **This is the first batch
whose pairing can be audited after the fact from the pull requests alone**, and
it is what makes the next paragraph a checkable correction rather than an
argument.

**The supplied "no `standard`-rated ticket appeared" does not survive the
branches, and the correction is narrow.** `repo-36`'s frontmatter reads
`difficulty: standard` on its own branch, and `repo-34` is filed `standard` too.
The claim holds *at intake* — neither existed when the board was read — and the
outcome was fine: `repo-36` was built on Opus, which is above what
`.claude/agents/builder.md@fdafd1a:23` "Its gate is" asks for. What the claim hides is
that its gate was **Sonnet**, where that row pairs a `standard` ticket with an
Opus gate. **A ticket filed and built in the same dispatch cannot be governed by
the rating it is given**, because the rating is written after the model is
chosen; the pairing rule is unenforceable on exactly the tickets a batch creates
for itself. Nothing went wrong here, and the general case is not safe: had the
build inherited Sonnet, the pair would have been Sonnet-on-Sonnet with a
`standard` label on it and nothing to catch it.

**what the skill got wrong** — seven, none fixed on this branch, which is scoped
to this file alone.

1. **The orchestrator relayed two claims it had not measured, and a builder
   caught both.** The first: that the Windows runner's workspace drive layout
   varies between runs, inferred from a single error string without reading the
   second run's checkout step. `repo-36`'s reviewer checked the two cited runs
   itself rather than accepting the correction — both log
   `Working directory is 'D:\a\tools\tools'`. The second: an instruction to run
   `node scripts/next-id.mjs downloader`, when the script takes a **prefix**.
   Re-run here, that is worse than an error — `node scripts/next-id.mjs
   downloader` prints `next free: downloader-1` and **exits 0**, a confident
   answer to a question nobody asked, and
   `scripts/next-id.mjs:36` "export const USAGE =" is the one line that says so.
   Both were one command
   from being right. **The `repo-36` builder refused to record the first**, on
   the reasoning that an unmeasured "flaky" line would sit in the one ticket
   whose whole subject is a claim that went unchecked for eleven runs — and the
   round it cost produced a strictly better test than the one it replaced, three
   real observed path pairs pulled out of the failing runs' own logs in place of
   one real and one invented. That is the fifth or sixth consecutive session in
   which a builder is the link that caught the orchestrator.
2. **"Assert the property, not the platform's spelling" was wrong advice, and
   the builder disproved it by building it.** With the surviving assertion
   already pinning `locateRecord`'s result to `path.relative`'s output, every
   further claim about that output's shape is a claim about `path.relative`. The
   proposed replacement was written and found unable to fail. The assertion was
   **deleted, not repaired**, and the reviewer reproduced the remaining one's
   falsifiability directly rather than agreeing. A test that cannot fail is the
   defect this page keeps naming; the new instance is that a *repair* can be one,
   and a repair arrives with a reason to trust it.
3. **Stale numbers were this batch's defect shape, and both sides had them.**
   Four instances, three re-verified here. The two relayed claims above. A
   builder reporting a suite pass as a `check` pass while `npm run check` was
   failing on two `no-shadow` errors — its own Log's correction says it: *"a
   suite passing is not `npm run check` passing"*. A gate record's `32 of these
   39 references`, caught by its own gate and re-run to `34 of 41`. And a
   `10 unanchored ... of 12` that **nobody caught until #190 re-ran it at the
   commit that wrote it** and got 11 of 13. None of these is bad judgement: every
   one is a real measurement carried forward instead of re-run. The reusable
   line is #190's — a record that counts its own references changes what it is
   counting, so run the command **after** writing the sentence that quotes it.
4. **The step-8 stall check earned itself, on a batch that had every reason to
   think it would not.** `git show` of the ticket on the branch, piped to
   `grep '^## Review'`, returned empty on `repo-36` while both agents considered
   the exchange closed and reported finished. Verified from the tree: at
   `a1c2a83`, the branch's first commit, that grep matches nothing. It is the
   same discriminator the entry two above records catching the same shape,
   holding unaltered for the second consecutive session —
   `.claude/skills/orchestrate-tickets/SKILL.md@fdafd1a:157` "Empty means the exchange is still open".
5. **A gate record's own citations are this batch's most-measured defect, and
   the one anchored round is the only round in which the mechanism caught
   anything.** #190 exists to record it. On `repo-36`'s record the checker
   reports `7 verified, 0 moved, 29 unanchored, 0 unresolvable — of 39` at
   **exit 0**, with two distinct failures sitting inside that clean result: a
   citation onto a blank line, and five coordinates that had drifted onto
   unrelated content when a later round edited the middle of the same test file.
   Running that record at its tip and again with `--rev` gives the **identical**
   answer for a set of coordinates that is right in one tree and wrong in the
   other. Round four was the first written with anchors, four of them quoting
   lines that contain double quotes — and the parser takes straight quotes only,
   so each anchor terminated at its escape. That run was `3 verified, 4 moved`,
   **exit 2**: the record's first non-zero exit in four rounds, failing loudly
   inside a single run, on the one round where the mechanism was switched on.
   **Operationally: an anchor fragment cannot contain a double quote at all** —
   pick a quote-free substring rather than escaping one. The coordinates were
   right both times; only the anchor text was malformed.
6. **A peer subagent overwrote another agent's scratch file** — `dl-46`'s
   content inside `repo-36`'s draft pull request body. The session scratchpad is
   shared and nothing partitions it by agent. Nothing was published and the
   builder rebuilt from the pull request's own body. **Supplied and not
   verifiable from a worktree**, which is exactly the property that makes it
   worth writing down: a scratch collision leaves no trace in git.
7. **`skipped` still reads as green, one session after this page recorded that
   it does — and this batch's own records-only branch is the third
   reproduction.** #190's CI run reads `conclusion: success` while
   `gh run view --json jobs` reads `test  skipped`, because the branch is
   markdown-only and `ci.yml`'s `changes` job gates the matrix off. The entry
   above already argued that a defect stopping at the history entry has not been
   fixed, and named the glance-reading row at
   `.claude/skills/orchestrate-tickets/SKILL.md@fdafd1a:261` "and a glance counts it as green"
   as still saying only `cancelled`. It still
   does. **The new datum is the third instance in three consecutive sessions**,
   which retires the reading that the first two were coincidence.

8. **The batch collided with a peer session on a ticket id, did not detect it
   until five pull requests were open, and paid a four-branch renumber for it.**
   While this batch ran, an unrelated session filed its own `repo-33` — ADR 004's
   compose rename — and **merged it first**, in #192. The batch's `repo-33` (the
   `citations.mjs` path fix, #186) was by then referenced across four unmerged
   branches. Two tickets on one id is not cosmetic: `node scripts/status.mjs
   --json` **exits 1**, and that exit code is the whole board gate CI runs, so
   #186 could not have merged as it stood. The merged ticket kept the id and the
   batch's was renumbered to `repo-36` on 2026-09-08, touching #186, #187, #190
   and #191 — one tracked file rename, a frontmatter id, two source comments,
   `ci.yml`'s explanatory comment, a Build section, and eleven references on this
   page. **Nothing was misused and `next-id.mjs` was not wrong.** It reads
   `origin/main` plus the diffs of *open* pull requests; the peer's ticket was in
   neither when this batch filed, so `next free: repo-33` was the correct answer
   to the question the script can ask. **The window between taking an id and
   opening the pull request that publishes it is invisible to every session
   inside it**, and nothing in the tooling closes it — the more parallel sessions,
   the likelier the collision, and this page's own premise is more of them. Two
   smaller costs worth recording: the renumber's first draft of a Log entry
   **minted a fresh unresolvable citation** by quoting four known-stale
   `file:line` pairs as prose, caught only by re-running `citations.mjs`; and
   `scripts/status.mjs`'s duplicate-id error prints
   `"undefined" is used by more than one ticket` **without naming the id**, so
   the clash had to be recovered by hand — cosmetic, real, observed and
   deliberately left unfixed as separate work. Note also that the pre-merge CI
   paragraph below pins #186 at `d0869fd`; the renumber moved that branch, so
   that reading is correct as taken and must be re-run against the new tip.

**Folding in unscoped work paid, and was still right to revert — both halves
belong in the record.** The owner's decision to fold the yt-dlp tier's mirror
grouping into `dl-45` is what surfaced two things nothing else would have: that
`dl-40`'s picker collapse shipped with its code and **no fixture exercising it**,
and a silent cross-language merge — reproduced, not hypothesised, against
`mapYtDlpInfo` with an untagged English/French audio pair whose technical
metadata coincided, which returned one variant with the French URL demoted into
`alternateUrls`. A host failure on the first would then have downloaded the other
track's content under the label the user picked. The gate carried that finding
rather than dropping it, the owner reversed the fold-in on it, and it is now
`dl-47` with its tradeoff left open. **The fold-in was not wasted and the revert
was not a retraction**: the work bought a defect found before a shared grouping
key reached `main`, which is precisely what it cost.

**Pre-merge CI, read by job rather than by run.** #186 is **fully green
including `test (windows-latest)`** at `d0869fd` — all four jobs `success` — and
it carries the fix for the `citations.test.ts` path-separator regression the
entry above recorded as an inherited red baseline. #188 and #189 are red at
their tips on **that same single assertion**, read from `--log-failed` rather
than from the run table: `expected '2 references in ..\..\..\..\..\RUNNER…' to
match`. So the batch built its own fix and its own siblings still inherit the
defect, because nothing merges without the owner. #187 is the deliberate case —
run conclusion `success` with `test (windows-latest, informational): failure`
inside it, which is option D working exactly as filed and **verified live**, not
reasoned.

**What went right, and is worth copying.**

- **Every agent's token figure arrived again**, 10 of 10, for the second
  consecutive session after 7 of 7 — and this time the account says what the
  earlier one could not: the figures are *last observed*, several agents kept
  working past their last report, and a turn ending in `SendMessage` delivers no
  usage block. That caveat is worth more than the total.
- **A gate that was refuted before its own record was committed.** `repo-31`'s
  reviewer anticipated that inserting its record would move a cited line and
  judged the shift harmless, on the reading that `citations.mjs` only turns
  non-zero on `unresolvable`. The builder measured instead: `EXIT` maps `moved`
  to bit 2, and the same file had already exited `2 — 8 moved` earlier on that
  very branch. The coordinate was re-resolved rather than left.
- **Two reviewers ran controls nobody asked for.** `repo-31`'s instrumented
  `killProcessTree` with a scratch-file write to prove the Windows branch is
  genuinely reached, then reverted and confirmed a clean `git status`; `dl-45`'s
  red-checked its own SSRF claim by stubbing the `alternateUrls` loop to an empty
  array and watching the new test fail, and red-checked the TLS claim by removing
  `TLS_VERIFICATION_FAILED` from `HOST_FAILURE_CODES` and watching two tests
  fail. Neither claim was accepted from a diff.
- **The records-only dispatch is cheap and it worked.** #190 cost 103,556
  tokens, the smallest agent in the batch after intake, and it is the only
  participant that re-derived the batch's citation figures from the branches
  instead of transcribing them — finding three places where the relay and the
  script disagreed, including the `10 of 12` nobody else caught. An
  evidence-recording dispatch with no gate is not a lesser dispatch; it was the
  one that measured.

## Fourteenth session — 2026-09-08

**Written by the orchestrator that ran the batch, not by a records-only
dispatch.** The errors below are mostly its own and the account is first-hand for
that reason. Every branch fact was re-read with `git show` against
`origin/main@b384033` rather than taken from an agent's report; where a figure is
an agent's and was not re-derived, it says so.

| Field | Value |
| --- | --- |
| `tickets` | **2** taken from `ready` to a gated branch — `repo-34` → #193, `repo-29` → #194 — plus **2 filed** from inside `repo-29`'s branch (`repo-37`, the 741-reference migration; `repo-38`, the `## Review` authorship conflict). Neither pull request merged during the session. **The intake that produced this board was the second one**: the first read a stale working tree and is recorded below |
| `agents` / `dispatches` | **8** agents — 2 seam-mappers, 4 builders (**2 killed within a minute**), 2 reviewers — / **24** dispatches-and-wakes (8 spawns, 16 `SendMessage`). The wake count is the honest half: 16 relays against 8 spawns, and the two reviewers were never messaged by the orchestrator at all after their first dispatch except to re-scope a gate |
| `builder rounds` | **~14**, of which **4 were the orchestrator's fault** — the highest fault share this page has recorded. Two whole builder dispatches were lost to a stale board; one round went to a relayed count the builder had already written correctly; and two rounds (a revert, then a restore) went to an option cost the orchestrator invented for a mechanism it had not read |
| `gates` | **6 completed passes over 2 reviewers** — 1 on `repo-34`, 5 on `repo-29` — and **5 returned findings**. Verdicts: `repo-34` FAIL at `cd00fb4` (regraded from a proposed CONCERNS after the reviewer corrected **its own** grading); `repo-29` CONCERNS ×4 then **PASS** at `345d639`. The `repo-29` reviewer then died to a session rate limit, after delivering its PASS |
| `wrong findings` | **3, none reached a commit, but one reached the user.** A gate's merge arithmetic was computed against `cd00fb4`, `repo-34`'s *first* commit rather than its tip — the builder caught it and the corrected finding was **worse** than the one filed. A gate's corpus sweep grepped for `UNRESOLVABLE` where `citations.mjs` prints that state as `FAIL`, silently undercounting two records — the builder caught that too. A builder's own `git grep` count of "two paths" was three by the time it committed, because the sentence recording it created the third match — the gate caught that one. **The first of the three was relayed to the user by the orchestrator before it was refuted** |
| `subagent tokens` | **1,891,252 across the 6 agents that reported, and 2 agents missing from it.** `repo-29` builder 666,943 · `repo-29` reviewer 572,706 · `repo-34` builder 338,693 · `repo-34` reviewer 177,234 · seam-mapper (second) 73,894 · seam-mapper (first, wasted) 61,782. The two killed builders **never reported** — an agent stopped with `TaskStop` delivers no usage block, so the cost of the stale-board dispatch is structurally unmeasurable and the total is a floor for that reason as well as the usual one. Split: builders 1,005,636 · gates 749,940 · intake 135,676, of which **61,782 (46% of intake) was spent mapping a board that did not exist** |
| `cost` | **≈ $34.42** at the 2026-09-02 rate of $0.0182/1k, recomputed from the total above. A floor over a floor: cache reads excluded, two agents absent, and the rate is six days old |

### What the skill got wrong

**1 · Step 1's intake is actively misleading in a shared checkout, and it cost
two builder dispatches.** The loop says `gh pr list` first, then
`npm run status -- --ready`, and to `git fetch` again immediately before
dispatching. All three were done. **None of them helps**, because `git fetch`
moves remote refs while `npm run status` computes the board from the **ticket
files in the working tree** — and in a checkout shared with live peer sessions
that tree sits wherever the last session left it. It was eight commits behind.
`--ready` returned `dl-45`, `dl-46` and `repo-29`; the first two had merged hours
earlier as `1f0f440` and `e26b393`, and `repo-31`, reported `needs-decision`, had
been answered and merged as `ff0c8fb`. Two Opus builders were dispatched against
finished work. Both independently spotted it inside a minute — one named the
cause exactly — and were killed.

The evidence was in the session's **first** command: the fetch printed
`f8340b1..b384033 main -> origin/main`. A derived view was believed over the raw
ref movement, and the failure is silent because the stale board is internally
consistent. **Step 1 should say to compare `git log --oneline -1 HEAD` against
`origin/main` and treat the board as unread when they differ**, and to read
ticket state with `git show origin/main:<path>` where they do. It should also say
not to refresh the shared checkout to fix this while `ListAgents` shows live
peers — the fix for one session's staleness is another session's reverting index.

**2 · There is no stopping rule for a ticket whose deliverable is a mechanism.**
_Do not cap the gate count_ is right for a defect hunt and wrong here.
`repo-29` shipped an enforcement gate, and each round found a smaller hole **in
the enforcement itself**: a grandfather list guarded only in the shrink
direction, then no distinctness check, then a bootstrap window reopened by
delete-and-re-add, then a rename bypass, then a self-invalidating count. Every one
was real, every one was reproduced by both sides, and every one was worth
closing. It still ran **seven builder rounds and five gates** on a branch that
had been landable since round two, and it is the single largest line in the
batch at 1.24 M tokens across its two agents. **A mechanism ticket hardens
without a natural floor**, because the mechanism is also the thing being
attacked. The stopping rule has to be named at dispatch — a severity floor, a
round budget, or "disclose below this bar" — and this skill offers none.

**3 · The relay table has no row for a mechanism the *orchestrator* invents.**
Its closest row covers relaying an option's stated mechanism out of a ticket. The
failure here was one layer up: putting an option to the owner and **describing a
cost for it that had never been measured**. The bootstrap closure was presented
as needing an explicit flag that would fail the branch and require a follow-up.
The builder had already built a closure that did neither, and reverted it rather
than keep a declined mechanism on the grounds its own version was cheaper —
writing the distinction into the Log with *"if that distinction changes the
answer it is the owner's to change"*. It did. The decision was re-put and
reversed, at the cost of a revert round and a restore round. **The rule to add:
an option you construct yourself is a claim you are making, and it needs a
measurement or an explicit "unverified" exactly as a relayed one does.** The
builder's refusal to quietly keep the better code is the only reason the error
surfaced at all.

**4 · Step 9 assumes the gate record gets committed, and nothing checks it.**
`repo-29` reached an **open pull request** carrying five gate rounds with **no
`## Review` section in its ticket at all**, because every report arrived as a
message rather than as a section. The skill already supplies the exact test — the
stalled-exchange row's `git show <branch>:<ticket-path>` piped to
`grep '^## Review'` — and the orchestrator never ran it, because that row frames
it as a test for a *stalled exchange* rather than as a per-branch precondition for
opening a pull request. It should be both. The builder raised the gap itself at PR
time; nothing in the loop would otherwise have caught it before merge.

**5 · Nothing covers a single agent lost permanently mid-batch.**
[worktree-hygiene.md](worktree-hygiene.md) handles _when every agent dies at
once_. Here one reviewer hit a session rate limit and terminated **after**
delivering its final PASS, leaving a live branch, an open pull request and no
reviewer. It happened to be harmless. Had it died one round earlier the branch
would have been mid-exchange with an unreachable counterparty, and the loop's
answer — findings go builder-to-reviewer directly — has no fallback for that.

### What went right, and is worth copying

- **Both reviewers corrected themselves against the rubric rather than defending
  a verdict.** `repo-34`'s was told its FAIL looked like CONCERNS by the severity
  table; it re-read `docs/01-TICKETS.md` itself, found the flaw was in **its own
  grading** — it had marked an acceptance line `unproven` when it had measured the
  claim and found it **false**, which the table grades `high` — and kept FAIL on a
  clause it could defend, saying it would rather lose the verdict than keep it on a
  bad footing. The orchestrator's rubric reading was the thing that was wrong.
- **Every finding on both sides was reproduced by the other before it was
  acted on**, in both directions, across all six gates. Two findings changed
  direction as a result and one got *worse* on correction.
- **A gate ran the control instead of reasoning about it, three times.** It
  verified a shallow-clone refusal against a real `git clone --depth 1`; it proved
  a glob-boundary canary by actually adding the file and watching it go red — and
  the builder noted the staging detail that makes that test meaningful, since the
  check reads the index and an unstaged sibling leaves it green; and it
  established that an evasion **required** editing the one constant meant to catch
  it, by testing the case without that edit, which turned a generous calibration
  into a measured one.
- **The full 59-entry audit was the right call and is the guarantee.** A gate
  enumerated every founding grandfather entry — 59 of 59 honest — precisely
  because that list is the one set the shipped mechanism can never check.

## Fifteenth session — 2026-09-09

**Written by a records-only dispatch, not by the orchestrator that ran the
batch or by any of its builders or reviewers.** The batch was orchestrated by
session `tools-52`, running Opus 5 (1M context); intake was 7 `ready` tickets,
of which `repo-33` and `repo-39` were held back for a batch of their own on
their own pages' request, leaving 4. The orchestrator's account arrived as one
dispatch and two follow-up corrections. **Everything checkable from a worktree
was re-read here rather than transcribed** — PR state and checks via `gh pr
list` and `gh pr checks`, each ticket's frontmatter and committed `## Review`
section on its own pushed branch via `git show <branch>:<path>`, and the
citation-collision claim via `git diff` against all three branches that touch
it. Subagent token figures, the exact round-by-round gate sequence behind two
tickets, and the release-workflow and Windows-push-guard findings below are the
orchestrator's own account and are marked as such; **this session's own token
cost is not observed from here and is excluded from every total below**, per
the orchestrator's own instruction to say which.

| Field | Value |
| --- | --- |
| `tickets` | **4** taken from `ready` to a gated branch — `repo-32` (`difficulty: hard`, #204), `repo-38` (`difficulty: standard`, #208), `repo-41` (no `difficulty` field, #207), `repo-42` (no `difficulty` field, #205) — plus **1 filed**, `repo-43` (`difficulty: mechanical`, `status: needs-decision`, #206), confirmed on each branch's own frontmatter rather than relayed. `repo-43` carries no gate by its own ticket's framing: a filed reproduction is its own verification. All five PRs open against `main`, `MERGEABLE`, checks green — reproduced per-PR, not read off one combined claim. **`MERGEABLE` is a fact about merge order, not about correctness, and this batch is a clean demonstration**: `repo-32`, `repo-38` and `repo-41` each independently repoint the same citation — `docs/work/repo-29-citations-carry-no-anchor.md`'s pointer at `docs/01-TICKETS.md`'s "So the reviewer reports and the builder writes" line, `:293` at the shared base `435ee35`. Confirmed by diff: `repo-38` and `repo-41` both move it to `:294` and agree with each other; `repo-32` moves it to `:349` and agrees with neither. GitHub computes `MERGEABLE` against `main` as it stands right now, one branch at a time, so it reports all three clean — whichever of `repo-32` and {`repo-38`, `repo-41`} lands second will conflict on that one line and must be re-resolved against the tree it lands in, not re-applied from either branch |
| `agents` / `dispatches` | **10** agents — 1 seam-mapper, 5 builders (`repo-32`, `repo-38`, `repo-41`, `repo-42`, `repo-43`), 4 reviewers (`repo-32`, `repo-38`, `repo-41`, `repo-42`) — / dispatches-and-wakes **not recorded** as a total; the orchestrator did not supply one and it is not recoverable from committed records for three of the four tickets — the tenth session's defect 7 (a committed record keeps the verdict and loses the pass structure) recurring, except on `repo-38`, whose Review section names all six round commits by sha directly |
| `builder rounds` | **at least 11** gate-facing rounds across the four gated tickets, counted here from each ticket's own committed Review/Log rather than relayed: `repo-32` 1 (low, fixed in the same commit as the gate record) · `repo-38` 6 (round 6 PASS at `2371b5b`; rounds 1-5 named by sha in the record itself) · `repo-41` 2 (FAIL at `f6df0f8`, fixed at `2ee209d`, then PASS) · `repo-42` **2, not the 3 relayed** — its committed record names "round 1" (the low finding raised) and "round-2" (the repair) only, and no third round is named anywhere on the branch; corrected here rather than transcribed. Two faults are independently confirmed as the orchestrator's own rather than taken on its word: `repo-32`'s builder was dispatched to write the `awaiting` parser while `Done when` 6's second sentence still required the owner's answer *first* — the ticket's own Log calls this "a real miss rather than folded into the answer" — and the branch closes `in-flight` rather than `done` after its first two commits, needing a third (`9c86c64`) once the owner answered on 2026-09-09; and `repo-38`'s round covering "correct dispatching.md's verbatim claim" (`0635578`) is a net **+23** lines (46 insertions, 23 deletions), matching the relayed claim that a "paragraph or two" ceiling given at dispatch did not survive contact with the actual correction. The seam-mapper's own misreading of `repo-32`'s decision as "answered 2026-09-08" is not separately confirmable from a worktree — no artifact records what the seam map said — and is taken on the orchestrator's account |
| `gates` | **11** completed passes across 4 reviewers — `repo-32` 1, `repo-38` 6, `repo-41` 2, `repo-42` 2 (corrected, see above) — all committed and read here. **All 4 returned findings** |
| `wrong findings` | **0 reached a commit as a refuted gate finding.** Two things nearer the eighth session's glance-reading family were each caught by their own author before commit rather than by the other side. `repo-42`'s reviewer told the record it had corrected an unverified claim of its own — that a citation had "moved twice" — after actually running the diff that showed it had not moved at all; reproduced here, `git diff 4f8f29b b4c695a -- scripts/test/hooks.test.ts` is empty, agreeing with the reviewer's own correction. `repo-38`'s reviewer's own draft report cited that ticket's own Log for four consecutive rounds, which would have gone `indistinct` under the citations gate on commit; per the orchestrator's relay it found this on itself while testing an unrelated scope question, and the committed round-6 section carries no self-citation at all — confirmed here, `grep -n 'repo-38-two-documents'` against the `## Review` block of that committed file returns nothing. The four intermediate drafts were never committed, so the defect itself is the orchestrator's relay and not independently re-run here |
| `subagent tokens` | **2,151,781** observed across the 10 agents — corrected mid-dispatch by the orchestrator from an initial 2,029,009, which had understated both `repo-38` agents. Per agent, last observed: seam-mapper 63,151 · builder `repo-32` 257,841 · reviewer `repo-32` 169,060 · builder `repo-38` 321,157 · reviewer `repo-38` 362,199 · builder `repo-41` 250,333 · reviewer `repo-41` 164,811 · builder `repo-42` 176,956 · reviewer `repo-42` 250,376 · builder `repo-43` 135,897. **This session's own tokens for writing this row are not included.** Split (arithmetic on the above, checked here): builders 1,142,184 (53.1%) · gates 946,446 (44.0%) · intake 63,151 (2.9%). `repo-38`'s pair alone is 683,356 — 31.8% of the batch — on what the orchestrator calls a two-sentence prose fix that grew a `high` nobody predicted, four of its six rounds spent on defects the repairs themselves introduced rather than on the original work. **Not the bill** — cache reads are the bulk and are not counted here |
| `cost` | **≈ $39.16** at the 2026-09-02 rate of $0.0182/1k, an arithmetic conversion of the observed total above and not independently billed; this session's own cost is excluded |

### What the skill got wrong

1. **The seam-mapper's decision reading was wrong on `repo-32`, and the
   skill's own grep fallback would not have caught it either** — this was a
   seam-map error, not a grep error. It reported `repo-32`'s `awaiting`
   sub-decision as "answered 2026-09-08". Confirmed false from the ticket's own
   words: `Done when` 6's second sentence — struck out but still legible on the
   branch as *"the meaning of `awaiting` … is put to the owner before the
   parser is written, and the answer recorded here"* — was live and unanswered
   at dispatch time, and the ticket's own Log calls the miss out directly:
   *"The dispatching intake was half right, and the half it had wrong is the
   live half."* The builder caught it because the dispatch marked the claim as
   an unverified relay rather than fact.
2. **The orchestrator dispatched `repo-32`'s builder to build while that
   ticket's `Done when` 6 required the owner's answer *before* the parser was
   written, and the skill has no step that checks a ticket's Build for an
   ordering constraint before dispatch.** It checks for open decisions, which
   is not the same thing — an open decision blocks a build outright; an
   ordering constraint permits the build but binds the sequence inside it.
   Confirmed from the ticket's own Log: *"The ordering this line asked for was
   not met and is not claimed … Recorded as a real miss rather than folded into
   the answer."* It was survivable only because the reading the owner
   eventually chose (A) was not the one that would have forced a rename (C) —
   had it been, the miss would have cost one. The branch closed `in-flight`
   rather than `done` on its first two commits as the direct, measured
   consequence, needing a third commit once the owner answered.
3. **The orchestrator gave `repo-38`'s builder a "paragraph or two" ceiling on
   the `dispatching.md` correction, invented without reading the section it
   bounded, and the real change was net +23 lines.** Measured directly:
   `0635578`, the commit titled "repair repo-29's moved citation and correct
   dispatching.md's verbatim claim," is 46 insertions and 23 deletions against
   that one file. A number was given where a condition — *stop if the
   historical measurements would have to change* — would have been the correct
   thing to hand a builder. The builder flagged the mismatch rather than
   proceeding silently, and its reasoning held.
4. **`gh ruleset view` is not on the deny list and `gh api` is**, confirmed at
   `.claude/settings.json:8 "Bash(gh api *)"` with no matching `gh ruleset`
   pattern anywhere in that file's `deny` array. Worth recording because
   `repo-42`'s rejected option (c) turned on re-reading a branch-protection
   ruleset, and the obvious route (`gh api`) is denied while a working one
   (`gh ruleset view`) exists and is easy to miss precisely because the denied
   one is the first thing that comes to mind.

### What the batch found, kept for the record rather than under a skill defect

- **The citation collision above was the batch's defining finding and it was
  not written into any ticket.** Three of the four branches independently broke
  the same coordinate — see the `tickets` row — because each edited
  `docs/01-TICKETS.md` above the line the record cites, and each branch's own
  gate found it separately rather than any of them seeing the other two.
  `npm run check` catches none of it; `citations-gate.mjs` is its own CI step.
  `repo-38`'s reviewer graded it `high` against the letter of the severity
  table, which would have said `med`, on the stated grounds that it fires
  unconditionally on push and none of that ticket's own acceptance lines could
  see it — and disclosed the stretch in the same sentence, which the record
  itself gives as the reason it was fixed rather than merged red.
- **A record cannot cite itself by coordinate under the citations gate, and the
  fix for mis-binding is not the fix for indistinctness.** Confirmed from both
  `repo-38`'s and `repo-42`'s own committed Review sections independently: a
  bare `:NNN` binds to whichever file was last named, so a full path repairs
  *that*; a full path pointed at the ticket's own file still occurs twice in
  the section that both cites and contains it, which is what a
  distinct-anchor check catches. `repo-42`'s reviewer measured its own first
  draft at "9 verified, 7 unanchored" with "4 anchor(s) not distinct" and
  repointed every self-citation to a named section instead of a coordinate.
  `repo-38`'s builder wrote the full-path repair first, its reviewer caught
  that it did not work for the self-citation case, and the builder reproduced
  the correction itself before committing round 6.
- **A `## Review` section is inserted above `## Log`, so its own height shifts
  every line beneath it, and a citation into a ticket's own file cannot be
  pre-resolved by either party while that section is still being drafted.**
  `repo-41` handled this best, in its own words: the reviewer "kept every
  coordinate pointed at other files," stated the four-state and fail-first
  claims in prose instead, and "dry-ran the checker against a spliced scratch
  copy rather than trusting care alone" — at the real insertion point, not a
  standalone scratch file — so the section needed no repair on landing. The
  builder then re-ran the same check against the real committed file after
  `oxfmt`, independently.
- **`repo-42`'s builder found a false *negative* in the code the ticket asked
  it to delete, where the ticket had only argued over-blocking.** Confirmed
  from the ticket's own text: the deleted bare-push guard reaches `main` only
  when `HEAD` reads `main` *and* `push.default` sends a bare push there; with
  `push.default = upstream` or a configured `remote.origin.push`, a bare push
  from a *feature* branch can reach `main` directly, and the guard "read [it]
  as safe and waved through." The ticket's own words: "It was wrong in both
  directions, and only the false-positive direction had ever been noticed."
  This makes the owner's choice to drop the mechanism entirely better founded
  than the ticket's own argument for it.
- **The `release` workflow was reportedly red on `main` during the batch, with
  concrete downstream damage to both release PRs.** This is the orchestrator's
  account and is not independently reproduced here — it describes a transient,
  time-boxed failure window that a later run superseded, and re-checking the
  workflow's current state would not confirm or refute what happened inside
  that window. Recorded as relayed, not as measured.
- **A worktree nested under the shared root's own path silently resolves an
  absolute `/workspaces/tools/...` read to the shared root's copy, with no
  error**, which is `repo-43`'s own subject — confirmed from its ticket text,
  filed `needs-decision` this batch rather than fixed, on the explicit
  instruction that no fix belongs on that branch. **This session hit the same
  family of guard once as well**, on a multi-branch `git show` loop — refused
  verbatim as *"a worktree-isolated agent's git operations must target its own
  worktree… Split it into plain, separate commands"* — and split into
  sequential single-branch calls rather than finding another spelling, and
  separately caught itself about to `Edit` the shared root's copy of this very
  file on the first attempt, which the tool itself refused. At least a ninth
  and tenth recorded instance of an agent not routing around either shape of
  this trap.
- **A record can be faithful and still be mislabelled verbatim, caught only by
  an after-the-fact audit.** Relayed by the orchestrator, not independently
  reproduced here since it concerns a PR comment's edit history rather than
  the tip: `repo-38`'s reviewer audited its own posted PR comment after #208
  was already open and found the header claimed "verbatim" for a report that
  was in fact a faithful third-person abridgement — instructions to the
  builder and the section block dropped, findings, verdict and measurements
  unaltered. The builder corrected the header to say exactly that rather than
  either leaving the mislabel or overstating the fix. The batch both settled,
  on `repo-38`'s own branch, that verbatim wins over completeness-of-receipt,
  and produced a live violation of that same rule in an artefact nothing
  checks — the **committed** `## Review` section is mechanically provable
  verbatim by diffing the two shas that bound it; the **PR comment** is not,
  because nothing resolves it against anything. `repo-42`'s reviewer did the
  equivalent check on its own PR comment and found it byte-identical, because
  that builder piped the committed section out rather than retyping it —
  piping beats transcribing, and only the former is checkable after the fact.

### What went right, and is worth copying

- **Every finding on every gated branch was reproduced before it was acted on,
  in both directions**, matching the batch's own framing: `repo-32`'s reviewer
  reproduced the builder's fail-first numbers by reverting the source in its
  own worktree; `repo-41`'s reviewer reran all seven of the builder's claimed
  mutations itself; `repo-42`'s builder and reviewer each drove the hook
  script directly rather than reasoning about `CLAUDE_PROJECT_DIR` from the
  header comment alone.
- **Two reviewers corrected themselves on their own artefacts rather than
  waiting to be caught** — `repo-42`'s "moved twice" retraction and `repo-38`'s
  self-citation fix at round 5 — which is the same shape as the fourteenth
  session's "both reviewers corrected themselves against the rubric," one
  level down: here it is a reviewer's own report format rather than its
  verdict.
- **An owner override on `repo-42` was better founded than the ticket it
  overrode**, because implementing the rejected-by-the-ticket option (c) is
  what surfaced the false negative above; declining to patch the false
  positive alone and instead deleting the whole mechanism closed both holes at
  once.
- **`repo-41`'s scratch-copy-at-the-real-insertion-point technique is now this
  page's clearest instance of Step 10's general shape** — the fact that a
  record about a not-yet-final file cannot be pre-verified against that file —
  solved by simulating the final file rather than by writing carefully.

## Sixteenth session — 2026-09-12

**Written by a records-only dispatch (Claude Sonnet 5, dispatched explicitly),
transcribing the orchestrating session's own account (Claude Opus 5) of a batch
it ran, with no `ticket-reviewer` gate on this branch — scoped to this file
alone.** Every branch fact below was re-read from `git show` and `gh pr view`
against the four pull requests' own remote refs (fetched as `pull/<n>/head`,
since three of the four head branches no longer exist under
`refs/heads` — only the pull request ref survives) rather than taken from the
account; token figures, the exact round-by-round exchange behind each gate, and
the "every pair differs" characterisation are the orchestrator's own and are
marked as such. Base `main` at `8d79d8e`, confirmed as the shared merge-base of
all four branches against `origin/main` — and, at the moment this row was
written, `origin/main` had already moved two commits past it
(`a7f2c86`, `d0727a2`), unrelated releases and a planner-deployment chore.

| Field | Value |
| --- | --- |
| `tickets` | **4** taken from `ready`/`needs-decision` to a gated branch: `repo-43` (`difficulty: mechanical`, #210), `repo-33` (`difficulty: hard`, #211), `repo-40` (`difficulty: standard`, three stacked pull requests — #213 `repo-40-trust-proxy-lift`, #214 `repo-40-trust-proxy-downloader` (draft), #215 `repo-40-trust-proxy-planner` (draft, carries the ticket file and its gate record) — ordered by the draft flag rather than by base branch, per each PR's own body), `repo-35` (no `difficulty` field at dispatch, `difficulty: hard` added on the branch once its decisions were answered, #216). All four frontmatter values confirmed on their own branch tips rather than relayed. Intake read **3** `ready` (`repo-33` and `repo-39`, both `hard`; `repo-40`, `standard` — `repo-39`'s rating confirmed on `main`), **2** `needs-decision` brought in by answering them (`repo-35`, `repo-43`), and **1** excluded because a peer session held it live (`repo-38`) — which had in fact already merged as `#208` by the time this row's own base commit was cut: `8d79d8e` **is** `#208`'s merge commit, so the exclusion and the peer's landing are the same event viewed from two sides, not a contradiction. `repo-39` was offered and not chosen. Zero file overlap across the four tickets' own diffs, measured with `git diff --name-only origin/main...<branch>` (3, 22, 4, 1 paths). All six pull requests' own CI checks read green, re-run here per PR rather than from one combined figure. **`MERGEABLE` does not hold for all six as of this row, and that is a property of right now rather than of the batch's own close**: `#211` (`repo-33`) reads `DIRTY` against the current `origin/main` tip, conflicting with `d0727a2`'s compose-file edits, which landed after this batch's branches were cut; the other five still read `CLEAN`. **Two have since merged** — `#210` and `#216`, while this row was itself being written — and `#211` went `CONFLICTING` and was resolved; see item 8 |
| `agents` / `dispatches` | **10** agents — 1 seam-mapper, 4 builders (`repo-43`, `repo-33`, `repo-40`, `repo-35`), 4 reviewers (one per ticket), 1 records-only builder (this row, resumed across the conflict episode in item 8) — / dispatches-and-wakes **not recorded**, and not supplied by the account either |
| `builder rounds` | **Not given as a total, and this session's own self-attribution is unusually total: the first six items below are the orchestrator's own by its own account, not a builder's or a reviewer's — item 7 is this row's own finding, made while checking the orchestrator's "every pair differs" claim; item 8 was recorded at the orchestrator's direction as it happened mid-draft; item 9 was raised by the owner and checked by the orchestrator.** At least one extra round is independently visible on each of four branches — `repo-43`'s gate-record citation repair (`1548f21`, after `6c76694`'s record broke `--require-anchors`), `repo-40`'s twice-repaired gate record (`7b2596b` rewriting unanchorable coordinates to prose, after `4e030ff`'s FAIL and the owner's reversal at `a5d38be`), `repo-33`'s CONCERNS record closed by two further Log entries rather than by a rewritten verdict (`6fcf4be`, `c6c838b`), and `repo-35`'s two reversed premises (item 3 below) plus its stop-short after a gate record made `npm test` red (item 6 below, resolved by moving the section out from under `## Review` entirely) |
| `gates` | **4 reviewers, all returned findings**, though not the same kind: `repo-43` PASS with **0 defects, 2 observations**, both resolved as not-carried; `repo-33` **CONCERNS**, 1 med + 1 low, both closed by later Log entries with the verdict left exactly as raised (*"a verdict that gets rewritten once the evidence arrives is not a record"*, in the record's own words); `repo-40` **PASS after three rounds** (FAIL → owner decision → PASS), 2 lows repaired in round 1, 1 acceptance-line high resolved by an owner override in round 2, 1 further low added in round 3; `repo-35`'s is not a `## Review` at all but **`## The gate on this filing`**, the carve-out `docs/01-TICKETS.md:281` "A gate on a pull request that only" names for a branch that only files a ticket — 5 findings raised across its own sequence of re-checks, all 5 carried, 0 dropped |
| `wrong findings` | **0 gate findings were refuted this batch, and the schema's row does not fit what happened instead — every wrong claim this session ran orchestrator → builder, not builder/reviewer → orchestrator.** Two are reasoning errors relayed as premises and reversed by measurement (item 3), one is a measurement relayed inside a question's premise and later reversed by a bigger measurement (item 2), one is a premise a question was built on that a downstream gate then dissolved (item 4), one is a base-branch omission (item 5), and one is a ship-authority gap that a builder's own stop-short caught before anything shipped red (item 6) |
| `subagent tokens` | **2,369,959** across the 10 agents that reported, none missing, summed here and matching the account exactly — **corrected from an earlier 2,028,628, which was a true floor when first recorded but predates both the conflict-episode rounds in item 8 and this row's own agent**: seam-mapper 79,318 · `repo-33` builder 342,100 · `repo-40` builder 304,858 · `repo-43` builder 115,620 · `repo-35` builder 381,971 · `repo-43` gate 123,963 · `repo-40` gate 193,590 · `repo-33` gate 241,812 · `repo-35` gate 335,198 · history builder (this row) 251,529. Split: builders 1,396,078 (**58.9%**) · gates 894,563 (**37.8%**) · intake 79,318 (**3.3%**). **Not the bill** — cache reads are the bulk and are not counted here, and several agents' final turns ended in a `SendMessage` that delivered no usage block, so the total remains a floor — and this row's own 251,529 is itself last-observed-before-this-correction, so it undercounts the round that produced this very sentence |
| `cost` | **≈ $43.13** at the 2026-09-02 rate of $0.0182/1k, an arithmetic conversion of the total above and not independently billed — a floor for the same reason the row above is one |

**Two things are true about this batch's model pairings, and both are kept
rather than one standing as a correction of the other.** First, **within every
one of the four tickets, the model that gated is not the model that built** —
`repo-43` Haiku→Sonnet, `repo-40` Sonnet→Opus, `repo-33` Opus→Sonnet, `repo-35`
Opus→Sonnet, 4 of 4, confirmed on each PR's own body (`#210`, `#213`/`#214`,
`#211`, `#216`). That is the property the skill's model-pairing rule exists to
guarantee: the checked thing does not pick its checker, and it held on every
branch. Second, **two of the four pairings are identical to each other** —
`repo-33` (`hard`) and `repo-35` (unrated) both landed Opus→Sonnet, also
confirmed on their own bodies: `#211`'s "Built by **Claude Opus 5**. Gated by
**Claude Sonnet**" and `#216`'s "Built by Claude Opus 5. Gated by Claude
Sonnet." Nothing was mis-dispatched — Sonnet gating Opus on both is the
correct direction for each ticket taken alone — but the two rows collapse onto
one pairing, and why they do is its own finding, at item 7 below.

### What the skill got wrong

Nine items. The first six are the orchestrator's own by its own account,
transcribed here against what each branch's own commits and Log entries show;
the seventh was found in transcription rather than supplied; the eighth
happened while this row was itself being drafted and is confirmed on
`repo-33`'s own branch below rather than taken on the relay alone; the ninth
was raised by the owner and checked here against `release-please-config.json`
and the ticket's own text rather than accepted.

1. **The gate record was the thing that broke, in three of four tickets — never
   the code — and the mechanism is that a `## Review` section is not enforced
   by the citations gate until it is committed.** `repo-43`'s record broke
   `--require-anchors` the moment it landed, repaired one commit later at
   `1548f21` ("fix self-referential citations in repo-43 gate record"), right
   after `6c76694` added it. `repo-40`'s record was rejected on citation grounds
   once, confirmed at `7b2596b`: two sha-prefixed coordinates into `8d79d8e`
   "cannot carry a working anchor: the planner's copy is already deleted on this
   branch (would resolve as 'moved'), and the downloader's goes stale the moment
   its own branch merges," rewritten as prose instead. `repo-33`'s reviewer hit
   the same shape and caught it before it ever reached a commit, which is why
   it is not in the committed text and is recorded here as supplied by the
   orchestrator rather than found in the tree: it wrote a bare `docs/02-DEPLOYMENT.md:516`
   into its Review draft, intending it against `origin/main`, but `citations.mjs`
   resolves a bare `file:line` against the **working tree**, not the ref named
   in prose — and at the tip, the migration section had grown and pushed that
   content down, so line 516 was blank. The builder measured both forms: as
   written, `exit 4` and unanchored; rewritten as prose naming the section
   instead of the line, `exit 0`. The corrected form is what landed. This is an
   instance of the round-trip working, not a gap in what either agent checked —
   neither "confirmed" nor "unconfirmed" fits it. (A different, also-real
   finding surfaced in the same ticket — demonstrating a compose-file breakage
   from inside a nested worktree versus outside one — and belongs with the
   `repo-43` path-shadowing thread rather than here.)
   Every exit-0 either agent takes before a record is committed is honest and
   says nothing about what committing it will do.
2. **A measurement relayed inside a question's premise reversed the question's
   answer, and the reversal is on the branch.** `repo-35`'s Build section
   records the correction directly: the 2026-09-08 note's "10 declaration lines
   across 5 files, only `history.md`'s two production" is wrong on the
   corrected count — **12 declaration lines naming 26 locations across 7
   files, suppressing 31 citations**, of which **21 of the 26 declared
   locations are not expressible as a rev pin**. The owner's "the evidence
   marker goes" answer was given against the wrong number.
3. **The orchestrator's own reasoning, sent down as a premise, was wrong twice,
   and both reversals are on the branch.** `repo-35`'s Log names both: the
   claim that dedupe-by-line cannot rescue a self-citation missed the case
   where the citation points at its **own** line — `[224, 224, 235]` collapses
   to 1 distinct line in that shape and would start passing, against 2 distinct
   lines for a citation pointing at a different line of the same file, which
   still fails — and "the three wording sites" was six, the branch finding a
   sixth (`scripts/citations.mjs@64edce2:595 "Every line an anchor's text starts on, in a file."`) that appeared in neither relayed list. Both reversals made
   `Done when` items and the Order section's dependency between parts 8 and 9
   load-bearing in a way the original premise did not predict.
4. **A question was answered before a downstream agent dissolved its premise,
   and the branch shows the re-ask rather than a silent substitution.**
   `repo-35`'s reviewer found `docs/01-TICKETS.md:281 "A gate on a pull request that only"` — the carve-out for a branch that only files a ticket, with
   `dl-29` named as the existing precedent — after the owner had already
   answered a differently-framed question about the `ready`-plus-gate-record
   conflict. The ticket now carries the gate under `## The gate on this filing`
   rather than `## Review`, and `status: ready` holds with CI green:
   "under `## Review` the suite is `1 failed | 312 passed`... under this
   heading it is `313 passed`", both measured on the branch.
5. **A base-branch check that is in `CLAUDE.md` and not in this skill caught a
   real defect.** `#214` and `#215` were opened against the lift branch;
   `CLAUDE.md:188 "Check the base branch too"` warns that a pull request opened against another feature
   branch disappears with it while its own page still says merged. Both are
   now based on `main` — confirmed on each PR's current `baseRefName` — with
   ordering enforced by the draft flag rather than by the base, stated in
   `#214`'s own body: "Ordering is enforced by the draft flag, not by the base
   branch."
6. **Conditional ship authority silently assumed the gates would still pass
   after the gate record itself was committed, and did not this time.**
   `repo-35`'s branch carries no `## Review` section and `status: ready`, not
   `done` — confirmed on the tip. Item 4's carve-out is the resolution: the
   record that would have tripped `reviewedButReady` was moved out from under
   `## Review` rather than shipped red or left silently mislabelled.
7. **`builder.md`'s model-pairing table gives `standard` an explicit gate
   override and gives `hard` and `absent` none, so two different difficulty
   classes collapse onto one pairing under an Opus orchestrator — found while
   checking the account's "every pair differs," not named by it.**
   `.claude/agents/builder.md@fdafd1a:23 "Its gate is"` states `standard`'s Sonnet
   builder is gated by Opus specifically because the default would gate a
   Sonnet build with Sonnet; `:25 "a contract, a security claim, a seam with reach"`
   pins `hard`'s builder to Opus but states no gate override, and an unrated
   ticket inherits the orchestrator's own model with the same silence. Both
   then fall through to `ticket-reviewer.md`'s pinned Sonnet default. This
   batch is the collision: `repo-33` (`hard`) and `repo-35` (unrated) were
   both built on Opus because the orchestrator itself was Opus, and both were
   gated Sonnet by the same unstated default rather than by a rule that
   named the pairing. The table is written as four distinct rows and behaves
   as three whenever the orchestrator runs Opus.
8. **The skill's loop has no step for a batch whose branches are still open
   when someone else's work lands, and this batch hit it while this row was
   itself being written.** After the row above was first drafted, the owner
   merged `#210` and `#216`; `main` moved five commits past this batch's own
   base, including a peer session's `pl-2` (`d0727a2`, `#212`) that nobody in
   this batch knew was coming; and `repo-33` (`#211`) went `CONFLICTING`. The
   loop ends at "open the PR" and says nothing about a branch left open while
   the board keeps moving under it. Confirmed here on `repo-33`'s own branch
   after the fact (fetched as `pull/211/head`), not taken on the relay alone.

   **The mechanism, and it is not a pick-a-side.** Both `repo-33` and `pl-2`
   had independently repointed the *same two citations* in
   `pl-38-the-planner-limiter-shares-one-bucket.md`, each correct against its
   own tree:

   | anchor in `docs/02-DEPLOYMENT.md` | `pl-2` wrote | `repo-33` wrote | true in the merged tree |
   | --- | --- | --- | --- |
   | "Rate limiting is per-client the same way the downloader" | line 657 | line 833 | **line 889** |
   | "Rate limits silently" | line 273 | line 231 | **line 283** |

   Four numbers, and after the merge none of them was right — re-confirmed
   directly against the merged tip (not against this row's own tree, which
   never carries `repo-33`'s rename): its line 889 reads "Rate limiting is
   per-client the same way the downloader's is" and its line 283 reads "Rate
   limits silently stop working." A citation repair is only valid against the
   tree it was measured in, so a merge conflict between two citation repairs
   that were each correct when written cannot be resolved by picking a side
   or keeping both — it has to be re-measured, which is what happened: run
   against the merged file, both corrected to line 889 and line 283.

   **The quieter half, and the better lesson: a clean auto-merge is not the
   same as a correct one, and the difference is invisible to a diff.**
   `docs/02-DEPLOYMENT.md` merged with no conflict marker at all, and it
   holds `repo-33`'s own five-step volume-migration repair (the med finding
   from the `gates` row above). It was in fact correct — `pl-2`'s new section
   landed between migration steps 1 and 2, the seven-step procedure stayed
   contiguous with its two-tool handling intact throughout, and the four
   `compose.yaml` mentions remaining in the file are all deliberate (two
   historical prose, two naming the old files in a pre-pull command) — but
   `git diff` showed nothing because nothing conflicted. It had to be read
   end to end as an operator would, not diffed, to know that it was correct.

   **The thing nobody anticipated: a test from a branch that never saw this
   one, written to survive it anyway.** `pl-2` shipped
   `scripts/test/cloudflare-setup.test.ts`, which globs the compose fragments
   at the repo root and finds them *by the service each one defines* rather
   than by filename, precisely because it anticipated a rename it had no
   visibility into. It passed on the merged tree, 15 of 15. The builder read
   its anti-vacuity guards rather than demonstrating them red, declining to
   mutate a shared file mid-merge, and said so rather than gloss over it; the
   reviewer then ran the mutation itself — renaming `compose.downloader.yaml`
   away and getting `no compose fragment defines downloader with ports:
   expected [] to not have a length of +0`, reverted clean, `git status
   --porcelain` empty, 15/15 restored. Two agents did two different halves of
   the same check, and the record names which did which.

   **`Done when` #3 was re-proved rather than carried forward, and the
   re-proof caught a gap a path checklist had missed.** Its original evidence
   was a CI run on `6fcf4be`; after the merge, the builder declined to carry
   that verdict forward and instead re-ran the `docker` job directly on the
   merge commit `b3b3786` — run `34718932111`, read at job and step level,
   `conclusion success`. That mattered for a specific reason: a proposed
   shortcut argued the merge touched none of the image build's inputs, naming
   the root `package.json` and lockfile, but the merge *does* touch
   `tools/downloader/api/package.json` (release-please's `0.3.0` → `0.4.0`).
   The version bump built green on `main` at `a7f2c86` and the rename built
   green on `6fcf4be`, but no run had covered both together until this one.
   **The generalisable rule: a check-list of paths has to name a dependency
   closure, not files chosen by hand.**
9. **`repo-40` was split into three pull requests on its own ticket's
   instruction, and the split's rationale did not hold — raised by the owner
   and checked here against `release-please-config.json` and the ticket's own
   text rather than accepted.** The Traps section states it as a rule:
   `docs/work/repo-40-trust-proxy-is-a-second-consumer-with-nowhere-to-land.md:87 "This is repo-wide work that touches two tools' files, and it is not one"`
   — "pull request… Landing all three in one branch produces the exact
   squash-merge shape the root `CLAUDE.md` names as the tell that it should
   have been more than one PR — split it, in whatever order keeps each PR
   green on its own." Confirmed against `CLAUDE.md:209 "one sentence written for one of them, which is the tell that it should have been"`.
   Neither builder nor reviewer is at fault for following a brief; nobody
   checked whether the rule's premise applied. Read directly:
   `release-please-config.json` names exactly two components,
   `tools/downloader` and `tools/planner` — `packages/core` is not one — and
   `refactor` (the type on two of the three sub-branches) carries
   `"hidden": true`. A single branch spanning all three paths would have
   produced no changelog line for either tool and no release; the failure the
   split exists to prevent was not available to occur.

   **Measured cost:** two extra pull requests (`#213` plus `#214`, `#215`), a
   draft-flag sequencing to hold merge order, three sets of CI runs, and — the
   mechanism, recurring three times and made visible here for the first
   time — repeated merge conflicts on the one shared ticket file. **Under
   squash-merge, a stacked branch conflicts with `main` after its own base
   lands even though it carries the identical commits, because the squash
   produces a new commit that is not an ancestor of the stack.** Confirmed on
   the tree: `#214` merged one such reconciliation (`1b7a923`, after `#213`'s
   squash `17966ac`); `#215` merged one (`7a12272`, also after `#213`'s
   squash) and, as of this writing, reads `DIRTY`/`CONFLICTING` against `main`
   again — a second reconciliation pending after `#214`'s own squash. All
   three, completed or pending, land on the shared ticket-file Log rather
   than on source. Retargeting the stack from base branches to `main` (item
   5) is orthogonal to this — that addressed `CLAUDE.md:188`'s
   disappearing-PR hazard and neither caused nor avoided these conflicts.

   **The generalisable rule:** the Traps rule is right for a `fix` or `feat`
   spanning two tools, which genuinely writes one sentence into two
   changelogs — but it is stated unconditionally, when the type decides
   whether there is a changelog at all, the same point `CLAUDE.md` already
   makes about `docs` being hidden. Read the commit type and the component
   list before paying for a split; if nothing reaches a changelog, the split
   buys only independent revertability, and that has to be worth the conflict
   rounds on its own. The same correction is being appended to `repo-40`'s own
   ticket Log, as a correction to the brief rather than an edit to its Traps
   section.

### What went right, and is worth copying

- **Every gate ran its own reproductions rather than accepting the builder's.**
  `repo-40`'s reviewer proved behaviour identity twice — an md5 match across all
  three copies of `trustProxy()` plus a 42-input runtime differential against
  both tools' built output, `cases=42 mismatches=0` — and mutation-tested the
  new parser suite, catching 8 of 10 mutations on the first pass and repairing
  the test for the other 2, confirmed in the record's own words: "Eight other
  mutations... were caught by the suite as first written."
- **`repo-35`'s gate and builder measured the same blocking figure by
  deliberately different routes and cross-checked position for position.** The
  ticket's own Log: "measured... by the gate first, then independently here
  through a different route, importing the checker's own `extractCitations` and
  `checkCitations` rather than parsing CLI output per file" — and it named the
  limit of that method rather than resting on the agreement: two faithful
  replicas of one algorithm inherit its edge cases identically, so agreement
  between them proves the replicas match and nothing about the algorithm.
- **`scripts/citations.mjs@64edce2:1424` "anchor starts on ${r.occurrences} lines of"
  prints a match count beside the word "lines" and misled the builder into
  recording a number that did not reproduce — and that miswording is the
  reproduction that justified `repo-35`'s part 9,** rather than a defect
  quietly patched around: "Filed as Build part 9 rather than silently
  corrected," in the gate's own words.
- **`repo-33`'s builder found a real answer to `records.md`'s stated regress —
  a record cannot report its own CI status, because writing the report creates
  a new tip nothing has measured — without contradicting the page: it split
  where the two facts live rather than pretending the regress does not apply.**
  After item 8's merge, both relevant trees now have job-level `docker`
  evidence — merge commit `b3b3786` (run `34718932111`) and tip `783ab77` (run
  `34719203897`), steps 5 and 6 `success` on both, all four workflows green on
  the tip, confirmed here on the PR's own
  [comment thread](https://github.com/brunolabbe/tools/pull/211#issuecomment-5648748786).
  **It deliberately did not commit the tip result** — doing so would have
  created a new tip whose own CI was unmeasured, pushing the same caveat one
  commit further out, which is the regress restated rather than solved. The
  ticket's Log keeps the claim that stays true (the gate was re-proved on the
  merge commit); the PR thread holds the claim that decays (the tip is green
  right now) precisely because a PR comment changes no tree. That split was the
  builder's own call, not the orchestrator's. Paired with it, and by the same
  builder in the same round: it read the tip's own CI runs after being told
  they were unnecessary because the intervening commits were documentation-only
  — "documentation-only" is a claim about a diff, not a measurement of a tree,
  and the identical shortcut had already missed
  `tools/downloader/api/package.json` once earlier in this round. One
  principle, applied twice, one read each time it was invoked.


## Seventeenth session — 2026-09-12/13

**Written by the orchestrating session itself (Claude Opus 5), with no gate on
this branch, scoped to this file alone.** Every branch fact below was re-read
with `git show` and `gh pr view` against the two pull requests' remote heads,
not taken from any agent's report. Token figures are each agent's
last-observed `subagent_tokens`, the only figures this page has ever counted.
Base `main` at `64edce2` for both branches, unmoved from intake to the last
look.

| Field | Value |
| --- | --- |
| `tickets` | **2**, both `difficulty: hard`: `repo-35` (the whole Build, parts 0–9, #219 at `aa8d19c`) and a **slice** of `repo-39` (the downloader records less `dl-44`, #220 at `7b5020b`). The slice closed `repo-39` as `done` and filed the remainder as **`repo-44`**, whose id was assigned by the orchestrator from `node scripts/next-id.mjs repo`, carrying `depends_on: [repo-35]` on the owner's answer. Intake found **2** `ready`, **0** `needs-decision`, no open pull requests, and no live peer session. The seam map put one file under both tickets (`scripts/citations-gate.mjs`, code on one side, `GRANDFATHERED` lines on the other); the owned records `dl-44`, `repo-21` and `repo-25` were excluded from the slice by measurement. **The one real collision was invisible to the map**: both branches edit the citations that `repo-37`'s enforced gate record makes *into* the `GRANDFATHERED` list, so the two PRs conflict on one line of `repo-37`. `git merge-tree` was run by the repo-35 gate, and the resolution (keep repo-35's pin) was proven green on a scratch merge: gate exit 0, `npm run check` exit 0, 346/346 |
| `agents` / `dispatches` | **5** agents: 1 seam-mapper, 2 builders, 2 reviewers. **5** spawns, plus **4** orchestrator wakes observed as `Resuming` in a `SendMessage` result: the repo-39 gate after a session-limit kill, the same gate on a send-back, the repo-39 builder on a report-format question, and the repo-35 builder on a direct ship grant. Agent-to-agent wakes are not observable from here and are **not recorded** |
| `builder rounds` | **7** invocations over 2 builders. `repo-35`: build → commit the review record and decline the PR → open the PR. `repo-39`: build → apply two gate findings and hold → woken by a question → commit the amended record and open the PR. **2 were the orchestrator's fault**: repo-35's third round, because ship authority was routed through the reviewer (item 1), and repo-39's third, a wake nobody needed (item 4). The first build round was complete on both branches |
| `gates` | **2** reviewers, **both returned findings**. `repo-35`: **PASS**, 1 low carried (no test for a pinned self-citation), and 0 med or high, on seven attacks including a fresh `git clone` from `origin` and a base-vs-tip parse diff over 171 files. `repo-39`: **CONCERNS → PASS** over three passes. The first was killed by an HTTP 429 session limit and resumed by message. The second returned 2 findings (repo-44's pin-reachability guidance; an unrecorded widened-count figure), both repaired at `49ffecb`, and was **sent back by the orchestrator** for sampling a check the prompt specified as an enumeration (item 2). The third enumerated 203 citation comparisons, 161 matched automatically and 42 read by hand, with 0 undisclosed wrong repoints |
| `wrong findings` | **0 gate findings refuted.** The widened repo count the builder reported as 1,010 reproduced as 1,013, and the reviewer explained all three deltas; a figure that did not reproduce rather than a finding. The wrong claims this session were the **orchestrator's own measurements** (item 6), and none reached a commit |
| `subagent tokens` | **1,831,087** last-observed, all 5 agents reporting: seam-mapper 82,664 · repo-35 builder 400,121 · repo-39 builder 566,211 · repo-35 gate 271,653 · repo-39 gate 510,438. Split: builders 966,332 (**52.8%**) · gates 782,091 (**42.7%**) · intake 82,664 (**4.5%**). **The repo-35 builder reported 516,783 at build completion and 400,121 after its resume**, so its last-observed figure is lower than an earlier one (item 3); with the higher figure the total is 1,947,749. The repo-39 builder's final report after opening #220 never reached the orchestrator as a notification, so its figure predates that round. **A floor, and not the bill**: cache reads are uncounted |
| `cost` | **≈ $33.33** (≈ $35.45 on the higher total) at the 2026-09-02 rate of $0.0182/1k. An arithmetic conversion, not billed |

**Model pairings: both tickets were `hard`, so both were Opus-built and
Sonnet-gated**, dispatched as `opus` and `sonnet` and named that way in both PR
bodies. Within each ticket the checker differs from the checked. Across the
batch the two pairings are identical, which is the sixteenth session's item 7
arriving again: every `hard` ticket lands on one pairing.

**Four decisions went to the owner, in three questions:**
- **batch:** the owner chose a larger repo-39 slice beside repo-35, **overriding the orchestrator's recommendation** of the 83-reference planner slice;
- **whether the citations gate widens to whole records:** "not yet, repoint what you touch", the recommendation, taken on a measured 614 → 2,068 failing references with the Review scope reproducing 614 as its control;
- **which slice:** the downloader, the recommendation, on a measured 0 of 296 references targeting `scripts/`, against 95 of 217 in the repo-* slice;
- **repo-44's `depends_on`:** `[repo-35]`, the recommendation.

### What the skill got wrong

Ten items. Items 1, 2, 4, 5 and 6 are the orchestrator's own. Items 7–9 came
from the three agents asked at the end of their runs. The seam-mapper and the
repo-35 gate were never asked, because the question was not put at dispatch as
the schema says, and they had finished before it was put.

1. **Ship authority relayed through the reviewer is not ship authority, and
   both builders said so.** The gate prompts told each reviewer to paste an
   authority paragraph into its final message to the builder, so that the
   builder could open the PR without a round back to the orchestrator.
   `builder.md` grants the PR only when the builder's *own* prompt gives
   explicit authority. The repo-35 builder committed the record and declined
   the PR, and its reviewer agreed. That cost a resume. The repo-39 builder
   held until a direct message from the orchestrator arrived. **Grant ship
   authority in the builder's dispatch, or in a direct message from the
   orchestrator; never route it through the reviewer.** The routing also
   carried an owner answer (`depends_on`) by the same hop, which the builder
   rightly would not act on alone either.
2. **A positive control can satisfy the prompt's letter and miss the failure it
   exists to catch.** The first repo-39 gate "proved its harness" by moving a
   citation out of range and watching `citations-gate` go red. The prohibited
   failure is a repoint that **resolves** to today's content and no longer
   supports the claim, and the gate passes that by construction. The same pass
   substituted hand-reading a sample for the enumeration the prompt specified,
   without saying so. The send-back asked for a control that plants the
   prohibited failure itself. That control first exposed **a bug in the
   reviewer's own comparison tool**, a self-referential match that approved
   any citation anchored on its enclosing test's name. Only then did the
   203-comparison enumeration mean anything. **A gate prompt should say which
   failure the control must plant, not only that one is required.** The
   reviewer's own account of why it sampled: the enumeration hit a pairing
   problem on its first record, it had five more attacks queued, and sandbox
   refusals (item 7) had eaten its turns. It did not surface the trade.
3. **`subagent_tokens` is not always cumulative.** `SKILL.md` says a resume is
   folded into the figure. The repo-35 builder reported 516,783, was resumed,
   and reported 400,121. One counterexample; the mechanism is not known here.
   Until it is, record every observed figure per agent, not only the last.
4. **"No completion notification since it was woken" is not "still
   running".** The orchestrator sent three agents a report-format question
   believing all three were mid-run. Two messages queued; the repo-39 builder's
   came back `Resuming`, because it had ended its turn waiting for the amended
   record. **One `ListAgents` first.** The measured price was +25,443
   subagent tokens (540,768 → 566,211), far below the 100–330 k resume figure
   `concurrency.md` carries. That is a second counterexample to one of the
   skill's constants, with the same caveat that subagent tokens exclude cache
   reads.
5. **Nothing makes anyone check a PR's title type against the paths it
   touches.** Both tickets were `repo`-scoped. repo-35's branch touches one
   `tools/downloader/docs/work/` record, and repo-39's touches 19 downloader
   records and one planner record. `release-please-config.json` has no
   `exclude-paths`, so a `feat` or `fix` title would have cut a changelog entry
   and a version in each tool for markdown edits. The repo-35 builder proposed
   `feat(repo):`, and the orchestrator caught it only at ship time. Both PRs
   landed as `chore(repo):`, following repo-29's #194. **Step 9 should have
   the orchestrator read `git diff --name-only` for `tools/` paths before
   granting a title.**
6. **The orchestrator's own harness could not fail, twice, and the rule that
   catches it was on the page both times.** Counting `indistinct` anchors
   through `failures[].state` returns nothing. An indistinct anchor keeps
   `state: "verified"` and is tallied only in `counts.indistinct`.
   - **First use:** it produced an empty column in a measurement put before
     the owner. It was withdrawn there as "the wrong state name", not
     investigated.
   - **Second use:** it returned 0 at base and 0 at tip, over the 21 records
     repo-39 changed, for a Done-when check. The positive control over
     `repo-31` and `dl-44`, which the gate says hold 3 each, returned 0 and
     0.
   - **After the fix:** the control read 3 and 3 at both revs, and the 21
     records read 0 and 0 again, now as evidence.

   The class is `defect-shapes.md`'s *harness that cannot fail*. Applying it on
   the first use would have cost one command.
7. **Subagent worktree sandboxes refuse ordinary shell shapes, and nothing an
   agent reads says so.** All three agents asked hit "too complex to verify
   that it stays inside the worktree". The refused shapes were:
   - a git command followed by `echo $?`;
   - a heredoc commit message, or a heredoc script body;
   - a variable holding a path;
   - a `for` loop over `sed -n`;
   - an `awk` program containing `>>`;
   - `python3`;
   - one heredoc that passed and failed on identical retries.

   The repo's own "read the exit code unpiped, redirected to a file" rule steers
   agents toward exactly these shapes. Workarounds that held: one plain command
   per call, `git commit -F <file>`, literal paths, `printf` over `cat <<EOF`,
   and `awk -v`.
8. **The test project that covers `scripts/` is named `repo`**, and neither
   `CLAUDE.md`'s Testing section nor `builder.md` names it. The orchestrator's
   own dispatch said "the `scripts` project", a spelling repo-35's ticket
   already records failing with "No projects matched the filter". Both
   builders found `repo` by reading `vitest.config.ts`.
9. **`builder.md`'s setup runs the farm script by an absolute path into the
   shared checkout**, on the page that forbids touching `/workspaces/tools`.
   Both builders flagged the contradiction. It works, and the page does not
   say the exception is intended.
10. **A dispatch boundary the gate itself made unkeepable.** The repo-39
    dispatch said to touch the slice's records and their `GRANDFATHERED` lines
    only. Deleting eight entries moved the lines `repo-37`'s enforced record
    cites, and the gate went red until `repo-37` was repointed. The repo-35
    builder hit the same edge from the other side and pinned those citations
    to `64edce2`. **Any branch that edits the `GRANDFATHERED` list also owns
    `repo-37`'s citations into it**, and two such branches in one batch always
    conflict there. The seam map could not see this, because the collision is
    a citation *into* a shared file, not an edit *of* one.

**Confirmed rather than contradicted.** `worktree-hygiene.md`'s _When every
agent dies at once_ held under a real HTTP 429 that killed one gate mid-run.
The orchestrator re-checked the shared checkout, the three worktrees and the
remote heads, all clean, and resumed the agent by message. It told the agent
that nothing it held was evidence, and the agent re-ran its control before
continuing.

## Eighteenth session — 2026-09-13

**Written by a records-only dispatch (Claude Opus 5, dispatched as `opus`),
transcribing the orchestrating session's own account of a batch it ran, with no
gate on this branch — scoped to this file alone.** Branch facts were re-read
from `pull/223/head` with `git log`, `git merge-base` and `git show`. The pull
request's state was read with `gh pr view 223` at 2026-09-13 05:01 UTC, and the
owner's decisions were read from its body. The gate's two passes were checked
against the reviewer's report on the PR thread and against the `## Review`
section on the branch. **Orchestrator-reported, not verified here:** the intake
count, the agent and wake counts, the attribution of rounds, every token figure,
the queued-message episode, the harness working-directory change and the
peer-session relay. #223's base is `4b9ce2f` (its merge-base with `origin/main`),
and `origin/main` has since moved one commit, to `514b5b6` (#222, a planner
filing). The two changes share no file: #222 touches 5 paths, #223 touches 40,
and `comm -12` over the two sorted `git diff --name-only` lists prints nothing.

| Field | Value |
| --- | --- |
| `tickets` | **1**, `repo-44` (`difficulty: hard`, confirmed in its frontmatter on `main`), taken whole on one branch as **#223**, open at `6e7ed81`. Four commits over `4b9ce2f`, 40 files, `status: done` on the branch tip. Intake: **no open pull requests**, and `--ready` returned **1** ticket (orchestrator-reported). That count is consistent with the base: `pl-39`, `pl-40` and `pl-41`, which `--ready` lists at `514b5b6`, are absent from `4b9ce2f`'s tree. **The seam-mapper was not dispatched**, because a single candidate has no seams to map, so the batch question became how to *slice* the one ticket (item 1). Read at 05:01 UTC: `OPEN`, `MERGEABLE`. `pr-title`, CI `check`, CI `changes`, `security` `codeql`, `dependency-review` and `CodeQL` were success, and both `test` matrix jobs were still `IN_PROGRESS`. At the orchestrator's earlier look, `CI` and `security` had been in progress |
| `agents` / `dispatches` | **3** agents: 1 builder (`opus`), 1 reviewer (`sonnet`), and 1 records-only builder (this row, `opus`). **3** spawns. Wakes are **approximate, since the orchestrator kept no strict tally**: the builder was woken about 4 times (the reviewer's pass-1 message, the orchestrator's acceptance message, the round that hit a failing condition, and a resend after a queued message went unread). The reviewer was woken once, sent back for enumeration, and took a further turn after the builder's closing commit |
| `builder rounds` | **About 4**: the build, the gate exchange, the closing commit that hit a failing condition, and the push that opened the PR. **2 were the orchestrator's fault.** One was a ship-authority condition broader than the `Done when` line it stood for (item 3). The other was a reply sent to a running builder that was never acted on (item 4). `6e7ed81`, the closing commit, is visible on the branch. The rounds themselves are orchestrator-reported |
| `gates` | **1** reviewer over **2 passes**, both **PASS** at `7725487`, and **findings were returned**. Pass 1 **sampled** `Done when` 3 despite a prompt that said "enumerate, don't sample": it read 39 of the 114 pins and spot-checked about 30–40 of the non-pin citations. The orchestrator caught this at step 8 and sent it back (item 2). Pass 2 enumerated all **443** citation occurrences the branch touched (409 inside `## Review`, of which 123 pinned; 34 outside it) with `citations.mjs`'s own extractors and resolvers, and found **0 mismatches**. It reported one headcount discrepancy, 26 against the Log's 25. Separately, the builder's reproduction found pass 1's "zero indistinct anchors anywhere" false: 2 pre-existing anchors, in `repo-16` and `repo-21`, since repaired in `6e7ed81`. It also found that pass 1's draft section would have failed the citation gate once committed. All of this is confirmed on the PR thread and in the branch's own post-gate Log entry |
| `wrong findings` | **0 gate findings refuted.** The wrong *claims* were the reviewer's "zero indistinct anywhere", and **both** headcounts: the builder's 25 and the reviewer's 26. A script corrected them to **28 occurrences at 24 distinct targets**. The 25 counted substitution rows and omitted `repo-37`'s pointer, and the 26 counted two `repo-1` rows that only the formatter touched, per the branch Log. **None reached a commit uncorrected** |
| `subagent tokens` | **1,410,875** observed, **1 of 3 agents missing**: builder **944,332** (cumulative, from its final completion notification, which folds in every resume) · reviewer **466,543** · this row **not reported**, since an agent cannot see its own figure. Split of the observed figure: builder 66.9% · gate 33.1% · intake 0%, with no seam-mapper. **Corrected during this row's writing** from a builder figure of 864,956, which came from its first completion notification. A floor on the batch, because this row's own agent is missing, and **not the bill**: cache reads are uncounted |
| `cost` | **≈ $25.68** at the 2026-09-02 rate of $0.0182/1k. An arithmetic conversion of the observed total, not billed |

**Model pairing: `hard`, so Opus built and Sonnet gated**, dispatched as `opus`
and `sonnet`. #223's body names both: "Built by `opus` (Opus 5) per
`difficulty: hard`, gated by `sonnet` (Sonnet 5)". With one ticket there is no
cross-ticket collision to see, but this is the pairing the sixteenth session's
item 7 says every `hard` ticket lands on.

**Four decisions went to the owner.** Each recommendation is from the
orchestrator's account, and each answer is confirmed in #223's body:
- **batch scope:** the options were the downloader slice (recommended), the planner slice, two stacked, or the whole ticket. **The owner chose the whole ticket, overriding the recommendation**;
- **`dl-33`'s quoted Vitest coordinate:** grandfather it (recommended, chosen), file a checker ticket, or paraphrase;
- **the 23 references that cannot take an anchor without editing a quote**, raised by the builder mid-build: grandfather them (recommended, chosen), grandfather them and file a checker ticket, or rewrite as prose;
- **`pl-32`'s extension-less `tools/planner/Dockerfile` coordinates:** a Log note (recommended, chosen), a ticket, or a revert.

### What the skill got wrong

Eight items, all from the orchestrator's account. Items 1, 3, 4 and 7 are
checked here against the page each one names, and item 8's two line numbers
against both trees. Item 5 is checked against the branch Log, and item 2
against the PR thread. Item 6 is harness behaviour and is not reproducible from
this branch.

1. **Step 2 has no case for one large unblocked ticket.** It mandates a
   seam-mapper and a "which batch" question
   (`.claude/skills/orchestrate-tickets/SKILL.md@514b5b6:42 "Map the seams, then ask which batch"`).
   With a single candidate there is nothing to map, but there is still a
   batch decision: how to slice a ticket whose own Build says
   `docs/work/repo-44-the-rest-of-the-review-corpus-and-the-pin-wait-class.md@514b5b6:72 "Take one tool, or one run of ids, per dispatch"`.
   `sizing.md` covers slicing only when a decision blocks
   (`.claude/skills/orchestrate-tickets/reference/sizing.md@514b5b6:108 "### Slice a blocked ticket"`).
   The owner overrode the recommended slice here, which is why the question
   was worth asking and why the step should say to ask it.
2. **A gate told "enumerate, don't sample" sampled and still reported PASS** on
   the `Done when` line that needed enumeration. Step 8's checks ask for a spec
   file and line per verdict
   (`.claude/skills/orchestrate-tickets/SKILL.md@514b5b6:82 "line carry a verdict naming a spec file and line"`),
   not for **population against coverage**. Adding **"does the count read equal
   the count that exists?"** would have caught it mechanically: 39 read of
   114 pins is visible in pass 1's own report. This is the seventeenth
   session's item 2 again, one session later, in a gate whose prompt already
   carried that lesson. The instruction alone did not hold, so the check has to
   sit with whoever accepts the report.
3. **`sizing.md` calls ship-authority conditions mechanical**
   (`.claude/skills/orchestrate-tickets/reference/sizing.md@514b5b6:40 "are mechanical. It worked on three branches"`).
   Running them is. **Writing** them is not. The orchestrator required a
   clean whole-file citation check on `repo-21`, but `Done when` 2 is only
   about indistinct anchors. Two deliberate failures that predate the branch, a
   quoted checker line and a placeholder, made it exit 3. #223's body records
   the condition being re-scoped after it failed, and it cost a round.
   **Derive each condition from the words of a `Done when` line**, not from
   the command that seems to stand for it.
4. **`concurrency.md` says messaging a running agent "is nearly free"**
   (`.claude/skills/orchestrate-tickets/reference/concurrency.md@514b5b6:95 "Messaging a running agent is nearly free"`).
   The orchestrator's option-1 reply came back "queued for delivery at its
   next tool round". The builder then completed without acting on it: it was
   shown `completed`, with the branch unpushed, and nothing announced the
   drop. A resend was needed. **After sending to a running agent, confirm with
   `ListAgents` and the artifact (a push, a commit) rather than assuming
   delivery.** This is the counterpart of the seventeenth session's item 4:
   there, a message believed to be queued was a resume; here, one that was
   queued was never read.
5. **The ticket expected `repo-35` to shift per-bucket counts, and it shifted
   none.** 231, 83, 4 and 49 reproduced exactly at `4b9ce2f`, which contains
   #219. This is recorded in the branch Log's "what the brief had wrong".
6. **Harness: a `cd` in one orchestrator Bash call moved the session's primary
   working directory.** An orchestrator call of the form `cd <builder worktree>
   && …` changed the session's primary working directory to that worktree, and
   an environment update announced it. An orchestrator whose next edit used a
   relative path would have written into the builder's tree. Orchestrator-reported.
7. **`records.md` does not say what happens when a fix lands after the
   reviewer's verbatim section is committed.** Searching `records.md` and
   `SKILL.md` for "after the gate" and "post-gate" returns nothing. The choice
   made here: the section stays as a description of the reviewed sha
   (`7725487`), the builder adds a dated post-gate Log entry for the fix
   (`6e7ed81`, whose entry says "The gate record above describes `7725487` and
   is committed as the reviewer sent it"), and the reviewer confirmed the new
   sha without editing its section.
8. **A relayed claim true of `main` and false of the branch.** A peer session
   (`tools-fa`) relayed "`const FAILING` moved to line 299; re-measure against
   the merged checker". That is true of `main`
   (`scripts/citations-gate.mjs@514b5b6:299 "const FAILING"`) and false of the
   branch. On #223's head it is at line 269, because the branch shrank
   `GRANDFATHERED`. And the base already contained #219: `626c8fb` is an
   ancestor of #223's head. **One command settled it.** The relay shape is *a
   claim true of `main` but not of the branch*.

### What went right, and is worth copying

- **The builder reproduced the gate instead of transcribing it, and it caught
  two false claims before either reached a commit.** Its whole-file sweep
  without `--section` contradicted pass 1's "zero indistinct anywhere". It then
  counted the outside-`## Review` repoints with a script built on
  `citations.mjs`'s own `extractCitations`, which settled a 25-against-26
  disagreement at a third number, 28 occurrences at 24 targets, and explained
  both wrong ones. Two agents that disagree are not choosing between their
  figures. The measurement neither of them had taken yet decides it.
- **The reviewer's second pass tested its own section with the checker before
  sending it**, after its first draft would have failed the gate on its own
  citations. The builder re-tested it in place (6 of 6 verified). That is the
  sixteenth session's item 1, a record that breaks only once committed, closed
  by the agent that wrote the record rather than found after it landed.

## Nineteenth session — 2026-09-13

**Written by a records-only dispatch (Claude Opus 5, dispatched as `opus`),
transcribing the orchestrating session's own account of a batch it ran, with no
gate on this branch — scoped to this file alone.** Both pull requests were read
with `gh pr view 228` and `gh pr view 229` at 2026-09-13 22:43 UTC, and their
comments with `--json comments`. Branch facts come from `git log`, `git
merge-base` and `git diff` on `origin/pl-42-the-revision-contract` and
`origin/pl-39-a-real-model`. Each verdict was read from the ticket's committed
`## Review` with `git show <branch>:<ticket>`. CI conclusions come from `gh run
list --branch <b> --json` and `gh run view <id> --json jobs`, never by eye. The
intake count was re-run as `npm run status -- --ready` on a checkout of the base.
Two measurements were taken on detached checkouts that were never pushed: the
citation gate at pl-39's gated tip, and the gate on a scratch merge of both
branches (item 1). **Orchestrator-reported, not verified here:** the open-PR
count at intake, the seam map and its finding, the owner's batch choice, every
wake and round count and the attribution of rounds, every token figure, the
reviewer's uncommitted "extended with 4 scenarios" claim, the unreceived queued
message, and items 3, 7 and 8's underlying episodes. Both branches sit on
`8849c14`, which is still `origin/main`.

| Field | Value |
| --- | --- |
| `tickets` | **2**, both `difficulty: hard` (confirmed in each ticket's frontmatter on `main`): `pl-42` → **#228**, open at `5f2be13`, five commits over `8849c14`; `pl-39` → **#229**, open at `e048642`, five commits over `8849c14`. Both `OPEN`, `MERGEABLE`, not draft, `status: done` on each branch tip. Intake: **0 open pull requests** (orchestrator-reported; consistent with the PR list, where #226 merged at 18:25 UTC, #227 was created at 21:28 and pl-42's first commit is 21:16), and `--ready` returned **3**, `pl-39`, `pl-41` and `pl-42`, reproduced exactly on `8849c14`. The seam-mapper reported no file overlap, and **the owner chose "pl-39 + pl-42 only"**, holding `pl-41` for a soft overlap on cost prose with `pl-39`. **The branches as finished share two paths**, neither of which the briefs predicted: `tools/planner/contract/src/errors.ts` (pl-42's new codes; pl-39's reworded `AGENT_UNAVAILABLE` comment, from the owner's first pl-39 decision) and `pl-24`'s gate record (each branch pins different citations in it). `git merge-tree --write-tree` reports no conflict, and the scratch merge passes the citation gate. Two other open PRs, #227 (`dl-48-coverage`) and #230 (`planner-env-example`, created 22:36), are not this batch's; #230's overlap with pl-39's new settings was not checked |
| `agents` / `dispatches` | **6** agents: 1 seam-mapper (**`sonnet`**, from `.claude/agents/seam-mapper.md`'s frontmatter, since no model was passed at dispatch), 2 builders (`opus`), 2 reviewers (`sonnet`), and 1 records-only builder (this row, `opus`). **6** spawns, plus **about 20 wakes, approximate because no strict tally was kept**: pl-42 builder about 5, pl-39 builder about 9, pl-42 reviewer about 2, pl-39 reviewer about 4 |
| `builder rounds` | **About 14**. **pl-42, about 5:** the build; step 7's owner decision (a new `REVISION_LIMIT_REACHED` code, limit 50); the gate fixes; the ship round; a CI-red round for moved citations. **pl-39, about 9:** the build; three owner decisions; the gate exchange; a blank-`MODEL_PROVIDER` plus custom-headers decision round; a stop on the section citations check; continue plus pins; a stop on pl-28 `WORSE`; the ship round. **About 4 were the orchestrator's fault** (items 1–3, and a citation gate read through a `grep` for `FAIL` or `MOVED`, which dropped the pl-28 `WORSE` line and cost one extra stop). The commits for each round are on the branches. The rounds themselves are orchestrator-reported |
| `gates` | **2** reviewers, **both returned findings**. **pl-42: PASS** at `9138ddc` over 2 passes (the PR thread's long form names `19f1810` as the first reviewed tip). The record lists **3 low findings, but only 2 are code fixes** (both at `9138ddc`); the third is the reviewer correcting its own first-pass citation, "No code changed for this one". It records 22 of its own source mutations, and 6 bounds green before the fix. **pl-39: CONCERNS** at `3841faf` over 3 rounds (`489bce9`, `b4c934f`, `3841faf`, named in the record's header): 1 med and 2 low, all fixed; 2 open decisions raised, both decided by the owner. CONCERNS rests only on e2e and the image build being unproven at the gate. **Both have since passed in CI:** the `planner` workflow at `e048642` (run 34787290352) shows `docker` success and `e2e` success. The builder had already run `npm run e2e:planner` at `3841faf` and `902265e`, 4 passed each, in a PR comment the reviewer re-ran and agreed with. **Owner decisions: six by the orchestrator's count**, pl-42's step 7 and five on pl-39 (all five are listed in #229's body). #228's body shows step 7 as two answers, option A and then 50 "asked separately", so seven answers counted per question |
| `wrong findings` | **0 gate findings refuted.** Wrong *claims*: the pl-39 reviewer's "logging.test.ts extended with 4 scenarios" for uncommitted probes, caught by the builder (the committed record says "4 uncommitted sentinel-injection probes"); two ambiguous or unanchored citations in the pl-39 section, caught by the builder's citations check; a mis-attributed citation in pl-42's first pass, which the committed record carries as the reviewer's own correction. **One reached a commit, annotated:** pl-42's record says "six" bounds and lists eight, and the builder's Log explains both (the reviewer's six mutated one `candidateId` variant as representative of three). **One further wrong claim reached a PR thread, not listed in the orchestrator's account:** the pl-39 gate's long form said e2e was not run because there is no Docker daemon, and the planner e2e suite does not use Docker. It was corrected by a separate builder comment, with the long form left unedited |
| `subagent tokens` | **1,391,956** observed, cumulative per agent, last observed: seam-mapper **48,896** · pl-42 builder **302,201** · pl-39 builder **494,921** · pl-42 reviewer **282,508** · pl-39 reviewer **263,430** · this row **not reported**, since an agent cannot see its own figure. Split: builders **797,122 (57.3%)** · gate **545,938 (39.2%)** · intake **48,896 (3.5%)**. **Both reviewer figures are floors**: each took further turns ending in `SendMessage` after its last usage report. A floor on the batch, and **not the bill**: cache reads are uncounted |
| `cost` | **≈ $25.33** at **the stale 2026-09-02 rate** of $0.0182/1k. An arithmetic conversion of the observed floor, not billed |

**Model pairing: `hard`, so Opus built and Sonnet gated**, on both tickets. #228's
body says "builder `opus`, gate `sonnet`", and #229's says the same.

### What the skill got wrong

Eight items, from the orchestrator's account. Items 1, 2, 4, 5 and 6 are checked
here against the pages they name, and two of them do not survive intact. Items
3 and 7 are not reproducible from outside the session. Item 8 is relayed, and
this dispatch saw a different shape of it.

1. **No step runs `node scripts/citations-gate.mjs --against origin/main` before
   a PR opens.** Any branch that moves lines an older gate record cites fails
   CI's `check` job. **Verified.** A search of `SKILL.md`, `reference/`,
   `.claude/agents/` and `review-ticket` finds the script only named, never
   invoked. `review-ticket` step 8 runs `citations.mjs` over the new record
   alone, which cannot see an older one. #228's CI failed at `3b3e1cd` (run
   34786249601, the `check` job) and passed at `5f2be13` after 5 pins in 3
   records (pl-10, pl-24, pl-29). **pl-39 would have failed too, measured:** at
   `3841faf` the gate exits 1 with 5 records `FAIL` and pl-28 `WORSE`, 13
   `moved` citations in total. `e048642` writes 11 pins to `8849c14` in 6
   records (repo-11, repo-33, repo-40, pl-24, pl-28, pl-38). The other two are
   pl-28's line-number shorthands, which sit in the same table cells as a pinned
   citation and resolve through it.
   **The pair is not a hazard to each other at merge:** a scratch merge of both
   heads gives `73 enforced, 0 failing` and exit 0 against `origin/main`.
2. **Ship authority granted in the gate prompt, relayed through the reviewer,
   loses to the builder's own dispatch**, and both builders were right to stop.
   **Partly contradicted:** the skill already sends it to the builder.
   `.claude/skills/orchestrate-tickets/reference/sizing.md@8849c14:35 "End every relay with conditional ship authority."`
   and
   `.claude/skills/orchestrate-tickets/reference/dispatching.md@8849c14:28 "Ship authority, or not."`
   both address the builder's relay, and `builder.md` opens a PR only when "your
   prompt" grants it. What is missing is narrower: nothing says a gate prompt
   *cannot* carry it. That is why the orchestrator counts this round as its own.
3. **A decision answered on one half of a pair has to be relayed to both
   halves**, or the reviewer's verbatim section records it as open. Blank
   `MODEL_PROVIDER` = unset went only to the builder. It was caught before commit,
   and the committed pl-39 record lists both decisions as decided.
4. **A message queued to a running agent was reported never received** (the
   pl-39 builder, the blank-`MODEL_PROVIDER` answer). This is the second sighting,
   after the eighteenth session's item 4, and the sentence it contradicts is
   unchanged since then:
   `.claude/skills/orchestrate-tickets/reference/concurrency.md@8849c14:95 "Messaging a running agent is nearly free"`.
   The harness behaviour itself is orchestrator-reported.
5. **Gate prompts do not require the reviewer to run `citations.mjs --section
   Review --require-anchors --require-distinct-anchors` before handing over its
   section.** The pl-42 reviewer did it unprompted; the pl-39 reviewer did not,
   and two citations failed at the builder. **Partly contradicted:**
   `ticket-reviewer.md` preloads `review-ticket`, which tells the reviewer every
   `## Review` citation needs an anchor that occurs once, and that CI enforces
   both. Its step 8 gives the exact command **to the builder, before the
   commit**, and that is where pl-39's two failures were caught. The skill
   worked at the step it designates. The defect is that the reviewer is given the
   rule but not the command, so a clean handover costs the builder a round.
6. **No procedure for a ticket that adds an npm dependency.** **Verified as
   absent:** `builder.md` and `ticket-reviewer.md` forbid `npm install`, and
   `dispatching.md` forbids writing an install into a gate prompt. Nothing covers
   adding a package. The builder improvised `npm install --package-lock-only
   --ignore-scripts` with a symlinked scratch install, and pl-39's Log records
   that `--package-lock-only` also rewrote two workspace versions, which were
   reverted by hand. The reviewer linked the builder's copy
   (orchestrator-reported). **#229's CI was the first real install, and it
   passed:** at `e048642`, `CI` (run 34787290348) shows `check`, `changes` and
   both `test` jobs as success.
7. **"Ask every agent for what the skill got wrong at dispatch" was not done.**
   Only the pl-39 pair was asked, mid-batch; the pl-42 agents never were. The
   instruction is this page's own schema row. The omission is
   orchestrator-reported.
8. **Relayed and unverified: the pl-39 builder reported that the sandbox
   refuses piped git commands and shell variables.** The orchestrator ran such
   commands without refusal in its own session. **This records dispatch, also
   worktree-isolated, saw part of it, in a narrower shape.** A plain pipe from
   `git diff` into `grep` and `wc` ran, and so did `echo "exit=$?"`. Three compound
   commands were refused before running. One was a `for` loop whose body ran `git`
   and `gh` ("names git in a form too complex to verify that it stays inside the
   worktree"). Another was a `;`-chain that ran the farm script with its output
   redirected ("runs bash inside a construct too complex to verify"). The third
   was a `cat` heredoc appending this entry, where `git` appeared only in the text
   being written ("too complex to verify that it stays inside the worktree"). Plain
   commands, and the file-edit tool, worked. The refusal appears to belong to a
   worktree-isolated agent and to fire on how a command is built, not on pipes or
   variables as such. One dispatch is not a measurement of the rule.

### What this row's verification added

- **#228's body is stale on one line.** Its "Verification on the final tip
  `3b3e1cd`" predates the pin commit `5f2be13`. The pin repair is documented in a
  separate PR comment, not in the body.
- **The seam map's "no overlap" held for the briefs and not for the branches.**
  Both shared paths came from mid-batch work: an owner decision that lifted the
  stop on `contract/` for one doc comment, and citation pins. A map read at intake
  cannot see either, and `git merge-tree` on the finished heads is the check that
  can.

## Twentieth session — 2026-09-14/15

**Written by a records-only dispatch (Claude Opus 5, dispatched as `opus`),
transcribing the orchestrating session's own account of a batch it ran, with no
gate on this branch — scoped to this file alone.** At 2026-09-15 02:12 UTC, all
seven pull requests (#241–#247) were read with `gh pr view <n> --json
number,title,isDraft,state,mergeable,headRefOid,baseRefName,statusCheckRollup,body`,
and the surrounding list with `gh pr list --state all --json`. Neither was read by
eye. Each verdict was read from the ticket's committed `## Review` with `git show
<head>:<ticket>`, at the head sha that command returned. Each ticket's `status:`
was read at its build and gate commits with `git grep '^status:' <sha>`. The
merge conflicts were measured with `git merge-tree --write-tree --name-only` over
all six pairs of the four planner heads, plus #246 × #247. The intake count was
re-run as `npm run status -- --ready` on `95c6403`, which is still `origin/main`.
Each skill claim was checked with `git grep` and `git log` on `origin/main`. The
token total and its split were re-added with `node -e`. **Orchestrator-reported,
not verified here:** the seam map and how the batch question was put, the order
and wording of the owner's answers beyond the five that PR bodies record, every
round, resume and wake count and each attribution of fault, every token figure,
the shared checkout's install and lockfile revert, the peer session, the
usage-limit episode, and the episodes behind items 3, 13 and 15.

| Field | Value |
| --- | --- |
| `tickets` | **4**, with each `difficulty` confirmed in frontmatter on `main` and at each head: `pl-49` (`hard`) → **#242**, not draft, at `20fd119`; `pl-43` (`hard`) → **#244**, draft, at `b0fc116`; `pl-41` (`standard`) → **#245**, draft, at `52be920`; `pl-45` (`standard`) → **#246**, draft, at `b5e42af`. All four are `status: done` at their heads, `OPEN` and `MERGEABLE`, with every check `SUCCESS`: `CI` `check`, `changes` and both `test` jobs, `planner` `docker` and `e2e`, `security` and `pr-title`. **Filings, none gated:** `repo-45` → **#241** at `22435fa`; `repo-46` and `repo-47` → **#243** at `72aa40c`. Both bodies say the reproduction is the verification. **#247**, not draft, at `926b57a`, is titled `docs(downloader): qualify dl-15's app.test.tsx citations before a planner test takes the name`. It changes only dl-15's ticket, 42 lines each way. #246's head still carries the same dl-15 change, and its body says it stays a draft until #247 and #242 merge. #246 × #247 merges clean. **Intake:** `--ready` returned **11** at `95c6403`, reproduced exactly (six `dl-`, five `pl-`). There were **0 open feature PRs**, consistent with `gh pr list`: before #241 was created at 22:58 UTC on 2026-09-14, the only open PRs were release PRs #232 and #233. The owner took the four planner tickets and no downloader ticket. #248 (`dl-51`, created 02:04 UTC on 2026-09-15) is not this batch's. It is consistent with the peer's downloader batch, but that is not checked |
| `agents` / `dispatches` | **12** agents by the orchestrator's table, this one included. **1 seam-mapper**, `sonnet`: no model was passed at dispatch, so it came from `.claude/agents/seam-mapper.md@95c6403:5 "model: sonnet"`. **4 builders**: `opus` for pl-49 and pl-43, `sonnet` for pl-41 and pl-45. **2 filers**, both `opus`. **4 reviewers**: `sonnet` for pl-49 and pl-43, `opus` for pl-41 and pl-45. **This records-only builder**, `opus`. Every builder and reviewer model matches its PR body, and the filers' models match #241 and #243. **#247's body says "Dispatched as `sonnet`", and the table lists no agent for it.** It was one of the two Sonnet builders or an agent missing from the table, and the branch cannot say which. **Resumes started by the orchestrator: about 20. Wakes between agents: not counted.** Around 01:40–02:00 UTC on 2026-09-15, the weekly usage limit (HTTP 429) killed two agents mid-turn. No damage was found, and one was resumed by message after the 02:00 reset (orchestrator-reported) |
| `builder rounds` | **About 19**, orchestrator-reported: pl-49 about 6, pl-45 about 5, pl-43 about 4, pl-41 about 4. **At least 4 were the orchestrator's fault.** Two were pl-49 stops at citation conditions the orchestrator had not anticipated. Two were ship conditions that could not be satisfied (item 6). Commits over `95c6403`, which are not rounds: pl-49 6, pl-41 5, pl-43 4, pl-45 4. pl-49's last commit, `20fd119`, only adds the transcription note to its Log (item 8) |
| `gates` | **4** reviewers over **7** gate passes, and **6 of the 7 returned findings**, read from each committed `## Review`. **pl-49: CONCERNS** against `a4bd8a6`, which the header names as a pre-squash sha. It raised 1 low, closed on the branch: pl-44 and pl-47 still named migration 9. The only row not proven is the in-image `--days 1` line, marked `unproven (gate)`. CI's `docker` job passed at `20fd119`, but that job builds the image and does not run the report. **pl-43: PASS** against `1a9ffff`, with 1 low repaired at `1a9ffff`. **pl-41: gate 1 CONCERNS at `7e72ce5`**, with 11 returned and 7 carried in 6 bullets. **Gate 2 PASS at `9e4e522`**, reviewed at `3b1225f`, with 4 returned and 3 carried and closed. **pl-45: gate 1 FAIL at `f796e8b`**, with 16 returned and 12 carried (5 med, 7 low). **Gate 2 PASS at `52bf582`**, with 4 returned, 3 carried and 2 gate-1 lows withdrawn. **Gate 3 PASS at `c8d46ee`**, with 0 returned. **Owner decisions: 12 answers to 11 questions** by the orchestrator's count, listed below. PR bodies record 5 of them as AskUserQuestion answers, one question each |
| `wrong findings` | **2 gate findings withdrawn** after the builder's pushback, which the reviewer reproduced. Both were pl-45 gate-1 lows that predate the ticket: the zero-specialist progress bar and the doubled `Unchecked` comment. **Both reached the committed record, labelled as withdrawn.** Gate 1 marks each "withdrawn in gate 2", and gate 2 says "both builder objections reproduced". **Every other wrong claim the orchestrator reports stayed out of the committed records**, judged by reading each record and grepping each ticket. pl-43's scope bullet carries the corrected figure ("about 55 sites … Only 2 were flipped individually"), and nothing in pl-43 says §3 decided the season question. pl-41's record gives the gate's own account of the `kind` tie-break: the mutation survived at `3b1225f` and goes red at `9e4e522`. The builder's account is not there. pl-49's Log says the gate "sent it as a message and did not write it into this file". The seam map is committed nowhere. **Two further wrong claims, found here, did reach a commit or a PR body.** pl-45's Log first reported `npm run check` exiting 2 on the missing SDK as the state of the unmutated tree. A later entry corrects it ("The Log's own verification was wrong"), and gate 1 carried it as a low. And #242's and #246's bodies both report "0 malformed" from `citations.mjs`, a figure that script never prints when the count is zero (item 6) |
| `subagent tokens` | **3,111,086** observed across 11 agents, re-added here and equal to the orchestrator's figure. Each figure is cumulative per agent, as last observed: seam-mapper **99,203** · pl-41 builder **225,811** · pl-43 builder **417,393** · pl-45 builder **615,384** · pl-49 builder **376,412** · repo-45 filer **101,134** · repo-46/47 filer **152,847** · pl-41 gate **326,251** · pl-43 gate **329,206** · pl-45 gate **303,995** · pl-49 gate **163,450** · this row **not reported**, since an agent cannot see its own figure. Split, also re-added: builders **1,635,000 (52.6%)** · gates **1,122,902 (36.1%)** · filers **253,981 (8.2%)** · intake **99,203 (3.2%)**. The shares are rounded and sum to 100.1%. **Two figures are floors.** The pl-41 builder's later turns ended in `SendMessage`, and the pl-45 gate's last turn failed at the usage limit. The total is a floor on the batch and **not the bill**: cache reads are uncounted |
| `cost` | **≈ $56.62** at **the stale 2026-09-02 rate** of $0.0182/1k, recomputed here. An arithmetic conversion of the observed floor, not billed |

**Model pairing: Opus built and Sonnet gated the `hard` tickets; Sonnet built and
Opus gated the `standard` ones.** #242's and #244's bodies name `opus` building
and `sonnet` gating. #245's and #246's name Sonnet building and Opus gating.
pl-43's record header agrees: "ticket-reviewer, sonnet; the builder ran opus".

**Owner decisions: 12 answers**, all through AskUserQuestion by the orchestrator's
account. Every one took the recommended option **except the merge order**, where
the owner chose "mark #244 draft, merge later" over "merge #242 soon". #244's
draft flag is consistent with that choice. **(body)** marks an answer that the named PR
body records as the owner's:
1. the batch: "no downloader tickets", then "pl-41, pl-43, pl-45, pl-49";
2. install `node_modules` in the shared checkout, and file repo-45. #242's body says the owner "has approved running `npm install` in the shared checkout", and pl-45's Log gives 22:46 UTC as when the SDK reached it;
3. pl-40 `depends_on` pl-49 **(body, #242)**. At #242's head pl-40 reads `depends_on: [pl-39, pl-49]`;
4. a dated Log line on pl-39 **(body, #242)**;
5. pl-45's "Watch it" becomes an honest attaching state, option 1 of 4 **(body, #246)**;
6. file repo-46;
7. file repo-47;
8. pl-41 keeps the cap at 40 with a mixed ranking, option 1 of 3 **(body, #245)**;
9. pl-43 counts only the named days as in season **(body, #244)**;
10. merge order;
11. split dl-15's citation repair into its own docs PR. #247's body gives the release-routing reason, and does not say who decided;
12. the downloader/planner split at intake, **counted within question 1**, which is why there are 12 answers to 11 questions.

**Settled by the orchestrator, not the owner.** PR bodies record six of these seven
as orchestrator-settled:
- **moving pl-44 and pl-47 off migration 9** (#242). On `main`, pl-44 names migration 9 three times, and pl-47 once. At #242's head, pl-44 names migration 10 in all three places, and pl-47's step 1 says "pl-49 took 9". pl-47's one remaining "migration 9" sits under "## The gate on this filing". #242's body calls that passage "its dated filing Log", but it is not in the Log;
- **the header sha of pl-49's record** (#242). The header names `a4bd8a6` as a pre-squash sha;
- **pinning moved citations to `95c6403`**, following repo-44's precedent. #242 pins six other records, and #244 pins pl-42's;
- **pinning pl-39's line-130 citation**, which had not moved, because the moved shorthands that inherit from it cannot carry a pin of their own (#242);
- **accepting oxfmt's re-padding** of pl-36's table (#242);
- **the ticket status convention on pl-43** (#244, "Settled by the orchestrator as a convention question");
- **PR title types.** The orchestrator retitled #245 from `feat` to `fix` to match `kind: fix`. No body mentions the retitle. #245's checks show a second `pr-title` run at 00:08 UTC, 25 minutes after the PR was created, which is consistent with an edit.

**Merge conflicts, reproduced at the current heads.** #242 conflicts with #244 in
pl-42's ticket, with #245 in pl-37's, and with #246 in pl-36's. Each of those runs exits 1
and lists only that file. #244 × #245, #244 × #246 and #245 × #246 exit 0, and so
does #246 × #247. **All three conflicts are in gate records that more than one
branch pins, and none is in source** (item 10).

**Environment, orchestrator-reported except where a record corroborates it:**
- The shared checkout's `node_modules` had lacked `@anthropic-ai/sdk` and 5 of its dependencies since pl-39 (#229); #242's body names the same six. A dry run showed 109 added, 0 changed and 0 removed. The owner approved `npm install` there at 22:46 UTC on 2026-09-14, and pl-45's Log gives that same time. The install added 6 packages and rewrote two version lines in the lockfile, and the orchestrator reverted those two lines. This dispatch did not look at the shared checkout.
- A peer session (`tools-7a`) ran a downloader batch at the same time, and the two sessions coordinated ids and seams by message.
- Around 01:40–02:00 UTC on 2026-09-15, the weekly usage limit killed two agents mid-turn. No damage was found, and one agent was resumed after the 02:00 reset.

### What the skill got wrong

Fifteen items, from the orchestrator's account. Items 1, 2, 9, 10, 11, 12 and 14
are verified here against the pages they name; 10 with a count corrected. Items
5, 7 and 8 are partly contradicted, and 4 and 6 are partly verified. Items 3 and
13 are orchestrator-reported. Item 15 is relayed, and this dispatch saw the same
shape.

1. **The nineteenth session's item 1 recurred unchanged.** No step runs
   `node scripts/citations-gate.mjs --against origin/main` before a PR opens.
   **Verified.** `git log` since 2026-09-13 returns nothing for
   `.claude/agents`, `.claude/scripts`, `review-ticket`, or any
   `orchestrate-tickets` page other than this one. **The account's exception is
   narrower than it says.** Three commits touched `.claude/` in that window,
   not one. #237 changed `.claude/skills/add-tool/SKILL.md` by 6 lines: a
   skill page, not a README, though the PR is about READMEs. #224 and #231 each
   added one entry to this page. `git grep citations-gate` over skills and
   agents still finds the script named and never invoked as a step. All four
   planner PR bodies report it exiting 0, which is the orchestrator's ship
   condition doing the step's work. #243's body confirms repo-47's framing: "the
   citations gate fails a code PR on citations in merged records that still
   verify on the base". The two pl-49 stops and the three throwaway
   pre-measurements are orchestrator-reported.
2. **The nineteenth session's item 6 recurred as repo-45.** No procedure covers a merged
   dependency, and the farm step has no freshness check. **Verified as absent.**
   The farm script's only check on the source is that it exists
   (`.claude/scripts/worktree-farm.sh@95c6403:34 "no shared node_modules at"`),
   and nothing in it compares it with the lockfile. `git grep` for "fresh",
   "stale" or "reinstall" in `builder.md` and `ticket-reviewer.md` finds nothing.
   The packing is confirmed twice. #242's body records `npm pack --offline` for
   pl-49, and pl-45's Log records the same command. **The red check reported as
   pre-existing is confirmed in pl-45's Log**, whose entry says `npm run check`
   "exits 2, solely on" the missing `@anthropic-ai/sdk`, "reproduced on the
   unmutated tree". pl-45's gate 1 carried it as a low: "The Log verification
   figures described a worktree without `@anthropic-ai/sdk`". The count of three
   builders and three gates is orchestrator-reported.
3. **The nineteenth session's item 7 recurred.** "Ask every agent what the skill got wrong"
   was in no dispatch prompt, and was asked mid-batch or after it. This page's
   schema row still asks for it "explicitly at dispatch". Dispatch prompts are
   not in the repository, so the omission is orchestrator-reported.
4. **The nineteenth session's item 5 recurred.** **Partly verified.** For pl-49, #242's body
   records the repair as "An anchor added to the gate's reliability citation",
   and the Log's transcription note lists it as one of three differences from
   the gate's text. For pl-45, the sandbox refusing the gate's file write is
   orchestrator-reported. Neither pl-45's record nor its Log mentions it.
5. **`builder.md` on status.** **Partly contradicted.** The two lines are
   `.claude/agents/builder.md@95c6403:212 "Append a dated entry to the ticket's Log and set"`,
   which goes on "in its frontmatter, in the commit that earns it", and
   `.claude/agents/builder.md@95c6403:218 "explicit ship authority, and then commit the gate record above"`.
   As written they do not contradict each other: one says when `done` is set,
   the other when the record is committed, and neither says which commit earns
   `done`. `status.mjs`'s `reviewedButReady` fails only a `ready` ticket that
   carries a `## Review`, so a `done` ticket without one passes. **Measured, the
   builders split three to one.** `git grep '^status:'` shows pl-49 `done` at
   `a4bd8a6`, pl-41 at `7e72ce5` and pl-45 at `f796e8b`, each before its first
   gate. pl-43 stayed `ready` until `b0fc116`, the commit that also adds its gate
   record. CI passes both readings. The defect is an undefined "commit that
   earns it", not two lines that disagree.
6. **Three ship conditions could not be satisfied.** **Partly verified: two of
   the three are confirmed in the code.** First, "0 malformed":
   `citations.mjs` adds `malformed-pin` to its summary only above zero
   (`scripts/citations.mjs@95c6403:1356 "are the two figures printed only above"`),
   yet #242's and #246's bodies both report "0 malformed". Second, the
   shorthands: a shorthand that carries its own pin is refused
   (`scripts/citations.mjs@95c6403:266 "so it is malformed rather than read"`),
   so rewriting only the moved citations cannot work when one of them is a
   shorthand. #242's body records the resulting deviation on pl-39. Third, the
   `git diff -w` splice check is orchestrator-reported as a condition. #242's
   body records its outcome: under `-w`, only the pinned row and the separator
   row change.
7. **Multi-gate records whose earlier gate reviewed a pre-squash sha.**
   **Partly contradicted.** `records.md` does document a header that names a
   pre-squash sha:
   `.claude/skills/orchestrate-tickets/reference/records.md@95c6403:135 "A gate record pins to the sha it reviewed"`.
   Its surviving-sha rule covers `@rev` pins and Log passages:
   `.claude/skills/orchestrate-tickets/reference/records.md@95c6403:257 "never a pre-squash branch tip"`.
   The gap is narrower than the account puts it. Nothing covers **one record
   holding gates at two or more shas**, since the checker reads one tree per run.
   Both shapes are confirmed in the records. pl-41's gate 1 is "Summarised
   without line citations, which moved in gate 2". **pl-45's gate 1 is recorded
   by finding, and it is gate 2 that is recorded by test name**, not gate 1 as
   the account had it.
8. **The transcription disclosure has no home.** **Partly contradicted.**
   `review-ticket` gives it one:
   `.claude/skills/review-ticket/SKILL.md@95c6403:143 "The disclosure note is required, not a habit."`,
   "Alongside the section", and its step 8 commits the note "together with" the
   section. But `builder.md` preloads no skill, and `git grep disclosure` over
   `.claude/agents` and `orchestrate-tickets` returns nothing. So the agent that
   commits the note has no instruction unless it opens `review-ticket`. Neither
   page says whether the note belongs in the Log or next to the section. The
   episodes are confirmed. pl-41's Log note quotes the message of commit
   `5ab1633` and landed in a later commit, `52be920`. pl-49's note is its own
   commit, `20fd119`. All four tickets now carry the note in the Log.
9. **A new file name broke another tool's record.** **Verified.**
   `tools/planner/web/test/app.test.tsx` and
   `tools/downloader/web/test/app.test.tsx` are both tracked at #246's head
   (`git ls-tree`), and #247's body explains the ambiguity and the
   release-routing reason for the split. `git grep release-please` over
   `.claude/skills` and `.claude/agents` finds only `add-tool` and this page.
   Nothing in `orchestrate-tickets` or `review-ticket` covers either half.
10. **The seam map does not see gate records.** **Verified, with the count
    corrected.** `.claude/agents/seam-mapper.md` never mentions a gate record,
    `## Review` or a citation (`git grep`). **This dispatch measured three
    conflicts, not four**, across every pair of this batch's open PRs that
    touch the planner. All three are in gate records: pl-42's, pl-37's and
    pl-36's. pl-36 is touched by three branches. The #242 × #245 merge
    auto-merges it, which means both sides changed it, and #242 × #246
    conflicts in it.
11. **A gate prompt scoped too wide.** **Verified in the record.** pl-43's scope
    bullet counts "about 55 sites" across five files, says "Only 2 were flipped
    individually", and calls it "A scope limit of this gate, disclosed rather
    than a defect found". The prompt's wording is orchestrator-reported.
12. **PR title type against ticket `kind`.** **Verified as absent.** `git grep`
    for "title" and "kind" over the `orchestrate-tickets` pages finds no rule
    on title types. `docs/01-TICKETS.md@95c6403:105 "work-package"` lists the
    three kinds. No conventional type corresponds to `work-package`, so "match
    the kind" has no answer for pl-43, pl-45 or pl-49, which are all
    `work-package` and titled `feat`. pl-41 is `kind: fix`, and #245 is now
    titled `fix(planner): …`. The earlier `feat` title is orchestrator-reported.
13. **A resumed builder's final message did not arrive**: pl-43's, after
    shipping, which had to be asked for again. And the pl-49 builder saw a
    reviewer's stated reply id differ from the message's `from=`.
    Orchestrator-reported. The branches cannot show either.
14. **No periodic peer check.** **Verified as worded.** The instruction is
    triggered by an event:
    `.claude/skills/orchestrate-tickets/reference/concurrency.md@95c6403:269 "so send it as soon as"`.
    `git grep` over `SKILL.md`, `concurrency.md` and `dispatching.md` finds no
    step that repeats `git worktree list` or `ListAgents` during a batch.
    Finding the peer through three foreign worktrees is orchestrator-reported.
15. **Relayed from builders: the worktree sandbox refuses compound `git`.**
    **This dispatch saw the same shape.** Two commands were refused before they
    ran. One was a `for` loop over `gh pr view` ("inside a construct too complex
    to verify"). The other was a `git fetch` followed by a `for` loop of
    `git merge-tree` ("names git in a form too complex to verify"). Plain `git`,
    a plain `git show` redirected to a file, a pipe-free `grep` over several
    files, and `node -e` all ran. This is the nineteenth session's item 8 again.

### What this row's verification added

- **The seam map's two failed claims are confirmed.** `git grep -i migration`
  on dl-53 returns nothing, while dl-57 has
  `tools/downloader/docs/work/dl-57-a-record-of-how-probes-and-downloads-end.md@95c6403:60 "Migration 5: a"`.
  On `main`, pl-40 does not name pl-49 anywhere. Its only "after it lands",
  `tools/planner/docs/work/pl-40-prove-p3-against-a-real-model.md@95c6403:89 "run the paid sets after it lands"`,
  refers to pl-41. The orchestrator's narrower reading, that pl-49 matters to
  pl-40's paid run, is consistent with pl-40's title ("the bill it ran up is
  on record") and not checked further.
- **Corrections to the account:** three conflicts rather than four (item 10);
  pl-45's gate 1 recorded by finding, not by test name (item 7); #237 touched a
  skill page, and #224 and #231 touched this page (item 1); "0 malformed" in
  two PR bodies (item 6); #247's `sonnet` dispatch missing from the token table;
  and pl-47's surviving "migration 9" sitting in its filing gate, not its Log.
- **Green CI does not close pl-49's one unproven line.** pl-49's CONCERNS rests on
  running the report in the image. CI's `docker` job builds that image and
  passed at `20fd119`, but it does not run the report, so the line stays
  `unproven (gate)`.
## Twenty-first session — 2026-09-14/15

**Written by Claude Sonnet 5, dispatched as a records-only builder for this
step, transcribing the orchestrating session's own account of a batch it ran,
with no gate on this branch — scoped to this file alone.** Four pull requests
were read with `gh pr view <n> --json …`, never by eye: #248 (`dl-51`), #250
(`dl-57`, a draft stacked on #248), #251 (`dl-55`), and #252 (`dl-60`). Each
ticket's committed `## Review` and Log were read with `git show
<branch>:<ticket>` after fetching all four branches locally. `npm run status
-- --ready` was re-run on this branch's own base (`origin/main` at `95c6403`).

**Independently reproduced here, not merely relayed:**

- The `records.md` pinning-rule failure (item 1): a fresh clone, dl-51's
  branch squashed onto a local copy of `main`, the branch ref deleted, `git gc
  --prune=now`, then `citations-gate.mjs --against origin/main`. Exit 1: 16
  unresolvable, `rev 04c2fb7 not in this repository`. Tagging that commit
  before deletion and pruning instead makes the same run exit 0 (74 enforced,
  0 failing).
- That dl-57's phase-1 gate pins, `@790c17b` and `@7b0cdcb`, are not ancestors
  of the branch's current tip (`git merge-base --is-ancestor`, both return
  false), consistent with the phase-2 rebase having orphaned them. Whether
  CI's `check` job fails on that branch with the same message is the
  orchestrator's account and is not re-run here.
- That `ci.yml`'s `check` job checks out with `fetch-depth: 0` and runs `node
  scripts/citations-gate.mjs --against` at line 190.
- That `builder.md` and `ticket-reviewer.md` never mention
  `citations-gate.mjs` (`grep -rn` across `.claude/agents/` and
  `.claude/skills/` finds nothing), while `review-ticket/SKILL.md` names it
  twice.
- The builder self-reports the gates refuted, quoted from the committed
  ticket text: dl-55's "no evaluation context" claim, and dl-60's "each call
  site has its own test" claim and its own retracted "would not load" line.
- The Haiku reword commit, `9dfe385` on `dl-57-outcome-record`.
- The dl-51 × dl-57 file overlap: diffing dl-57's own commits (over dl-51's
  tip, which it carries as an ancestor after the rebase) against dl-51's own
  diff over `main` finds **9** shared paths here, not the reported 11 — see
  "What this row's verification added" below.
- dl-60's gate sequence: the committed ticket carries **two** rounds
  (CONCERNS at `f43135f`, PASS at `faebe96`), not the three below — also
  unreconciled, see the same section.

**Orchestrator-reported, not verified here:** the agent and dispatch counts,
every wake count, the attribution of orchestrator-fault rounds, the Sonnet
weekly usage-limit episode and its timestamps, the pin-repair dispatch and
its failure on all three branches, every per-agent token figure (an agent
cannot see its own total, and this dispatch was not present for any of the
others'), and the reviewer's self-report of lacking `ListAgents` (item 8).
Whether the repository has `deleteBranchOnMerge: true` is also
orchestrator-reported: `gh api` is denied to this dispatch, so the repository
setting itself was not read here, only its consequence — the pruning
behaviour the simulation reproduces regardless of which setting caused a
branch ref to go away.

| Field | Value |
| --- | --- |
| `tickets` | **4** taken from ready (or filed) to a gated PR: `dl-51` → **#248** (`2e8aa7b`, 4 commits, `MERGEABLE`/`CLEAN`), `dl-55` → **#251** (`7df48f6`, 5 commits, `MERGEABLE`/`CLEAN`), `dl-57` → **#250** (`9dfe385`, 7 commits over #248, `MERGEABLE`/`UNSTABLE`, **draft**, stacked on #248), `dl-60` → **#252** (`56f7238`, 5 commits, `MERGEABLE`/`CLEAN`), a security fix filed and built inside this session rather than taken from intake. All four `status: done` on their branch tips (`git show <branch>:<ticket>`). Two further tickets were filed by builders mid-build rather than at intake: **dl-59** (a defect, with reproduction, on #248's branch, `status: ready`, not built) and **dl-61** (the shadow-DOM regression, `depends_on: [dl-55]`, on #251's branch, `status: ready`, not built). A mechanical builder made one further commit on #250, a reword of a dropped Log note, changing no finding, verdict or citation. `npm run status -- --ready` on this branch's base lists dl-51, dl-55 and dl-57 as ready; dl-60 carries no ticket file on `main` at all and no `difficulty` field on its own branch |
| `agents` / `dispatches` | **11** agents, orchestrator-reported: 1 seam-mapper; 6 builders (dl-51, dl-55 and dl-57 on Sonnet; dl-60 on Opus; a Haiku one-line reword; a Sonnet pin-repair that stopped correctly, without committing a wrong remedy); 4 ticket-reviewers (dl-51, dl-55 and dl-57 on Opus; dl-60 on Sonnet — confirmed in #252's body, "Builder: Claude Opus 5. Gate: Claude Sonnet"). **11** spawns. Wakes were **not tallied** |
| `builder rounds` | **Not tallied exactly.** At least **2** were the orchestrator's own fault: the dl-51 × dl-57 seam miss, which forced a stacked rebase of dl-57 and a separate phase-2 gate; and the pin-repair dispatch, whose remedy (re-resolve citations at the tip) the orchestrator recommended without measuring it first, and which failed on all 3 branches it was tried on. A Sonnet weekly usage limit also killed the dl-57 builder mid-round, orchestrator-reported at 01:40 UTC; it resumed after the 02:00 reset. dl-57's own committed Log separately records at least 3 gate-driven rounds (the FAIL fix, the CONCERNS fix, the phase-2 rebase) not attributed to orchestrator fault |
| `gates` | Verdict sequences, read from each ticket's committed `## Review`: **dl-51** CONCERNS (`04c2fb7`) → PASS (`d331300`). **dl-55** FAIL (`fc8be9e`) → CONCERNS (`16084d2`) → CONCERNS (`d8aced1`), then shipped under conditional authority with no committed PASS round. **dl-57** FAIL (`790c17b`) → CONCERNS (`7b0cdcb`, three lows fixed after) → CONCERNS (`c64defb`, the phase-2 rebase gate) → PASS (`2c26f18`). **dl-60** CONCERNS (`f43135f`) → PASS (`faebe96`) — **two rounds as committed**, where the account handed to this row states three; not reconciled here. Every round short of the three named PASSes returned findings |
| `wrong findings` | **0 gate findings refuted.** Builder self-reports refuted by a gate, both confirmed in committed ticket text: dl-55's claim that a cross-origin frame "has no evaluation context" (round 2 measured it false directly, against two real cross-origin servers); dl-60's claim that "each call site has its own test" (gate 1's med finding: `jobs/orchestrator.ts:220` had none, closed in `faebe96`). A third self-correction, not a finding that reached a commit wrong: an earlier draft of dl-60's own Log claimed its round-2 spec "would not load" on `main`; the gate disproved it by running the spec (22 failed, 6 passed of 28), and the Log was corrected before committing. Separately, one gate wrote a self-contradictory sentence, orchestrator-reported and in no committed record: a `TypeError` "counted as 1 of the 6 passes — actually a failure." The orchestrator relayed the wrong half; the builder caught it before any commit |
| `subagent tokens` | **3,446,956** in total, last observed per agent: seam-mapper 98,673 · dl-51 builder 486,017 · dl-57 builder 784,264 · dl-55 builder 586,523 · dl-60 builder 282,531 · Haiku reword 70,665 · pin-repair 102,914 · dl-51 gate 220,718 · dl-55 gate 196,927 · dl-57 gate 287,553 · dl-60 gate 330,171. Split: builders 2,312,914 (67.1%) · gate 1,035,369 (30.0%) · intake 98,673 (2.9%). **Caveats, orchestrator-reported:** the dl-55 gate's figure was reported twice, non-monotonically (202,260 then 196,927), and its round-3 total was never reported; the dl-57 gate's final rounds ended in `SendMessage` and were not reported. The total above undercounts by an unknown amount |
| `cost` | **≈ $62.73** at the page's 2026-09-02 rate of $0.0182/1k — an arithmetic conversion of the token total above, not billed. That rate is not re-measured here and is now over a week stale |

**Model pairing.** dl-51, dl-55 and dl-57 each carry `difficulty: standard` in
their own frontmatter, and each PR body names its builder as Sonnet and its
gate as Opus (#248: "Builder: Claude Sonnet 5. Gate: Claude Opus 5"). dl-60
carries no `difficulty` field — an emergent, same-session filing rather than
an intake ticket — and #252's body names Opus as builder, Sonnet as gate.

### What the skill got wrong

Eight items, from the orchestrator's account. Items 1–3 and the self-report
parts of "wrong findings" above are checked here against the pages and
tickets they name; items 4, 5, 6 and 8 are orchestrator-reported and not
independently checked; item 7 is checked against item 1's simulation.

1. **`reference/records.md`'s pinning rule is measured false under this
   repo's settings.** It says a gate record
   (`.claude/skills/orchestrate-tickets/reference/records.md@95c6403:135 "A gate record pins to the sha it reviewed"`)
   stays
   (`.claude/skills/orchestrate-tickets/reference/records.md@95c6403:137 "reachable afterwards through the ticket's pull request"`).
   Whether this repo deletes a branch on merge is orchestrator-reported (`gh
   api` is denied here); what is independently confirmed is CI's `check` job
   checking out with `fetch-depth: 0`
   (`.github/workflows/ci.yml@95c6403:98 "cheaper of the two ways to give the gate a memory"`),
   which fetches branches and tags, never `refs/pull/*`.
   - **The simulation, reproduced here:** a fresh clone, dl-51's branch
     squashed onto a local `main`, its branch ref deleted, `git gc
     --prune=now`, then `citations-gate.mjs --against origin/main`. Exit 1:
     16 unresolvable, `rev 04c2fb7 not in this repository` — `04c2fb7` is
     dl-51's own gate-1 fix commit, which the committed record pins 16
     citations to.
   - **Already live on #250:** its pre-merge rebase orphaned the phase-1
     gate's `@790c17b` and `@7b0cdcb` pins — confirmed here, both fail
     `git merge-base --is-ancestor` against the branch's current tip. That
     CI's `check` job fails on that branch with the same message is the
     orchestrator's account, not re-run here.
   - **Re-resolving pins at the tip is not a remedy:** the pinned citations
     quote code that later gate rounds rewrote (orchestrator-reported,
     matching item 7 below).
   - **A tag on the reviewed commit is a remedy:** the same simulation, with
     a tag placed on `04c2fb7` before deletion and pruning, exits 0 (74
     enforced, 0 failing) — reproduced here.
   - **The owner chose to merge and repair on `main` afterwards**, and to
     record the defect here rather than file a ticket (orchestrator-reported).
   - **Contrast, orchestrator-reported and not checked here:** the peer
     session's gates name reviewed shas only in prose headers, never as
     `@sha:` pins, and none of its six PRs is exposed to this failure mode.
2. **The seam map missed dl-51 × dl-57.** As finished, diffing dl-57's own
   commits (over dl-51's tip, which it carries as an ancestor after the
   rebase) against dl-51's own diff over `main` finds **9** shared paths
   here — `.env.example`, `config.ts`, `routes/probe.ts`, `server.ts`,
   `01-ARCHITECTURE.md`, and four ticket records — not the reported 11; the
   method behind that count is not stated in the account handed to this row.
   dl-57's own committed Log records the real cost of the rebase itself: one
   structural conflict in `routes/probe.ts` (dl-51 wraps the handler body in
   an outer `try`/`finally`; dl-57 had restructured the same region into a
   `try`/`catch`/`finally` dl-51's tree never had) and two more in citation
   pins shared with the `dl-32` and `dl-46` records, resolved by taking the
   union of both branches' pins. A peer session's seam-mapper had flagged the
   refusal-classification seam first (orchestrator-reported, not checked
   here).
3. **`builder.md` never mentions `scripts/citations-gate.mjs`,** which CI's
   `check` job runs
   (`.github/workflows/ci.yml@95c6403:190 "node scripts/citations-gate.mjs --against"`).
   Confirmed absent across `.claude/agents/` and `.claude/skills/` apart from
   `review-ticket/SKILL.md`, which does name it
   (`.claude/skills/review-ticket/SKILL.md@95c6403:213 "job over every"`
   and
   `.claude/skills/review-ticket/SKILL.md@95c6403:403 "one part of a ticket CI checks"`)
   — but nothing tells a *builder* to run it before pushing. Builders
   learned of it mid-batch from a peer session's warning
   (orchestrator-reported).
4. **No procedure for a vulnerability a gate finds in a public repo.** dl-60
   is exactly that case — a live SSRF bypass, per #252's body, "live on the
   deployed downloader." The improvised practice, orchestrator-reported:
   - keep it out of every committed record, using a neutral line;
   - build the fix locally, gated from the shared object store without a
     push;
   - push only on the owner's word;
   - keep related weaknesses out until the fix merges.

   This row follows the same instruction it was given for the same reason:
   it names only the IPv6 spellings #252's own body already states publicly
   (mapped, SIIT, compatible, well-known NAT64, Teredo, 6to4, local-use
   NAT64) and no others.
5. **No guidance on model usage limits.** A weekly limit killed a builder
   mid-round with uncommitted work (orchestrator-reported: the dl-57
   builder, 01:40 UTC, resumed after the 02:00 reset). The work survived
   only because the worktree was held open rather than reclaimed on
   completion.
6. **The resume-versus-fresh cost is unguided.** Resuming the dl-57 builder
   — cumulatively 784,264 tokens by this session's own figures — for a
   one-line Log reword would have reloaded that whole context; a fresh Haiku
   builder did the same edit for 70,665, about 9% of it. Both totals are the
   orchestrator's account; the artifact the cheaper path produced, `9dfe385`,
   is confirmed here and changes exactly the one Log line its own message
   describes.
7. **The orchestrator offered a remedy it had not measured.** Re-resolve-at-
   tip failed on its premise: the pinned citations quote code that later
   gate rounds rewrote, so re-resolving against the tip repoints a citation
   at text the reviewed commit never had. Running `citations.mjs` on an
   unpinned copy — what the pin-repair builder did, per the orchestrator's
   account — would have shown the failure before it was recommended. Its
   later option text was also wrong: it said "only prose" would remain once
   the affected branches merged, though the reviewed commits still exist,
   fetchable, on every branch checked here, so tagging them remains
   possible — item 1's simulation depends on exactly that. **It then failed
   for real:** tried on all three branches carrying orphaned pins,
   re-resolve-at-tip failed identically on each, because the pinned
   citations quote code later gate rounds had already rewritten. The
   pin-repair builder stopped rather than guess, which was correct. One
   `citations.mjs` run against an unpinned copy of the record would have
   shown this before the remedy was recommended — see "What happened after
   this row was written," below.
8. **A reviewer reported lacking `ListAgents`,** which its frontmatter
   grants (orchestrator-reported). This is a self-report; this dispatch has
   no channel to that agent's transcript and does not check it.

### What this row's verification added

- **dl-60's committed gate history carries two rounds, not three.** Its
  `## Review` shows CONCERNS at `f43135f` and PASS at `faebe96` only; no
  third verdict is committed anywhere in the ticket. The account handed to
  this row states three. Neither side settles which is right here — a third
  round could have happened and gone unrecorded, or the account over-counts.
- **The dl-51 × dl-57 file-overlap count does not reproduce at 11.** The
  method available to this dispatch — diffing dl-57's own commits against
  dl-51's, since dl-57 carries dl-51 as an ancestor after the rebase — finds
  9 shared paths, including the three the account names by name
  (`routes/probe.ts`, `config.ts`, `server.ts`). A different method, applied
  before the rebase collapsed the two branches' histories together, may be
  what produced 11.

### What happened after this row was written

This row was written before the batch's last phase, and under-reported it.
The correction below exists because the owner asked for it, not because a new
gate ran on this branch — the same shape as this page's own mandatory field,
which "does not arrive on its own" unless an agent is asked for it explicitly
(see "Why the last field is mandatory," above). Orchestrator-observed unless
marked otherwise; nothing below is independently reproduced by this amending
dispatch except where stated.

**The pinning defect played out, and cost four repair rounds across five
PRs.** Item 1 above already records the defect as a simulated failure; this
is what it cost for real:

- After #252 (dl-60) merged as `cbfdbba` and its branch was deleted, a fresh
  clone of `origin/main` at `49515ba` failed the gate:
  `dl-60-guard-embedded-ipv4.md` — 1 unresolvable, rev `f43135f` not in this
  repository. **`main`'s `check` job was red, and so was every open PR's, in
  both sessions.** A peer session reproduced it independently.
- The owner was offered archive tags (simulation exit 0) versus prose repair,
  and chose **prose**: re-point a citation that still resolves at the tip,
  rewrite the rest as prose naming the reviewed commit. The earlier "merge
  first, repair after" choice is what made `main` red in between.
- Repairs: #255 (dl-60's record, on `main`), then #248 and #251 on their
  branches, then #250 after its rebase. Each was proven by a squash-and-prune
  simulation in a fresh clone, and by the orchestrator re-running that
  simulation itself.
- **dl-51 then moved four unpinned citations in dl-60's merged record** —
  `probe.ts`, around line 48 and again around line 134; `jobs.ts`, around
  line 53; `config.ts`, around line 427 — which CI caught; they were pinned
  to `@cbfdbba`.
- **dl-57 carried 41 orphaned pins** (`@790c17b`, `@7b0cdcb`): 34 re-pointed,
  7 rewritten as prose.
- Final state: everything merged; `main` at `b6d3014` verified in a fresh
  clone — citations gate exit 0 (81 enforced, 0 failing), `npm run status --
  --json` exit 0.

**Three more entries for "what the skill got wrong," continuing the
numbering above:**

9. **A citation on an extension-less file is invisible to the checker.**
   `tools/downloader/Dockerfile@790c17b:152` carried a dead pin that
   `citations.mjs`'s grammar cannot see — confirmed by this dispatch reading
   `INLINE`'s pattern, which requires either a slash-qualified path ending
   in `.\w+` or a known extension, and `Dockerfile` has neither — so it is
   not counted, not resolved, and not failed. dl-57's builder found it by
   grep. A green citations run is not evidence that every citation in a
   record was checked.
10. **A stale object store makes the check lie.** Any checkout that ever
    fetched the branch still holds the pinned commit until gc, so the gate
    exits 0 locally while CI fails. A peer session hit this. Only a fresh
    clone, or squash plus `git gc --prune=now`, is a valid test;
    `git branch -r --contains <sha>` printing nothing is the tell.
11. **Re-running a workflow does not pick up a repaired base.**
    `gh run rerun` re-uses the merge commit computed when the run was
    created: #251 failed with the identical error at 21:37 and again at
    23:24 after `main` was fixed. A push — merging `origin/main` into the
    branch is enough — is what produces a fresh merge ref. This cost two
    extra pushes (#251, #256).

Item 7's outcome, once the remedy it offered unmeasured was tried for real,
is recorded in place above rather than repeated here.

**Agent and token figures, reconciled.** The row above's 3,446,956 was
correct for its own eleven agents at the time — the sum of its own
per-agent figures, re-added here rather than trusted. Two adjustments carry
it forward rather than simply adding to it:

- **`102,914` — the pin-repair agent's first report, superseded rather than
  added to.** `subagent_tokens` are cumulative per agent (see the schema
  section, above), so a later report replaces an earlier one rather than
  joining it; the pin-repair agent's own last report, `265,947`, is the row
  below and belongs in the total once, not twice.
- **`197,180` — the agent that wrote the original row itself, never counted
  in its own eleven** because an agent cannot report its own total inside
  the document it is writing. It belongs in the total from here.

Five more agents ran afterward, distinct from the eleven above:

| Agent | Model | Task | Tokens |
| --- | --- | --- | --- |
| builder | sonnet | pin repairs on #255, #248, #251 (supersedes the `102,914` above) | 265,947 |
| builder | sonnet | dl-63 measurement and filing (#256) | 116,035 |
| builder | haiku | rebased the history row (#253) | 61,654 |
| builder | haiku | merged main into dl-55 (#251) | 37,902 |
| builder | haiku | merged main into dl-63 (#256) | 30,224 |
| builder | sonnet | dl-57 rebase and 41-citation repair (#250) | 187,258 |

That makes **17** distinct agents: the original eleven, five new builders in
the table above, and the row's own author. The reconciled total is
**4,240,242**: `3,446,956 − 102,914 (superseded) + 699,020 (the six rows
above, which already carry the supersession's new figure) + 197,180 (the
row's own author) = 4,240,242` — equivalently, the sum of all seventeen
agents at their last observed figure. Both this total and every other token
figure on this page **exclude cache reads**, which dwarf it and are
effectively the whole bill (see the schema section, above); and it is still
missing two gate agents' unreported final rounds, per the original row's own
caveat, so `4,240,242` is a floor rather than a count.

## Twenty-second session — 2026-09-17/18

**Written by Claude Sonnet 5, dispatched as a records-only builder for this
step, transcribing the orchestrating session's own account of a batch it ran
(orchestrated by Claude Opus 5, 1M context), with no gate on this branch —
scoped to this file alone.** Two pull requests were read with `gh pr view <n>
--json …`, never by eye: #264 (`pl-44`) and #266 (`pl-40`). Each ticket's
committed `## Review` and Log were read with `git show <branch>:<ticket>`
after fetching both branches locally, `pl-50`'s filed ticket included.
`npm run status -- --ready` was re-run on this branch's own base
(`origin/main` at `20c8fd1`). CI conclusions were read per sha with
`gh run list --branch <b> --limit 6 --json workflowName,status,conclusion,headSha,event`,
checked twice, twenty minutes apart.

**Independently reproduced here, not merely relayed:**

- #264's three commits (`1bce511` → `5359847` → `088b11f`) and #266's four
  (`125dac5` → `6813a9e` → `0568981` → `0947440`) match the account's shas
  exactly, read from each PR's own `--json commits`.
- Frontmatter at each branch tip (`git show <branch>:<ticket>`): `pl-44`
  `status: done`, `difficulty: hard`. `pl-40` `status: in-flight`,
  `difficulty: standard`. `pl-50`, filed on `pl-40`'s branch,
  `status: ready`, `difficulty: standard`.
- `pl-44`'s committed `## Review`: **PASS** at `5359847`, first pass
  **CONCERNS** at `1bce511` (one med, one low, one Log-framing correction) —
  matches the account's gate sequence exactly.
- `pl-40`'s committed `## Review`: **Gate 1 CONCERNS** at `125dac5` (3 med, 6
  low, 2 open decisions, counted directly off the labelled bullets), **Gate 2
  PASS** at `6813a9e` — matches.
- `pl-44`'s own Log agrees with the account's correction (a): its "dropped,
  agreed" bullet says the orphan-close-before-the-check bullet "is not one
  \[a departure]" because Build's own step 3 already specifies that order.
- `pl-40`'s Log confirms the redaction-walk exchange behind the account's
  correction (b) and owner decision C in full: gate round 1's MED 1 entry
  describes the original reproduction, the second false positive found while
  re-verifying the first fix, and the rework; the 2026-09-18 Log entry for
  decision C names the gate's second-pass plants as exactly three shapes —
  Google Cloud, Akamai, and a bare password parameter — each now covered by
  its own regression test.
- The stale `_Open with the owner_` cross-reference fix is in `pl-44`'s own
  Log fold-in list, dated to the owner's 2026-09-17 decision.
- **Owner decision B's premise, independently measured here, not only taken
  on the account's word:** `git show origin/pl-40-live-harness:tools/planner/api/test/fixtures/wikipedia-geosearch.json`
  parses to 426 entries, `lat` 46.734–46.892, `lon` −71.336 to −71.116 — a
  tight radius capture around one point (46.8139, −71.208, `dist: 0`,
  "Bibliothèque de Québec"), consistent with the account's "single capture
  centred on Québec City" and not a Montréal–Québec corridor spread. The
  account's exact quoted phrase for the gate's own caveat — "if it covers the
  corridor, which I have not verified" — does not appear verbatim in the
  committed ticket; the committed record's own wording for open decision B is
  narrower ("changes which 40 finds survive the notability-first ranking …
  The orchestrator's call"), consistent with the account's substance but not
  a verbatim source for the quote.
- CI at #264's tip (`088b11f`): `CI`, `pr-title`, `planner`, `security` all
  `success`. CI at #266's tip (`0947440`), re-checked twice: `pr-title`,
  `security`, `planner` and `downloader` all `success`; **`CI` itself was
  still `in_progress` at both checks** — unresolved as this row is written,
  which is the account's own claim and is not settled further here.
- The subagent-token arithmetic below re-adds correctly from the five
  per-agent figures, checked with a plain calculation rather than trusted
  from the account.
- `SKILL.md`'s steps 10–12 and its "After a merge" section, cited for items 2
  and 5 below, read as the account states at `20c8fd1`.

**Orchestrator-reported, not verified here:** the agent and dispatch counts
beyond what each PR body itself states, every sideways wake, the attribution
of rounds to orchestrator fault versus structure, and the framing of the
gate's own caveat behind item 1 below (the substance is confirmed in the
committed record; the exact wording is not, per the bullet above).

| Field | Value |
| --- | --- |
| `tickets` | **2** taken from ready to a gated PR: `pl-44` (`hard`) → **#264**, branch `pl-44-replan-run-and-edits`, `1bce511` build → `5359847` repair → `088b11f` gate record, `status: done`, all four PR workflows green at `088b11f`. `pl-40` (`standard`) → **#266**, branch `pl-40-live-harness`, `125dac5` → `6813a9e` (gate-1 repairs) → `0568981` (gate record) → `0947440` (owner decisions A–D, files `pl-50`), `status: in-flight` **by design** — no agent here holds an Anthropic key, so the harness merges in-flight and the owner's own paid run against `claude-opus-5` is what moves it to `done`. One further ticket filed on `pl-40`'s branch: `pl-50` (the thinking-token breakdown pl-39's usage mapping drops), `status: ready`, not built. `npm run status -- --ready` on this branch's own base (`20c8fd1`) lists both `pl-44` and `pl-40` |
| `agents` / `dispatches` | **5** agents, orchestrator-reported: 1 seam-mapper (inherited model, no explicit `model` at dispatch); `pl-44` builder (`opus`); `pl-40` builder (`sonnet`); `pl-44` gate (`ticket-reviewer`, `sonnet`); `pl-40` gate (`ticket-reviewer`, `opus`) — both pairings confirmed in their own PR bodies. **5 spawns**, plus **2 `SendMessage` resumes** (one per builder, each carrying decisions and conditional ship authority). Sideways builder↔reviewer wakes **not tallied exactly**; at least 4 occurred (each gate's findings→builder, the builder's reply→reviewer, the final `## Review`→builder, plus one further wake on `pl-40` for a citation correction — confirmed in the ticket's own text, see below) |
| `builder rounds` | **7 total, 0 attributable to orchestrator error.** `pl-44`: 3 (build, gate repair, gate record — the third round also opened the PR). `pl-40`: 4 (build, gate-1 repairs, gate record, owner decisions + ship). The two ship rounds are the skill's own default (step 9, "The builder opens the PR"); `pl-40`'s decision round is structural, since the owner's answers could not exist before the gate raised the questions they answer |
| `gates` | **2 agents, 4 rounds, every round returned findings.** `pl-44`: CONCERNS at `1bce511` (1 med, 1 low, 1 Log correction) → PASS at `5359847`, record `088b11f`. `pl-40`: CONCERNS at `125dac5` (3 med, 6 low, 2 open decisions) → PASS at `6813a9e`, record `0568981` |
| `wrong findings` | **0 refuted, 0 reached a commit wrong.** Two corrections recorded instead, both confirmed above: (a) `pl-44`'s own Log first called the orphan-run close a "departure from the brief"; the gate read Build step 3 and found it already specifies that order, so the Log was corrected, not the code. (b) `pl-40`'s gate found the redaction walk false-positived on the harness's own records; the builder's fix surfaced a second false-positive shape the gate had not hit; the gate's second pass then planted three signed-URL/credential shapes (Google Cloud, Akamai, a bare password parameter) the fix still missed — which became owner decision C |
| `subagent tokens` | **1,626,625** total, last observed per agent: seam-mapper **124,836** (19 tool uses) · `pl-44` builder **479,029** · `pl-40` builder **539,188** · `pl-44` gate **296,234** · `pl-40` gate **187,338**. Re-added here: builders **1,018,217 (62.6%)** · gates **483,572 (29.7%)** · intake **124,836 (7.7%)** — the account's own split, and it checks out exactly |
| `cost` | **≈ $29.60** — an arithmetic conversion of the total above at the page's 2026-09-02 rate of $0.0182/1k, not billed. That rate is **16 days stale**, over two weeks, as of this row |

**Model pairing, recorded at dispatch, confirmed in both PR bodies.**
`pl-44` (`difficulty: hard`) built by `builder` dispatched as `opus`, gated
by `ticket-reviewer` dispatched as `sonnet` — matching the skill's `hard`
row. `pl-40` (`difficulty: standard`) built as `sonnet`, gated as `opus` —
matching the skill's `standard` row.

**Owner decisions, four, all through `AskUserQuestion`, options with the
recommendation first, none overridden — confirmed in `pl-40`'s own Log entry
dated 2026-09-18:** **A**, keep the spend-stop formula as Build step 3 states
it, document the one-run fallback overshoot rather than double the term.
**B**, keep the `articlesNear` stub rather than wire in
`wikipedia-geosearch.json` — independently measured here (above) to be a
single capture at the corridor's destination end only. **C**, keep the
credential-shaped-query-parameter denylist, widen it with `X-Goog-Signature`,
`X-Goog-Credential`, `hdnts`, `hdnea`, `password`, `pwd` and `credential`,
each with its own regression test. **D**, file `pl-50` rather than fold the
`ModelUsage`/`usageOf` fix into `pl-40` — `pl-40`'s Log says the "thinking
share of output" column stays unfillable until `pl-50` merges.

### What the skill got wrong

Seven items. Items 1–6 are the orchestrator's account; items 2, 4 and 5 are
checked here against the pages they name, and the rest are reported. Item 6
is checked and found **false** for this session, not merely confirmed — see
"What this row's verification added," below. Item 7 is this dispatch's own
defect, reproduced here from `git reflog` rather than taken on the
orchestrator's word.

1. **A gate's recommendation can rest on an unverified premise, with no row
   for it in `SKILL.md`'s Relaying table.** Orchestrator-reported: the
   `pl-40` gate recommended wiring `wikipedia-geosearch.json` through
   `articlesNear` conditioned on an unverified premise about corridor
   coverage; the orchestrator measured it false (see above) before it
   reached the owner. Proposed rule: a gate prompt must say that a
   recommendation whose condition is unmeasured is not a recommendation —
   measure it, or name it as blocking and hand the decision up unrecommended.
2. **The loop has no state for a ticket that merges deliberately
   unfinished.** Confirmed against `SKILL.md`'s own loop, read at `20c8fd1`:
   step 10 says hold every worktree "until the ticket is finished", and step
   11 says check the merge landed what it was supposed to; neither names a
   ticket whose `status` merges as `in-flight` on purpose. `pl-40` merges
   exactly that way. Also worth
   naming: `--ready` will not re-offer an `in-flight` ticket, confirmed by
   this row's own `--ready` run above listing `pl-44` and `pl-40` and no
   third planner ticket in that state — so the follow-up depends on the
   owner remembering to run the owner's key against it.
3. **Step 12's own row is unbudgeted work in the shared checkout.**
   Orchestrator-reported and consistent with this dispatch's own experience:
   appending to `history.md` means editing a tracked file the repo's
   worktree convention forbids touching in `/workspaces/tools`, so the row
   is its own builder, worktree, PR and merge — a whole dispatch
   `sizing.md` never counts. This dispatch is that cost.
4. **The `standard` row's gate is the expensive half, and the page implies
   the opposite.** Checked against this session's own figures: the Opus gate
   on the Sonnet-built `pl-40` cost **187,338**, against the Sonnet gate on
   the Opus-built `pl-44`'s **296,234**, with both gates at two rounds
   (CONCERNS → PASS). So here the pairing table's more expensive builder
   model produced the cheaper gate — one measurement, not a rule, and
   consistent with the account's framing.
5. **`## After a merge` gives the orchestrator the pre-merge look, but a
   batch that ends before CI finishes has no owner for the rest of it.**
   Confirmed against `SKILL.md`'s own "After a merge" section, read at
   `20c8fd1`: it asks for one `gh run list --json` look per branch about to
   land, naming the sha — and this row's own re-check (above) is exactly
   that shape, run on a PR (`#266`) whose CI was still `in_progress` at both
   looks. The skill does not say whether the look belongs to the shipping
   builder (discouraged by
   the no-polling convention) or leaves the batch's `# Done` carrying an
   unresolved check.
6. **The commit trailer named Opus on both branches, including the
   Sonnet-built one — reported as confirmed, and found false here.** See
   "What this row's verification added," below.
7. **Concurrent agents share one branch namespace and one ref store, and
   nothing in the skill says so.** This dispatch's own worktree setup
   collided with the live `pl-40` builder's, on a ref rather than a file.
   Reproduced from `git reflog show history-twenty-second-session`, which
   *is* `pl-40`'s reflog because the two branches were briefly one ref,
   oldest to newest: `branch: Created from origin/main`, `pl-40`'s four
   commits, `branch: Reset to origin/main`,
   `Branch: renamed refs/heads/pl-40-live-harness to
refs/heads/history-twenty-second-session`, `reset: moving to 0947440`, then
   back to `20c8fd1`. This dispatch's setup step took a branch name
   (`pl-40-live-harness`) straight from stale context instead of naming its
   own work, and the rename that fixed the mistake hit the shared local ref a
   sibling worktree had checked out mid-repair. Nothing was lost only because
   `pl-40`'s builder read its own reflog before acting rather than assuming,
   and because all four of its commits already existed on
   `origin/pl-40-live-harness` — confirmed here, `pl-40-live-harness` and
   `origin/pl-40-live-harness` are both `c13afe5` now, one commit ahead of
   `0947440`, and PR #266 is unaffected. **Had those commits been local
   only — the ordinary state for most of a build, and `pl-44`'s own state for
   most of this batch — the reset would have taken them, and the branch that
   lost them would have looked exactly like a branch that had never
   committed.** `concurrency.md` reasons about file collisions between two
   builders; `worktree-hygiene.md` reasons about holding and releasing a
   worktree; neither covers a setup step that reuses or renames an existing
   branch. The two builders here were dispatched against different tickets
   and different files — the seam map was correct — and they still
   collided, on a ref neither of them chose carelessly. Proposed rules, both
   cheap: a builder's setup must fail rather than reuse or rename an
   existing branch name, and a records-only dispatch should be told its
   branch name rather than left to pick one from context.

### What this row's verification added

- **Item 6 does not hold for `pl-40`.** `git log origin/pl-40-live-harness -4
  --format='%(trailers:key=Co-Authored-By,valueonly)'` returns
  `Claude Sonnet 5 <noreply@anthropic.com>` on all four commits — not Opus.
  `pl-44`'s three commits (`git log origin/pl-44-replan-run-and-edits -3`)
  carry `Claude Opus 5 (1M context) <noreply@anthropic.com>`, as the account
  states. So the trailer matched each builder's **own** dispatched
  model here, not a single value inherited once per session tree from the
  orchestrator — the opposite of what `SKILL.md`'s worked mechanism and this
  row's own attribution instructions describe. This dispatch's own
  attribution reminder names `Claude Sonnet 5` for its commits, consistent
  with the `pl-40` builder's trailer and not with the "inherited from the
  orchestrator" claim; the 2026-09-06 Haiku-signed-Opus measurement the skill
  cites is not reproduced or contradicted here, so the mechanism may depend
  on how a subagent is dispatched (backgrounded versus a direct `model`
  parameter) rather than being uniform. Recorded as a live counter-example,
  not a resolution.
- **Owner decision B's premise is independently confirmed, not only
  orchestrator-reported** (see the bullet above): the fixture is a single
  426-entry radius capture centred at Québec City, not a corridor.
- **The account's exact quoted phrasing for the gate's caveat in item 1 does
  not appear in the committed ticket.** The substance — an unmeasured
  condition behind a recommendation — is confirmed; the sentence is not, and
  may be from the live exchange rather than the committed summary.
- **Item 7's ref collision is reproduced from `git reflog`, not taken on the
  orchestrator's relay.** `git reflog show history-twenty-second-session` in
  this worktree returns the same eight-entry sequence the orchestrator
  quotes, oldest to newest ending at `20c8fd1`; and `git show-ref | grep
  pl-40-live-harness` here shows both the local and the `origin` ref at
  `c13afe5`, one commit ahead of `0947440` — matching, not merely
  consistent with, the orchestrator's own end-state check.

## Twenty-third session — 2026-09-17/18

**Written by Claude Sonnet 5, dispatched as a records-only builder for this
step, transcribing the orchestrating session's own account of a batch it ran
(orchestrated by Claude Opus 5, 1M context), with no gate on this branch —
scoped to this file alone.** Five pull requests were read with `gh pr view <n>
--json …`, never by eye: #269 (`dl-58`), #263 (`dl-59`), #265 (`dl-61`), #267
(`dl-56`), and #262 (the `dl-63`/`dl-66` decisions record). Each ticket's
committed `## Review` and Log were read with `git show <branch>:<ticket>`
after fetching all five branches locally, `dl-67` and `dl-68` (filed mid-batch)
included. `npm run status -- --ready` was re-run on this branch's own base
(`origin/main` at `20c8fd1`). **This row is stacked on PR #268
(`history-twenty-second-session`), not on `main`**, because #268 was still
open when this dispatch started — its own row is the twenty-second, and this
one has to read after it.

**Independently reproduced here, not merely relayed:**

- Every branch tip matches the account exactly (`git rev-parse`, fetched
  locally): `dl-58` → `4bc2871`, `dl-59` → `7bed832`, `dl-61` → `224ea35`,
  `dl-56` → `6035bca`, the decisions branch → `515dc30`.
- `dl-58`'s six gate rounds, verdicts and shas match its own committed
  `## Review` exactly: FAIL at `b63d8c6`, FAIL at `31ba6c9`, FAIL at
  `d81cfce`, FAIL at `29aaacd`, CONCERNS at `6f17db4`, PASS at `ed4ece4`.
  Frontmatter at the tip: `status: done`, `difficulty: standard`.
- `dl-59`'s two gate rounds match: FAIL at `483ca7d`, PASS at `c70dd8a`
  (labelled "Gate 2 — re-check of the gate 1 findings" in the ticket's own
  text). `status: done`, `difficulty: standard`.
- `dl-61` carries no `difficulty` field at all, confirming it inherited Opus
  rather than being rated, and one gate round — PASS, reviewed at `7d801d6`;
  its current tip (`224ea35`) is one commit past that, filing `dl-68`.
  `status: done`.
- `dl-56`'s frontmatter carries `difficulty: hard`. Its `## Review` shows
  Gate A: PASS (reviewed at `cff1440`, redirect-hop and split-DASH coverage
  reconfirmed at `4c13032`) and Gate B: CONCERNS (`4c13032`) → a follow-up
  PASS (`4479b6d...c887152`) once the owner's server-wide concurrency cap
  was built — matching the account's "Gate A PASS; Gate B CONCERNS then
  PASS." `status: done`.
- The disputed seek-placement finding, quoted from `dl-56`'s own Log: "the
  Log's `-ss` placement table's 1-second-segment row … did not reproduce on
  my original fixture (640x360@15fps, g=15, video-only: 1.00x, no
  difference). Re-running with the builder's exact fixture (1280x720@25fps,
  g=25, both with and without audio) reproduced their numbers exactly
  (1.245x and 1.255x)." The reviewer's own fixture was the coarser one, as
  the account states, and the Log records both reviewers as agreeing the
  output-side choice is unaffected either way.
- `dl-58`'s gate 2 carries the med finding item 1 below describes, word for
  word close enough to check: "the gate-1 record is not in the branch: the
  ticket at 31ba6c9 has no `## Review` section … A merge from this commit
  loses the FAIL that caused the round" — the round the account attributes
  to the orchestrator's own hold instruction.
- `.claude/skills/orchestrate-tickets/SKILL.md@fdafd1a:224 "that nothing is committed"`
  carries no carve-out anywhere near it for a gate record that is itself only
  reachable through a commit — confirming the gap item 1 names.
- `dispatching.md`'s "Tell the reviewer to send a `## Review` block for the
  builder to commit verbatim" instruction lives as prose at line 171, under
  its own heading, and is absent from the "So make gate 1 look like gate 4"
  bullet list at line 288 — confirming where the rule does and does not
  live. Which literal prompt text `dl-56`'s two gates actually received is
  not checked here; only the reference page's own structure is.
- `records.md`'s documented formatter failure (its item 4) names "gate
  tables" specifically ("oxfmt rewrapping gate tables broke a
  self-referential row twice"), which is narrower than the prose-bullet case
  item 5 below describes — confirming that gap too.
- Both `dl-58` (`engine/src/index.ts`, the `runFfmpeg` export line) and
  `dl-56` (the same file, ten lines inserted immediately after) touch that
  file on adjacent lines over `origin/main` — confirmed by diffing each
  branch against `origin/main` directly, not taken on the account's word.
- The subagent-token arithmetic re-adds to **3,007,314** from the eleven
  per-agent figures below, checked with a plain calculation rather than
  trusted from the account — matching the account's own sum exactly.
- `.claude/agents/builder.md` — the file behind this dispatch's own system
  prompt — never mentions `CLAUDE.md`'s "Handing back" section or the
  `# Done` heading anywhere across its 296 lines (`grep -n` finds nothing);
  `.claude/skills/orchestrate-tickets/SKILL.md@fdafd1a:312 "Close the batch with"`
  states the rule instead. So a subagent whose instructions are
  drawn only from `builder.md` has no textual source, inside that file, for
  the prohibition it is nonetheless expected to follow.
- `SKILL.md`'s step 12 is one sentence — "Append this session's row to
  `reference/history.md`, in the schema that page fixes" — naming no state
  for two sessions appending at once, and this page's own sessions are
  numbered by ordinal ("Twenty-second", "Twenty-third", …), which is exactly
  what collides if two are written from the same base at the same time.
- Every one of #269, #263, #265, #267 and #262 is still **OPEN**, unmerged
  (`gh pr view --json state`), as the account states.

**Orchestrator-reported, not verified here:** the agent and dispatch counts
beyond what each PR body itself states, every sideways wake, the exact count
of builder rounds and which were the orchestrator's fault beyond the two
mechanisms checked above, the framing that Gate A's findings arrived as
narrative-only until the builder noticed at close-out (the ticket today
carries a committed `### Gate A` section, so only the end state is checked
here, not the intermediate one), and the `dl-68` quote-requoting detail — the
committed file already reads `"open"`, and no earlier single-quoted revision
exists anywhere in that branch's own history to diff against, so this dispatch
can neither confirm nor refute it from the tree alone.

| Field | Value |
| --- | --- |
| `tickets` | **4** taken from ready to a gated PR, plus one records-only ticket shipped without a gate: `dl-58` (`standard`) → **#269**, tip `4bc2871`, six gate rounds. `dl-59` (`standard`) → **#263**, tip `7bed832`, two gate rounds. `dl-61` (unrated, inherited Opus) → **#265**, tip `224ea35`, one gate round. `dl-56` (`hard`) → **#267**, tip `6035bca`, two reviewers, three rounds total (Gate A once, Gate B twice). The `dl-63`/`dl-66` decisions, recorded by a builder with no gate → **#262**, tip `515dc30`. Two further tickets filed mid-batch, not built: `dl-67` (yt-dlp misclassifies a no-media page as DRM, found by `dl-58`'s gate) and `dl-68` (play/metadata scripts stop at shadow roots, measured by `dl-61`'s gate). All five PRs **open**, none merged, as of this row |
| `agents` / `dispatches` | **11** distinct agents, orchestrator-reported: 1 seam-mapper; 1 records-only decisions builder; `dl-58` builder and gate; `dl-59` builder and gate; `dl-61` builder and gate; `dl-56` builder and two gates (A and B). **21** total: 11 spawns plus 10 orchestrator messages. Agent-to-agent messages between builders and reviewers were numerous and were **not** counted — reported as such rather than guessed at |
| `builder rounds` | **Not tallied to one number here** (orchestrator-reported per ticket): `dl-58` six, `dl-59` three, `dl-56` four, `dl-61` three (two after its gate). **2 attributed to the orchestrator's own fault**, both checked above: (1) a hold instruction with no carve-out for the gate record itself, which `dl-58`'s own gate 2 then raised as a med finding, costing a round on the orchestrator's own instruction; (2) a `dl-56` gate prompt that never asked for a commit-ready `## Review` section, unlike `dl-58` and `dl-59`'s prompts — checked here against where the instruction lives in `dispatching.md`, not against the literal prompt text itself, which this dispatch never saw |
| `gates` | **12 rounds across 5 reviewer dispatches; all but the final confirming round of each ticket returned findings.** `dl-58`: FAIL ×4 → CONCERNS → PASS. `dl-59`: FAIL → PASS. `dl-61`: PASS (one round, one low). `dl-56` Gate A: PASS (one round). `dl-56` Gate B: CONCERNS → PASS |
| `wrong findings` | **1 refuted, and it reached no commit.** `dl-56` Gate B's claim that the seek-placement table's 1-second row did not reproduce was itself wrong — its own fixture was coarser than the builder's; re-run with the builder's exact parameters, it reproduced the builder's numbers exactly, confirmed above from the ticket's own Log. A second disputed item went the other way, and did reach a commit: `dl-58`'s builder challenged a one-word transcription finding; the reviewer checked its own saved draft against the sent text and the wording stood, closed in gate 5's "verified" bullet (word-diffed) |
| `subagent tokens` | **3,007,314** total, re-added here from the last-observed per-agent figures and matching the account's own sum exactly: seam-mapper 67,687 · decisions builder 126,137 · `dl-58` builder 735,973 · `dl-58` gate 301,674 · `dl-59` builder 226,789 · `dl-59` gate 164,324 · `dl-61` builder 154,913 · `dl-61` gate 218,770 · `dl-56` builder 468,567 · `dl-56` gate A 240,624 · `dl-56` gate B 301,856. Several agents' final turns ended in `SendMessage` with no reported usage block, so this is a floor, not a count — the account's own caveat, not contradicted here. Excludes cache reads |
| `cost` | **≈ $54.73** — an arithmetic conversion of the total above at the page's 2026-09-02 rate of $0.0182/1k, not billed. That rate is **16 days stale** as of this row |

**Model pairing, confirmed in each PR's own body, not taken on the account's
word.** `dl-58` (`difficulty: standard`): "Attribution. Builder: Claude Sonnet
5. Gate (all six rounds): dispatched as Claude Opus." `dl-59`
(`difficulty: standard`): "Built by Sonnet 5 (dispatched as builder). Gated
by Opus (dispatched as `ticket-reviewer`)." `dl-61` (no `difficulty` field):
"Built by Claude Opus 5 (1M context). Gated by `ticket-reviewer`, dispatched
as Sonnet." `dl-56` (`difficulty: hard`): "Built by Claude Opus 5 (1M
context); both gates dispatched as Claude Sonnet." All four match the
skill's own `standard`/`hard`/inherit rows in `builder.md`.

**Owner decisions, confirmed in the PR bodies that name them.** `dl-58`
carries four: D1(a) logger-wide substring redaction, D2 fix the success-path
`Referer` inside this ticket rather than file it separately, D3(b) a
case-insensitive URL matcher (which also protects ffmpeg's own stderr
redaction, proven with its own tests), D4(b) drop branch-sha pins from the
gate record in favour of prose plus evidence declarations, since a pin to a
branch-only commit cannot survive this repo's squash-merge-and-delete-branch
flow — the same failure mode `records.md`'s pinning section and the
twenty-first session's row both already document, now designed around rather
than repaired again. `dl-56` carries one: a server-wide cap on concurrent
frame grabs (`MAX_CONCURRENT_FRAME_GRABS`, defaulting to
`MAX_CONCURRENT_JOBS`), overriding the builder's own recommendation to leave
the gap and file a ticket to measure it under load, and matching Gate B's and
the orchestrator's inclination instead.

**Seam overlap.** `tools/downloader/engine/src/index.ts` is the batch's only
cross-branch collision: `dl-58` rewrites the `runFfmpeg` export line to add
`redactUrlsInText`, and `dl-56` inserts ten new export lines immediately
after that same line. Neither branch carries the other as an ancestor, so
whichever of #269 and #267 merges second is the one that needs a rebase —
confirmed by diffing both branches against `origin/main` directly, not taken
on the account's word.

### What the skill got wrong

Seven items. Items 1 (both halves), 4, 5 and the `# Done` half of item 3 are
checked here against the pages and tickets they name; items 2, 6 and 7, and
the narrative-findings half of item 3, are the orchestrator's own account and
are reported rather than independently checked.

1. **Two mechanisms cost a round each, and both are structural rather than a
   one-off mistake — see the bullets above for each.**
   - **A hold instruction with no carve-out for the gate record itself.**
     When `dl-58`'s gate 1 raised decisions for the owner, the orchestrator
     told the builder to commit and push nothing, and never carved out the
     gate record. The record went uncommitted, and gate 2 then raised it as
     a med finding — a round spent on the orchestrator's own instruction.
     The "Independently reproduced" bullets above cite the guidance in
     question, which has no exception for the gate record — exactly the
     thing that must be committed regardless of whether a decision is
     still open.
   - **A gate prompt that never asked for a commit-ready section.** The
     `dl-56` gate prompts asked for findings in full but, unlike the `dl-58`
     and `dl-59` prompts, never said to return a `## Review` section as text
     for the builder to commit. Gate A sent narrative findings only, so its
     record was missing from the ticket until the builder noticed at
     close-out (orchestrator-reported; the ticket today carries the record,
     so only the repaired end state is checked here).
     `dispatching.md` carries the rule in prose, at its own heading; the
     "so make gate 1 look like gate 4" bullet checklist does not repeat it.
2. **The orchestrator never asked its agents for this field at dispatch**,
   which the schema explicitly requires (see "Why the last field is
   mandatory," above the seventh session's row). The items here are the
   orchestrator's own observations plus what agents volunteered unprompted;
   a session that asked at dispatch time would likely have more. Not
   checked here — this dispatch has no view of the dispatch prompts used.
3. **`# Done` reached reports to the orchestrator twice** — the decisions
   recorder and `dl-58`'s builder, orchestrator-reported — which `SKILL.md`
   forbids for subagents (it says so at `CLAUDE.md:259 "Handing back"`,
   which `SKILL.md` inherits). Checked here:
   `.claude/agents/builder.md` does not carry that rule at all — it never
   mentions `CLAUDE.md`, "Handing back," or a `# Done` heading anywhere
   across its 296 lines.
   The "Independently reproduced" bullets above cite where `SKILL.md` states
   the rule instead, but a builder's own agent file is silent on it, so a
   subagent that had read only its own instructions would have no way to
   know the heading is forbidden to it.
4. **Step 12 has no guidance for a concurrent session writing the same
   file.** Confirmed against `SKILL.md`'s own step 12, which is one
   sentence naming no state for two sessions appending at once. PR #268 was
   open on `history.md` while this row was being written, which is why this
   PR is stacked on #268 and marked draft rather than opened against `main`.
   The skill numbers rows by ordinal ("Twenty-second," "Twenty-third," …),
   which is exactly the scheme that collides if two sessions both compute
   their own ordinal from the same base.
5. **oxfmt split a citation's coordinate from its quoted anchor across a
   line wrap, in prose.** `records.md` documents that failure for gate
   tables only (its item 4, quoted above); `dl-58`'s builder hit the same
   failure in a prose bullet — the "two words of the transcription" note in
   its own gate 6 names "the `oxfmt` line-wrap that forced it" — and
   repaired it by hand rather than fighting the formatter.
6. **"Verbatim" versus the formatter, a second shape.**
   Orchestrator-reported: in `dl-68`, `npm run format` re-quoted a string
   *inside* a quoted reproduction block (`'open'` → `"open"`). The reviewer
   judged it formatting, not content. `dispatching.md`'s verbatim discussion
   covers self-citation — a reviewer's own sent text against what the
   builder commits — not a formatter rewriting a quotation's punctuation
   after the fact. Not independently checked: the committed file already
   reads `"open"`, and this branch's own history carries no earlier
   single-quoted revision to diff against.
7. **Evidence for "do not cap the gate count," with a number.** `dl-58` ran
   six rounds and five returned findings, including two credential leaks (a
   shared object, then a cycle's own back edge) that only appeared *after*
   the first three highs were fixed — confirmed above from the ticket's own
   gate 2 and gate 3 sections. It cost `dl-58`'s builder and gate together
   **1,037,647** subagent tokens (735,973 + 301,674, re-added here), about
   34.5% of the whole batch's 3,007,314. A three-gate cap would have stopped
   at gate 3, before either credential leak surfaced, and shipped one.

### What happened after this row was written

This row was written while the batch's PRs were still open and `dl-56` still
had post-PR work running. The correction below exists because the owner
asked for it — the same shape as the twenty-first session's own amendment,
and the same reason the page's last field is mandatory: nothing here would
have been captured by a session that merely moved on once its row was
committed.

**`dl-56` took three more rounds after this row was written, all post-PR, all
now merged into the record.** Confirmed by re-reading the ticket at its
current tip (`4dfa0bf`) and re-running `gh pr checks 267`:

1. **The owner's server-wide grab-cap decision was built** — already
   described above under "Owner decisions" and closed as "Gate B follow-up:
   PASS" in the ticket's own `## Review`, at `4479b6d...c887152`.
2. **A CodeQL fix, plus the Windows-leg instrumentation that led to it.**
   GitHub's default code-scanning setup — the ticket's own words, "a
   different check from this repo's own `codeql` job, which passed" — raised
   a file-system race between the byte cap's `fs.stat` and its `fs.readFile`
   on `preview-frame.ts`. The fix opens the path once and reads through that
   one handle. This also broke a citation: Gate A's output-check bullet had
   quoted the exact `readFile` line the fix deleted. The ticket's own text
   names the rule this earns (item 11 below): "A citation that cannot be
   repointed is a verdict to rewrite, not a coordinate to edit, so it went
   back to Gate A, which reproduced the change on its own and sent an
   amended bullet" — committed at `7fd038b` and visible in the `## Review`
   section itself as "_(Amended by the reviewer at `cf86ecb`, replacing the
   bullet written at `cff1440`...)_".
3. **A fixture repair for the Windows leg's split-DASH test**, at `21b052f`
   and `4dfa0bf`. The builder's own Log is explicit about not guessing at the
   cause from one failure: it added instrumentation first, waited for a real
   Windows run, read the assertion message it produced (`HTTP error 404 Not
   Found`, the requested paths, the platform), and only then diagnosed the
   MPD naming a file the served directory did not hold — not a codec or
   muxer difference, which was the first, unproven hypothesis. The fixture
   now generates with its working directory at the served directory instead
   of an absolute path, and asserts its own naming assumption so a future
   platform difference reads as a sentence rather than another opaque
   `expected null not to be null`.

**Final state, confirmed here, not taken on the account's word:** `gh pr
checks 267` at `4dfa0bf` returns eleven checks, all `pass` — including two
separately named CodeQL entries, `CodeQL` (the default code-scanning setup)
and `codeql` (this repo's own `security.yml` job), and `test
(windows-latest, informational)`.

**The `gh run list --branch` blind spot behind item 8 below is reproduced
here, not only reported.** Re-running the exact command
`SKILL.md`'s own `## After a merge` section names —
`.claude/skills/orchestrate-tickets/SKILL.md@fdafd1a:179 "gh run list --branch"` —
against `dl-56-grab-a-preview-frame`, filtered to the commit named in the
account (`6035bca`), returns exactly four workflow-level rows, all
`success`: `pr-title`, `security`, `downloader`, `CI`. Neither `CodeQL` (a
check run from GitHub's default setup, not a workflow at all, so `gh run
list` cannot see it in principle) nor `test (windows-latest, informational)`
appears in that output in any form, even though the latter's failing job is
`continue-on-error` — confirmed at
`.github/workflows/ci.yml:338 "continue-on-error:"` — so the *workflow*
still reports `success` while the job inside it did not. Whether the PR's
check rollup actually showed two failures at that exact commit is not
independently checked here: this dispatch has no `gh api` access (denied by
this repo's own settings) and the branch has since moved past that commit, so
only the *mechanism* is reproduced, not the historical state.

Four more entries for "what the skill got wrong," continuing the numbering
above:

8. **`gh run list --branch` hides real failures, and `SKILL.md`'s own `##
   After a merge` section is what tells you to use it.** It reports
   *workflow* conclusions, not the PR's check rollup. Two shapes hide behind
   a green workflow list: a `continue-on-error` job inside an otherwise green
   workflow (this repo's own `windows-latest, informational` leg, by design —
   `repo-31`'s own reasoning, cited in `ci.yml`), and a check run that is not
   an Actions workflow at all, such as GitHub's default code-scanning setup,
   which `gh run list` cannot see regardless of flags. The account reports
   the orchestrator used the weaker command for the whole batch and nearly
   closed with both unseen — not independently checked, since this dispatch
   cannot see the orchestrator's own session. The mechanism itself is
   reproduced above. The remedy: `gh pr checks <n>` or `gh pr view --json
   statusCheckRollup`, with `gh run view <id> --log-failed` to read why a
   failing one failed. Worth naming precisely because this repo runs **two**
   CodeQL scans under names that collide in casual prose (`CodeQL` and
   `codeql`) — confirmed above from `gh pr checks 267` — so "CodeQL passed"
   is ambiguous here unless the sentence says which.
9. **Inference stated as measurement, three times in one afternoon, by three
   different agents — orchestrator-reported, not independently checked.**
   Two reviewers are reported to have independently called a deterministic
   one-platform failure "flaky" and retracted when challenged, then both
   described the cause as the Windows muxer writing paths differently —
   itself an inference, not what CI showed, which was only that the MPD
   named a file the served directory did not hold. The builder is reported
   to have caught that version and kept it out of the committed record. This
   dispatch cannot see the live exchange that produced or retracted those
   claims, so the episode itself is not verified — but the ticket's own
   committed text is consistent with a builder that refused to do the same
   thing: its Windows-failure entry states explicitly "What it does not
   establish, and I did not guess," names two competing hypotheses without
   picking one, and says outright "I could not check the win32 binary...
   and I stopped rather than find another way around."
10. **The "commit nothing while a decision is open" hold silently blocked a
    gate record, and it cost more than one round.** Item 1 above already
    names the mechanism; the outcome, re-checked directly against the
    ticket: `dl-58`'s gate-1 record was still absent from the ticket at
    `31ba6c9` — gate 2's own reviewed commit — which gate 2 raised itself as
    a med finding ("the gate-1 record is not in the branch … a merge from
    this commit loses the FAIL that caused the round"), and gate 3 is the
    first round whose own findings confirm it closed ("gate 2 M2 is closed
    apart from the transcription bullet"). Counting inclusively from the
    hold at gate 1 through the round that fixed it, that is three rounds a
    record everyone already had in hand sat uncommitted. The exact same
    shape recurred once more in the same ticket: gate 5 separately found
    that gate 4's own record "had gone uncommitted entirely," fixed in gate
    5's own round — confirmed on `dl-58`'s own branch (unmerged, so cited
    here as prose rather than a coordinate: `git show
    dl-58-redact-probe-error-url:tools/downloader/docs/work/dl-58-a-failed-probe-logs-the-page-url-unredacted.md`,
    around its gate 5 section), which reads "gate 4 is missing from the
    record and the preamble miscounts." One ticket, one root cause, two
    separate rounds lost to it.
11. **A gate whose record cites a line a later fix deletes cannot be
    repointed, only rewritten — and the rewrite is the reviewer's to make,
    not the builder's.** Confirmed directly from `dl-56`'s own committed
    text (quoted in full above): its builder held its push rather than
    editing a reviewer's verdict to match the new tree, and asked Gate A for
    an amended bullet instead — closing the exact failure mode `records.md`
    warns against under "do not remap a citation that is the finding's own
    evidence," but for a different reason: here the cited text is gone
    outright, not merely moved, so there is nothing left to remap it to.
    Neither `SKILL.md` nor `dispatching.md` states this anywhere; the
    builder worked it out from `records.md`'s adjacent rule and the general
    principle that a finding's words are the reviewer's, not the builder's,
    to change.

**Subagent tokens, reconciled — 13 agents, not 11.** The figure published
above, **3,007,314**, was correct for the eleven agents alive when this row
was written; it is not silently replaced here, the way the twenty-first
session's row handled its own superseded figure. Two of the original
eleven grew with `dl-56`'s post-PR work, and two more agents joined:

| Agent | Change | Tokens (last observed) |
| --- | --- | --- |
| `dl-56` builder | grew | 564,306 (was 468,567) |
| `dl-56` gate A | grew | 323,976 (was 240,624) |
| general-purpose agent | new, dispatched to read a CodeQL alert | 60,022 |
| this row's own author | new — an agent cannot report its own total inside the document it is writing, the same caveat the twenty-second session's row recorded for itself | 175,595 |

Re-added here from all thirteen agents' last-observed figures (the eight
unchanged ones plus the four above): seam-mapper 67,687 · decisions recorder
126,137 · `dl-58` builder 735,973 · `dl-58` gate 301,674 · `dl-59` builder
226,789 · `dl-59` gate 164,324 · `dl-61` builder 154,913 · `dl-61` gate
218,770 · `dl-56` builder 564,306 · `dl-56` gate A 323,976 · `dl-56` gate B
301,856 · general-purpose (CodeQL read) 60,022 · this row's own author
175,595 = **3,422,022**. Still a floor, not a count, per the same caveat the
original figure carried: several agents' final turns ended in a `SendMessage`
with no reported usage block. At the page's 2026-09-02 rate of $0.0182/1k,
that re-prices the batch at **≈ $62.28**, an arithmetic conversion, not
billed, of a rate that is now **16 days stale**, same as the rate this row's
original `cost` field used.

## Twenty-fourth session — 2026-09-19

| Field | Value |
| --- | --- |
| `tickets` | **7** taken from `ready` to a gated PR: `dl-63` → #273, `pl-50` → #274, `dl-68` → #275, `pl-46` → #276, `dl-67` → #277, `dl-66` → #278, `pl-47` → #279. `dl-50` held (needs the owner's firewall for live siteverify). Six follow-ups filed on the branches that found them: `dl-69`, `dl-70`, `pl-51`, `pl-52`, `repo-49` |
| `agents` / `dispatches` | **15** agents (1 seam-mapper, 7 builders, 7 reviewers) / **36** from the orchestrator (15 spawns, 21 `SendMessage`, 6 of those resumes after a session usage limit killed every running agent at once). Builder↔reviewer wakes are not counted |
| `builder rounds` | **~23** across 7 builders, of which **1** was the orchestrator's fault: `dl-67`'s dead `redactUrl` mask form existed only because the orchestrator's own question wording ("the request URL or its redacted form") read as a requirement, and removing it cost a round. `pl-47`'s measurement round was deliberate (measure before asking) and is not counted as a fault |
| `gates` | **18** passes across 7 reviewers; the first pass on **every** ticket returned findings (`pl-47`'s were informational plus an open decision). `pl-50` gate 1 was FAIL |
| `wrong findings` | **0** reached a commit. One gate corrected its own count ("7 false clashes" → 14 lines, with `pl-21` reclassified); `pl-46` low 3 was accepted as defence in depth after the builder's measurement showed the mutation fails earlier |
| `subagent tokens` | **3,407,252**, a floor: two agents' last reports predate their final rounds (the `dl-66` reviewer at 129,856, the `pl-46` builder at 251,952) |
| `cost` | ≈ **$62.01** at the page's 2026-09-02 rate of $0.0182/1k, an arithmetic conversion that is now 17 days stale, not a bill |

### Per agent

| PR | Model | Agent | Task | Tokens |
| --- | --- | --- | --- | --- |
| — | inherit (opus) | seam-mapper | 8 candidates, read from `origin/main` | 81,377 |
| #273 | opus | builder | `dl-63`, then `dl-70` filed | 123,277 |
| #273 | sonnet | ticket-reviewer | `dl-63`, PASS | 141,497 |
| #278 | sonnet | builder | `dl-66`, `pl-51` and `repo-49` filed; killed by the session limit, resumed | 388,269 |
| #278 | opus | ticket-reviewer | `dl-66`, 3 passes, PASS | 129,856 (stale) |
| #277 | sonnet | builder | `dl-67`, killed by the session limit, resumed | 278,428 |
| #277 | opus | ticket-reviewer | `dl-67`, 4 passes, PASS; killed and resumed | 175,701 |
| #275 | sonnet | builder | `dl-68`, `dl-69` filed; killed, resumed to open the PR | 260,690 |
| #275 | opus | ticket-reviewer | `dl-68`, 3 passes, PASS | 122,547 |
| #276 | sonnet | builder | `pl-46` | 251,952 (stale) |
| #276 | opus | ticket-reviewer | `pl-46`, 2 passes; CONCERNS until CI e2e, which then passed | 154,848 |
| #279 | opus | builder | `pl-47`, plus a worst-diff view-size measurement | 491,199 |
| #279 | sonnet | ticket-reviewer | `pl-47`, PASS; killed while composing, resumed | 241,414 |
| #274 | sonnet | builder | `pl-50`, `pl-52` filed; killed mid-edit, resumed | 379,700 |
| #274 | opus | ticket-reviewer | `pl-50`, 3 gates (FAIL, CONCERNS, PASS) | 186,497 |

Every builder/gate pair ran on different models, with each half as dispatched, per _Which model built it_.

### What the skill got wrong

1. **Step 1's intake read a stale tree.** `npm run status -- --ready` reads the working tree, and the shared checkout was 5 commits behind `origin/main`. It listed `dl-58`, `dl-59` and `dl-61` as ready after all three had merged. `git fetch` moves refs, not files. Intake has to read ticket state out of `origin/main` (`git show origin/main:<path>`), and the seam-mapper prompt has to say so.
2. **Nobody told the builders to run the citations gate.** `.claude/agents/builder.md` never mentions `citations-gate.mjs` (0 occurrences, measured). `npm run check` does not run it, but CI's `check` job does. Five of seven branches (`dl-66`, `dl-67`, `dl-68`, `pl-50`, `pl-47`) reported green to the orchestrator while CI would have gone red, and each cost a gate finding and a round. Put the command in `builder.md`'s gate list.
3. **Branches that pass alone can break `main` together, and step 11 cannot see it.** Every PR was green on its own. A scratch merge of the whole batch, then `citations-gate.mjs`, showed that `pl-47` adds two lines above a `tools/planner/CLAUDE.md` line cited in `pl-46`'s committed Review. Whichever merged second would have landed `main` red with no git conflict. The per-branch `gh run list` look in _After a merge_ cannot catch this. Add a pre-merge step: merge every open batch branch in a scratch worktree and run the citations gate. Then draft whichever PR has to go last (#279 here).
4. **Concurrent follow-up filings need pre-assigned ids.** Four builders filed tickets in the same hour. The orchestrator ran `next-id.mjs` once and handed out `dl-69`, `dl-70`, `pl-52` and `repo-49`, and nothing collided, but the skill does not say to. `next-id.mjs` also reports false clashes (`repo-49`).
5. **The skill sets no concurrency ceiling.** Fourteen agents running at once hit the session usage limit, and every agent died mid-step. The branches survived because each builder had pushed or held clean worktrees, but six resumes each reloaded a full transcript.
6. **An orchestrator's option wording becomes a requirement.** The phrase "or its redacted form" in a question to the owner was carried into the ticket as scope, and both agents then argued to keep dead code because of it. This is a costume of the _relayed option_ row that points the other way: the orchestrator's own words, relayed down.
7. **A cross-tool filing leaks into a changelog, and the fold-in rule does not warn about it.** `dl-66`'s branch filed `pl-51` under `tools/planner/` in a `fix(downloader)` PR, so it will put a downloader line in the planner's changelog, as #248 already did. The owner accepted it this time. The builder prompt should say that a ticket for another tool is filed in its own `docs` PR.

## Session 2026-09-20 — base fdafd1a

**Written by the orchestrating session (Claude Fable 5.1), which also built the
page-side work; the first row in repo-54's shape, and the first whose `cost`
is measured rather than converted.**

| Field | Value |
| --- | --- |
| `tickets` | **11** on one branch, `orchestrate-skill-sweep` (#281): the sweep of sessions 12 to 23 into the rule pages (no ticket), then `repo-50` filed, `repo-51` to `repo-57` filed and built — `repo-54`, `repo-56`, `repo-57` on the pages by the orchestrator, `repo-51`, `repo-52`, `repo-53`, `repo-55` by Sonnet builders on their own branches, merged here |
| `agents` / `dispatches` | **9** subagents (1 reviewer on the sweep, 4 builders, 4 reviewers) / **9** spawns plus about 30 orchestrator messages; sideways wakes not counted |
| `builder rounds` | `repo-51` 3, `repo-52` 2, `repo-53` 4, `repo-55` 3, each plus a landing round. **Orchestrator's fault: 3** — a brief that summed every assistant record where streaming logs a response once per block (repo-53, 86% over); a brief naming an anchor that cannot exist for a first `## Review` (repo-55); a claim that the page wiring was on the branch when it was in the working tree (repo-53, one round on a false premise) |
| `gates` | **14 passes across 5 reviewers**, every one Opus on a Sonnet build or on the orchestrator's own work: the sweep 4 (FAIL, CONCERNS, CONCERNS, PASS), `repo-51` 2 (CONCERNS, CONCERNS; a third cancelled on budget), `repo-52` 1 (CONCERNS; second cancelled on budget), `repo-53` 4 (FAIL, CONCERNS, PASS, PASS), `repo-55` 3 (CONCERNS, CONCERNS, PASS). **All returned findings.** The whole-branch gate was replaced by preflight, the full suite, the citations gate and mutation controls run by the orchestrator, on the owner's decision at 2% of the weekly budget |
| `wrong findings` | **0 gate findings refuted by a builder.** One reviewer corrected its own pin count (8 → 7) before sending. The wrong claims ran the other way: three orchestrator briefs or relays, above, and one Log sentence per script ticket caught by its gate |
| `subagent tokens` | last observed: sweep gate 390,374 · `repo-51` builder 204,236 · `repo-52` builder 571,525 · `repo-53` builder 414,369 · `repo-55` builder 213,087 · `repo-51` gate 236,498 · `repo-52` gate 136,385 · `repo-53` gate 231,915 · `repo-55` gate 285,260. Floors: three builders' landing rounds ended in messages and reported no usage |
| `cost` | **$195.40** from `node scripts/agent-cost.mjs` over the nine transcripts, rates read 2026-09-20, five synthetic session-limit records skipped; the orchestrator's own transcript is not priced. For scale, the old conversion would have called this batch about $50 |

**what the skill got wrong**

- A gate record's coordinates cannot be re-resolved by the reviewer, so the builder repoints them; every multi-round ticket paid one landing round for it → `records.md`, multi-round record; `review-ticket`, each gate is its own commit.
- Three sweeps for displaced citations each missed a scope the previous one had not named (`## Review` only, then `docs/work` only) → `builder.md`, both roots with the `*.md`; `repo-50` filed.
- `subagent_tokens` priced a batch at a third of its bill → `repo-53`, built; `SKILL.md` Cost column; `history.md` cost row.
- `gh run list` hides `continue-on-error`, `skipped` and non-workflow checks → `SKILL.md`, After a merge.
- The pre-PR checks lived as four prose rules and were skipped in three sessions → `repo-51`, built; the PR's own `fix` title would have released the downloader through one pinned record, caught by preflight's first real run.
- An agent definition is read at launch from the shared checkout, so a branch editing it is gated under the old page; a resumed reviewer runs an older one still → `dispatching.md`.
- A queued message to a running agent is not delivered until an artefact shows it → `SKILL.md` step 6, `concurrency.md`.
- A brief can name an anchor that cannot exist, or a rule that double-counts a real input; a gate's first attack should run the tool on one real input by a second method → `dispatching.md` gate checklist.
- A dispatched builder reports `# Done` because its page predates the rule → `builder.md`, `ticket-reviewer.md`.
- The session limit killed four Opus gates mid-round; damage check clean, all four resumed by message with results declared void → `worktree-hygiene.md` held as written.

**what went right**

- Every one of eleven orchestrator relays that a builder or gate contradicted was contradicted with a command, and every contradiction was right.
- A builder verified its pin revs' ancestry against `origin/main` unasked; a reviewer tested the literal-token sandbox claim it had inferred before letting a page carry it.
- The reviewer of the sweep found the sweep's own gate record could not cite the pages it moved, and the rule it produced governed every record after it.
