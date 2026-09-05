# Dispatching builders and gates

## Dispatching a builder

`.claude/agents/builder.md` is loaded into every builder before your prompt is,
and it carries the setup order, the scope rule, the gate commands, the
bookkeeping, "do not spawn subagents", "say what you could not do" and "push back
rather than transcribe". **Do not restate any of that** — it is inherited, and a
prompt that repeats it is paying twice for the same instruction while making the
part that is genuinely yours harder to find.

**The one thing you set that is not in the prompt is the model**, and it comes
from the ticket's `difficulty` field rather than from your read of the work —
`npm run status -- --json` carries it, the table has no column for it, and
[`.claude/agents/builder.md`](../../../agents/builder.md) holds the mapping.
Absent means inherit, which is most tickets. You have not read the brief; do not
rate it.

What only you can supply, and what every builder prompt therefore carries:

- **The ticket, and the base.** Say the base explicitly — `origin/<base>` —
  especially for a stacked branch. The agent knows *how* to set up; only you know
  what it is building and what it is building on.
- **The sibling that carries the handover.** The agent definition cannot know
  which sibling ticket's Log holds the context for this one. You do, from intake.
- **What is already settled**, if this is a resume: which findings are addressed,
  what must not be re-done, what a previous round measured.
- **Ship authority, or not.** The default is stop before the PR. On the *last*
  relay, replace it with conditional ship authority — see [sizing.md](sizing.md).
  This is per-dispatch by definition and is the single highest-value line in the
  prompt, because it removes an entire round.
- **The fold-in exception, out loud.** The agent is told to implement the Build
  section and not widen it. Say in the prompt that if the work in front of it
  makes some *other* small, already-specified piece of work free, it should fold
  it in rather than leave it — and if it decides not to, write in the Log that it
  could have and why it did not. That note is what lets you catch the call; a
  silent deferral is invisible. See _Fold it in, or file it_ in
  [sizing.md](sizing.md).
- **Where to write scratch files**, namespaced by ticket — see
  [concurrency.md](concurrency.md) on the pull request that briefly carried
  another ticket's body.
- **The narrowest thing that can fail**, for verification runs. Agents reach for
  the whole directory by default; say the spec file. See [sizing.md](sizing.md)
  for the 20x this costs.

### An answered decision has to be recorded even when you do not build it

The case this loop had no step for, measured 2026-09-03. A slice was dispatched
with its ticket's question held open; the user then answered it — and the answer
was *bigger* than the branch, reversing an architectural decline documented in the
service's own source. Widening the running builder into it would have destroyed the
thing that made the slice dispatchable in the first place.

**The scope call is easy and the bookkeeping is the part that gets dropped.** Keep
the slice; give the large half its own branch, its own gate and its own reviewer.
But an answer that is neither built nor written down **evaporates**, and the ticket
is then actively misleading: its Build still describes the mechanism the decision
just replaced, so the next agent builds the wrong half off stale text and nothing
in the repo contradicts it.

So when you hold an answer back from the build, spend the one message anyway — the
builder is already editing that ticket, which makes this nearly free, where a
future dispatch to record one decision is a full round. Ask it to:

- **Record the question, the answer and the reason** in the ticket's own settled-
  decision form, unmistakably answered rather than still open.
- **Mark the superseded Build step**, without rewriting it into a new brief — that
  is the next agent's job, with the deployment in front of them.
- **Carry the cost that came with the answer.** The objection the chosen option has
  to meet travels with it, or whoever builds it rediscovers it from scratch.
- **Say `status` stays `ready`.** The half is decided, not done.

And say **do not implement any of it** in those words. An agent handed a decision
reads it as work.

**The harder case is an answer to a ticket you never dispatched, because there is
no carrier at all.** Everything above rides on a builder that is already editing
the file. When you ask a question to *clear the board* rather than to unblock a
running agent — which is what a decision-blocked intake produces — the answer
arrives with nobody holding the ticket, the cheap path does not exist, and the
rule silently does not apply. Measured **2026-09-05**, at the batch's close-out
rather than during it: `dl-32`'s decision was answered and deferred to a later
batch, and its page still reads "deliberately not ranked here" with a Log ending
at the filing date, 2026-08-31 — five days. **Recording it is its own dispatch and
has to be scheduled as one** — cheap, but not free, and not something to notice at
close-out.

## Dispatching a gate — the highest-leverage thing you write

Gate yield tracked prompt specificity, not gate number. In the reference session
gates 4 and 5 were the cheapest **and** the highest-yield, because by then the
prompts said *reproduce this exact mutation* instead of *review this*.

**Name the builder in every gate prompt.** The reviewer sends its findings to the
builder itself now, so a gate prompt that does not say who to address has no
channel — give the builder's agent id (never an agent-type name; see below).
**Do not tell it to fetch `SendMessage` first**: both agents carry `SendMessage`
directly and neither has `ToolSearch`, so that instruction sends a reviewer to a
tool it does not have — measured, and recorded below. Say explicitly what still comes back to you: an
unsettleable disagreement, and any open decision. Anything else you ask to be
routed through yourself, you are volunteering to retype.

### Never write an install into a gate prompt

**Do not tell a reviewer to run `npm ci` or `npm install`** — in this repo you
populate a worktree with `worktree-farm.sh` then `npm run build`, and the farm
script refuses outright when pointed at the shared checkout. Measured 2026-09-03:
an orchestrator put `npm ci` in a gate prompt to verify a hand-edited lockfile.
That gate ran **two hours without reporting** and was killed with its spend
unmeasured.

**The lockfile was verifiable without it**, which is the part worth keeping. The
replacement gate checked the same thing in minutes: `npm ls zod -w @downloader/web`
against the farmed tree, plus reading the lockfile entry against `package.json` —
establishing that the edit added an edge to an **already-resolved** version rather
than introducing a new one. When you genuinely need a fresh-install guarantee, say
so as a question the gate may answer *"I could not verify this"*, and mean it.

**The wider lesson is about the replacement, not the failure.** Given the correct
setup and scoped to three named checks with the container and cross-browser tails
explicitly dropped, it returned a sharper result than the two-hour attempt — it
read a library's source to establish that an ordering hazard was intrinsic rather
than assumed, and it worked out which *tier* of the suite guards that ordering.
**Gate yield tracks prompt specificity, not runtime**, and this is the cleanest
measurement of that on the page: same branch, same model, two prompts.

### And say the checkout comes before the build

`ticket-reviewer.md` gives the setup order as farm, then `npm run build`, in a
section that sits well above the one telling the reviewer to `git checkout
--detach <sha>`. A gate read it top to bottom on 2026-09-04 and **built `main`** —
grading a tree that was not the branch — catching it only because `dist/` was
missing a file the branch adds, and flagging it unprompted. Nothing else would
have: a reviewer measuring the base produces a fluent, correctly formatted gate
that marks acceptance lines `unproven`, which is the silent failure that page
already warns about arriving from the other direction. One clause in the prompt —
*fetch, detach onto the sha, **then** farm and build* — costs nothing. **This is a
habit-dependent stopgap, and the durable fix is the agent definition's ordering**,
filed as `repo-20`. When that lands, keep the measurement and drop the clause —
a reminder for a bug that no longer exists is worse than no reminder.

### Send the findings in full; the builder writes the section down

**Do not tell the reviewer to send a `## Review` block for the builder to paste
verbatim.** An orchestrator did exactly that on 2026-09-03 and it was wrong —
`docs/01-TICKETS.md:239` is explicit that *"the reviewer reports and the builder
writes the section down"*, with the date, the verdict, an acceptance table naming a
test per `Done when` line, and a bullet per finding including the ones needing no
change. Verbatim transcription is nowhere in that rule, and the reason it is not is
the same one a reviewer discovers the hard way: **a reviewer's worktree is thrown
away, so a section authored there is authored into nothing.** The record has to be
written where it will survive.

**The hazard the verbatim instruction was reaching for is real, but it is a
different one: a record must never carry findings or verdicts its writer never
received.** Both halves of that were measured the same afternoon, and the contrast
is the whole lesson.

- A reviewer sent the orchestrator a literal block and sent the **builder** a prose
  narration of the same six attacks. The builder refused to compose the record from
  it, on the grounds that paraphrasing a narration and labelling the result verbatim
  is a substitution described as the thing itself. **Right call** — it did not have
  the findings in full, only a description of them.
- A sibling reviewer sent its builder two complete findings reports, then said "go
  ahead and write the section". The builder wrote a compliant section: date,
  verdict, both passes and their shas, `capture-rules.test.ts:359` and two more per
  acceptance row, a bullet per finding. The reviewer flagged it as "not verbatim".
  **The section was correct**, and it did something a pasted block could not — it
  attributed which side measured what, because by then the builder had run
  experiments the reviewer had not seen when it wrote its report.

So the test is **not** "are these the reviewer's exact words". It is **"was every
finding and verdict in this section actually received"**. What the gate prompt
should require is therefore about completeness, not form:

- **Send findings in full, not a summary** — every finding, its evidence, its
  disposition, and the acceptance verdicts with their test citations. A builder
  cannot write down what it was not told.
- **Do not authorise the commit before the findings are complete.** Ordering is
  what bit here: "ship it, my findings follow" is a race the builder cannot see,
  where "here are my findings, then ship" is one message.
- **A builder that refuses to fabricate a record is doing its job**, not being
  obstinate. Budget the round rather than pressing it.

### Addressing, which is where this loop actually failed

**Give the gate prompt the builder's agent id**, and require the reviewer to
**state its own id back** in the message it sends. The asymmetry is structural
rather than an oversight to fix: the builder is dispatched first, so its prompt
cannot name a reviewer that does not exist yet, and the reviewer's message is the
only channel by which it can learn the return address.

**An agent id, never an agent-type name.** `SendMessage` to `"ticket-reviewer"`
does not resolve. Three consecutive test runs read as a broken design — a builder
reporting the reviewer "not reachable" and falling back to the orchestrator — and
all three were this. The same call with the id succeeded first time. When a report
says a sibling was unreachable, **ask for the verbatim error before believing the
channel is at fault**; none of the three reports contained one, and there was no
error to contain.

### What was measured about the channel

Probed on 2026-09-01, against the real agent types rather than reasoned from the
tool docs:

- **Both `builder` and `ticket-reviewer` carry `ListAgents` and `SendMessage`
  directly.** Not deferred, and **neither has `ToolSearch`** — a prompt telling
  either to fetch `SendMessage` first sends it to a tool it does not have.
- **Siblings are mutually visible.** A subagent's `ListAgents` listed another
  agent running under the same parent that it had not spawned. This is the fact
  the whole design rests on and it was the one in doubt.

**One correction worth keeping, because it nearly became a rule.** An earlier pass
probed both agent types immediately after adding the tools to their frontmatter,
got "I do not have those tools" from both, and concluded that the agent registry
is read once at session start and that frontmatter edits cannot take effect until
a new session. **That was wrong** — a later probe in the same session found both
tools present. The refresh mechanism was not determined and is not worth guessing
at; what is worth keeping is that a negative probe taken moments after an edit is
not evidence about the design, and a claim that broad deserved a second
measurement before it was written down.

**Also note the self-report is unreliable.** Each probe listed fewer tools than
its own frontmatter grants — a builder reporting eight where the file lists
thirteen, omitting `Grep` and `Glob`, which it certainly has. Ask an agent to
*call* a tool, not to tell you whether it has one.

**So make gate 1 look like gate 4.** Every gate prompt should:

- **Name what to attack.** The riskiest decision, the seam with the longest reach,
  the claim you least believe. Generic review finds generic things.
- **Demand reproductions, not conclusions.** "Revert the fix, confirm it goes red"
  beats "assess whether the test is adequate". A builder's own mutation claim is
  self-transcription — reproduce it independently.
- **Require a positive control before any negative is believed.** Make the gate
  prove its own harness can produce the failure it is looking for, and state that
  result in the review. This is the single highest-yield line in a gate prompt: in
  the third session the gate on a security claim pointed ffmpeg straight at the
  untrusted origin first, got a clean refusal, and only then ran sixteen candidate
  options — which is the entire reason its sixteen negatives are evidence rather
  than a broken fixture.
- **Expect a judgement question to come back as an echo.** The corollary to the
  rule above, and it is the one that decides what a gate is worth. Ask a reviewer
  to *run* something and you get information you did not have. Ask it to *judge*
  something you have already doubted — "is this over-specified?", "is the register
  right?", "is that claim earned?" — and you will usually get your own doubt
  returned in better prose, which feels like corroboration and is not. Both
  readings were already in your prompt.

  Measured on one gate in the fourth session, over a 45-line diff: six findings,
  **three genuinely independent** (a heading that swallowed the section's closing
  paragraph; a worked example that fused two incidents needing two different
  commands; a documented command that exits 2 because it names no pattern — the
  reviewer ran it), **two echoes** of questions the prompt had already raised, one
  cosmetic. Every independent one required executing or resolving something; every
  echo was pure judgement. Scope a gate toward what it must run, and accept that
  the questions you already know to ask are the ones it can least help you with.

- **Enumerate, never sample.** Say "walk every conditional and `??` in these files
  and report how many you tested and what survived". Sampling misses clustered
  defects, and a claim of *none left* is worth exactly what the sweep behind it was.
- **Check the ticket's premise, not only its code against the ticket.** When a
  ticket rests on machinery — a workflow, a scheduled job, a hook, an external
  service — make one gate confirm that the machinery **actually runs**, by reading
  its run logs, not that the code calling it is correct. A green pull-request check
  and a working mechanism are different claims, and no amount of reviewing the
  diff distinguishes them: in the reference session a ticket passed **four** gates
  sitting on a job that had never once done its work (the same job `## After a
  merge` names), and every gate had verified the code faithfully. This is one
  command, and it is why a whole follow-up ticket had to exist.
- **Verify the negative half of every acceptance line.** A criterion reading "a
  branch that edits X **fails** the check" is not proven by three green runs. In the
  reference session a doc ticket reached its fourth gate before anyone watched the
  check actually fail.
- **Resolve every citation, not six.** Staleness clusters in whatever was written
  earliest and edited around, so spot-checks systematically miss it.
- **Say what is already settled** and must not be redone: "gate 2 verified the
  sweep — spot-check two conclusions, then focus on this round".
- **Give verdict guidance** once findings shrink: *"say PASS unless you find
  something that would mislead a reader or let a defect through; do not manufacture
  another round."*
- **Forbid delegation.** No subagents.
- **Fix nothing.** The gate reports; the builder fixes.

Ask for: `PASS / CONCERNS / FAIL`, gates reproduced independently, findings
most-severe-first with `file:line` and a concrete failure scenario each, and
anything claimed that could not be verified.

### Authorising an outward-facing action

**This is not an exception to "Fix nothing" above** — it authorises a throwaway
branch off the base, never a change to the branch under review. See also
_When every agent dies at once_ in [worktree-hygiene.md](worktree-hygiene.md), which is the same cleanup rule arriving from the
other direction.

Sometimes a gate cannot reproduce a claim without reaching outside the repo — a
dry run that needs a branch on `origin`, a service that will not answer a local
ref. Refusing costs you the reproduction; granting it carelessly leaves debris on
a shared remote under someone else's name. Grant it with the conditions attached,
in this order:

- **One named throwaway.** Name the branch in the prompt (`<ticket>-verify-scratch`)
  so it is unmistakably disposable and you can find it later by grep.
- **Make the agent verify the preconditions itself, and say which.** "Confirm no
  workflow can fire on this ref before pushing." Do not hand it your own survey —
  a builder in the fourth session reported four workflows, all of them
  push-to-`main`, and there are **seven**. The reviewer read all seven, reached the same
  conclusion, and only then pushed.
- **Dry run only, never the real thing**, and never to the default branch.
- **Cleanup is the immediate next action after capturing the output**, not a step
  at the end of the review, and it must be stated that way. This is the rule that
  earns its keep: a session usage limit killed that gate mid-run, and it happened
  to die *just before* the push. Had the cleanup been batched with the write-up, a
  second interruption would have stranded the branch.
- **Demand proof of deletion** in the report — `git ls-remote --heads origin |
  grep -c <the-branch-name>` → 0; **name the pattern**, because a bare `grep -c`
  is a usage error and `grep -c ""` counts every branch on the remote and can
  never be 0. Then **check it yourself**: it is one command and it is the only
  part you can confirm.
- **Give it an explicit way out.** "If you judge the push not worth the remote
  churn, say so and verify as far as you can without it." An honest *I did not
  reproduce this* is a legitimate review; a reasoned substitute presented as a
  reproduction is not.


### Do not cap the gate count

The obvious economy — "three gates then ship" — is wrong. In the reference session a
fourth gate caught a process document contradicting itself in adjacent sentences,
and another fourth gate caught three mediums including a UI element stuck permanently
on for every healthy job. A cap ships those.

The economy is in **scope**, not count. Gates 1 and 2 cost the most and found the
least because they re-read everything from scratch.

Narrowing works, measurably: in the second session narrow gates averaged 75 k
against 124 k for full ones, found fewer things, and **never found nothing.** The
line that makes them cheap is _say what is already settled_ — an explicit "do not
re-sweep the citations, do not re-run the full suite" is worth more than any
instruction about what to examine.

**But a gate can also be scoped too wide.** One gate in the second session was
given seven attack sections — real network calls to two ffmpeg builds, a
from-scratch baseline build, an end-to-end browser suite and a mutation sweep over
seven files — on the widest branch of the batch. It ran **70 minutes and 181 tool
calls**. It found the batch's most serious defect, so the work was real, but it
should have been two gates: one on the security claim, one on everything else.

**So split on the kind of setup, and treat that as a rule rather than a caution.**
The third session split exactly that shape in advance — gate A on the security
claim (real ffmpeg, two TLS origins, recovering a propagation array out of a
stripped binary), gate B on the code, the record and the repo invariants. 114 k
and 113 k, both PASS, both returning findings neither would have reached inside
the other's attention, and B ran the e2e suite while A ran ffmpeg sweeps. The test
is mechanical: **if the attack list needs two kinds of setup, it is two gates.**
Every narrow or split gate across that session was cheaper than every full one and
none came back empty.

**A quiet worktree is not a liveness signal.** That same gate looked hung —
flat transcript, no file written for ten minutes — and was reported to the user as
probably stuck. It was running long subprocesses, and had in fact already
finished. Before concluding an agent is stalled, remember that ffmpeg, Playwright
and a full rebuild all write nothing for minutes at a time. The non-destructive
probe is a message asking it to report what it has and drop the expensive
remainder; it costs almost nothing and is safe if the agent is healthy.

**Do not reach for the agent's output file instead.** It is the obvious move and
it is a trap: `TaskOutput` is deprecated for local agents, and the file it names
is a symlink to that agent's **full conversation transcript**. Reading it would
spend the orchestrator's context — the one thing that has to survive the batch —
on the transcript of one agent. `ListAgents` says what is running; a message says
how it is doing; **`TaskStop` ends one that has genuinely run away**, which is the
tool the 70-minute gate above needed and nobody had.

Prefer `TaskStop` to a `maxTurns` cap in the agent definition. A capped gate stops
mid-review and still returns something shaped like a finished one — the same
failure as a reviewer that read the wrong tree and marked every acceptance line
`unproven`. Bound the gate by scoping it, watch it, and stop it deliberately.
