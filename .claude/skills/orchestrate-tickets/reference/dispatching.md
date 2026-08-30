# Dispatching builders and gates

## Dispatching a builder

`.claude/agents/builder.md` is loaded into every builder before your prompt is,
and it carries the setup order, the scope rule, the gate commands, the
bookkeeping, "do not spawn subagents", "say what you could not do" and "push back
rather than transcribe". **Do not restate any of that** — it is inherited, and a
prompt that repeats it is paying twice for the same instruction while making the
part that is genuinely yours harder to find.

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

## Dispatching a gate — the highest-leverage thing you write

Gate yield tracked prompt specificity, not gate number. In the reference session
gates 4 and 5 were the cheapest **and** the highest-yield, because by then the
prompts said *reproduce this exact mutation* instead of *review this*.

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
