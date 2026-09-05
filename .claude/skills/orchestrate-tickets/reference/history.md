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
orchestrator's dispatch and against the branches in the tree. Every field marked
`not recorded` below is one only the dispatching session could see; they are left
empty rather than estimated, per the schema. Everything else was re-verified here
against commits, files and re-runs rather than transcribed — which is how three of
the nine defects below were found, none of them reported by the session and none
visible in any outcome. What could **not** be checked from a worktree is marked
where it appears: token counts, another session's transcript, and any agent's
statement about its own context.

| Field | Value |
| --- | --- |
| `tickets` | **3** dispatched concurrently off `origin/main@c37cab9` — `dl-37`, `repo-18`, `repo-19` — plus this **unticketed** skill branch. PRs #146 (repo-18) and #145 (repo-19) open at close; `dl-37` still gating. **2** further tickets filed out of dl-37 (`dl-38`, `dl-39`). `dl-32`'s decision was reported answered by the owner and held for a later batch — **and as of this branch it is not written down**: the ticket's decision section still reads "deliberately not ranked here" and its Log ends 2026-08-31. That is `dispatching.md`'s _An answered decision has to be recorded even when you do not build it_, unapplied, on the one ticket that was answered but not dispatched. Flagged, not fixed here |
| `agents` / `dispatches` | `not recorded` |
| `builder rounds` | `not recorded`. One is attributable to the orchestrator by name: two round trips on a single dl-37 decision, caused by framing a defect as one to *defer* without saying the file was one dl-37 itself introduces (`api/src/tls-rejections.ts`, added by `8245721`). The correction reached the builder mid-revert; it stopped, reconstructed from backups rather than memory, re-ran its mutation checks and disclosed the reconstruction as the thing most worth independent scrutiny |
| `gates` | **≥4 rounds recorded on the tree**, all returning findings — repo-18 two (`## Review` and `### Gate 2`, both PASS), repo-19 one (PASS), dl-37 at least one (its `TlsRejectionLog` finding is committed at `4f46415`) and still gating at close. Spawn count `not recorded` |
| `wrong findings` | **No gate finding was refuted this session**, and the schema's row does not fit what happened instead: the wrong claim ran **builder → gate**, not gate → builder, and it *did* reach a commit. See the fourth entry below |
| `subagent tokens` | `not recorded` |
| `cost` | `not recorded` |

**Board shape at intake, which the skill had already anticipated — and re-measured
here, because this branch is cut from the same base.** `npm run status -- --ready`
at `c37cab9` returns **six**, and **five carry an open decision their own page
forbids a builder from settling** (`dl-32`, `repo-15`, `repo-16`, `repo-18`,
`repo-19`; `dl-37`'s was answered on 2026-09-03). So the batch question was "which
decisions to answer", not "which tickets to run", exactly as step 2's second
bullet says. Recorded because the anticipation was written on one session's
evidence — nine and eight, on 2026-09-03 — and this is the second.

**But step 2's own grep got two of the six wrong, in opposite directions, and the
errors cancelled.** `grep -nE '^#{2,4} .*([Dd]ecision|[Oo]pen question)'` matched
five files: it counted `dl-37`, whose heading reads *"answered 2026-09-03 — not
open"*, and it missed `repo-16` entirely, because that ticket's open decision is a
**paragraph in its Build section** — *"Nothing here is a code fix, and the
deliverable is a decision. Do not settle…"* — under no matching heading. Five
matched, five blocked, and the two are not the same five. This is the session's own
theme arriving in the skill's own instruction: **the right total by a wrong
route**, which nothing downstream can catch. The bullet now says to read the
matches rather than count them.

**what the skill got wrong** — nine, all fixed on this branch. Seven are numbered
below; the other two are recorded where they were found — step 2's grep, above,
and the missing carrier for an answered-but-undispatched decision, in the
`tickets` row.

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
   observe a fact, this one is an agent reporting a check it did not run.
5. **Half of step 4's model check was redundant and the other half was
   unobservable — and the skill said neither.** `.claude/agents/ticket-reviewer.md`
   pins `model: sonnet` in frontmatter, so the gate's model was always two file
   reads and never needed `resolvedModel`; passing `model: "sonnet"` on every gate
   was belt-and-braces. The builder's model genuinely is unobservable under a
   backgrounded dispatch, which is how `concurrency.md` says to dispatch a batch —
   and entry 4 is what that costs. Step 3 now says to **pass the builder's model
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
   acceptance line `unproven`. Recorded in `dispatching.md` as a gate-prompt clause;
   **the durable fix is the agent definition's ordering and is not on this branch.**

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
