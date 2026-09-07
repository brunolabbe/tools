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
| `cost` | actual dollars, with the date, because rates move. The conversion measured 2026-09-02 was **$0.0182 per 1k subagent tokens**, which prices the six sessions above at roughly $16 to $73 each |
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
   Under `dispatching.md:206 "Probed on 2026-09-01"`, three lines down at
   `:209`, the page says both agent types carry `ListAgents` and `SendMessage`
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
| `tickets` | **6 pull requests against `origin/main`, one merged.** `#175` (`docs/dl-44-dl-45-decisions`, decision records for `dl-44`/`dl-45`) · `#176` (`repo-30-id-sweep-repo-tickets`, a second round on `repo-30` — its first fix had already merged the same day as `#174`/`24e5bf7` and left `status: ready`, re-verified here: `docs/work/repo-30-the-id-sweep-cannot-see-repo-tickets.md:6` "status: ready" still reads that way on `main`, because the sweep's own exit-code test had never observed what it claimed to — see item 2) · `#177` (`docs/repo-decisions-2026-09-07`, four decision records: `repo-15`, `repo-16`, `repo-26`, `repo-29`) · `#178` (`dl-43-gate-progress-on-what-actually-happened`, built, plus filed `dl-46`) · `#179` (`repo-21-orchestration-skill-loop`, `repo-21` + `repo-28`, **merged as `9b426c8`**, the base this row is measured against) · `#180` (`repo-windows-ci`, filed `repo-31`, `status: needs-decision`). The supplied summary reads **"5 tickets built + 2 bookkeeping branches + 1 filing."** The two bookkeeping branches (`#175`, `#177`) and the one filing (`#180`) match the diffs exactly. **The five built tickets do not reconcile**: `git diff --name-only origin/main...<branch>` on all six names exactly four built tickets — `repo-21`, `repo-28` (both `#179`), `repo-30` (`#176`), `dl-43` (`#178`) — and `dl-46` is filed, not built, on its own branch's own diff. Re-run here, `npm run status --ready` returns exactly the four tickets this batch built or attempted (`dl-43`, `dl-44`, `dl-45`, `repo-30`) plus the four it recorded decisions for (`repo-15`, `repo-16`, `repo-26`, `repo-29`) — this batch touched every ticket that was `ready` or `needs-decision` on the board at once, which is worth recording on its own. Left as an unreconciled count rather than silently rounded to five |
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
   disagreed: `tools/downloader/e2e/sniffer/mse-page.spec.ts:102` "toHaveCount(5)"
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
   `scripts/test/citations.test.ts:1319` "This record exists at that rev and cited something different there",
   reached from `scripts/test/citations.test.ts:1318` "expect(pinned.stdout).toMatch(" — one unfixed regression
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
| `tickets` | **3** taken from `ready` to a gated branch, none merged at close: `repo-15` (#182, tip `a2c5b0a`), `dl-44` (#183, tip `b94f9bf`), `repo-16` (#184, tip `14703b5`) — every tip and PR number re-checked here with `git ls-remote --heads origin` and `gh pr view --json headRefOid`, all three open against `main`. Around them: **one ticket closed without being built** (`repo-26`, `status: done` on `repo-15`'s branch, closed as already built by `repo-22`/#161 — confirmed on `main`, where `36be01b` carries it), **one filed** (`repo-32`, `status: needs-decision`, no `## Review` heading, on `repo-16`'s branch), and **two held tickets amended on a sibling's branch** (`dl-46` on `dl-44`'s, `repo-29` on `repo-16`'s). Both amendments re-verified additive-only by `--numstat` (+24/−0 and +46/−0) and frontmatter-identical by hunk position — the added hunks open at 105 and 140, and at 387 and 653, none of them inside a nine-line frontmatter block. **Board at intake: 7 `ready`, 1 withheld**, re-measured at the base with `npm run status -- --ready` — `dl-44`, `dl-45`, `dl-46`, `repo-15`, `repo-16`, `repo-26`, `repo-29` ready, `repo-31` withheld as `needs-decision`; all four `depends_on` blockers among them (`dl-40`, `dl-41`, `dl-43`, `repo-13`) read `done`. **All three built tickets carry `difficulty: hard`, and all three were built on Opus and gated on Sonnet**, stated in each pull request body — the first batch to run entirely under `repo-27`'s pinned `hard` row, `.claude/agents/builder.md:25` "a contract, a security claim, a seam with reach" |
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
   at `.claude/skills/orchestrate-tickets/SKILL.md:261` "and a glance counts it as green"
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
   `.github/workflows/ci.yml:136` "--require-anchors" — scoped that way on
   purpose, `.github/workflows/ci.yml:128` "alone, on purpose". So the page
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
  it does. `.claude/skills/orchestrate-tickets/reference/worktree-hygiene.md:74` "Retire a reviewer when its record is pushed"
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
| `tickets` | **5 pull requests, none merged**, every one branched off `origin/main@4fad5f8` — re-confirmed with `git merge-base` per branch, all five returning that sha — and with **zero file overlap**, measured with `git diff --name-only origin/main...<branch>` on all five (3, 4, 15, 22 and 1 paths, no path in two of them). #186 `repo-33`, filed **and** built in one branch. #187 `repo-31`, option D. #188 `dl-46`. #189 `dl-45`. #190 `repo-29`, records-only and ungated. **Board at intake, re-measured at the base**: `npm run status -- --ready` returns exactly 3 — `dl-45`, `dl-46`, `repo-29` — with `repo-31` and `repo-32` withheld as `needs-decision`. **The batch took all three, answered one of the two withheld, and filed a fifth ticket it then built**, which is a complete sweep of the board in one round. Around them: `repo-34` and `dl-47` filed new (`status: ready`, on #187's and #189's branches), and `repo-32` moved `needs-decision` → `ready` on #187's — that one was **answered, not filed**, and existed at the base. Every id and status read out of `git show` on the branch rather than from the account |
| `agents` / `dispatches` | **10** agents — 1 seam-mapper, 5 builders, 4 reviewers — / total dispatches-and-wakes `not recorded` beyond the 10 spawns |
| `builder rounds` | **Not given as a count**, and the account supplies reviewer rounds instead. What is derivable from the committed records: `repo-33` **4** gate rounds over 6 commits, `dl-45` **3** passes over 3 tips plus a separate docs-only gate on its decision record, `repo-31` recorded across 3 tips, `dl-46` **1**, `repo-29` none. **Orchestrator's fault: the account attributes none, and one is legible in the tree** — `repo-33`'s round four exists only to correct a relayed claim that the Windows runner's drive layout varies between runs, and its own record says so. It produced a strictly better test anyway; see below |
| `gates` | **4 reviewers over 5 branches**, #190 ungated by the orchestrator's own authorisation as records-only. **Every verdict PASS**, all five records read out of `git show` rather than from the account. Findings: `repo-33` 1 in round one and 1 in round three, both resolved, 0 in round four; `repo-31` 2, both **dropped** as already fixed in a later commit on the same branch before the record was written; `dl-46` 4 returned, 2 carried and 2 dropped; `dl-45` 1 carried — the finding that narrowed the branch — plus 0 on its decision-record gate |
| `wrong findings` | **Five, across four links, and none reached `main` because nothing merged.** Two are the orchestrator's relayed claims, refuted by a builder each. One is a gate's reading of `citations.mjs`'s exit codes, refuted by the builder committing its record. One is a stale count inside a gate record, caught by the gate itself. One is advice that a builder disproved by building it — see the two lists below |
| `subagent tokens` | **2,019,787 across all 10 agents, none missing** — last-observed cumulative, so every figure is a floor and the total is a floor. `dl-45` builder 412,457 · `repo-33` builder 276,856 · `repo-31` reviewer 213,774 · `dl-46` reviewer 206,179 · `dl-45` reviewer 199,585 · `repo-31` builder 194,572 · `dl-46` builder 193,356 · `repo-33` reviewer 165,138 · `repo-29` builder 103,556 · seam-mapper 54,314. Re-added here; the supplied total is exact. Split: builders 1,180,797 (**58.5%**) · gates 784,676 (**38.8%**) · intake 54,314 (**2.7%**). By model: Opus 1,235,111, Sonnet 784,676. **It is a floor for a second reason the account states plainly** — several agents kept working after their last usage report, and a final turn that ends in a `SendMessage` delivers no usage block at all |
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
branches, and the correction is narrow.** `repo-33`'s frontmatter reads
`difficulty: standard` on its own branch, and `repo-34` is filed `standard` too.
The claim holds *at intake* — neither existed when the board was read — and the
outcome was fine: `repo-33` was built on Opus, which is above what
`.claude/agents/builder.md:23` "Its gate is" asks for. What the claim hides is
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
   second run's checkout step. `repo-33`'s reviewer checked the two cited runs
   itself rather than accepting the correction — both log
   `Working directory is 'D:\a\tools\tools'`. The second: an instruction to run
   `node scripts/next-id.mjs downloader`, when the script takes a **prefix**.
   Re-run here, that is worse than an error — `node scripts/next-id.mjs
   downloader` prints `next free: downloader-1` and **exits 0**, a confident
   answer to a question nobody asked, and
   `scripts/next-id.mjs:29` "export const USAGE =" is the one line that says so.
   Both were one command
   from being right. **The `repo-33` builder refused to record the first**, on
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
   `grep '^## Review'`, returned empty on `repo-33` while both agents considered
   the exchange closed and reported finished. Verified from the tree: at
   `a1c2a83`, the branch's first commit, that grep matches nothing. It is the
   same discriminator the entry two above records catching the same shape,
   holding unaltered for the second consecutive session —
   `.claude/skills/orchestrate-tickets/SKILL.md:157` "Empty means the exchange is still open".
5. **A gate record's own citations are this batch's most-measured defect, and
   the one anchored round is the only round in which the mechanism caught
   anything.** #190 exists to record it. On `repo-33`'s record the checker
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
   content inside `repo-33`'s draft pull request body. The session scratchpad is
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
   `.claude/skills/orchestrate-tickets/SKILL.md:261` "and a glance counts it as green"
   as still saying only `cancelled`. It still
   does. **The new datum is the third instance in three consecutive sessions**,
   which retires the reading that the first two were coincidence.

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
