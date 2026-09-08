---
id: repo-37
tool: repo
title: 741 failing references sit behind the citation gate's grandfather list
kind: chore
status: done
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

`scripts/citations-gate.mjs:315 "const FAILING = new Set"` enforces anchors on
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

### 2026-09-08 — the planner's slice, 14 records of 17

**Built:** every citation under the `## Review` section of `pl-5`, `pl-10`,
`pl-17`, `pl-18`, `pl-20`, `pl-24`, `pl-26`, `pl-27`, `pl-29`, `pl-31`, `pl-33`,
`pl-34`, `pl-36` and `pl-37`, and their `GRANDFATHERED` entries deleted.

**Not built, and filed rather than left here:**
[repo-39](./repo-39-the-unanchored-half-of-the-review-corpus.md) carries the
downloader's 20 records (300 references), the `repo-*` 22 (231), and the planner's
own remaining three — `pl-25` (23), `pl-28` (38), `pl-32` (22) — plus the nine
method notes below, which are the part a next builder cannot re-derive from
repo-29's measurements.

Measured in this worktree, exit codes read by redirecting to a file rather than
through a pipe:

| `node scripts/citations-gate.mjs`    | enforced | failing | grandfathered | references |
| ------------------------------------ | -------- | ------- | ------------- | ---------- |
| baseline, `origin/main` at `a5e31c7` | 6        | 0       | 59            | 740        |
| this branch                          | 20       | 0       | 45            | 614        |

Both exit 0. `--against origin/main` reports `45 entr(y/ies) compared … 0 raised`,
so the ratchet turned only downwards. **126 failing references were repointed or
anchored**, every one read by hand.

#### The `Done when` lines, with the two this slice cannot close

1. **unproven, and expected to be** — `GRANDFATHERED` is not empty and holds 45
   records / 614 references. That belongs to the unbuilt half and travels to
   repo-39; it is not a failure of this branch, and it is said here rather than
   left to be inferred.
2. **proven** — `node scripts/citations-gate.mjs` runs with
   `--require-distinct-anchors` in force and reports `0 failing` over 20 enforced
   records, 14 of which this branch put there.
3. **proven for the 14 records this branch touched, unproven for the 45 it did
   not.** Every repoint was read against the claim its record makes — the enclosing
   test, the function, the doc comment — not just against the anchor. Nothing was
   demoted to prose to satisfy a checker except the five cases named below, each
   annotated in the record itself.
4. **proven** — `npm run check` exit 0; `node scripts/status.mjs --json` exit 0;
   `npm test` 136 files / 2354 tests, all passing.

#### What the brief had wrong

- **The corpus figures were slightly stale, as the brief predicted of itself.**
  The Why table says 49 `moved` and 741 total; this worktree measured 48 and 740
  at `a5e31c7`. Immaterial, and recorded because the brief asks the next reader to
  re-measure for exactly this reason.
- **"Anchor every citation" understates the job.** Two thirds of the planner's
  failures were not unanchored citations waiting for a fragment — they were
  coordinates that had drifted off their claim, or had never been right. `pl-17`'s
  four proofs were all invalidated by the very commit that landed them (the test
  file was rewritten in `2ea0631` and never touched since; three of its four
  coordinates are off by exactly +109 lines). `pl-18` cited the decline-refused
  test for "decline accepted" and vice versa. `pl-37` named `travel.ts:362` for a
  call that is at `orchestrator.ts:362` — right line, wrong file.
- **The `unchecked` state is a hole the brief does not mention.** The gate's
  `FAILING` set is `unanchored`/`moved`/`unresolvable` plus the `indistinct`
  verdict; a prose reference passes. So a citation demoted to prose stops failing,
  which is honest where it never named a file and is gaming the gate where it did.
  Said out loud because the next builder will find the same lever.

#### What could not be anchored, and why

- **Four citations are declared `citations: evidence`, in two records.** `pl-34`'s
  Low 1 quotes two ambiguous citations _as the finding_, and `pl-29` cites
  `src/overpass_api/statements/around.cc:392-441` in an external repository the
  record already labels "external, unpinned". Neither can be made to resolve, and
  neither should be.
- **Five references were rewritten as prose rather than qualified**, each with a
  sentence in its own record saying so: `pl-34`'s and `pl-26`'s references to a
  _ticket's_ line number (`` `:285` ``, `` `:40` ``), and `pl-5`'s three
  references to its own file. A work record's line number is not a citation — it
  moves whenever the record grows — and `pl-5`'s case is structural rather than
  editorial: **a record cannot cite itself with a distinct anchor**, because the
  anchor text is written into the very file it points at and `locateAnchor` does
  not exclude the citing line. Reproduced three times with three fragments before
  giving up on it.
- **Two stale coordinates outside `## Review` were left alone.** `pl-34`'s Log
  still carries `api/src/runs/travel.ts:286-310`, repointed to `302-342` inside
  the gate record; `pl-20`'s Log repeats `intakes-store.test.ts:105,108`. The
  gate's scope is the `## Review` section, and rewriting merged Log prose across
  17 records is a wider change than this ticket asked for. Recorded as a class in
  repo-39 rather than fixed here.
- **One rendering defect was seen and not repaired.** `pl-20`'s first acceptance
  row contains an unescaped `|` inside a code span, which splits the markdown
  table cell; the row renders as two columns of whitespace. Not a citation defect,
  so out of this ticket's scope, and noted so the next reader of that record knows
  it is known.

#### The method, in one line each

The nine notes that cost this slice a retry each are in
[repo-39](./repo-39-the-unanchored-half-of-the-review-corpus.md)'s Build section
rather than here, because they are instructions for the work that is left and not
a record of work that is done. The two worth repeating at the point of decision:
**repoint to the enclosing test's name**, which is stable where an assertion line
is not; and **an anchor may not contain a double quote**, for which there is no
escape.
