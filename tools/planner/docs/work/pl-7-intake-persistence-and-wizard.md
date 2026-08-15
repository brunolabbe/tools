---
id: pl-7
tool: planner
title: The intake — persistence, routes, and the wizard over them
kind: work-package
status: ready
milestone: P1
depends_on: [pl-3, pl-6]
---

# pl-7 — The intake: persistence, routes, and the wizard

**Packages:** `api`, `web`

## Why

An intake that does not survive a reload is a form, not a document. Someone
describes a trip over an evening, closes the tab, and comes back to it — that is
a claim about persistence and nothing else, and this is where it is made true.

It is also where the invalidation rule from [pl-6](./pl-6-question-tree-and-engine.md)
meets a user. The engine can compute what an edit discards; this ticket is
responsible for never discarding it silently.

## What pl-6 leaves you

`@planner/intake` landed on 2026-08-15 and is pure — no database, no network, no
clock, enforced by a source scan. Everything below is already built and tested;
this ticket calls it and stores what it says.

```ts
QUESTION_TREE                              // the authored tree, and its `version`
reachable(tree, answers): QuestionNode[]   // which questions these answers open
prune(tree, answers): { kept, dropped }    // and what no longer answers anything
nextQuestion(tree, answers): IntakeProgress // { node, coreComplete }
toBrief(tree, answers): TripBrief
validateAnswer(node, answer, now): void    // throws INVALID_ANSWER / INVALID_DATES
validateTree(tree): string[]               // run as a test, not at boot
```

Five facts from that work change what this ticket builds:

- **An answer is `{ state: "declined" } | { state: "answered", value }`**, and
  `value` carries the same `kind` as its question — parse it with the contract's
  `answerSchema`. That object is what the `answers.value` column holds as JSON.
  There is no `unknown` state: an unanswered question is a row that is not there.
- **`validateAnswer` takes the whole answer, and `now` as an argument.** Pass the
  request's clock in; do not let a route reach for one inside the engine.
- **A `core` question cannot be declined** — the engine refuses it with
  `INVALID_ANSWER`. So the wizard must not offer "skip" on a core question, and
  the checkpoint means what it says.
- **`INVALID_ANSWER` exists** (`details.question` is the id, mapped to 400 in
  `api/src/http-errors.ts`). Let the engine's errors out through
  `toErrorResponse`; do not catch and re-word them.
- **Question ids are dot-separated slugs** (`shape`, `road-trip.drive-hours`) and
  the validator holds them to it, so they are safe in a path segment.

## Build

### Persistence

1. **Migration 2. Append it; do not edit migration 1.** The usual reason is not
   the operative one here — no database of consequence exists — but the published
   image already carries migration 1, so anything that has run it sits at
   `user_version = 1` and would silently never see an edited version.

   ```sql
   DROP TABLE messages;
   DROP TABLE conversations;

   CREATE TABLE intakes (
     id TEXT PRIMARY KEY, title TEXT, tree_version INTEGER NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   ) STRICT;

   CREATE TABLE answers (
     intake_id   TEXT NOT NULL REFERENCES intakes (id) ON DELETE CASCADE,
     question_id TEXT NOT NULL,
     value       TEXT NOT NULL,     -- JSON, parsed against the contract schema
     answered_at TEXT NOT NULL,
     PRIMARY KEY (intake_id, question_id)
   ) STRICT;
   ```

   One row per answer rather than a blob per intake: discarding an abandoned
   branch is then a `DELETE`, and re-answering is idempotent by primary key
   rather than by care.

2. **A store that reads and writes and nothing else.** Every decision about which
   questions exist belongs to `@planner/intake`. A store that starts evaluating
   conditions is a second copy of the engine, and it will drift.

### Routes

3. **Submitting an answer is one transaction, and it is the whole ticket.**

   - Parse the body with `answerSchema` — the boundary where `unknown` becomes a
     typed answer.
   - Find the node in `reachable(tree, answers)`, not in `tree.nodes`: answering
     a question this intake never opened is a request to refuse, not a row to
     write.
   - `validateAnswer(node, answer, now)`.
   - Write the answer, then `prune`, and delete the orphans **in the same
     transaction**. A crash between the two leaves an intake holding answers to
     unasked questions, which is exactly the state pl-6 exists to make
     impossible.
   - Return `nextQuestion`, the reachable set, `toBrief`, and **which answers
     were discarded** — `dropped` carries each answer's node, so the UI has its
     prompt.
   - Move `updated_at`; the index on it is there for the list route.

4. **A preview of that transaction**, as a dry run or a sibling route. The wizard
   has to warn before committing a change that discards eight answers, and the
   only correct source of that list is the same `prune` the write would run.
   Recomputing it in the browser is a second implementation that will drift from
   the first.

5. **The title is drawn from the destination answer** once one exists, so the
   list route has something to show. Null until then.

   **pl-6 moved that further away than this step assumed.** `destination` is a
   `refine` question — a plan can be drafted without it (§1's hard facts do not
   include where) — so it is the _first question past the checkpoint_, and an
   intake that stops where the wizard invites it to stop has no destination and
   no title at all. Decide what the list shows for one: the shape and the dates
   ("a backcountry trip in February") is the obvious answer and needs no new
   column, since the brief is derivable from the answers. Whatever it is, record
   it here.

### The wizard

6. **One question per screen.** The tree branches, so a single long form would
   have to show and hide sections as answers change — the same invalidation
   problem, rendered badly. One question at a time makes the branch invisible,
   which is the point of a guided intake.

7. **A control per question kind**, driven by the contract's discriminated union,
   so a kind added to the contract without a control here is a compile error
   rather than a blank screen. There are eight: `single-choice`, `multi-choice`,
   `text`, `text-list`, `number`, `number-list`, `dates` and `budget`. The last
   two are composites and carry the weight — `dates` has to make "ten nights
   sometime in spring" as easy to say as a pair of dates, or every user invents
   dates and the tool plans against fiction. Each node carries its own bounds
   (`min`, `max`, `integer`, `unit`, `maxLength`, `maxItems`) and its `choices`;
   render from those rather than hard-coding any of them.

8. **Back, and edit — and never a silent discard.** When a change would strand
   answers, the preview from step 4 names them **by prompt and not by id**, and
   the user confirms before anything is written.

9. **Show the brief as it fills.** This is not a debug view. It is how a user
   notices the tool misheard them, and it is why §3 wanted the brief visible.

10. **Progress, honestly.** The reachable count moves as branches open and close,
    so "question 4 of 18" is a number the tool cannot stand behind — the repo's
    rule against faking progress applies directly. Report what is answered and
    that more remain. "The essentials are done" is a truthful milestone where a
    percentage is not, and step 12 is where it earns its keep.

11. **Stop at the core questions.** Decided 2026-08-14 — the roadmap's
    _Still open_ carries the reasoning and the consequences. When nothing
    reachable and `core` is unanswered, the wizard says so and offers two ways
    on: take the draft, or keep refining. It does not march to the end of the
    tree, and it does not decide this by filtering the reachable set in the
    browser — `nextQuestion` returns `{ node, coreComplete }` and this renders
    it. `coreComplete` true with a `node` still to ask **is** the checkpoint:
    the essentials are done and refining is open.

    It arrives after eight questions for five shapes and seven for a resort, so
    the checkpoint is a screen most users will actually reach — build it as one,
    not as a banner.

    In this ticket there is no plan to draft: Phase 2 owns that button. So what
    lands here is the checkpoint, the refine path, and an **exit** that leaves a
    complete intake behind. Build the fork now anyway — retrofitting a stopping
    point into a linear wizard is a rewrite of the flow, and the whole argument
    for stopping is that people abandon the corridor.

12. **Refining is re-entrant.** A user who takes the draft comes back to sharpen
    it, so refine is somewhere you return to, not a corridor you leave once. The
    intake stays open after core-complete and the list route must show it as
    resumable rather than finished. Nothing here is a second state machine:
    "core-complete" is a fact computed from the answers, never a column.

13. **The client mirrors the seam, not the logic.** No condition evaluation in
    the browser. The server returns the next question, the reachable set and the
    discard preview; the UI renders them.

## Traps

**A tree version change under a saved intake is undecided, and this ticket has to
decide it.** Someone starts, the tree changes in a release, they come back; their
answers may reference questions that no longer exist.

The recommendation is to re-run the engine against the **current** tree on load
and prune what no longer fits — same machinery, no second code path. The
alternative is keeping every historical tree version forever. Either way, an
intake whose version moved must say so rather than quietly losing answers.
Record the decision in this log and in the roadmap's "still open".

pl-6 did half of it already: `prune` drops an answer whose question the tree no
longer has and returns it as a `dropped` entry with a **null node**, which is
the one case the UI has no prompt to name it by. Say "some earlier answers no
longer apply" and move on; do not print an id at a user.

**A tree edit can turn a saved intake into a 500, and `tree_version` is how you
see it coming.** `toBrief` parses what it assembles against the contract, so an
answer that no longer fits its slot — a bound tightened, a choice removed —
throws `INTERNAL` on a plain read of an old intake. Re-validating each stored
answer with `validateAnswer` when the version has moved, and dropping the ones
that now fail the way `prune` drops the rest, is the same decision as the trap
above and probably wants the same code path.

**`fetchHealth` in [web/src/api/health.ts](../../web/src/api/health.ts) is the
pattern to follow** — contract types on both sides, the server's own error
payload parsed back into an `AppError` rather than a generic "request failed",
and the `AbortController` cleanup whose reason under StrictMode is documented
there.

**Do not delete the health readout.** Which provider is configured stays worth
showing once a real one exists; it is the first question about a bad plan. Move
it, do not drop it.

**The image does not carry `@planner/intake` yet.** pl-6 added its manifest to
the build stage — `npm ci` fails without it — but the runtime stage copies a
`dist` per package and the intake's is not among them, because nothing imported
it. The first `import` from `api` makes that a container that boots and then
cannot resolve a module. Add the two `COPY` lines in `tools/planner/Dockerfile`
in the same change, and check the image, not just the tests.

**There is still no owner model**, so every visitor shares one store and can read
and edit everyone's intakes. Do not paper over it with an unguessable id — that
is not an authorization model, and pretending otherwise is worse than the honest
gap. See the traps in [pl-2](./pl-2-container-image.md).

## Done when

Someone answers into a branch, is told the essentials are done and can stop
there, goes back, changes an early answer, is shown exactly which answers that
discards and confirms it, reloads mid-intake, and finds the intake where they
left it — resumable, whether or not it passed the checkpoint. The dry run and the
real write agree on what is discarded. Re-answering a question does not create a
second row. An unknown intake id is a typed 404 and not a 500.
`npm test -- --project planner` covers the store, the routes and the
invalidation path.

## Log

_Not started._
