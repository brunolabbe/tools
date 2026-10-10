# Dispatching builders, gates and fixers

Every agent reads `roles/common.md` and its own role page from `origin/main`
before it reads your prompt. **Do not restate anything those pages say** — a
prompt that repeats them pays twice and buries the part that is yours.

**The frontmatter is read at launch from the shared checkout; the role pages at
the agent's first command, from `origin/main`.** So a branch that edits a role
page is built and gated under the page on `main`, and a woken agent runs the page
it read at its first launch. After a merge that changes a definition — a model,
an effort, a tool — bring the shared checkout to `main` before the next
dispatch, and check
the first dispatch with `node scripts/agent-cost.mjs --agent <id>`.

## Before any dispatch

- **Create the ticket's scratch directories**: `<scratchpad>/<id>/build`,
  `gate-1`, `gate-2` and `land`. A redirect into a directory that does not exist
  fails silently, and at least five agents lost a run to it in one batch.
- **Check the branch name is free**: `git branch --list <name>` and
  `git ls-remote --heads origin <name>` both empty. Name the branch for every
  dispatch, records-only ones included.
- **A Build step that fetches an external host: `curl` it once first**, and check
  the container firewall's allowlist, not only reachability. A builder cannot
  ask for it to be opened.
- **Dry-run anything you prescribe** — a command, a fix, a merge condition — on a
  scratch copy before you write it into a prompt.

## A builder prompt carries

- **The ticket and the base**, as `origin/<base>`, and the branch name.
- **The scratch directory**, as a literal path.
- **The sibling that carries the handover**, when another ticket's Log holds
  context for this one.
- **What is already settled**, on a resume: which findings are addressed, what a
  previous round measured.
- **The owner's answer, when the ticket is `needs-decision`**: the answer, its
  date and the options it was chosen from, pasted. The builder records it on
  the ticket and sets `ready` in its first commit (`roles/builder.md`). Name no
  `status` yourself.
- **Ship authority, or not.** The default is: build, push, open a draft pull
  request, stop. Authority to land goes in the agent's own dispatch or a direct
  message from you, never through a gate.
- **"Maintenance"**, when it is one, so the builder stops on a judgement call.
- **The fold-in exception**, out loud: if the work makes some other small,
  already-specified piece free, fold it in, or say in the Log why not.
- **The narrowest thing that can fail**, for verification runs.
- **When you name a line to edit, quote its content**, not its number.

A branch touching a spawn call or an ffmpeg path is unproven on Windows until the
draft pull request's Windows leg has run: read it yourself with `gh pr checks`.

## A gate prompt carries

Gate yield tracks prompt specificity, not gate count or runtime.

- **Nothing from the build**: the ticket id and path, the base sha, the head
  sha, the pull request number, the scratch directory. Never the builder's
  report or a summary of it.
- **Where the section goes**:
  `<scratch>/<id>/gate-<n>/gate-<n>@<short head sha>.md`, first line
  `## Review` for gate 1 and `### Gate <n>` after — the names `roles/reviewer.md`
  and `records.md` use. A prompt that says `gate-1.md` made every gate in three
  batches flag the conflict, and some wrote both.
- **What to attack**: the riskiest decision, the seam with the longest reach,
  the claim you least believe. Name the real input to run first.
- **Which failure the positive control must plant.**
- **What is already settled** and must not be redone.
- **The depth**, and for a `mechanical` ticket, "narrow": the named attacks and
  the acceptance table, no full invariant sweep.
- **On a slice, which acceptance lines belong to the unbuilt half**: expected
  `unproven (scope)`, not FAIL.
- **An owner for every seam**, when a gate is split across two dispatches.
  Split only when the attack list needs two kinds of setup; a split by angle was
  trialled and dropped (repo-58).

Never a severity rule of your own: `gate.md`'s table is the only one. Never an
install — `npm ci` in a gate prompt ran two hours without reporting. Ask a gate
to *run* things; a judgement question you have already doubted comes back as an
echo.

### Authorising an outward-facing action

Sometimes a gate cannot reproduce a claim without pushing a branch to `origin`.
Grant it with conditions, in this order: one named throwaway
(`<ticket>-verify-scratch`); the agent verifies itself that no workflow can fire
on that ref; dry run only, never the default branch; cleanup is the immediate
next action after capturing the output; proof of deletion in the report
(`git ls-remote --heads origin | grep -c <name>` → 0), which you then check; and
an explicit way out — "if it is not worth the churn, say so and verify as far as
you can".

### A probe pull request

A measurement that needs CI to run on a real pull request — a code-scanning
check, a workflow leg — is the opposite case: workflows must fire, so the
conditions above do not fit. Every sibling's preflight merges against its head
for as long as it is open, so:

- **It adds new files only.** Where the measurement needs an edit to an existing
  file, pick one that no open pull request and no ticket in the batch touches,
  and name it in the dispatch.
- **Its title is checked like any other**
  (`node scripts/commit-message.mjs --text "<title>"`) before you write it into
  the prompt; "DO NOT MERGE" goes after the type and scope.
- **It is a draft, and it is closed with its branch deleted** as the next action
  after the reading is captured. A sibling whose preflight exits 16 against a
  probe waits for that, and changes nothing.

**Preflight exit 16 against a sibling that will merge** blocks `gh pr ready` on
the branch that merges second, not on both: set the order, hold the second as a
draft, and rebase it once the first has merged
([concurrency.md](concurrency.md)).

## Routing a round

`SKILL.md` step 6 has the table and the severity floor.

- **The builder, resumed** with `SendMessage` to its agent id (never a type
  name), when any finding needs judgement: every finding of the round in one
  message, pasted; any decision already answered, with how it was taken; and
  whether it has ship authority.
- **A fresh `fixer`**, when every finding is mechanical or only the landing is
  left: the branch, the base, the findings pasted, the scratch directory, the
  gate files to land, the pull request number and title, and every model's name
  for the body. A fixer and a resumed builder never work one branch at once.
- **End the last relay with conditional ship authority**: "apply these, and if
  preflight exits 0 and the diff's scope is unchanged, land it yourself; if any
  condition fails, stop and tell me." It removes a round and gives up no gating.
  A fix that is real work cannot take it.
- **Neither gets your judgement of a finding, nor your expectation of its
  remedy.** If you think one is wrong, say so as a question the agent answers by
  reproducing it.
- **Which findings are mechanical is your call, and err toward the builder**: a
  finding is mechanical when its fix is fully stated by the finding and touches
  only the code it names.

## Re-gating

Wake the **same** gate, once (`SKILL.md` step 8): the sha it gated, the new head,
its own findings as it wrote them, each refutation as a command and its output.
Not the fixer's account. A woken gate costs a fraction of a fresh one; never
dispatch a fresh reviewer for round two.

## Watching agents

- A quiet worktree is not a liveness signal: ffmpeg, Playwright and a rebuild
  write nothing for minutes. Probe with a message asking for what it has.
- Never read an agent's output file to check on it; it is the full transcript.
  `ListAgents` says what is running, and `TaskStop` ends a runaway.
- A `completed` agent is still reachable: `SendMessage` wakes it.

## An answered decision has to be recorded even when you do not build it

When the user answers a ticket's open question and the answer is bigger than the
running branch, keep the slice — and spend one message so the answer does not
evaporate: have the builder record the question, the answer, the reason and the
cost that came with it in the ticket, mark the superseded Build step, leave
`status` as `ready`, and implement none of it. For a ticket nobody is building,
recording the answer is its own maintenance dispatch; schedule it.
