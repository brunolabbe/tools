---
id: repo-37
tool: repo
title: 741 failing references sit behind the citation gate's grandfather list
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-37 — The `## Review` corpus is not anchored

**Packages:** `docs/work/`, `tools/*/docs/work/`, and `scripts/citations-gate.mjs`
(the `GRANDFATHERED` list only).

## Why

repo-29 built the gate and did not pay the debt. That was the owner's answer —
the mechanism was the deliverable — but the debt has to have a home or the answer
evaporates into a comment in a script. This is the home.

`scripts/citations-gate.mjs:258 "const FAILING = new Set"` enforces anchors on
every work record's `## Review` section. **59 of the 63 records that have such a
section are exempted by name**, each with the number of failing references it is
allowed to hold. Measured on repo-29's branch:

| Class        | Count   |
| ------------ | ------- |
| unanchored   | 639     |
| moved        | 49      |
| unresolvable | 47      |
| indistinct   | 6       |
| **total**    | **741** |

**Only 4 records are enforced today, and only 1 of the 4 carries a citation the
gate actually checks.** `dl-17` and `dl-26` have `## Review` sections with zero
references; `repo-30`'s two are `unchecked` prose of the "line 12" shape, which
names no file. `pl-2` carries the only two real `file:line` citations under
enforcement in the whole repository. That number is the argument for this ticket:
today's gate protects the future and almost nothing else, and it stays that way
until this list shrinks.

### What is already known, so it is not rediscovered

**An automatic sweep does not work, and repo-29 measured why rather than
assuming it.** A sweep was built, run over this exact scope and reverted. It
accepted an anchor only when the fragment occurred exactly once in the target
file, and chose it by one of three rules — anchor today's content where the cited
lines are byte-identical to the commit that first carried the record's
`## Review` heading (270 citations), repoint to where the text the reviewer saw
has uniquely gone (116), or follow an existing anchor that has moved (40). It
proposed 426 repairs of 688 and refused 262.

**It was reverted because two of the first ten anchors inspected were false**,
both inside `repo-25`'s own gate record:

- a backticked shorthand naming port 443 — a TLS **port**, quoted by that record
  as the known false positive it exists to describe — was anchored against line
  443 of `citations.mjs`;
- a citation quoted _inside a reproduction_ of an earlier run was anchored to
  what that line holds today, editing a dated measurement to match the tree.

`scripts/citations.mjs:58 "there is no lexical rule that separates"` says why the
first cannot be fixed in the sweep. **So a sweep must not touch a shorthand, and
must not touch a citation inside a quoted reproduction.** Those two lines are the
deliverable repo-29 left behind; they are not advice, they are the boundary of
what any automation here may do.

**331 of the 639 unanchored citations point at lines whose content has changed
since the record was written**, comparing the cited range at the record's birth
commit against the tip. Those cannot be anchored to today's content without
manufacturing a false claim — they need repointing, which is judgement, one at a
time. That is the size of the job and the reason repo-29 did not fold it in.

## Build

Not a single dispatch. Take it in reviewable slices — a tool's records, or a
run of ids — and for each slice:

- Anchor every citation under `## Review`, on a fragment that occurs **once** in
  the target file. `--require-distinct-anchors` will tell you when it does not.
- Repoint what is stale rather than anchoring a wrong coordinate to today's
  content. Anchoring a stale citation is how a silent error becomes a
  `verified` one.
- Declare a deliberately unresolvable citation with
  an evidence declaration comment (`citations: evidence`, naming the location) rather than repointing it. There is
  no declaration for an indistinct anchor and that is deliberate — the fix is
  always available.
- **Lower the record's number in `GRANDFATHERED`, or delete the entry.** The gate
  fails if the number is higher than the debt, so the ratchet does the
  bookkeeping for you.
- Say in the Log what you could not anchor and why, rather than picking a
  fragment to satisfy yourself.

**Do not grep the checker's output for a state name.** Two of its six
per-citation labels are not their state: `unresolvable` prints as `FAIL` and
`verified` as `ok`. A sweep filtering on `MOVED|UNRESOLVABLE` silently drops
every unresolvable citation and prints a smaller number that looks like an
answer — which is how repo-29's own gate under-counted this corpus by ten
citations across two records. Grep the marks, or read the summary line, which
names every state. `citations-gate.mjs` prints state names instead, so the two
tools do not agree on labels and a filter written for one is wrong for the
other.

**A second known instance, and it is the wrong-file shorthand class rather than
the weak-anchor one.** `repo-6`'s record writes two bare shorthands — a line number in backticks with
no filename, twice — in a paragraph about `scripts/status.mjs` — but the nearest qualified
citation above them names `.github/workflows/ci.yml`, so both bind to the
workflow. They were `unchecked` for as long as that file was shorter than 401
lines, which read as loud enough. repo-29's branch took `ci.yml` past 414 lines
and **both went quiet**: the first now resolves to an `echo` inside a shell block
and reports `unanchored`, which is indistinguishable from a citation nobody has
got round to anchoring. (Their coordinates are described rather than quoted; a
backticked bare number is itself a shorthand, so writing them here would mint two
more of exactly the defect.) Qualifying them is not mechanical — the symbols the
record names (`const repoRoot = DEFAULT_ROOT`, the `run()` helper) are not in
`status.mjs` today, so somebody has to decide what a merged record's dated claim
should point at, which is this ticket's judgement and not a repoint. `repo-6`
carries no `## Review` section, so no gate will ever raise it.

**One known instance outside this scope, recorded here so it is not lost.**
`.claude/skills/orchestrate-tickets/SKILL.md:115 "model: sonnet"` anchors on a
fragment that occurs twice in `.claude/agents/ticket-reviewer.md`. repo-21's CI
step over that file runs `--require-anchors` without
`--require-distinct-anchors`, so it passes today. Whoever adds the stricter flag
to that step fixes this first, or the step goes red on a file they did not touch.

## Done when

1. `node scripts/citations-gate.mjs` exits 0 with an empty `GRANDFATHERED`, or
   the list holds only entries whose Log says why they cannot be repaired.
2. No citation is anchored on a fragment that occurs more than once in its
   target — which is now checkable rather than aspirational.
3. Every citation the work repointed still supports the claim the record makes
   about it, and anything that could not be given a distinctive anchor is listed
   in that record's Log.
4. `npm run check` and `node scripts/status.mjs --json` exit 0.

## Log

- **2026-09-08** — Filed from repo-29's build, which measured everything above
  and deliberately built the gate without paying the debt. The corpus figures,
  the reverted sweep's two false anchors and the 331-drifted measurement are all
  repo-29's, taken at `b384033` on branch `repo-29-citation-anchors`; re-measure
  before starting, because the denominator grows with every gate record and
  repo-29's own filing figures were already stale within five days.

  `difficulty: hard` is not about the diff. Every one of the 331 drifted
  citations is a judgement about what a record was claiming, and the failure mode
  — anchoring a wrong coordinate so it reports `verified` — is worse than the
  state it replaces. That is a contract-shaped risk over somebody else's
  committed evidence, which is what `hard` is defined for.
