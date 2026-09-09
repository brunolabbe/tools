---
id: repo-32
tool: repo
title: A done ticket can carry an obligation nobody can see
kind: chore
status: in-flight
milestone: null
depends_on: []
difficulty: hard
---

# repo-32 — `done` can hide an outstanding obligation

## Why

**`npm run status` cannot tell "done, nothing left" from "done, but one
acceptance line waits on something nobody can do yet".** Both render as absent
from the board, because both are `status: done` and the board is computed from
frontmatter.

That second state is not an edge case and not a lapse. It is what a ticket looks
like when its last acceptance line names an observation that only exists **after
a merge** — a GitHub alert state, a hook firing on `main`, a workflow that its
own trigger filter keeps off every branch but the default one. The work is
finished and correctly gated; the proof is not available to the person finishing
it, by construction.

Today the only thing that closes such a line is somebody remembering. There is no
field, no board column and no command that surfaces it, and the ticket most
likely to need the reminder is the one that has just dropped off the board.

### The reproduction — three in one batch, not a hypothetical

1. **[repo-13](./repo-13-codeql-false-positives-recur.md)** closed `status: done`
   on 2026-09-01 with acceptance lines 5 and 8 **genuinely open** — not struck,
   no "Done" marker, both explicitly "deferred to the merge". They stayed open
   for six days and were answered only because
   [repo-16](./repo-16-suppression-does-not-dismiss.md) happened to be filed
   against the same subject. Nothing surfaced them in between.
2. **[repo-16](./repo-16-suppression-does-not-dismiss.md)'s `Done when` 6** —
   the state of a code-scanning alert after the change, read from the security
   tab. The dismissal step it depends on runs only on a push to `main`, so there
   is no "after" until the ticket merges, and `gh api` is denied in the
   development container besides. Filed `done` with the line marked outstanding.
3. **repo-15's hook** — cannot be observed firing until it is on `main`, for the
   same structural reason.

Three tickets, one batch, three different agents. The rate is the argument: this
is the normal end state of a certain kind of work, not an occasional slip.

**What makes it worth a ticket rather than a habit** is that the repo already
rejected "somebody will remember" as a mechanism.
[adr/003](../adr/003-the-status-page-is-generated.md) is the argument in full: a
projection kept by hand needs a writer, and every writer available here is a
person who will forget. An obligation recorded only in prose inside a `done`
ticket is exactly such a projection.

## Decision

**How should a post-merge obligation be recorded, such that something other than
memory surfaces it?** Three options, with what each costs. **This ticket
recommends option A** and does not settle it: the choice touches the ticket
schema, which is parsed strictly and gates CI, so it is not a builder's to make.

**A — an optional frontmatter field, surfaced by `npm run status`.** Something
like `awaiting: <what closes it>` on a `done` ticket, rendered as its own board
section and reported by `--json`. Recommended, because it is the only option that
makes the obligation _derivable_ rather than remembered, which is adr/003's own
test.

- Cost, and it is the real one: the frontmatter is **parsed strictly and gates
  CI**, and [repo-24](./repo-24-quoted-scalars-render-with-quotes.md) is the
  recorded instance of a parser change failing the board on sound work. A new
  field needs its validation, its render, its `--json` shape and a decision about
  whether an unclosed `awaiting` should ever fail anything.
- Second cost: a field nobody clears is a field that rots. Whatever is built
  needs an answer for "who removes it and when", or it becomes a second
  projection with the same defect.

**B — a convention, written into `docs/01-TICKETS.md`, with no mechanism.** A
`done` ticket carrying an open acceptance line must name it in a fixed form the
last Log entry can be grepped for. Cheap, in version control, and honest about
being a habit.

- Cost: it is the mechanism adr/003 rejected, wearing a style guide. Nothing
  fails when it is skipped, and the three instances above were each written by an
  agent that had read `01-TICKETS.md`.

**C — do nothing, and rely on the record's own closing sentence.** adr/005 ends
with "until somebody records that, this record describes a mechanism that has
been built and not seen to run", which is a genuinely good sentence in a
genuinely findable place.

- Cost: it works only for the reader who opens that document, which is the
  reader who least needs telling. Zero work, and it is the honest baseline.

## Build

**Startable: the decision is answered — option A, with the sub-decision in step
2 answered as "render only".** Both answers, and the costs that ruled the other
options out, are in the dated Log entry below; this section is not the record of
them. Whoever builds it should re-read the three instances first; two of them may
have closed by now, which changes the argument's shape but not its direction, and
a fourth arrived on 2026-09-07 (the Log entry names it).

1. ~~**Answer the decision**, with the owner.~~ **Done, 2026-09-07.** Option A,
   over B and C. Do not re-open it in the implementation.
2. **A, so:** add the field to `docs/01-TICKETS.md`'s field table, teach
   `scripts/status.mjs` to parse and render it, and implement the `--json`
   contract as answered: **an unclosed obligation is a rendered line and a
   `--json` field, never a `problem` and never a CI failure.** That
   sub-decision is settled — the reasoning is in the Log and it is not a
   builder's to revisit. What is still open and belongs to the builder is the
   shape, not the severity: the field's name in `--json`, where it renders on
   the board, and what an empty or malformed value does.
3. **Whichever:** amend `docs/01-TICKETS.md` where it says a ticket moves to
   `done` in the commit that earns it, since that sentence is the one that reads
   as though `done` meant nothing is left.
4. ~~**Answer "what makes somebody look at an informational CI failure", inside
   this mechanism rather than beside it.** Added 2026-09-07 on the owner's
   decision, not part of the original filing — see the Log entry of that date
   for the provenance and the cost. Concretely: `windows-latest` is now
   non-blocking ([repo-31](./repo-31-the-windows-leg-is-almost-all-red.md)), it
   is red for repo-36 (`docs/work/repo-36-citations-loses-the-record-path.md`, unmerged at the time of writing, on `origin/repo-33-citations-windows-paths`),
   and nothing forces anyone to notice. "`windows-latest` is red for repo-36" is
   an `awaiting` line, so the field is the nearest mechanism this repo has. The
   build has to decide **what it attaches to**, and that is the part with no
   obvious answer — every instance in "The reproduction" hangs an obligation on
   the ticket that incurred it, and this one belongs to no ticket at all: it is
   a standing condition of the repository. Three shapes worth costing before
   picking, none of them free:
   - `awaiting` on repo-31, which incurred it. Cheapest, and wrong the moment
     repo-36 merges and the leg goes green for a reason repo-31 knows nothing
     about.
   - `awaiting` on repo-36, the ticket whose merge closes it. Fits the field's
     grain — an obligation closed by an event — but reverses its direction: this
     one is not "repo-36 is unfinished", it is "the board is unfinished until
     repo-36 lands".
   - A board line owned by no ticket. Honest about what it is, and the largest
     change: it means `status.mjs` renders something computed from more than
     frontmatter, which is the thing adr/003 spent a whole record making sure
     was derivable.

   **This step must not turn the leg back into a gate.** repo-31's answer was
   "run it, report it, do not gate merges on it", and a mechanism here that
   fails CI would re-litigate that decision from inside another ticket — which
   the "render only" answer in step 2 already forbids for every other case.~~

   **Superseded, 2026-09-08.** Its sole instance closed: repo-36 merged
   (`479c831`, #186) and `test (windows-latest, informational)` is green on
   `main`. See the Log entry of that date — no live instance remains to design
   the mechanism against, so the three-shapes question above is struck rather
   than answered.

## Done when

1. The decision above is answered by the repo's owner, with the rejected options
   recorded alongside the cost that ruled each out.
2. If a mechanism is chosen, it is implemented, and **it is made to fail first** —
   a ticket carrying an unclosed obligation is shown to appear where the chosen
   mechanism says it should, before the mechanism is trusted.
3. The three instances in "The reproduction" are re-read at build time rather
   than trusted from this page, and their state recorded — an alert, a hook and a
   workflow are each claims about a commit, and `main` moves.
4. `docs/01-TICKETS.md` says what `done` does and does not promise.
5. `npm run check` passes and `npm run format` has been run, since this ticket's
   work is `.md` and `.mjs`.
6. Build step 4 is answered rather than deferred: the standing "`windows-latest`
   is red and nobody owns it" condition is either carried by the mechanism, with
   what it attaches to written down, or explicitly declared out of scope with a
   reason. **Not left as the third bullet of a Build step**, which is how it
   would go missing. The meaning of `awaiting` (the three readings above) is put
   to the owner before the parser is written, and the answer recorded here.

## Log

- **2026-09-07** — Filed from repo-16's build, on the owner's decision to file
  rather than fold. The gap was surfaced by repo-16's **gate**, which named it
  and declined to resolve it; the builder carried it as an open decision, and the
  owner chose to file. Both agents agreed it should appear once, attributed to
  the gate that found it, which this entry does.

  The three instances were read from the ticket files on this branch, not
  relayed: repo-13's acceptance lines 5 and 8 read open at `origin/main@e9054c5`
  before repo-16 amended them, repo-16's `Done when` 6 is marked outstanding on
  its own page, and repo-15's hook is named by the orchestrator on the same
  terms as the other two. **repo-15's instance is the one fact here that was
  relayed and not checked** — its branch is unmerged and not visible from this
  worktree.

  `repo-32` was taken from `node scripts/next-id.mjs repo` (`next free: repo-32`,
  against both ticket roots and every open pull request's diff), not derived by
  hand. Its Log half is unchecked by that script; no `repo-3[2-9]` id appears in
  any Log or gate record reachable from this branch.

  No `## Review` heading, deliberately. A filing has no work to check, and
  `scripts/status.mjs`'s `hasGateRecord` matches the heading rather than the
  body — so an empty one would trip repo-12's `reviewed-but-ready` board check.
  repo-16's Log records that trap being sprung.

  Nothing implemented, and deliberately: the mechanism is the decision.

- **2026-09-07** — **Answered by the owner: option A**, and a second answer to
  the sub-decision Build step 2 was told to bring back. `status` moves to
  `ready`. **Nothing is implemented here, deliberately** — the owner held the
  implementation for its own batch, because this ticket is rated `hard` and the
  field it adds lands in frontmatter that is parsed strictly and gates CI.

  **A — an optional `awaiting` field on a `done` ticket, surfaced by
  `npm run status`.** That is this ticket's own recommendation, taken as filed.
  The costs it names are accepted rather than waived: the field needs its
  validation, its render, its `--json` shape, and an answer to "who clears it
  and when" or it becomes a second projection with the same defect adr/003
  rejected.

  The rejected options, with the cost that ruled each out:

  - **B, a convention in `docs/01-TICKETS.md` with no mechanism** — rejected as
    the mechanism adr/003 already rejected, wearing a style guide. The three
    instances in "The reproduction" were each written by an agent that had read
    that file.
  - **C, do nothing and rely on adr/005's closing sentence** — rejected because
    it reaches only the reader who opens that document, which is the reader who
    least needs telling.

  **The sub-decision, answered: render only. An unclosed `awaiting` never fails
  CI.** It is a rendered line and a `--json` field, and it is not a `problem`.
  The owner's reasoning, recorded because the shape of the implementation turns
  on it: these obligations are open **by construction** — the proof does not
  exist until after a merge — and the person holding one frequently cannot close
  it, so gating on it would block unrelated work for a reason nobody could act
  on. [repo-24](./repo-24-quoted-scalars-render-with-quotes.md) is the recorded
  case of a frontmatter parser change failing the board on sound work, and that
  is the failure mode a new field must not reintroduce. So this is a reminder
  and not a gate, and Build step 2 is answered: whoever builds it should not
  need to ask again.

  Recorded from repo-31's branch (`repo-31-windows-leg-non-blocking`, base
  `origin/main` at `4fad5f8`), which was the batch in which the owner answered
  both tickets. That branch touches nothing this ticket will touch —
  `scripts/status.mjs` and `docs/01-TICKETS.md` are untouched by it — so
  whoever picks this up starts from `main` with no dependency on it.

  **One thing for the builder, found while recording this rather than relayed —
  and it splits three ways rather than one.** repo-31 went `done` in that same
  batch carrying three claims its own Log could not check. repo-31's gate
  pointed out that they are not all the same shape, and it is right; the
  distinction is worth having before anybody designs a field around it.

  **The facts, which nobody disputes:**

  1. **Whether `if: failure()` fires in a step of a job carrying a job-level
     `continue-on-error`.** The answer exists as soon as the branch's own
     **pull-request** run happens, because `ci.yml` triggers on `pull_request`.
     Nothing about it waits for a merge. What it does wait for is somebody
     opening the pull request — which the agent that wrote `status: done` is
     told not to do.
  2. **Whether the workflow parses.** Was in the same state and is now closed:
     `actionlint` v1.7.12 answers it locally, run independently by the builder
     and by the gate. An obligation that turns out to be answerable by a tool
     nobody had reached for is the good outcome, and what closed it was a second
     reader rather than a mechanism.
  3. **Whether `main` still carries no `required_status_checks`.** Needs
     `gh api`, which `.claude/settings.json` denies. **Merging does not unlock
     it** and neither does anything else available here; it is blocked by a
     permission decision the repo made on purpose.

  **The classification is disputed, and it is this ticket's own decision rather
  than a builder's.** Three readings collided on this batch and none of us can
  settle it:

  - The **gate** and the **orchestrator** read (1) and (2) as _blocked by local
    tooling_ rather than by a merge, and therefore not what `awaiting` is for,
    with only (3) genuinely this ticket's shape.
  - The **builder** read (1) as this ticket's shape, from the "Why" section's
    own words — "the proof is not available to the person finishing it, by
    construction" — on the grounds that the person finishing it stops before
    the pull request, so no run exists at the moment `done` is written.
  - Nobody argued it, but (3) sits oddly in **either** reading: an obligation
    that no event will ever close is not "waiting" for anything, and a field
    called `awaiting` that carries it is recording a permanent condition in a
    slot shaped for a temporary one.

  **So the question for the owner, at build time, is what `awaiting` means**,
  and the answer decides the field rather than describing it: is it _waiting on
  an event that will happen_ (the three original instances, and (1) only if
  opening a pull request counts as the event), or _the proof is not available to
  whoever is closing this_ (which admits (1) plainly and makes (3) a misuse), or
  _anything a `done` ticket still owes_ (which admits all three and makes the
  field's name wrong)? All three of this page's original instances satisfy every
  reading, which is exactly why the filing did not have to choose — and why the
  builder must. Put it to the owner with those options before writing the
  parser, not after.

  Whichever is chosen, **(1) is the instance to write the first `awaiting` line
  against**, because it is hours old rather than the six days repo-13's lines
  went unseen and its closure is imminent and directly observable — which is
  what `Done when` 2 needs from a first case.

- **2026-09-07, later** — **Build step 4 and `Done when` 6 were added on the
  owner's decision, and they are not part of the original filing.** Recorded
  with provenance because a Build step that appears without one reads as
  something the filer wanted.

  What happened: repo-31's build surfaced that its answer (keep `windows-latest`,
  informational) leaves nobody owning a red that no longer gates, and carried
  that up as an open decision with three options — **file it as its own `repo-`
  chore** (the builder's recommendation, listed first), fold it into this
  ticket, or accept it as recorded. **The owner chose to fold it in here**,
  overriding that recommendation, on the reasoning that the `awaiting` field is
  the nearest mechanism this repo has and "`windows-latest` is red for repo-33"
  is precisely an `awaiting` line.

  **The cost the owner accepted, stated plainly: it widens a ticket that was
  deliberately held back for its own batch.** This page is rated `hard` and
  changes strictly parsed frontmatter that gates CI; step 4 adds a question with
  no obvious answer — what a repository-wide obligation attaches to, when every
  instance in "The reproduction" attaches to the ticket that incurred it. The
  alternative kept this ticket's scope fixed at the price of a fifth open
  `repo-` ticket about a condition that will disappear the moment repo-33
  merges. Both were put; this is the one chosen.

  Also from repo-31's gate, and worth having here rather than only there: the
  "fourth instance" paragraph above was rewritten. It had presented three
  unverifiable claims as one uniform instance; the gate pointed out they are
  three different shapes, and it was right about the facts. The **classification**
  is where the gate, the orchestrator and the builder disagreed, so it is
  recorded above as a question for the owner rather than settled here — it
  decides what `awaiting` means, which is this ticket's decision to make and not
  a reviewer's.

- **2026-09-08** — Step 4 of the Build above, and its three costed options, named
  `repo-33` as the ticket whose merge turns the `windows-latest` leg green. That
  ticket was renumbered to **`repo-36`** —
  `docs/work/repo-36-citations-loses-the-record-path.md`, still on branch
  `repo-33-citations-windows-paths` (#186) — after a peer session filed and
  merged a different `repo-33` (ADR 004's compose rename, #192). Two tickets
  claiming one id makes `node scripts/status.mjs --json` exit 1, and that is the
  board gate. The Build section was repointed because a future builder acts on
  it; the Log entries below the fold keep their original wording, since they
  record what was true when they were written. The `awaiting` design question
  step 4 poses is unchanged — only the id in it moved.

- **2026-09-08, later** — **Build step 4's premise closed, and the step is
  struck rather than answered.** Measured at `a5e31c7` today, not relayed:
  repo-36 merged as `479c831` / #186
  (`gh pr view 186 --json mergeCommit,mergedAt,state` → `MERGED`,
  `2026-09-08T01:48:27Z`), and `test (windows-latest, informational)` is
  `success` on `main` in CI run `34260766014`, alongside `changes`, `check` and
  `test (ubuntu-latest)` all `success`
  (`gh run view 34260766014 --json headSha,jobs` → `headSha` `a5e31c7f…`,
  matching this branch's base).

  This closes the leg that step 4 was written against without answering the
  question it posed. The three costed shapes — attach to repo-31, attach to
  repo-36, or a board line owned by no ticket — remain unresolved in the
  abstract; what has changed is that no live instance survives to design the
  mechanism against, so answering it now would be designing against a
  hypothetical rather than the reproduction the ticket was filed with. `Done
when` 6 is not struck: a future builder still owes an answer to "what makes
  somebody look at an informational CI failure" in general, but building the
  first case against a closed instance would mean re-deriving the scenario from
  memory, which is exactly the failure mode `01-TICKETS.md`'s "A ticket carries
  a decision or a reproduction" rule warns about. `status` stays `ready`: this
  is a decision recorded, not the ticket built.

  Recorded via `AskUserQuestion` in the dispatching session on 2026-09-08. The
  owner's answer: drop step 4 and record the closure, rather than redesigning
  the mechanism against a hypothetical or leaving the stale premise in place.

  **One thing flagged, not fixed, and unverified by this entry's author beyond
  reading the file:** `tools/planner/docs/work/pl-2-container-image.md` still
  reads `status: in-flight` although its work merged as #192, and its own Log
  argues its third `Done when` line is "true of a machine and not of a branch"
  — a live instance of the same obligation-hiding-behind-a-status-field problem
  this ticket exists to fix, and a candidate beyond the three in "The
  reproduction". Left untouched here: a sibling builder is working in
  `tools/planner/` in this same batch.

- **2026-09-09** — **Built: the `awaiting` field, its parse, its render on three
  views, and its `--json` shape.** Branch `repo-32-done-hides-obligation`, base
  `origin/main` at `435ee35`. The base is on the remote, checked against it
  rather than assumed — a local-only base is the ordinary case for stacked work
  and needs a different first step. Files: `scripts/status.mjs`,
  `scripts/test/status.test.ts`, `docs/01-TICKETS.md`, and one `awaiting` line
  plus a Log entry on
  `docs/work/repo-16-suppression-does-not-dismiss.md`.

  **`status` is `in-flight`, not `done`, and that is the point of the ticket
  rather than an evasion.** `Done when` 6's second sentence — "the meaning of
  `awaiting` (the three readings above) is put to the owner before the parser is
  written, and the answer recorded here" — is unanswered. Writing `done` over an
  acceptance line nobody has answered is the exact state this page exists to make
  visible, so it would be self-refuting; and the repo already has a name for work
  that landed as a partial (`scripts/status.mjs`'s `reviewedButReady` docblock
  argues it at length, from `pl-28`). The open decision went up as options with a
  recommendation, which is all a subagent can do with one.

  **The dispatching intake was half right, and the half it had wrong is the
  live half.** It relayed that Build step 4 _and_ `Done when` 6 were superseded,
  leaving steps 2–3 as the work. Build step 4 is indeed struck in this file, and
  its premise checks out from here: `479c831` ("fix(repo): ask git where the
  record lives … (repo-36) (#186)") is an ancestor of `origin/main`, and repo-36's
  own page reads `status: done`. But `Done when` 6 is **not** struck — the Log
  entry of 2026-09-08 says so in those words. Its first sentence is satisfied by
  that entry (step 4 declared out of scope, with the reason); its second is live,
  and no Build step covers it. So the live scope was steps 2–3 **plus** an
  acceptance line, which is why this ends `in-flight`.

  **The windows-latest half could not be re-verified at the tip**, and the
  earlier entry's `success` reading stands as a claim about `a5e31c7`. `main` is
  now `435ee35`, an all-markdown change, so `ci.yml`'s `changes` job skipped the
  whole test matrix: `gh run view 34362401775 --json jobs` returns `check`
  `success`, `changes` `success`, and the matrix job `skipped`. Nothing here
  contradicts the earlier measurement; there is simply no newer one.

  **The three instances, re-read from the files on this branch rather than from
  the "Why" section above.**

  1. **repo-13 — closed.** Acceptance lines 5 and 8 each now carry a dated
     answer ("Answered 2026-09-07 by repo-16"), and its gate-1 table row 3 is
     marked `WITHDRAWN` with the retraction beneath it. Nothing outstanding.
  2. **repo-16 — open, and it is the one real instance left.** `Done when` 6
     reads "Not done, and not doable from here": the dismissal step runs only on
     a push to `main`, and `gh api` is denied here besides. This is the ticket
     the first `awaiting` line was written against.
  3. **repo-15 — closed, by an event nobody predicted here.** Its obligation was
     "the hook cannot be observed firing until it is on `main`".
     [repo-42](./repo-42-the-hook-has-fired-and-overblocks-a-worktree-push.md)
     merged as `435ee35` (#202) recording that somebody watched it refuse
     something, with the preconditions checked rather than relayed. Worth noting
     for the field's sake: what closed it was **a whole ticket**, filed because
     the observation came with a defect attached. An `awaiting` line would have
     surfaced it earlier; it would not have replaced repo-42.

  So one of the three original instances survives, which is fewer than the
  filing had and enough to build against — `Done when` 2 wanted a live case and
  there is one.

  **Made to fail first, with the numbers.** The 22 new cases went in before a
  line of `status.mjs` changed: `npx vitest run scripts/test/status.test.ts` →
  **17 failed | 110 passed (127)**. The five that were green at that point are
  the ones asserting _absence_ (no section when nothing is owed, `--markdown`
  silent, and so on), which is the honest count rather than a claim of 22.
  **One of them was a false green and was rewritten before the source changed**:
  `the repo's own board surfaces at least one real outstanding obligation`
  filtered on `t.awaiting !== null`, and with no such field the property is
  `undefined` on every ticket — so every ticket passed the filter and the case
  proved nothing. It filters on `typeof t.awaiting === "string"` now, which is
  red before the field exists and red again if repo-16's line is deleted without
  another taking its place. After the source: **127 passed (127)**.

  **What the build decided, since Build step 2 left the shape to the builder.**

  - **The name is `awaiting` in the frontmatter and `awaiting` in `--json`** —
    every other field serialises under its own name, and this one is spoken about
    by that name in both `Done when` 6 and the owner's answer.
  - **It renders in its own section under the tool**, below the open list, marked
    `!`. It cannot be a column or a suffix on a row, because most of what it
    names has no row: a `done` ticket is absent from every view here, which is
    the defect. The obligation is printed instead of the title — the title is
    what the reader already has.
  - **`--show` carries it twice, deliberately.** As a field row beside `note` and
    `difficulty`, and appended to the closing line, because
    `done — nothing to pick up` is the sentence an agent reads to decide there is
    nothing here, and a verdict that omits the obligation is the whole defect in
    one line. It is appended to the `dropped` reason rather than replacing it.
  - **Not filtered by status.** The field earns its keep on `done`, but a rule
    keyed on status would need an author to know it, and rendering an open
    ticket's obligation costs one line and spares a rule.
  - **An empty value is a named parse error, and `awaiting: null` is the same
    error.** Every other optional scalar means something when absent; this one
    **is** its text, so an empty one records nothing and would render a board
    line with nothing on it. A ticket says it owes nothing by having no such
    line. The error names the file, the line and the remedy, which is
    `rejectQuoted`'s shape. **This refuses a malformed value, not an unclosed
    obligation** — the owner's "never a CI failure" answer is about the second,
    and a test asserts `--json` still exits 0 and writes nothing to stderr with
    an obligation outstanding.
  - **Who clears it**, which was the owner's second stated cost: whoever observes
    the obligation closed deletes the line in the commit that records the
    observation, beside striking the acceptance line. Written into
    `docs/01-TICKETS.md` and into repo-16's own Log, because a field nobody
    clears is the second projection adr/003 rejected.

  **What the brief had wrong, or left for the build to find.**

  - **`Done when` 6 was relayed to this build as superseded and is not.** Above.
  - **Build step 3 named one sentence to amend and the change forces four.**
    Amending "Move a ticket to `done` … in the commit that earns it" was the
    named work; adding the field also moves `docs/01-TICKETS.md`'s field table,
    its "both optional ones" sentence (now three), the default view's mark
    legend (`!` had to be described as _not_ a fifth kind of open ticket), and
    the "Where each kind of fact goes" table. All four are folded in here.
  - **`renderMarkdown` had an early `continue` for a tool with nothing open**,
    which is precisely the tool an `awaiting` section is for. Restructured so
    both branches reach it. Nothing in the brief could have predicted that; it is
    recorded because it is the one place the change was not additive.
  - **Two committed gate records cite `scripts/status.mjs` and
    `docs/01-TICKETS.md` by line, and this change moved every one of them.**
    `node scripts/citations-gate.mjs` exits 0 on the base and exited **1** here
    until they were repointed: six coordinates in
    `tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md`'s Review section, and
    one in `docs/work/repo-29-citations-carry-no-anchor.md`'s. Only the numbers
    moved; every anchor still resolves, and the gate now reports
    `23 enforced, 0 failing`, with the history comparison reporting `0 raised`.

  **Not done, and why.**

  - **The root `CLAUDE.md` carries the same "move a ticket to `done`" sentence
    and was left alone.** It could have been folded in. It is the page that costs
    every session, it already sends the reader to `docs/01-TICKETS.md` for the
    fields, and `awaiting` is written rarely and read from `npm run status`.
    Recorded rather than silently deferred.
  - **`.claude/skills/orchestrate-tickets/reference/sizing.md:137` cites
    `scripts/status.mjs:264` for `reviewedButReady`, which is at 387 here and was
    already at 346 on `origin/main`** — stale before this branch, staler after.
    Left, because [repo-39](./repo-39-the-unanchored-half-of-the-review-corpus.md)
    owns that sweep, and one hand-repointed line ahead of it makes a corpus
    harder to sweep rather than easier.
  - **`tools/planner/docs/work/pl-2-container-image.md`, flagged in the entry
    above, is untouched.** It reads `status: in-flight`, not `done`, so it is not
    an instance of _this_ defect — it is on the board, with a row. Its third
    acceptance line being "true of a machine and not of a branch" is a genuine
    `awaiting` candidate once its status moves, and it belongs to whoever closes
    pl-2.
  - **No decision was resolved in a commit.** See the open decision below.

  **Open decision, for the owner: what does `awaiting` mean?** The three readings
  the entry of 2026-09-07 records, unchanged, and the parser was written without
  the answer because the dispatch said to build. What is implemented is the part
  every reading shares — an optional free-text scalar, rendered, never a gate.

  - **A — waiting on an event that will happen.** Matches the field's name and
    the owner's own words ("open by construction — the proof does not exist until
    after a merge"). Admits all three original instances and repo-16's live one.
    Excludes repo-31's fact 3 (`main`'s `required_status_checks`, which needs
    `gh api` and which no event unlocks), which would then need a home — a Log
    line, or a ticket.
  - **B — the proof is not available to whoever is closing this.** Admits
    repo-31's fact 1 plainly, since the person finishing stops before the pull
    request. Also excludes fact 3, on the ticket's own reading.
  - **C — anything a `done` ticket still owes.** Admits all three of repo-31's
    facts and makes the field's name wrong; choosing it means a rename, which is
    the one reading that changes the parser rather than the guidance.

  **Nothing here excludes fact 3 by construction** — the parser takes any text —
  so choosing A or B is a documentation change and a note on this page, and
  choosing C is a rename plus the same. This ticket goes `done` when the answer
  is recorded above; until then `Done when` 6's second sentence is what
  `in-flight` is holding.

  **Gates run**, all from this worktree after `worktree-farm.sh` and
  `npm run build`: `npm run check` → exit 0 (the `no-await-in-loop` warnings it
  prints are pre-existing and in neither file this branch touches);
  `npx vitest run scripts/test/status.test.ts` → 127 passed;
  `npm test -- --project repo` → 6 files, 307 passed; `npm test` → 136 files,
  2385 passed; `npm run format` → run, and this branch changes four `.md` files;
  the citations gate with its history comparison → exit 0, 0 raised; the anchored
  check on `orchestrate-tickets`' SKILL.md → exit 0;
  `node scripts/status.mjs --json > /dev/null` → exit 0. **Not run and not
  provable here:** either tool's e2e suite or container build, neither of which
  this change can reach.
