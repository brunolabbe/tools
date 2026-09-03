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

| round | tool calls | subagent tokens |
|---|---|---|
| 1 | 37 | 100 k |
| 2 | 10 | 94 k |
| 3 | 11 | **118 k** |

**Every token figure on this page is `subagent tokens`**, the measure
`reference/history.md` counts sessions in — not dollars, and **not** the whole
volume a request moves. Measured 2026-09-02 on one gated ticket: 152,659 subagent
tokens, but 3.9 M and 5.8 M tokens all-in for the builder and the reviewer once
cache reads are counted, and cache reads are essentially the entire bill. So these
numbers compare rounds against rounds honestly and say nothing directly about
cost. The conversion measured on that ticket was **$0.0182 per 1k subagent
tokens**, which prices the sessions in `history.md` at roughly $16 to $73 each —
useful for a budget, and stale the moment rates move.

Eleven tool calls cost more than thirty-seven. The third session reproduced this
at four times the scale on its widest branch — 100 calls → 238 k, then **29 calls
→ 255 k**, then 50 calls → 290 k. Cost rises as the work shrinks. That branch cost
978 k against a sibling's 322 k, and the difference was rounds, not difficulty. So:

- **End every relay with conditional ship authority.** "Apply these, and **if**
  `npm run check` is green, the suite is green and the diff scope is unchanged,
  open the PR yourself (**or, on a branch with no PR yet, commit the gate record
  yourself** — the same clause, and the state this skill's default produces) — do not check back. If any condition fails, stop and tell
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
- **A second gate on the same brief re-derives the first.** Gate count is not the
  lever; the brief is. Measured 2026-09-02: a first gate returned PASS with zero
  findings, and a second on the *same* branch — deliberately aimed only at ground
  the first had declared out of scope — cost **$2.47** and returned one genuinely
  new artifact (a real TLS handshake, run both pre- and post-fix) and **zero new
  defects**. The verdict did not move. Run a second gate when you can name an
  angle the first did not take; if you cannot name one, you are buying a
  re-derivation. This is the same finding as "gate yield tracked prompt
  specificity, not gate number" in [dispatching.md](dispatching.md), arriving from
  the other end.
- **Some work needs no gate at all.** Filing a ticket that *records a defect* is
  the clear case: require the builder to reproduce the defect before writing it up,
  and the reproduction **is** the verification. In the second session that builder
  found more than it was briefed, corrected the orchestrator, and cost 111 k with
  no reviewer at all.

### Slice a blocked ticket

The inverse of the section below, and the one that makes a decision-blocked board
productive instead of idle. A ticket whose page forbids a builder from settling
its open question is not therefore undispatchable — **the question usually blocks
part of it, not all of it**, and the ticket often says which part.

Three tells, all readable without loading the whole ticket:

- **A Build step marked unconditional.** "Fix the positional-argument parse
  **regardless of what is decided below**"; "required whichever option wins";
  "whichever way this goes". The ticket has already done the separation for you.
- **The ticket recommends an ordering.** One 2026-09-03 case read "do not move
  Chromium; fix the classification (half two) first, since it is cheap, strictly
  an improvement, and independent — then take half one as its own decision". That
  is a dispatch plan written by the filer.
- **A step whose deliverable is a measurement, not a build.** "Re-run job X and
  record whether it goes green, because that single fact separates Option D from
  a dead end." Do it yourself; it is one call and it converts the decision you owe
  the user from an opinion into a number.

Four things the dispatch prompt must then carry, and the first two are the ones a
builder will otherwise get wrong:

- **Say the ticket does NOT close, and that its status stays `ready`.** A builder
  told to implement a Build section will close the ticket, because that is what
  finishing means everywhere else.
- **Say the boundary is the point**, and name the held question in the builder's
  own words — quote the ticket's "do not settle it here" heading. A boundary given
  without its reason reads as an arbitrary narrowing and gets helpfully exceeded.
- **The unconditional half still earns a Log entry**, saying what landed and what
  remains open pending a decision. Otherwise the next agent cannot tell a sliced
  ticket from an untouched one.
- **Ask the held decision immediately** — see _Batch them_ in the skill page. The
  slice and the question are the same ticket, and the answer is only cheap while
  the builder lives.

**The trap, and it is not obvious.** A slice can *de facto answer* the question it
was supposed to hold. Measured 2026-09-03: a ticket's unconditional step 2 was
"reject an unknown flag with a non-zero exit", and its held question was whether to
implement or delete a documented-but-dead flag. Landing step 2 turns that flag from
a silent no-op into a hard error — which is most of what deleting it would do. The
ticket half-noticed, saying step 2 "makes deleting the strictly safer of the two in
the short term", and no one had drawn the conclusion. **So before dispatching a
slice, ask what the unconditional half does to the held option**, and put it in the
prompt as a thing to surface rather than to resolve: *if landing this forces a
behavioural answer to the open question, say so as an open decision rather than
picking one — I am the only participant who can put it to the user.* The builder is
the one with the code in front of it and is best placed to see it; it will not
raise it unless asked, because from inside the slice it looks like scope it was
told to stay out of.

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
