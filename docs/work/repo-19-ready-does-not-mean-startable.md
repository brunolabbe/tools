---
id: repo-19
tool: repo
title: ready does not mean startable, and the board cannot say which
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-19 — `ready` does not mean startable

**Packages:** `scripts` (`status.mjs`, `test/status.test.ts`), `docs/01-TICKETS.md`.

## Why

`npm run status -- --ready` is the command that answers "what can I pick up".
Measured on `origin/main@7fe18af`:

```
$ node scripts/status.mjs --ready | wc -l
7
```

**Six of those seven cannot be started**, because each carries an explicit
unsettled decision its own page says must not be resolved by whoever picks it up:
`repo-14` ("Open question — do not settle it here"), `repo-15` (Decisions A and
B), `repo-16`, `dl-32` ("The decision this ticket exists to force"), `dl-33`
("The decision this ticket must force"), `dl-34` ("Open decision, for whoever
picks this up"). The one that is genuinely startable is `dl-35`.

So the board's headline query is **86% wrong**, and it is wrong in the expensive
direction: an orchestrator dispatches a builder that reads the ticket, discovers
the decision, and stops. That is a full builder round — measured elsewhere in this
repo at roughly a dollar and 100 k subagent tokens — spent to learn something the
frontmatter could have said.

**The repo already knows.** `docs/01-TICKETS.md` says _"`status: ready` means
nobody has picked a ticket up, which is not the same as it being startable"_, and
`.claude/skills/orchestrate-tickets/SKILL.md` records a session where a ticket read
`ready` while its own first section was titled "Read this before picking it up"
and said the work must not be pulled forward. Both describe the gap. Neither
closes it.

### What this is not

**Not a case for banning open questions.** `docs/01-TICKETS.md` is explicit that
_"a ticket carries a decision **or** a reproduction"_ — filing a decision is a
legitimate and deliberate reason to file, and several of the six above say the
person who picks the work up is better placed to price the options than the person
who filed it. `CLAUDE.md` requires surfacing decisions as questions rather than
resolving them in prose. **A rule that every question must be answered before
`ready` would forbid half of what a ticket is for.**

The defect is that one word carries two meanings — _unclaimed_ and _dispatchable_
— and only the first is recorded anywhere.

### There is no state before `ready`, and that is the root

`STATUSES` is `["ready", "in-flight", "done", "dropped"]` (`scripts/status.mjs:53`).
**A ticket's first state is `ready`.** There is no `draft`, no `groomed`, no
`needs-decision` — nothing between "this file now exists" and "anyone may build
this". So a filing that deliberately poses a question has nowhere to sit except
the same bucket as work that is fully specified and waiting for a builder.

Every other status marks a transition somebody performs: `in-flight` when it is
picked up, `done` in the commit that earns it, `dropped` when it is rejected. Only
the **first** transition — from filed to buildable — has no state to move out of,
because it has no state to move from. That asymmetry is the whole bug.

### It also broke the difficulty field, on that field's first use

`repo-17` added an optional `difficulty` rating. Asked to rate the eight open
tickets, a reader returned `hard` for all seven carrying an open decision and
`standard` for the one without — a perfect correlation, with one rating reasoned
as _"the fix is mechanical, but the ticket carries an unresolved call"_. It was
rating blockedness because blockedness had nowhere else to live. The definition
was corrected to "rate the work as it will be once its decisions are answered",
which fixed the rating and left the blockedness still unrecorded.

## Build

**Answer the decision below before writing anything** — it changes which files
move and whether the parser's taxonomy changes at all.

1. **Re-run the measurement at the tip.** `node scripts/status.mjs --ready`, then
   read each returned ticket's headings for a decision section. Both cheap; the
   6-of-7 figure is `7fe18af` and the board moves.
2. Implement the chosen option. If it adds a `status` value, `STATUSES` in
   `scripts/status.mjs:53` and the field table in `docs/01-TICKETS.md` move
   together, and **the parser rejects an unknown status by design** — so every
   ticket carrying the new value must land in the same commit as the parser, or
   the board fails for everyone. `repo-17` hit exactly this and its Log records it.
3. **Whatever is chosen, `--ready` must stop returning work that cannot be
   started**, and must say why it withheld one. A query that silently returns
   fewer rows is a different kind of wrong answer.
4. Test it against a fixture ticket in each state. `scripts/test/status.test.ts`
   has the `repoWith` helper for throwaway trees. Run it red first.

## The decision this ticket posed — answered, see the end of this section

**How does the board learn that a filed ticket is waiting on a human?**

| Option                                                                                                                                            | What it costs                                                                                                                                  | What it buys                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — a new `status` value _before_ `ready`** — `groomed`, `needs-decision`, `draft`; name it for what the ticket waits on, not for what it lacks | `STATUSES`, the field table, and every affected ticket in one commit with the parser. Five tickets change state today                          | The board states it directly. `--ready` becomes true by construction, and `npm run status` shows the queue of decisions waiting on a human — which nothing shows today        |
| **B — a board check, in `repo-12`'s shape**                                                                                                       | A warn-not-fail check naming file and id on stderr, exiting non-zero only under `--json` (which CI reads). No taxonomy change, no ticket edits | Cheapest, and consistent with the two checks already there. But it needs a way to tell an _answered_ decision section from an open one — see below, and that is the hard part |
| **C — prose only**                                                                                                                                | A sentence in `docs/01-TICKETS.md`                                                                                                             | Free, and the reason this ticket exists: the gap is _already_ described in two places and has never once been acted on                                                        |

**The hard part of B, and it may decide the whole question.** A decision section
exists whether or not it has been answered — `repo-17` records its answer _inside_
its own decision section, so presence proves nothing. Detecting "answered" needs a
convention (a required `**Answered:**` line, a separate `## Decisions taken`
heading, a frontmatter field), and inventing a convention to avoid changing a
taxonomy may cost more than changing the taxonomy.

**A lean, not a decision:** A states the fact where the fact belongs, and the
`depends_on` machinery already proves the board can express "not startable yet"
without anyone objecting. It also fills a hole in the lifecycle rather
than patching a symptom — every other status marks a transition somebody performs,
and this is the only one that does not exist.

**If A is chosen, the naming is part of the decision, not a detail.**
`needs-decision` says precisely what these six wait on and would read false on a
ticket that is merely half-written; `groomed` is the familiar term and covers both,
at the cost of saying less. Pick one a reader can apply without asking — the parser
rejects anything else. But A is the option that touches every ticket, so the
cost is real and it is the filer's job to say so rather than hide it.

### Answered by the repo's owner — **A**, named `needs-decision`

Relayed into this ticket's build dispatch rather than written here first, which
is the hazard named in the Log entry below. The heading above was rewritten in
the same commit: it read _"and does not settle"_ while carrying the answer, and a
reader scanning headings for an open decision — which is exactly how this
ticket's own Build step 1 says to read a board — would have taken it for open.

**The answer, and the reason.** A: a new `status` value before `ready`. The board
states the fact where the fact belongs, `--ready` becomes true by construction
rather than by a check somebody has to keep passing, and it fills the hole in the
lifecycle this ticket identified — every other status marks a transition somebody
performs, and this was the only one that did not exist.

**B was not chosen, and its own hard part is why.** Detecting an _answered_
decision section from an open one needs a convention that does not exist today —
a required `**Answered:**` line, a `## Decisions taken` heading, a frontmatter
field. Inventing a convention to avoid changing a taxonomy costs more than
changing the taxonomy, and choosing B without settling it would have been
choosing a convention by accident. **C was not chosen** because it is what the
repo already has: the gap is described in `docs/01-TICKETS.md` and in
`.claude/skills/orchestrate-tickets/SKILL.md` and had never once been acted on.

**The naming was asked and answered separately**: `needs-decision` over `groomed`
and `draft`, because it says _what_ the ticket waits on rather than what it
lacks. The cost is accepted rather than denied — it reads false on a ticket that
is merely half-written, and there is no state for that. If one is ever needed it
is a second value, not a re-reading of this one.

## Done when

1. `npm run status -- --ready` returns only tickets that can actually be started,
   proven by a test over a fixture tree containing one startable ticket and one
   waiting on a decision.
2. That test failed before the change, and the Log says so with its output.
3. `--ready` says what it withheld and why, rather than silently returning fewer
   rows.
4. The decision above is recorded on this ticket with its answer and its reason.
5. If a `status` value was added, no ticket carries it in a commit earlier than
   the parser that accepts it.
6. `npm run check` and `npx vitest run scripts` pass, and `npm run status --json`
   exits 0.

## Review

**Gate: PASS** — 2026-09-05 · `origin/main...424be56` · defect hunt run directly in this session, medium depth (no `ticket-reviewer` subagent dispatched; this session performed the hunt itself in-context)

Gated by Sonnet 5 (`claude-sonnet-5`). The builder ran Opus — **inferred, not checked**: it was dispatched in the background, which returns no `resolvedModel`, so this is read off `.claude/agents/builder.md`'s **`absent` difficulty row** — repo-19 carries no `difficulty` field, confirmed as `null` in `npm run status -- --json` — which maps to inherit, Opus in practice. Not off an observation of the actual model that ran.

> **Correction, 2026-09-05 — the orchestrator's error, not this gate's.** This line originally cited the `hard` row ("never below default model"). That is **dl-37's** rating, a different ticket in the same batch; repo-19 is unrated. The sentence was supplied to the reviewer as fact in its dispatch instruction and transcribed faithfully, so the gate did not get this wrong — the citation did. The conclusion is unchanged (Opus either way); only the rule cited was inapplicable. Recorded here rather than silently rewritten because it is an instance of exactly what `repo-18` is on the board to catch: a citation that resolves to real text while saying something the source does not support.

| Done when                                                                                                                                                                      | Verdict · proof                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `npm run status -- --ready` returns only tickets that can actually be started, proven by a test over a fixture tree with one startable ticket and one waiting on a decision | **proven** — `scripts/test/status.test.ts:1049` (unit, `readyTickets` over a `repoWith` fixture) and `:1061`–`1062` (CLI, `--ready`'s stdout/stderr)                                                                                                                                                                                                       |
| 2. That test failed before the change, and the Log says so with its output                                                                                                     | **verified** — see "The 15-vs-11 reconstruction" below                                                                                                                                                                                                                                                                                                     |
| 3. `--ready` says what it withheld and why, rather than silently returning fewer rows                                                                                          | **proven** — `scripts/test/status.test.ts:1062`, `:1074`, `:1089`–`1095`, and the widened `test.each` row at `:769` (dependency-blocked case gains a second stderr line, asserted at `:783`–`784`)                                                                                                                                                         |
| 4. The decision above is recorded on this ticket with its answer and its reason                                                                                                | **proven** (documentation line, checked by inspection rather than a test) — `docs/work/repo-19-ready-does-not-mean-startable.md:130`–`157`                                                                                                                                                                                                                 |
| 5. If a `status` value was added, no ticket carries it in a commit earlier than the parser that accepts it                                                                     | **verified** — `git log origin/main..HEAD --oneline` shows exactly one commit (`424be56`) moving `STATUSES` (`scripts/status.mjs:69`), `repo-15`'s and `repo-16`'s frontmatter (`docs/work/repo-15-deny-list-does-not-protect-itself.md:6`, `docs/work/repo-16-suppression-does-not-dismiss.md:6`), and the field table (`docs/01-TICKETS.md:95`) together |
| 6. `npm run check` and `npx vitest run scripts` pass, and `npm run status --json` exits 0                                                                                      | **verified** — `npm run check` exit 0; `npx vitest run scripts` → `137 passed (137)` at `424be56`; `node scripts/status.mjs --json > /dev/null` exit 0                                                                                                                                                                                                     |

**The 15-vs-11 reconstruction, in the permanent record.** Re-running the Log's Done-when-2 claim independently: I pulled `origin/main`'s `scripts/status.mjs` and swapped it into a checkout of this branch, then ran `npx vitest run scripts`. First attempt gave `15 failed | 121 passed (136)`, not the Log's `11 failed | 125 passed (136)`. Diagnosis, not assumption: three of the four extra failures came from tests that read the live `docs/work/` tree rather than a `repoWith` fixture (`scripts/test/status.test.ts:178`, `:196`, `:560` at the pre-amend line numbers) — they threw because `docs/work/repo-15-...md` and `docs/work/repo-16-...md` already carried `status: needs-decision` in my checkout while the parser I'd swapped in did not know that value. That is Done-when 5's own hazard — a ticket carrying the new value in a commit earlier than the parser — reproducing itself inside my reconstruction, because I had reverted only the script and not the two ticket files to match. Reverting `repo-15` and `repo-16`'s frontmatter to `origin/main`'s `status: ready` alongside the old parser reproduced the Log's number exactly: `11 failed | 125 passed (136)`. Under that exact reproduction, all three verbatim `FAIL` blocks quoted in the Log — the `validate` error on `pl-1-slug.md` for "a ticket waiting on a decision is open work, and its milestone has not started", the `expected '' to match /status\s+needs-decision/` for "--show ... does not call it unblocked", and `expected 1 to be +0` for "--ready lists the startable ticket ..." — match what I captured byte-for-byte. "After" state at the amended tip (`424be56`, including the low-finding test below): `137 passed (137)`. The red run is real and the Log's self-correction (first draft quoted an unobserved message, then the author swapped the old script back in, re-ran, and got `expected 1 to be +0`) is corroborated rather than contradicted.

**Gate finding closed.** I raised one low finding: `withheldFromReady`'s documented priority rule (`scripts/status.mjs:462`–`464`, comment at `:462`–`463`: "the decision comes first when a ticket carries both") — a ticket with both `needs-decision` status and an unmet dependency — was tested for `--show`'s closing line (`scripts/test/status.test.ts:1160`–`1162`) but not for `withheldFromReady`/`--ready`'s stderr notice itself. The builder closed it: added `withheldFromReady reports the decision, not the dependency, when a ticket carries both` (`scripts/test/status.test.ts:1104`–`1115`), and I independently mutation-verified it — inverted the reason ternary's branch order in `scripts/status.mjs` (dependency check first, decision check second) and reran; the new test is the one that fails, with the message flipping from the needs-decision reason to `"waits on pl-2"`, exactly as the ternary's actual behavior would produce if the priority were wrong. Restored the correct code and reran: `137 passed (137)`. Closed by test, not dropped.

- **findings** · 1 returned by this gate's defect hunt, 1 carried, 1 closed by the builder's follow-up commit, 0 dropped.
- NFR: security n/a (no new URL, credential, or subprocess path touched) · performance n/a · reliability ✓ (`validate` still rejects an unknown status by construction, exercised at `scripts/status.mjs:331` via the fail-first checks above) · maintainability ✓ — `needs-decision` has exactly one home in source (`grep` for `STATUSES`/`.status ===`/`.status !==` across `scripts/` and `.claude/` returns only `scripts/status.mjs`), and the taxonomy comment at `scripts/status.mjs:53`–`68` documents the ordering rationale in place.
- **Invariants walked, most n/a for this diff**: no tool-to-tool import, no `AppError`/taxonomy code touched (this is a repo script, not tool contract code), no shell spawn, no header/URL logging, no SSRF-relevant URL, no faked progress, no contract package edited, no new workspace dependency or `Dockerfile` change. Tests run under the existing `scripts/test` project (`scripts/test/tsconfig.json`), no new package registration needed. Skipped: none of these apply to a `scripts/`-only, non-tool change.
- Base-commit comparison: `npx vitest run scripts` at `origin/main` (`c37cab9`) → `126 passed (126)`. At `424be56` → `137 passed (137)`, a net +11 (10 from the original commit, 1 from the low-finding follow-up) — consistent with the diff's ten new `repo-19` tests plus the one closing this gate's finding, with no other pre-existing test count movement.
- One pre-existing test's assertion was reworded, disclosed and reviewed: the `test.each` at `scripts/test/status.test.ts:767`–`786` moved from one shared `[DANGLING]` stderr expectation to a per-row `onStderr` array, because `--ready`'s row now legitimately carries a second stderr line (`WITHHELD_REPO9`) beside `DANGLING`. Kept exact per row rather than loosened to `toContain`, which the Log itself argues is the right tradeoff since the enumeration is the test's whole point. No other existing assertion changed meaning.
- **Two judgement calls the builder flagged, both ruled in its favor** (agreed by the ticket owner separately): (1) Done-when 3's widening to report both withholding reasons on `--ready`'s stderr, not only the new status — the acceptance line carries no qualifier limiting it to `needs-decision`, and narrowing it back would recreate the "notice implies completeness" defect for the dependency-blocked case, one level down from the defect this ticket closes. (2) The ticket's own decision-heading rename (`docs/work/repo-19-ready-does-not-mean-startable.md:100`, "and does not settle" → "posed — answered, see the end of this section") — one line, reversible, and it fixes on this ticket's own page the exact stale-heading failure the Log documents happening to `dl-32`.

## Log

- **2026-09-02** — Filed off `origin/main@7fe18af`, out of a session that tried to
  rate the open tickets and found the rating contaminated by blockedness.

  **Measured, not assumed:** `--ready` returns 7; six of the seven carry a heading
  that names an unsettled decision; `dl-35` is the only one a builder could start
  today.

  **Not fixed here**, and the reason is the open question: the cheap option (B)
  depends on being able to tell an answered decision from an open one, and nothing
  in the format expresses that today. Choosing B without settling that is choosing
  a convention by accident.

  `repo-19` confirmed free against both lists: `docs/work/` tops out at `repo-18`,
  a grep over the tree adds only `repo-404`, `repo-808`, `repo-901` and `repo-999`
  (all `scripts/status.mjs` fixtures), and no remote branch or pull request in any
  state names it.

- **2026-09-05** — Built on `repo-19-needs-decision-status`, off `origin/main` at
  `c37cab9`. Option A, `needs-decision`, recorded above with its reason.
  `scripts/status.mjs`, `scripts/test/status.test.ts` and `docs/01-TICKETS.md`
  moved; `repo-15` and `repo-16` moved to the new status in the same commit as
  the parser.

  **Step 1's measurement, re-run at the tip, and the ticket's headline numbers
  were stale twice over.** `--ready` returned **6**, not 7 — `dl-33`, `dl-34` and
  `repo-14` are `done` and `dl-35`, the one the ticket named as the single
  startable ticket, has merged. Reading each returned ticket's headings for a
  decision section:

  |           | Heading                                                                                 | Verdict                                                |
  | --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
  | `dl-32`   | `## The decision this ticket exists to force`                                           | open on the page, **answered in session** — see below  |
  | `dl-37`   | `## The decision, answered 2026-09-03 — not open`                                       | startable, says so itself                              |
  | `repo-15` | `## The decisions this ticket poses, which it does not settle`                          | **`needs-decision`**                                   |
  | `repo-16` | Build opens "the deliverable is a decision. Do not settle it inside the implementation" | **`needs-decision`**                                   |
  | `repo-18` | `## Open question — do not settle it here`                                              | answered in session, and in flight in another worktree |
  | `repo-19` | this one                                                                                | answered in this dispatch                              |

  So **two tickets qualify, not five** as the decision table estimated, and not
  six as the Why section measured. Derived from the files rather than taken from
  the dispatch, which offered the same pair as an explicit inference to check.

  **The one thing that does not fit, and it is an open decision, not a
  finding.** `dl-32`'s decision was answered by the owner in this session — remove
  the list route — but that answer exists only in a dispatch prompt, not on
  `dl-32`'s page. Its file still reads `## The decision this ticket exists to
force`. It was left `ready`, which is now the true statement about whether it
  can be dispatched and the false one about what its page says, and this ticket
  had no authority to write somebody else's answer onto their page along with a
  reason it does not have. It is handed back to the orchestrator as options.
  **This is the failure mode the new status makes possible**, and it is worth
  naming: an answer relayed through a prompt and not written down leaves the
  board and the page disagreeing in the other direction. Hence the sentence added
  to `docs/01-TICKETS.md`: move a ticket to `ready` in the commit that records the
  answer, and the answer goes on the ticket, never into a builder's prompt alone.

  **Done when 2 — the tests failed first.** `npx vitest run scripts` before the
  change: `Tests  11 failed | 125 passed (136)`. Three threw in `validate`
  in-process; seven were CLI runs that exited 1 because the parser refused the
  fixture, so their payload assertions saw an empty stdout; one failed on
  behaviour with the parser uninvolved — the pre-existing `--ready` case beside a
  dangling dependency, which is the test the widened account changes. Verbatim,
  one of each shape:

  ```
  FAIL scripts/test/status.test.ts > a ticket waiting on a decision is open work,
       and its milestone has not started
  Error: tools/planner/docs/work/pl-1-slug.md: "needs-decision" is not a status.
    Use one of: ready, in-flight, done, dropped
   ❯ validate scripts/status.mjs:331:11

  FAIL scripts/test/status.test.ts > --show on a ticket waiting on a decision
       does not call it unblocked
  AssertionError: expected '' to match /status\s+needs-decision/
  + Received: ""

  FAIL scripts/test/status.test.ts > --ready lists the startable ticket and says
       on stderr what it withheld and why
  AssertionError: expected 1 to be +0 // Object.is equality
  ```

  The last of those is the parser reaching the test as an **exit code** rather
  than as a message, which is worth seeing: it is the same failure `ci.yml` gets.

  After: `Tests  136 passed (136)`.

  **Done when 5 and 6, proven by making the gate fail first** rather than by
  observing it pass. `ci.yml`'s `check` job is
  `node scripts/status.mjs --json > /dev/null` and the exit code is the whole of
  it, so `origin/main`'s copy of the script was run against this branch's
  tickets — which is exactly "a ticket carries the new value in a commit earlier
  than the parser":

  ```
  $ git show origin/main:scripts/status.mjs > /tmp/old-status.mjs
  $ node /tmp/old-status.mjs --json --root . > /dev/null; echo "exit: $?"
  docs/work/repo-15-deny-list-does-not-protect-itself.md: "needs-decision" is not
    a status. Use one of: ready, in-flight, done, dropped
  exit: 1
  $ node scripts/status.mjs --json > /dev/null; echo "exit: $?"
  exit: 0
  ```

  That is the whole board failing for every reader, from one ticket, which is why
  `repo-15`, `repo-16`, `STATUSES` and the field table are one commit.

  **Done when 3 was widened, deliberately, and it is the one judgement call
  here.** `--ready` reports **everything** it withheld, not only the rows this
  ticket newly removed: `needs-decision` gets `status is "needs-decision", so it
waits on a human…` and a dependency-blocked ticket gets `waits on <ids>`. A
  notice naming one of two reasons re-creates the defect for the other, and a
  reader would take the list for complete. The cost is one existing test: the
  `test.each` table asserting stderr for every mode beside a dangling dependency
  now carries expected stderr per row, because `--ready` legitimately gains a
  second line there — `repo-9` is withheld _because_ its dependency dangles. Kept
  exact per mode rather than softened to `toContain`; the enumeration was the
  point of that case and still is. Narrowing this back is a two-line change if a
  reviewer disagrees.

  **On stderr, not stdout**, and against the pull of "a quieter command is the
  failure mode". `node scripts/status.mjs --ready | wc -l` is the measurement this
  ticket was filed off, and the fix's whole claim is that the count now means
  "startable" — prose on stdout would break the number the change exists to make
  true, and two existing tests assert `--ready`'s stdout byte-for-byte. The
  sharpest case is covered directly instead: with everything withheld, stdout
  still says `nothing is ready and unblocked` and stderr says which tickets and
  why, so the empty board and the blocked board no longer look alike.

  **It is not a `problem`, and that was load-bearing.** `problems` moves
  `--json`'s exit code. A ticket saying it waits on a human is a board in good
  health, so routing the notice there would have failed every reader's pipeline
  the moment somebody filed a question — the exact filing `docs/01-TICKETS.md`
  invites. Asserted: `--json` over a tree holding a `needs-decision` ticket exits
  0 with `problems: []` and an empty stderr.

  **Three views the brief did not name and the new status would have broken.**
  Each is now covered:

  - `milestones` read `started` as "any status that is not `ready`", so a
    milestone holding nothing but unanswered questions would have reported
    `in progress` — the same conflation the status was added to remove, one view
    over. Now keyed off a new `UNSTARTED` set.
  - The default view's blocked suffix joins `depends_on`, so a ticket held up by
    a decision and nothing else rendered as `(waits on )`, an empty list after
    the words that promise one. It now marks `?` with `(waits on a decision)`.
  - `--show`'s closing line said **`unblocked`** on a `needs-decision` ticket,
    which is the same lie `--ready` was telling — nothing in `depends_on` holds
    it up and it is still not startable. That line is the per-ticket verdict
    CLAUDE.md sends a reader to, so it is where an agent decides to build. It now
    says `waiting on a decision — not startable until someone answers it`, and
    carries any real blockers after a `; also blocked by`.

  **Left alone on purpose.** `.claude/skills/orchestrate-tickets/SKILL.md`
  describes this gap in prose and needs no edit: it dispatches from `--ready`,
  which is now true by construction. `grep -rl in-flight` over `*.md`, `*.mjs`,
  `*.ts` and `*.yml`, excluding `scripts/` and every `work/`, names **12 files
  and exactly one of them is about the taxonomy** — `docs/01-TICKETS.md`, whose
  field table moved. Nine are the phrase used for its ordinary meaning in source
  comments (an in-flight request); the other two are `adr/001`'s account of a
  mirroring option it rejected and `worktree-hygiene.md` on in-flight gates. So
  the taxonomy has one home outside the parser, not several.

  **Unmeasured, and stated as unmeasured.** CI has not run this branch. The
  `--json` exit code was checked locally against this worktree's tickets and
  against `origin/main`'s parser, which is the same command `ci.yml` runs, but
  the workflow itself was not executed.

  **Gate finding closed:** the reviewer found `withheldFromReady`'s documented
  priority — the decision reason wins when a ticket carries both an unmet
  decision and an unmet dependency — untested at that function, covered only
  through `--show`'s closing line. Added
  `withheldFromReady reports the decision, not the dependency, when a ticket
carries both`, and checked it is not tautological by inverting the ternary's
  branches and confirming the new test is the one that catches it:

  ```
  - "status is \"needs-decision\", so it waits on a human answering it rather than on a builder",
  + "waits on pl-2",
  ```

  Restored the correct code and reran: `137 passed (137)`. `npm run check` and
  `node scripts/status.mjs --json` still exit 0.

- **2026-09-05** — Gate recorded (PASS), PR [#145](https://github.com/brunolabbe/tools/pull/145)
  opened against `main`, and the reviewer's report posted to the thread. The
  `## Review` section was committed **verbatim as sent** by the reviewer; the only
  change on commit was `oxfmt` padding the acceptance table's columns, verified by
  diffing the section afterwards.

  **One correction to the gate record, and it is the orchestrator's error rather
  than the gate's.** The model line cited `.claude/agents/builder.md`'s `hard`
  difficulty row ("never below default model"). That row belongs to **`dl-37`**,
  a different ticket in the same batch. repo-19 carries **no `difficulty` field**
  — verified here, not relayed:

  ```
  $ node scripts/status.mjs --json | ... [(id, difficulty) for repo-19, dl-37]
  [('dl-37', 'hard'), ('repo-19', None)]
  ```

  The applicable row is `absent → inherit (Opus, in practice)`. The conclusion is
  unchanged — Opus under either row — so **no re-gate**: only the cited rule was
  wrong, and the substance of the verdict is untouched.

  **Attribution matters here and is deliberate.** The sentence was written by the
  orchestrator into the reviewer's dispatch instruction and given as fact; the
  reviewer transcribed it faithfully. A reader checking the record against the
  frontmatter would have found them disagreeing and had no way to see which link
  in the chain failed, so the correction is recorded inline in `## Review` as a
  block quote rather than silently rewritten. **This is an instance of the defect
  `repo-18` exists to catch** — a citation that resolves to real text while saying
  something the source does not support — arriving in this repo's own gate record
  while that ticket was in flight, which is worth the two lines it costs to
  record.
