# Size the process to the ticket

The loop above is one loop. Running it identically over a one-line frontmatter fix
and a seventeen-file change touching `packages/core` is the single largest source
of waste, and it is easy to do without noticing, because each individual round
looks reasonable.

**Builder round-trips cost more than gates.** A second-session docs ticket spent
449 k across five invocations on a 123-line change — 312 k of it three builder
rounds, two applying about four lines of markdown each — while all six of its
gates returned landable findings. A resumed builder pays a full context reload,
and its cost is flat in the work done and rising with transcript length:

| round | tool calls | tokens |
|---|---|---|
| 1 | 37 | 100 k |
| 2 | 10 | 94 k |
| 3 | 11 | **118 k** |

Eleven tool calls cost more than thirty-seven. The third session reproduced this
at four times the scale on its widest branch — 100 calls → 238 k, then **29 calls
→ 255 k**, then 50 calls → 290 k. Cost rises as the work shrinks. That branch cost
978 k against a sibling's 322 k, and the difference was rounds, not difficulty. So:

- **End every relay with conditional ship authority.** "Apply these, and **if**
  `npm run check` is green, the suite is green and the diff scope is unchanged,
  open the PR yourself — do not check back. If any condition fails, stop and tell
  me." This removes an entire round and gives up no gating, because the conditions
  are mechanical. It worked on three branches in the second session and four of
  five in the third. **Know when you cannot give it:** a FAIL whose fix is real
  work needs a real check, and that branch will cost you a round no matter how the
  relay is written. Budget for it rather than trying to write around it.
- **Batch every finding from a gate into one relay.** Two relays of one finding
  each cost double for the same result.
- **Choose the gate count from what the branch risks escaping** — a shared
  package, a contract, an untested path, a security claim — not from a rule and
  not uniformly. A self-generated docs ticket deserves one builder and at most one
  gate. See _Do not cap the gate count_ in [dispatching.md](dispatching.md) for the other half of this: the economy is
  in scope, never in refusing a gate that has something to check.
- **Point every verification run at the narrowest thing that can fail.** This is
  the largest single cost in a batch and the page said nothing about it for five
  sessions. Measured on this repo, warm: one spec file **2 s**, the directory that
  contains it **41 s**, the tool's whole project **~50 s**, plus **12 s** to rebuild.
  A five-mutation sweep is `5 x (12 + 2)` or `5 x (12 + 41)` — **1.2 minutes or
  4.4 minutes for identical evidence**, and the fifth session paid the second
  figure across six agents. A mutation to one regex cannot break a spec that never
  imports it, so run the spec, then run the project **once** at the end. Say it in
  the prompt; agents reach for the directory by default. The 20x is this repo's
  suites and will not transfer as a constant — the *shape* does, so have the agent
  measure both once and use the number it gets.
- **Some work needs no gate at all.** Filing a ticket that *records a defect* is
  the clear case: require the builder to reproduce the defect before writing it up,
  and the reproduction **is** the verification. In the second session that builder
  found more than it was briefed, corrected the orchestrator, and cost 111 k with
  no reviewer at all.

### Fold it in, or file it

**The rule itself is repo-wide and lives in `docs/01-TICKETS.md`** — a ticket
carries a decision or a reproduction, and work with neither left gets done in the
commit at hand. What follows is why an *orchestrator* is the one who has to catch
it, which is not obvious from the rule.

A ticket whose entire deliverable is **one line** is not a ticket. The fourth
session shipped a 58-line brief whose Build section was "append one `_Outcome:_`
line to a sibling ticket" — and the branch that filed it was the branch that had
just *measured* the annotation to be free. It proved the thing was affordable and
then declined to pay for it.

Nobody was careless. The builder was told "implement the Build section, do not
widen or narrow", and it obeyed. **The defect is the orchestrator's**, in two
places: the dispatch rule had no exception for work the branch itself had just
made free, and the resulting deferral was never surfaced as a decision.

**The arithmetic is not close.** Folding it in costs one resume of an agent that
is alive and holds the whole context — and, if the PR is still open, not even a
new pull request. Filing it costs a future intake slot, a full builder dispatch, a
gate, a PR and a merge, all to move one line. Call it five to ten times the price,
paid later, by someone with none of the context.

Three tells that you are looking at this, all cheap to check at relay time:

- **The Build section's output is a single line, or a single frontmatter field.**
- **The blocking reason is already gone** — most sharply when *this* branch is what
  removed it. A ticket that says "X is now affordable because we just measured Y"
  is a ticket that should have spent Y.
- **The ticket's own Why explains why it was not folded in.** In the reference
  case: "left as its own ticket rather than folded in because the brief did not ask
  for it." That sentence is the builder telling you it could have. Read those; they
  are where deferrals become visible, which is exactly why the builder prompt is
  told to write them.

**When you do fold it in, do not delete the ticket if it has already been
committed.** Mark it `done` in the commit that earns it — the convention this repo
already documents — and rewrite its Log to say it was folded in and why that was
possible. The brief usually records *why* the work became affordable, which is not
derivable from a one-line diff; and on a branch where gate records have already
verified that ticket's id, frontmatter and `depends_on`, deleting the file dangles
verified content across every one of them.

**The inverse still holds**, so do not over-read this: a ticket that records a
*defect* is worth filing even when the fix looks small, because the reproduction is
the deliverable and the fix may not be. The test is not size, it is whether
anything is left to decide.
