---
paths:
  - "tools/planner/itinerary/**"
  - "tools/planner/contract/src/unchecked.ts"
  - "tools/planner/web/**"
  - "tools/planner/api/src/db/**"
  - "tools/planner/api/src/grounding/**"
---

# Saying what a plan did not check

Lifted out of `tools/planner/CLAUDE.md` so it loads when you are in `itinerary`,
in the contract's `unchecked.ts`, or rendering a plan — and costs nothing
elsewhere. The rules are unchanged.

**Name what you did not check, not only what you did not cover.** A packed plan
looks equally finished whether every constraint was enforced or three were
skipped for want of data, so every plan carries an `UncheckedConstraint` list. A
caller that drops that list on the floor turns an honest plan into one that
merely looks finished. It is **not** a `PlanGap`: a gap names a specialist that
did not contribute, and "nothing measured the distance" is not a statement about
a specialist.

Until pl-27 that list carried travel time **always**, because
`Place.coordinates` was null until grounding and nothing could measure between
one item and the next. That reason was right for Phase 2 and is no longer true:
a run locates the places its candidates name and measures a matrix over them, so
each entry is a claim about _this plan_ — naming the items whose transition
nothing could measure, the ones a run could not afford to look up, and still
carrying its Phase 2 sentence plan-wide when nothing was measured at all. The
rule that replaced it is the same rule one level down: **say what happened to
this plan, never what is true of the phase.**

**`travel-time` can appear more than once on one plan, and on a plan with
placed items on two or more days it is never absent.** Those are two separate
things a reader has to hold.

The first is that "nothing could measure this", "this run stopped asking" and
"nothing ever measures this" are three different sentences, and the list's job
is to say which applies to what — so **a kind is not a unique key**. Anything
rendering or indexing this list keys on `uncheckedConstraintKey` from the
contract, which is where that identity now lives; the plan view keying on the
kind is what this cost, on three of the six checked-in sets.

The second is that a transition is a pair of items **within one day**. The
overnight hop from the end of one day to the start of the next is charged to no
day's budget and measured by nothing, so an entry names it whenever a plan has
placed items on two or more days. Going quiet once every within-day pair was
measured would tell a reader the getting-about had been checked, and on this
list silence is a claim. (A plan whose placed items all land on one day has no
such hop and can legitimately carry no entry at all — the packer fills days
evenly, so it takes a season filter to produce one.)

The vocabulary is `@planner/contract`'s (`unchecked.ts`) because it goes over the
wire; `@planner/itinerary` derives it and re-exports the type. **It is derived,
never stored** — `compose` returns it for the plan it just built and
`uncheckedForRevision` reads it off a stored revision, and the two agree by
construction because both are the same function over the days. Do not add a
column for the list: a stored list can disagree with the days it is printed
beside, and re-composing on read would drift with `limits.ts` and with the clock.

**`coverage` is the one exception, and it proves the rule** (pl-29). A thin
corridor is not a function of the brief, the candidates or the days — it is a
live backend's answer to a query that ran once, upstream of any candidate — so it
rides on `PlanRevision.coverage`, exactly as a measured leg rides on
`PlanItem.travelFromPrevious`. That is the same test as the paragraph below, not
a hole in it: **evidence from outside is stored; a derivation over the days is
not.** `tools/planner/CLAUDE.md` carries the full reasoning. Anything else you are
tempted to add a column for, check against that test first.

**Evidence is stored; a derivation is not**, and pl-27 is where the two part
company. `PlanItem.travelFromPrevious` is a column, because a measured distance
came from outside at a moment from a source, its cache row will expire, and a
plan must still be able to say what its days were packed against. The list above
is read _off_ that, so nothing re-measures on a read. **Three answers and not
two**: measured, nobody could say, and never asked for want of budget — the last
two are different sentences to a reader, and a `null` that meant both would tell
someone that nothing knows a road nobody ever looked up.

**The packing limits are content, and they are reviewed as content** — the same
standing the question tree has. They live in `itinerary/src/limits.ts`: how many
minutes of activity an appetite means, how much road a drive appetite means, how
many things a pace means. Argue with the number rather than adding a branch that
works around it, and keep them tables rather than conditionals — "why only two
things on Tuesday" has to be answerable by reading one value.
