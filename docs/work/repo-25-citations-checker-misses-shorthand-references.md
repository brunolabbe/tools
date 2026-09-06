---
id: repo-25
tool: repo
title: The citation checker silently skips shorthand and prose references, then reports full coverage
kind: fix
status: done
milestone: null
depends_on: [repo-18]
difficulty: standard
---

# repo-25 — a clean citation report over a ticket whose references were never read

**Files:** `scripts/citations.mjs`, `scripts/test/citations.test.ts`.

## Why

`scripts/citations.mjs` detects a citation by matching backticked `file:line`
text. Anything referring to a location in another shape is not checked — **and
is not reported as unchecked**, which is the defect. The summary line counts
what it found, so a ticket carrying five references and three citations reports
`3 citations … 2/3 resolve`, and reads as complete coverage.

### Reproduction

A scratch ticket containing five references to real locations. Every location in
the sample below is a **quotation of a reference shape**, not a pointer, so the
checker is told so rather than asked to resolve them — which is the mechanism
this ticket adds and the reason this section exits 0:

<!-- citations: evidence hls.ts:367, hls.ts:27 -->

```markdown
See [`release-please-config.json:31`](../../../release-please-config.json), and
the `docs` line at `:27` in the same file.

Also [`manifest/hls.ts:456`](../../resolvers/src/manifest/hls.ts) and then
line 367 of that file, and hls.ts:367 as a bare mention.
```

`node scripts/citations.mjs <file>` reports **3 citations**, of which one fails
as ambiguous. Silently skipped:

| Reference               | Why it is missed                         |
| ----------------------- | ---------------------------------------- |
| `` `:27` ``             | shorthand — no filename in the backticks |
| `line 367 of that file` | prose, not backticked                    |

Both name real lines. Both could be wrong without any signal. Nothing in the
output says two references went unread; the count is of what was _detected_, and
a reader has no way to tell that from what was _written_.

**Two sessions hit this independently on 2026-09-05**, on the same shape — a
fully-qualified reference followed later in the same sentence by a bare `:NN`
shorthand, which is a natural way to write and exactly what is invisible.

### It is not what repo-18 fixes

[repo-18](./repo-18-citations-resolve-is-not-correct.md) (PR #146, gated) makes
the tool verify that a citation _says what it claims_ rather than merely
resolving. That is the other half: it improves the verdict on citations the tool
already sees. A reference it never detects gets no verdict either way, and gains
nothing from anchor-text checking. `depends_on: [repo-18]` because that PR
rewrites this file and is merge-ready — build on it rather than against it.

## The open decision

**What should count as a citation, and what should an unrecognised reference
do?** The second question matters more than the first: silence is the bug, and
any of these fixes it.

- **A. Detect shorthand, resolve it against the nearest preceding qualified
  citation (recommended).** Matches how people actually write, and the file is
  unambiguous from context. Costs a notion of "current file" while scanning, and
  needs a rule for a shorthand with nothing before it — which should be an error,
  not a skip.
- **B. Report unrecognised references instead of resolving them.** Flag anything
  that looks like a location but was not detected — a bare `:NN`, a
  `line NNN` phrase — as `unchecked` rather than resolving it. Cheaper and
  strictly honest; leaves the writer to qualify it by hand. Weaker, but it makes
  the gap visible, which is the whole complaint.

<!-- citations: evidence hls.ts:27 -->

- **C. Also read markdown link targets.** Would catch `[`:27`](../file.json)`.
  Does not help the prose case, and link targets are relative paths that need
  resolving against the ticket's own location — more machinery than A for less
  coverage.

**A and B are not exclusive**, and doing both is probably right: resolve what can
be resolved, report what cannot. The tool already ends its output by naming two
things it cannot judge, so it has a place to say so.

## The carve-out is prose, and something is about to automate around it

**A ticket whose citations must not resolve is not an edge case — three exist
already.** This one (its reproduction sample and its own evidence), and
`repo-21`, which states the same thing about itself: _"both failures are
deliberate … repointing either would destroy the evidence it exists to carry —
the carve-out `citations.mjs` names and cannot check. Do not 'fix' them."_

That carve-out exists in exactly two places, and **a machine can read neither**:
a sentence in the tool's own output footer, and a "do not fix these" warning in
each ticket's prose.

Two things now converge on it:

- **repo-18 (#146) ships `--require-anchors`**, which folds `unanchored` into the
  failure count (`summarize`, `scripts/citations.mjs`), so it exits non-zero on
  citations that today only warn. It widens what counts as a failure.
- **repo-21 proposes running `citations.mjs --require-anchors` in
  `.github/workflows/ci.yml`** over `SKILL.md`. That would be the first thing to
  run this checker automatically — at which point "this ticket must fail" stops
  being a note to a human and becomes a red build.

Not listed in `depends_on`: neither is a prerequisite for fixing the
under-reporting, and `repo-21` does not exist on this branch, where a dangling
id would make `scripts/status.mjs --json` exit non-zero — which _is_ the CI
board gate.

**So whatever lands here should give the carve-out a form a CI job can read** — a
frontmatter field, or a marker on the citation itself — rather than adding a
third prose warning. The three failure classes are not alike and should not
collapse into one exit code: a citation that cannot be resolved, one that
resolves to the wrong content, and one that is _deliberately_ unresolvable
because it is the evidence.

## Build

<!-- citations: evidence index.ts:440 -->

1. Land on top of #146 rather than beside it — both change `scripts/citations.mjs`.
2. Take the decision above.
3. `scripts/test/citations.test.ts` is the existing suite; extend it. The
   reproduction above is the fixture — a shorthand after a qualified reference,
   a prose reference, and a bare basename that is ambiguous, in one file.
4. **Do not make a bare basename resolve by guessing.** `index.ts:440` matching
   ten tracked files must keep failing; ambiguity is a real answer and the
   current behaviour there is correct.

## Done when

- A ticket containing a shorthand reference either resolves it or reports it as
  unchecked, and in neither case is it silently absent from the count.
- A test proves the reproduction above accounts for every reference in it.
- A prose reference does not cause a false failure on ordinary ticket text —
  worth checking against the existing `docs/work/` corpus, which is full of
  sentences containing numbers.
- A ticket that declares its citations deliberately unresolvable is
  distinguishable from a broken one **by exit code**, not only by prose — so
  that anything wiring this into CI can tell them apart.
- `npm run check` and `npm test` pass.

## Log

<!-- citations: evidence hls.ts:367, index.ts:440, file.ts:120, other.ts:9 -->

- **2026-09-05 — filed.** Found while path-qualifying six ambiguous citations
  across dl-40..dl-43 on PR #151, and independently hit the same day by the
  session working on #147, which was the tell that it is a shape rather than a
  slip. The measurement in the reproduction was taken before filing: five
  references written, three detected, and a summary line that distinguishes
  neither. The related trap for anyone fixing a list of ambiguous citations is
  that the obvious qualification is not always enough — `api/src/config.ts` and
  `api/src/db/schema.ts` each still match both `downloader` and `planner`.
- **This ticket fails its own checker on purpose, twice.** `node
scripts/citations.mjs` on this file reports `2/4 resolve`: `hls.ts:367` inside
  the reproduction block, and `index.ts:440` in the Build section, are both
  deliberately unqualified — they are the evidence, and qualifying them would
  destroy it. That is the second case the tool's own footer names ("a citation
  that is a finding's own evidence must stay as written"). Nothing in CI runs
  this checker, so the non-zero exit is advisory. Do not "fix" those two.
- **2026-09-06 — built.** Decision taken by the owner as **A and B together**:
  a backticked shorthand resolves against the nearest preceding qualified
  citation, a prose `line NNN` is reported `unchecked` and never resolved. C was
  not taken. Six states now, and the count is of _references_ rather than of the
  subset that happened to be detected — on this file, 6 before and 11 now.

  **What the brief had wrong, and it is only the numbers.** The Log entry above
  says this file "reports `2/4 resolve`". It reported neither: repo-18 (#146)
  had already replaced `N/N resolve` with named buckets by the time this ticket
  was filed, and the count was 6, not 4, because the Log passage quoting the two
  deliberate citations contains them a second time. Against `origin/main@cf433aa`
  the actual output was `0 verified, 0 moved, 2 unanchored, 4 unresolvable — of 6
citations`. The _shape_ of the claim held exactly — four failures, all of them
  deliberate — so nothing downstream of it changed.

  **Prose is counted and never fatal, and that is a measurement rather than a
  preference.** Resolving `line 367` against the current file would have been
  free, and it is wrong: 95 `line NNN` phrases sit in the work records and most
  are ordinary sentences about a fixture, a diff or quoted output, so a guess
  would manufacture the exact defect this script exists to catch. `unchecked`
  therefore sets no exit bit. The corpus test asserts prose stays under an eighth
  of all references (56 of 760 when written, about 1 in 14); loosening `PROSE` to
  a bare number takes it to 122,728 of 17,150 and fails, which is how it was
  checked that the assertion can fail at all.

  **Shorthand resolution is a heuristic, and the output now says so.** Measured
  over the 301 shorthands in the work records: 44 sit after a citation on their
  own line, 89 more inside the same paragraph, 156 inherit from further up, and
  12 have nothing above them at all. Three of the 156 inherit the _wrong_ file —
  a Log passage that had drifted onto another document — and all three surfaced
  as a loud `past end of file`, not as a quiet pass. The residual risk is the
  quiet one: a wrong file whose line number happens to exist reads `unanchored`
  with somebody else's text under it. Two things answer that rather than one:
  every shorthand prints as `:27 in <file> (named at record line N)`, so the
  guess and its source are both on screen; and the file is inherited **as
  written**, ambiguity included, so a shorthand under a bare `status.test.ts`
  fails ambiguous exactly as the qualified citation above it does. Narrowing
  inheritance to the paragraph was considered and rejected: it would refuse 156
  of 301, nearly all of them correct, and the shape this ticket was filed for is
  a shorthand _in the same sentence_.

  **Build step 4 holds.** `index.ts:440` still matches ten tracked files and
  still fails; there is a test on it and a second on the inherited case.

  **The carve-out is a declaration now**, not a third prose warning:
  `<!-- citations: evidence file.ts:120, other.ts:9 -->`, one or more per record,
  filtered by `--section` like the citations it excuses. Those two are quotations
  of the grammar rather than pointers, so this Log declares them alongside the
  ticket's own evidence — which is the first use of the marker for the thing it
  is for. An HTML comment rather
  than the frontmatter field the ticket floated, for two reasons: `status.mjs`
  parses frontmatter strictly, so a new key there costs `FIELDS` and
  `docs/01-TICKETS.md` for a fact about one record's citations; and a marker on
  the citation itself edits the citation, which is precisely what must not
  happen to a quotation of a defect inside a reproduction block. A declaration
  that excuses nothing — because the citation now passes, or is not in the record
  at all — is itself an error, so the waiver cannot rot into a rubber stamp.

  **The exit code is a bitmask**, `1` unresolvable · `2` moved · `4` unanchored
  under `--require-anchors` · `8` a wrong declaration, printed under the summary
  as `exit 3 — 1 unresolvable, 1 moved`. This is wider than the acceptance line,
  which asks only that declared evidence be distinguishable from a broken record;
  it is what the ticket's own sentence about three classes not collapsing into
  one exit code requires, since a ranking collapses them exactly when two occur
  together. It changes three assertions repo-18 wrote as `toBe(1)` — a moved-only
  record is now `2`, `--require-anchors` on a legacy record is now `4` — and each
  of those tests now pins the bit _and_ the printed sentence, so the number can
  never drift from what it means.

  **This file now exits 0 and its two deliberate citations are byte-identical**:
  `0 verified, 0 moved, 3 unanchored, 0 unresolvable, 2 unchecked, 6 evidence —
of 11 references`. Six rather than two, because the shorthand and prose rules
  read the reproduction sample and the options table as well, and every one of
  those is a quotation of a shape rather than a pointer. Nothing in CI runs this
  checker yet; when repo-21 wires it in, this record passes and a genuinely
  broken one does not.

  **Not folded in, and both are real.** repo-24's Log flags that a citation
  ending one line short of a closing brace still reports `ok` because the script
  "only bounds-checks against EOF" — reproduced, and it is the documented design
  rather than a defect: an unanchored citation is not checked for content at all,
  which is what `unanchored` says and what an anchor fixes. And repo-24 also
  observes that `--rev` reads the _ticket_ from the working tree, so a run at an
  old sha checks today's citations against an old tree. That one is a genuine
  defect with a reproduction, in this file, and it is not this ticket's Build —
  it wants filing rather than folding.
