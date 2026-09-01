# What the sessions cost

Provenance for the rules on this page's parent, kept out of `SKILL.md` because it
is evidence rather than instruction, and because everything at the top of
`SKILL.md` is what survives a compaction.

This skill is written from six sessions, each applying the last one's lessons:
~4 M subagent tokens across 21 agents and 16 gates; then ~2.7 M across 17
invocations and 6 gates; then 2.86 M across 12 agents and 18 invocations, five
tickets to five merged pull requests, 8 gates and 8 that returned landable
findings; then **2.04 M across 10 agents and 16 invocations, four tickets to four
pull requests, 6 gates and 6 that returned findings, every builder producing a
complete branch on its first round, and no branch ever needing a rebase**; then
**877 k across 6 agents and 12 dispatches-or-messages, three tickets to three
pull requests, 3 gates, again every builder complete on its first round and no
rebase — and a batch whose whole output was 266 non-documentation lines — 104 of
them `src/`, the rest tests, a fixture and one config line — against 1,113 of
documentation. That 4.2:1 is the fifth session's real lesson and the reason two
of the entries in `reference/sizing.md` are about cost rather than correctness.**

Then **~1.74 M across 11 agents and 19 dispatches-or-messages, three tickets to
three pull requests, 8 gates, and three further tickets filed.** Every builder took
three rounds, and the sixth session's lesson is *why*, because only one of the nine
rounds was the work's fault:

- **Two rounds were the orchestrator's own errors**, both of them compression —
  relaying a gate's *conclusion* rather than its evidence, which cost a round of
  refutation; and *describing* a gate record the builder was asked to commit, which
  cost a round to nothing. Both are now rules on `SKILL.md`.
- **Three rounds were structural and correct**: a post-PR gate's result and a
  user's decision each arrived after the previous round had closed. That is the
  price of the post-PR gate pattern and it is worth paying.

The other measurement worth carrying: **two of eight gate findings were wrong**,
and both were caught only because the relay said *reproduce this before accepting
it*. One had **every premise true and its conclusion false** — the shape that
survives an orchestrator's own check and dies on contact with a running test. The
count that matters is not gates-that-found-something; it is that no wrong finding
reached a commit.
