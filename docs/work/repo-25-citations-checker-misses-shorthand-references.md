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
5. **Folded in 2026-09-06, on the owner's instruction and against the builder's
   recommendation to file it as a ticket of its own.** `--rev <sha>` reads the
   _record_ from the working tree while resolving its targets at `<sha>`, and
   says so nowhere — repo-24's Log, one level out from this ticket's own subject:
   a flag that plainly answers a different question than the one a reader
   assumes, with no error to say so. Name both sides in the output, and where the
   record exists at the rev and cited something different, say that too. **Do not
   read the record from the rev**: a gate record is written after the commit it
   reviews, so it is not there.

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
- `--rev <sha>` names which record it read, and a record that exists at `<sha>`
  and cited something different there is told so — so a citation the record did
  not have then cannot fail a run without explanation. (Build 5, folded in; its
  own acceptance because it is a second behaviour change and one arriving without
  one was the objection to folding it in at all.)
- `npm run check` and `npm test` pass.

## Log

<!-- citations: evidence hls.ts:367, index.ts:440, file.ts:120, other.ts:9, src/tls.ts:2, src/tls.ts:99 -->

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
  of all references. **The figures this paragraph first carried were measured
  over a sixth of the corpus** — see the 2026-09-06 correction below — and the
  measured ones are 99 prose references of 1915, about 1 in 19. Loosening `PROSE`
  to a bare number fails the assertion, which is how it was checked that it can
  fail at all.

  **Shorthand resolution is a heuristic, and the output now says so.** Measured
  over the shorthands in the work records — **again first measured over a sixth
  of the corpus**; the real figures are in the 2026-09-06 correction below. Some
  inherit the _wrong_ file —
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

  **This file now exits 0 and its two deliberate citations are byte-identical.**
  More than two are declared, because the shorthand and prose rules read the
  reproduction sample and the options table as well, and every one of those is a
  quotation of a shape rather than a pointer. **The counts are deliberately not
  quoted here.** The number this file reports changes every time this Log gains a
  paragraph, and quoting it inside the entry that grows it is exactly how the
  "2/4 resolve" line above went stale — a reviewer caught this entry doing it
  again, one paragraph after the passage complaining about it. Run the command;
  `exit 0` is the claim. Nothing in CI runs this checker yet; when repo-21 wires
  it in, this record passes and a genuinely broken one does not.

  **Not folded in, and both are real.** repo-24's Log flags that a citation
  ending one line short of a closing brace still reports `ok` because the script
  "only bounds-checks against EOF" — reproduced, and it is the documented design
  rather than a defect: an unanchored citation is not checked for content at all,
  which is what `unanchored` says and what an anchor fixes. And repo-24 also
  observes that `--rev` reads the _ticket_ from the working tree, so a run at an
  old sha checks today's citations against an old tree. That one is a genuine
  defect with a reproduction, in this file, and it is not this ticket's Build —
  it wants filing rather than folding.

- **2026-09-06 — the `--rev` fold-in, and a correction against myself.**

  **Folded in against my own recommendation, and the reproduction narrowed the
  fix.** I reported this as a candidate ticket and recommended filing it; the
  owner chose to fold it in and took the widening cost knowingly, with two
  conditions — that the reviewer heard the scope before the tree moved, and that
  the fold-in carried its own `Done when` line. Both are honoured (`Done when` 5,
  Build 5). My framing to the owner was looser than the evidence: I described it
  as "`--rev` checks today's citations against an old tree", which invites the
  fix "read the record from the rev too". That fix is wrong. **A gate record is
  written after the commit it reviews, so it does not exist at the sha it pins
  to**, and reading it from there would fail the flag's main use outright; there
  is a test pinning exactly that, because it is the reason the obvious answer is
  the wrong one. repo-24's own framing was the right one all along — _a flag that
  plainly answers a different question than the one a reader assumes, with no
  error to say so_ — so what changed is what the run says, not what it resolves.

  Reproduced before fixing, in a throwaway repo: commit 1 has a record citing
  `src/tls.ts:2` against a 7-line file; commit 2 grows the file and the record
  gains `src/tls.ts:99`. `--rev <commit 1>` reported `1 unresolvable` and exited
  1, blaming a citation **the record did not contain at that sha**, with nothing
  saying which document it had read. Now the header reads `read from the working
tree and resolved against <sha>`, and the run adds `2 reference(s) now, 1 then
— 1 it did not have then`. Advice on stdout, so `stderr empty ⟺ exit 0` holds.

  **The quiet wrong-file shorthand is real, and my last report understated it.**
  I wrote that the three wrong-file inheritances in the corpus "all surfaced
  loudly as `past end of file`" and that the quiet variant was possible but
  uneliminated. That was true of the three I had found — by looking at failures,
  which is the wrong place to look for a silent one. Audited properly, on the
  owner's instruction: of 259 shorthands that resolve, 73 have another file named
  between the citation they inherited from and the line they sit on, and
  **`repo-23-deployment-reads-as-downloader-only.md:181` is a confirmed quiet
  miss**. It writes `` `:141` `` meaning `docs/02-DEPLOYMENT.md`; the tool
  inherits `docs/adr/004-one-compose-fragment-per-tool.md` from record line 111,
  70 lines and a section boundary away. The ADR has 178 lines, so 141 exists — it
  reports `unanchored`, prints the ADR's line 141 as though it were the cited
  one, and exits 0.

  **The rule is unchanged anyway, and that is a measurement rather than a
  shrug.** Resetting the inherited file at a heading is the obvious guard and I
  measured it: 70 of the 259 resolutions cross a heading, and nearly all are
  right — `repo-6`'s record is about `scripts/test/status.test.ts` throughout, so
  fifty-odd of them inherit correctly across its `##` boundaries. Refusing 70
  mostly-correct resolutions to catch one known-wrong one is the worse trade, and
  it is the same trade the ticket's own Build step 4 refuses in the other
  direction. What does answer it is the display, and the confirmed case shows it
  working: the run prints `:141 in docs/adr/004-… (named at record line 111)`
  against a shorthand on line 181, and 111-against-181 is visible on the line
  without cross-referencing anything. **It is visible, not fatal, and I am saying
  so rather than claiming the hazard is closed.**

  **`.claude/skills/orchestrate-tickets/reference/records.md` was edited on this
  branch** — the carve-out section, which now documents the declaration instead
  of warning in prose. Recorded here because **repo-21 rewrites that same page**
  and is not in this batch, so it will rebase over this; whoever builds it should
  find these edits rather than discover them as a conflict.

- **2026-09-06 — gate round 2: a fix for the port collision, and every corpus
  figure in this Log restated.**

  **The numbers first, because they undercut the reasoning above them.** Every
  corpus measurement in the two entries above was taken over **26 of 107**
  records. The scripts asked git for `docs/work` and `tools/*/docs/work`, and
  `git ls-files 'tools/*/docs/work'` matches **zero** — a git pathspec does not
  glob a path segment that way, and it fails by matching nothing rather than by
  erroring. So the combined pathspec silently returned `docs/work` alone. What
  was restated, and it is the justifications rather than the conclusions:

  | figure                                | as first written | measured over all 107 |
  | ------------------------------------- | ---------------- | --------------------- |
  | records / references                  | 26 / 764         | **107 / 1915**        |
  | records this change newly fails       | 4                | **11**                |
  | shorthands resolving to a file        | 259              | **465**               |
  | of those, inheriting across a heading | 70               | **94**                |
  | prose share of all references         | 1 in 14          | **1 in 19**           |

  **The conclusions survived re-derivation** — 94 cross-heading resolutions to
  buy one known-wrong one is the same bad trade 70 was — and **the shipped corpus
  test was never affected**, because it walks the tree with `readdirSync` and
  always saw all 107. The damage was confined to the numbers this Log offered as
  its evidence, which is the damage worth writing down: a conclusion asserted on
  a sixth of the evidence and _called a measurement_ is not a smaller measurement,
  it is a different kind of claim.

  **What made it invisible, which is the part worth carrying.** The discrepancy
  was printed in my own terminal and I explained it away. Loosening `PROSE` to a
  bare number to prove the corpus test could fail returned `expected 122728 to be
less than 17150` — a **17,150**-reference corpus, against the 764 I was
  quoting two paragraphs later. I read that line as "the loose regex explodes",
  attributing the whole difference to the variable I was manipulating and never
  looking at the constant. `npm run status` had also printed `downloader — 3 open
of 44` and `planner — 1 open of 37` earlier in the same session; 44 + 37 + 26 is
  107, and I had every term on screen. And no `dl-` or `pl-` ticket ever appeared
  in a list captioned "records that newly fail", which is a silence that should
  have been louder than any number. **A denominator that disagrees by 22× is not
  a detail of the effect you are measuring.**

  **The port collision, found by the reviewer and fixed here on the owner's
  instruction.** `dl-38` writes `` `:443` `` and `` `:8443` `` in a paragraph
  about TLS ports; the shorthand rule reads them as line numbers, inherits
  whatever file was named above, and fails. Eleven such in `dl-38`, two more in
  `dl-21`. **This branch introduced that on already-merged, already-gated
  tickets**, and repo-21 proposes wiring this script into CI, at which point
  advisory becomes a red build — which is why it is fixed here rather than filed.

  There is no lexical rule separating a port from a line, so the fix is not a
  regex. It is a principle: **a verdict derived from a guess may not be fatal.** A
  shorthand supplies the number and the _inheritance_ supplies the file, so "line
  443 is past the end of this file" is a claim about the pairing — the guessed
  half — and nothing here can tell a stale citation from something that was never
  one. It reports `unchecked`: counted, printed with the guessed file and the
  record line that named it, fatal to nothing. **Ambiguity deliberately does not
  route through it**, because that is a fact about the _name_, which the record
  wrote out in the qualified citation above; that citation still fails ambiguous
  on its own, so Build step 4 holds and no record loses a real failure. Measured
  over all 107: newly-failing records **11 → 4**, and the four that remain are all
  the orphan-shorthand case the brief requires to stay an error.

  **Considered and declined: a `crossed` state for a shorthand inheriting across
  a heading**, raised by the owner during the gate. It would cost heading
  tracking inside `extractCitations`, a dimension orthogonal to `STATES`, and a
  summary-line format change — and 94 of the 465 resolutions cross a heading with
  nearly all of them correct, so it would annotate ninety-four to flag one. The
  provenance already on each line is the cheaper answer. Declined with the number
  that declined it rather than left unwritten.

  **Two things the reviewer corrected in this file's own claims, both reproduced
  before accepting.** The `summarize` docblock said the suite could no longer be
  run against older source because a missing named export is a link error — **it
  is not, under vitest**: the 58-test suite against `b93e345` gives `3 failed |
55 passed` with no `SyntaxError`, because vite degrades an absent export to
  `undefined`. Two of those three fail behaviourally and only the direct-call unit
  test degrades to `TypeError`, so **repo-18's red-run property is largely
  preserved rather than given up** — a better outcome than either of us first
  stated, and predicted by repo-18's own docblock, which I was editing without
  reading back. And the count of new exports is **four** (`EXIT`,
  `applyDeclarations`, `extractDeclarations`, `recordDrift`), not five; I had
  counted from memory instead of from the file, which is the same error as the
  pathspec one wearing different clothes.
