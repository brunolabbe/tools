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
non-zero exit and `status.test.ts:180` asserts the set is empty — and the pull
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
