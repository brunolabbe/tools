# Dispatching builders and gates

## Dispatching a builder

Every builder reads `roles/common.md` and `roles/builder.md` from `origin/main`
before it reads your prompt's intent, and they carry the setup order, the scope
rule, the gate commands, the push, the report's shape, "say what you could not
do" and "push back rather than transcribe". **Do not restate any of that** — a
prompt that repeats it pays twice for the same instruction and buries the part
that is genuinely yours.

**You choose the agent, not the model.** `builder-mechanical`,
`builder-standard` or `builder-hard`, from the ticket's `difficulty` —
`npm run status -- --json` carries it — per `SKILL.md`'s _Which model built it_.
Absent means `builder-hard`. You have not read the brief; do not rate it, and
never pass `model`.

What only you can supply, and what every builder prompt therefore carries:

- **The ticket, and the base.** Say the base explicitly — `origin/<base>` —
  especially for a stacked branch. The agent knows *how* to set up; only you know
  what it is building and what it is building on.
- **The branch name, checked free.** `git branch --list <name>` and
  `git ls-remote --heads origin <name>` both empty before you write it into the
  prompt. Refs are shared across every worktree of this repo, and a builder's
  setup refuses an existing name rather than reusing it; a records-only dispatch
  left to pick its own took a live sibling's branch from stale context and reset
  it (2026-09-18). Name the branch for every dispatch, records-only ones
  included.
- **The sibling that carries the handover.** The agent definition cannot know
  which sibling ticket's Log holds the context for this one. You do, from intake.
- **What is already settled**, if this is a resume: which findings are addressed,
  what must not be re-done, what a previous round measured.
- **Ship authority, or not.** The default is stop before the PR. On the *last*
  relay, replace it with conditional ship authority — see [sizing.md](sizing.md).
  This is per-dispatch by definition and is the single highest-value line in the
  prompt, because it removes an entire round. **It goes in the builder's own
  dispatch or a direct message from you, never through a gate prompt**: authority
  a reviewer pastes into its message is not authority under the builder role, and
  both builders that received it that way declined — one at the cost of a
  resume, the other holding until a direct message arrived (2026-09-12,
  2026-09-13).
- **What the skill got wrong**, asked in the dispatch. `history.md`'s schema
  says to ask every agent at dispatch; three sessions asked at close-out or not
  at all (2026-09-13, 2026-09-14, 2026-09-18), and their fields are the
  orchestrator's own observations plus whatever agents volunteered. One sentence
  in the prompt: *end your report with what these pages got wrong or omitted for
  this ticket.*
- **The fold-in exception, out loud.** The agent is told to implement the Build
  section and not widen it. Say in the prompt that if the work in front of it
  makes some *other* small, already-specified piece of work free, it should fold
  it in rather than leave it — and if it decides not to, write in the Log that it
  could have and why it did not. That note is what lets you catch the call; a
  silent deferral is invisible. See _Fold it in, or file it_ in
  [sizing.md](sizing.md).
- **Where to write scratch files: one directory per ticket,
  `<scratchpad>/<ticket-id>/`, as a literal path, and the same path in the
  gate prompt.** Namespacing is [concurrency.md](concurrency.md)'s rule, from
  the pull request that briefly carried another ticket's body. Sharing the path
  with the reviewer is repo-57's: a reviewer woken for a later round
  re-verifies against the same base tree, and the one that had kept its
  base-tree extract and comparison script there took ten minutes on a round
  where the one that rebuilt them took an hour (2026-09-20).
- **Say "maintenance" when it is one** — no ticket, or a `chore` with no
  source change — so the builder runs on Haiku by the table and stops on a
  judgement call instead of making it (repo-56).
- **The narrowest thing that can fail**, for verification runs. Agents reach for
  the whole directory by default; say the spec file. See [sizing.md](sizing.md)
  for the 20x this costs.
- **A Build step that fetches an external host: `curl` it once before you
  dispatch.** Check whether the container firewall is open to that host first
  — the allowlist may block it even if the host is reachable — and if it is
  not, ask the owner to open it before dispatch. The container firewall blocks
  most hosts, and a builder cannot ask for it to be opened. dl-70's registry
  step was built, pushed and stopped on a timeout one command would have shown
  first, costing a round (2026-09-26).
- **A branch touching a spawn call or an ffmpeg path is unproven on Windows
  until you look yourself.** Ask the gate to name that CI leg `unproven (gate)`
  in its section, but do not stop there: **a gate reviews a detached commit
  and preflight runs locally, so neither has any CI result to read at all,
  whatever the leg's own visibility** — that is the true mechanism, not
  `continue-on-error` hiding the leg from any particular command (correction,
  gate 1, finding 2: `gh pr checks` and `gh pr view --json statusCheckRollup`
  do list `windows-latest, informational` by name once a pull request exists
  and its CI has run — that is exactly why `SKILL.md`'s _After a merge_
  reaches for those two rather than `gh run list`). So once the pull request
  is open, run that same look yourself, before granting the merge, rather than
  waiting for the after-merge one: `dl-53` introduced six failures on that leg
  that no gate or preflight run could see before the pull request existed, and
  a pre-merge `gh pr checks 298` on the already-open pull request is what
  found them (2026-09-27).
- **When a dispatch names a line to edit, quote its content, not only its
  number.** A coordinate like "line 1981" can point at the wrong thing when the
  fixer misinterprets which field or line the number refers to. The text holds
  only the meaning you intend.

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

### Reading a subagent's `resolvedModel`, when you have to

**The route since 2026-09-26 is `node scripts/agent-cost.mjs --agent <id>`**,
which finds the agent's transcript by the id its `Agent` result reported and
prints the model and the effort its records carry — measured that day on a real
transcript, 70 of 70 billed records carrying both. What follows is how that was
established, and still holds for a reconstruction.

You should not have to: both halves of the model pairing are knowable at dispatch,
and `SKILL.md`'s _Which model built it_ says to write them down there. This is for
the case where a record has to be reconstructed afterwards. **Three routes, and
only the third is measured in this tree.**

- A **`PostToolUse` hook** on the `Agent` tool, returning the field through
  `hookSpecificOutput.additionalContext`. Relayed, not run here.
- **`/tasks`** (v2.1.242+), which names the model per subagent row. Relayed, not
  run here.
- The **task output file** whose path a backgrounded `Agent` result hands you,
  which carries `/message/model` on every assistant record. Measured 2026-09-06
  against a `ticket-reviewer` dispatched `model: "sonnet"`: 182 records, one
  distinct value, `claude-sonnet-5`.

The third is **the dispatcher's route, not the subagent's** — a subagent cannot
read its own, and the file named for its session id under `~/.claude/projects/` is
a different conversation altogether. Read it with a script that prints aggregates:
it is the full subagent transcript, and the tool result's "do not read this" is a
warning about your context, not a seal. The same file carries
`cache_read_input_tokens` per request, the half `subagent_tokens` omits, which
repo-17 measured on 2026-09-01 at ~94% of the bill.

## Dispatching a gate — the highest-leverage thing you write

Gate yield tracked prompt specificity, not gate number. In the reference session
gates 4 and 5 were the cheapest **and** the highest-yield, because by then the
prompts said *reproduce this exact mutation* instead of *review this*.

**Give the gate nothing from the build.** The ticket id and path, the base sha,
the head sha, the scratch directory and what to attack — never the builder's
report, its reasoning, its open decisions or a summary of any of them. The gate
reads the brief as it stood at the base and forms its own verdicts; you compare
them with the builder's (`SKILL.md` step 7). Its findings come back to **you**,
and you paste them onward — see _Routing findings_ below.

### What an agent reads, and when

**The frontmatter is read at launch, from the shared checkout; the procedure is
read at the agent's first command, from `origin/main`.** Since 2026-09-26 each
definition in `.claude/agents/` is a model, an effort, a tool list and a pointer,
and the agent's first command is one `git show origin/main:…` of its role pages.
So **a branch that edits a role page is built and gated under the page on
`main`**, which is what the old arrangement produced by accident: the gate on the
2026-09-20 sweep ran on a `ticket-reviewer.md` that still said the orchestrator
checks "four things" while the branch under review said five, and it reported the
mismatch itself. A sweep of the roles cannot dogfood itself — say in the gate
prompt what the branch changes in the gate's own page, and read the record
knowing the gate did not run under it. **A woken gate runs the page it read at
its first launch**, so a re-gate after a role page merged runs the older one.

A change to a definition's frontmatter — a model, an effort, a tool — takes
effect for the next dispatch from a shared checkout that has it, which is
`main` once merged, not the branch.

**A branch that adds or renames a role page cannot dispatch under it until it
merges.** The definitions read the pages from `origin/main`, so on such a branch
every new agent fails at its first command with git's `exists on disk, but not
in` — loudly, which is the intended failure. Gate that branch by hand or under
the definitions on `main`, and say which in the pull request body.

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

### The checkout comes before the build — a measurement, not a clause to write

**Nothing about this belongs in a gate prompt any more.** `ticket-reviewer.md`
used to give the setup order as farm, then `npm run build`, in a section that sat
well above the one telling the reviewer to `git checkout --detach <sha>`. A gate
read it top to bottom on 2026-09-04 and **built `main`** — grading a tree that was
not the branch — catching it only because `dist/` was missing a file the branch
adds, and flagging it unprompted. Nothing else would have: a reviewer measuring
the base produces a fluent, correctly formatted gate that marks acceptance lines
`unproven`, which is the silent failure that page already warns about arriving
from the other direction.

`repo-20` reordered that page to fetch → detach → farm → build, and the order now
lives in `roles/reviewer.md`, so the instruction loads itself into every gate
for free. The clause that used to sit here
was habit-dependent and cost a sentence per gate; **a reminder for a bug that no
longer exists is worse than no reminder**, so do not re-add one. The measurement
stays because the failure mode is silent.

### Send the findings in full; the lander writes the section down

**The gate returns a `## Review` block, and whoever lands the ticket — the
builder, or the fixer — commits it verbatim, with every other gate's, once, at
the landing (`records.md`, since `repo-67`). You carry it between them by
pasting it, never by describing it. That is the rule, settled by the owner on repo-38 (2026-09-09), and
this page used to argue the opposite.** An orchestrator instructed exactly that
on 2026-09-03, on a reading of `docs/01-TICKETS.md:351`'s *"the reviewer reports
and the builder writes the section down"* that this page called wrong, on the
theory that the sentence left room for the builder to compose the section from
raw findings rather than commit the reviewer's own text. That theory does not
survive the owner's ruling: the reviewer returns the section as text and the
builder commits it unedited, because a reviewer's worktree is thrown away when
it reports, so a section authored there is authored into nothing. The record has
to be written where it will survive, by the one still holding write access —
verbatim, because the builder is also the model under review, and letting it
compose its own verdict is the one thing the split between reviewer and builder
exists to prevent.

**Verbatim is the rule; a narrower hazard sits beside it and is still real: a
record must never carry findings or verdicts its writer never received.** Both
halves of that were measured the same afternoon, and the contrast is the whole
lesson.

- A reviewer sent the orchestrator a literal block and sent the **builder** a prose
  narration of the same six attacks. The builder refused to compose the record from
  it, on the grounds that paraphrasing a narration and labelling the result verbatim
  is a substitution described as the thing itself. **Right call** — it did not have
  the findings in full, only a description of them.
- A sibling reviewer sent its builder two complete findings reports, then said "go
  ahead and write the section". The builder wrote a compliant section: date,
  verdict, both passes and their shas, `capture-rules.test.ts:359` and two more per
  acceptance row, a bullet per finding. The reviewer flagged it as "not verbatim",
  **and the owner's ruling on repo-38 says the reviewer was right to flag it**: the
  attribution this measurement shows — which side measured what, from experiments
  the reviewer had not seen when it wrote its report — is a reason to send the
  reviewer that detail so it can fold it into its own returned section, not a
  reason to let the model under review author the record itself.

So the test **is** "are these the reviewer's exact words", for the section that
gets committed — that is what "verbatim" settled to mean on repo-38. Completeness
answers a different, earlier question, about what has to reach the builder before
it commits anything: **was every finding and verdict the reviewer holds actually
sent**. A gate prompt needs both:

- **Send findings in full, not a summary** — every finding, its evidence, its
  disposition, and the acceptance verdicts with their test citations. A builder
  cannot write down what it was not told, and once it has been told, it commits
  what the reviewer returned rather than composing its own version of it.
- **Do not authorise the commit before the findings are complete.** Ordering is
  what bit here: "ship it, my findings follow" is a race the builder cannot see,
  where "here are my findings, then ship" is one message.
- **A builder that refuses to fabricate a record is doing its job**, not being
  obstinate. Budget the round rather than pressing it.

**"Verbatim" cannot mean byte-identical when the section cites its own ticket,
and repairing that is not a violation of it.** repo-42's reviewer handed over a
section transcribed verbatim and `citations-gate.mjs` failed it anyway — a
`## Review` section that cites its own ticket file by coordinate is structurally
indistinct, because `scripts/citations.mjs`'s anchor check counts a fragment's
occurrences across the whole file (`occurrences: hits.length`, `locateAnchor`
run over the full content) with no exclusion for the line doing the citing.
**Repairing that means not citing the ticket's own file at all — a full path
does not help.** Indistinctness comes from the anchor occurring twice in the
*target* file: once at the cited line, once inside the citation quoting it. A
full repo-relative path changes which file resolves, not how many times the
anchor occurs there, so it stays indistinct (measured: a self-citation by full
path still reports `anchor starts on 2 lines`, `1 anchor(s) not distinct`).
Name the section, the date or the heading instead of a coordinate when citing
the ticket's own file — a cross-file citation is unaffected and needs no
change. That repair touches no verdict, row or severity in the section, so it
is not the builder editing the model under review's own judgement. Make it and
commit it; do not read it as breaking verbatim, and do not leave the next
builder caught between an unsatisfiable rule and a red gate.

### Addressing a resume

**Every resume is yours, by agent id.** Builders and gates no longer message each
other: since 2026-09-26 neither carries `SendMessage` or `ListAgents`, and you
wake each one — a builder with judgement findings, a gate to re-gate — with
`SendMessage` to the id its `Agent` result reported. **An id, never an
agent-type name**: `SendMessage` to `"builder-standard"` does not resolve. Three
consecutive test runs of the old loop read as a broken design — an agent
reporting the other "not reachable" — and all three were a type name; the same
call with the id succeeded first time. **A `completed` agent is still
reachable**: `SendMessage` wakes it into its own context (measured 2026-09-01).
Never infer from a status that it has gone.

### What was measured about the channel

Probed on 2026-09-01, against the agent types of the loop in which builders and
gates messaged each other — kept because the self-report half still holds, and
because a future design that restores peer messaging starts from it:

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

**Also note the self-report is unreliable, and this is the tool-list measurement
behind it.** Each probe listed fewer tools than its own frontmatter grants — a
builder reporting eight where the file lists thirteen, omitting `Grep` and `Glob`,
which it certainly has. The rule this is an instance of is not about tools and is
not stated here: a claim an agent makes about **itself** — its tools, its model,
its lifecycle — is a self-report and is checked from outside, with the one-call
check per field in [`SKILL.md`](../SKILL.md) under _Relaying_.

**So make gate 1 look like gate 4.** Every gate prompt should:

- **Run the thing under review on one real input and check the answer by a
  second method, first.** Before the diff, before the tests: for a tool, the
  real file it will be used on; for a rule, the branch it governs. Every
  defect that mattered on 2026-09-20 was found this way and none by reading —
  a cost script whose brief double-counted streamed responses by 86%, a
  preflight that passed a stale sibling ref as clean, a restore that discarded
  uncommitted work — and each of those tickets' tests were green throughout.
  Mutation and reproduction check the tests; this checks the claim.
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
- **Return a `## Review` section as text, with every finding in full, to you**,
  in those words — you paste it to the lander. A gate prompt that asked for findings in full and not for the
  section got narrative back, and the record was missing from the ticket until
  the builder noticed at close-out (2026-09-17). The rule sits under _Send the
  findings in full_ above; this is where the prompt has to carry it.
- **Dry-run the section against the checker before handing it over, from
  inside your own worktree, already checked out at the head sha you reviewed
  — never a different checkout.** Splice it into a scratch copy of the ticket
  at the real insertion point, above `## Log`, and run
  `node scripts/citations.mjs <copy> --section Review --require-anchors
  --require-distinct-anchors --require-claude-pins`. A reviewer that did this unprompted handed over a
  section needing no repair (2026-09-09); one that did not cost the builder a
  round on two citations (2026-09-13); `repo-62`'s gate 1 skipped it again on
  2026-09-27 and its section failed the lander's own splice on arrival, where
  every gate told to do it in these words passed first time. `records.md` has
  what running the check from the wrong checkout does instead of catching
  anything.
- **When a gate is split across two dispatches, name an owner for every seam
  that could plausibly belong to either.** Splitting by kind of setup (below)
  removes overlap in what each gate reads, not in what either might assume the
  other covers: two gates on `dl-53`, split exactly that way, each left a
  mid-stream SSRF-redirect reproduction to the other, and neither ran it until
  the orchestrator noticed (2026-09-27). Say, in each prompt, which one owns
  which reproduction that a reader could reasonably expect from either.
- **Say which failure the positive control must plant.** "Prove your harness" is
  satisfiable by a control that moves a citation out of range, when the
  prohibited failure is a repoint that still resolves; a gate did exactly that
  and passed the failure it existed to catch (2026-09-12).
- **Name the severity floor** for a mechanism ticket — _Name a floor for a
  mechanism ticket_ in [sizing.md](sizing.md).
- **Never carry ship authority** — the builder bullet above.
- **Nothing from the build** — the first paragraph of this section.
- **Name the ticket's scratch directory**, the same literal
  `<scratchpad>/<ticket-id>/` the builder was given, for the base-tree extract
  and any comparison script a later round will need (repo-57).
- **Ask what the skill got wrong**, as for the builder.

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
on for every healthy job. A cap ships those; so would it have shipped a credential
leak that `dl-58`'s sixth gate found (2026-09-17). A severity floor named at
dispatch is not a cap — _Name a floor for a mechanism ticket_ in
[sizing.md](sizing.md).

The economy is in **scope**, not count. Gates 1 and 2 cost the most and found the
least because they re-read everything from scratch.

**And it is in the resume.** A later round on the same reviewer, woken by
message with its base-tree extract kept in the ticket's scratch directory, costs
a fraction of a fresh dispatch: four rounds on one ticket came to $19 measured
by `agent-cost.mjs`, against $33 for one reviewer's four rounds on a larger
diff and $26 for three on another (2026-09-20). Never dispatch a fresh reviewer
for round two of a ticket whose round-one reviewer can be woken.

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

### Splitting a gate by angle — trialled, and dropped

Five parallel angles on one model (verification-gap, edge-case, security,
conventions, intent), merged and decided in code by a workflow, were trialled
against pl-39's first-round gate on 2026-09-26 and failed all three of their
adoption criteria: they found 3 of the single gate's 5 items and nothing it had
not, at 2.7× its cost, in the same wall-clock. Each angle re-read most of what a
whole gate reads, and an item one angle saw and handed to another was lost at
the seam. [repo-58](../../../../docs/work/repo-58-trial-a-gate-split-by-angle.md)
has the numbers. The rule above — split when the attack list needs two kinds of
setup — is the only split.

## Routing findings: the builder or the fixer

A gate's findings come back to you, and you paste the round onward **as the
reviewer wrote it**, to one agent — `SKILL.md` step 6 has the table and the
measurement behind it. What goes in each dispatch:

- **The builder, resumed** with `SendMessage`, when any finding needs
  judgement: **every** finding of the round in a single message, pasted, the
  mechanical ones included; any open decision already answered,
  with how it was taken (`SKILL.md`'s provenance row); and whether it has ship
  authority for the landing. Its role page tells it to fast-forward from
  `origin/<branch>` first, since a fixer may have pushed in between.
- **A fresh `fixer`**, only when every finding of the round is mechanical, or
  the landing is all that is left: the branch, the base, the findings, pasted,
  and the scratch directory; ship authority when the gate records and the
  pull request are all that remains. **A fixer and a resumed builder never work
  one branch at the same time** — both push to it, and the second push is
  rejected as non-fast-forward — which is one more reason a round is never
  split between them.
- **Neither gets your judgement of a finding.** If you think one is wrong, say
  so as a question the agent answers by reproducing it; a verdict of yours is a
  relay, and `SKILL.md`'s relaying table says what those cost.
- **Land from the gate's own file, and diff what landed against it.** The gate
  writes each section to a named file (`roles/reviewer.md`); hand the lander
  that path, and after it reports, compare the committed section with the file
  ignoring table padding. On 2026-09-26 that comparison caught both of a batch's
  two altered records, and nothing else did.
- **A round's dispatch carries no gate record to commit.** Every gate's
  section is held in its file until the landing (`records.md`, _A multi-round
  record lands once, at the end_). The landing dispatch hands over **the set
  the final gate returned** — every earlier section re-issued by it, one file
  per gate, all resolved against the tip it reviewed — and never a mix of
  rounds. Say in it that the lander repoints nothing: if `review-record.mjs`
  finds a section `MOVED`, the tip moved after the final gate, and the repair
  is waking that gate to re-issue against the new sha (`roles/reviewer.md`).
  Until `repo-67` an earlier round's section was already committed by the time
  a later round moved its lines, and `dl-53`'s landing dispatch ordered a
  byte-for-byte splice before re-resolution, which `review-record.mjs`
  refuses (2026-09-27); under this rule there is nothing to re-resolve.

**Which findings are mechanical is your call, and err toward the builder.** A
finding is mechanical when its fix is fully stated by the finding and touches only
the lines it names: a rename, a citation repoint or pin, a Log sentence, a
registration line, a lint or format fix. Anything whose fix is "decide how" is the
builder's, and so is the whole round it arrives in. A fixer that misjudges hands
the finding back, which costs one small round; a builder woken for a round of
mechanical fixes alone reads its whole transcript on every turn, and re-writes
it first if the wake falls past its cache TTL.

## Re-gating a round

Wake the **same** gate with `SendMessage`; its base-tree extract is in the
scratch directory, and a woken gate costs a fraction of a fresh one (_Do not cap
the gate count_). The message carries:

- the sha it gated and the new head sha, so its scope is
  `git diff <gated sha>..<new sha>` and nothing else;
- **its own findings, as it wrote them** — the only list it gives verdicts on;
- each refutation the builder or fixer returned, **as the command and its
  output**, labelled as their claim to re-run. Not their account of the fix:
  the gate did not see the build's claims in round one, and it does not see the
  round's either.

Its role page tells it to give each named finding a verdict, raise new findings
only in the lines the round touched, re-sweep nothing already settled, and return
a new `### Gate <n>` subsection **with every earlier section re-issued beside
it**, re-resolved against the new head, because nothing has been committed yet
and the last set a gate returns is the one that lands. Hold the paths of that
set, and only that set, for the landing dispatch. After two re-gates that each
raise a new `high`, `SKILL.md` step 8 hands the state to the user.
