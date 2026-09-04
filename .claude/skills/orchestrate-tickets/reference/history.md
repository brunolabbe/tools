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

**What went right, and is worth copying.** Every builder corrected the orchestrator at least once — a stale timing figure, an unmerged capability claimed as landed, a laundered mechanism, and a rule that contradicted the repo. Two agents *deleted their own tests* for passing on something the old code also satisfied. Two reviewers ran controls nobody asked for: a pure order-swap to isolate an ordering claim rather than a removal, and a simulated **over**-narrowing to prove the suite catches the mirror defect. And a builder with unconditional ship authority declined to upgrade its own gate's CONCERNS to PASS, on the grounds that doing so would be transcribing a better verdict onto its own work.
