---
id: repo-14
tool: repo
title: citations.mjs documents a --section flag it does not implement, and accepts it silently
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-14 — `--section` is documented, accepted, and does nothing

**Packages:** `scripts` (`citations.mjs`, `test/citations.test.ts`).

## Why

`scripts/citations.mjs` advertises a `--section` flag in its usage line:

```
 *   node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>]
```

That is `scripts/citations.mjs:25`, and it is the **only** occurrence of the string `section`
anywhere in the file — `grep -c section scripts/citations.mjs` returns `1`.
There is no implementation, and `main()` does not validate its arguments, so the
flag is accepted and ignored.

**The failure mode is worse than "documented but absent".** An unknown flag that
errored would cost someone five seconds. This one is _accepted_, so a reader
scoping a check to one section of a long record — a gate record with four `##`
sections and fifty citations — believes they filtered it and did not. They get a
whole-file pass wearing the label of a filtered one, and every number they then
quote is about the wrong denominator. That is a wrong answer delivered
confidently, which is the shape this script exists to prevent in _records_.

It has already misled someone: pl-37's builder read a whole-file pass as a
filtered one.

## Reproduction

Measured in this worktree against `docs/work/repo-12-board-shows-merged-work.md`,
capturing stdout+stderr to files and comparing with `cmp`:

| Invocation                                                         | Result                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `node scripts/citations.mjs <ticket>`                              | `8/8 resolve`                                                                          |
| `node scripts/citations.mjs <ticket> --section Log`                | `8/8 resolve` — **byte-identical** to the above                                        |
| `node scripts/citations.mjs <ticket> --section NoSuchSectionAtAll` | `8/8 resolve` — **also byte-identical**; a section that does not exist is accepted too |

The third row is the one that closes the question: if the flag were implemented
and merely buggy, a nonsense section name would plausibly yield `0/0`. Identical
bytes for a real section, a fake section, and no flag at all means the argument
is never read.

### A second defect, found while reproducing the first

`main()` picks the ticket file at `scripts/citations.mjs:226` with:

```js
const file = argv.find((a) => !a.startsWith("--"));
```

A flag's **value** does not start with `--`, so it is indistinguishable from the
positional argument. Put any flag first and its value is taken as the file:

```
$ node scripts/citations.mjs --section Log docs/work/repo-12-board-shows-merged-work.md
ENOENT: no such file or directory, open 'Log'      # exit 1

$ node scripts/citations.mjs --rev HEAD docs/work/repo-12-board-shows-merged-work.md
ENOENT: no such file or directory, open 'HEAD'
```

**This is not confined to the unimplemented flag.** `--rev` is documented _and_
implemented, and it breaks the same way in the same ordering — so the repo has a
working feature that fails on an argument order every CLI convention permits.
Whichever way the open question below is settled, this line needs fixing, and it
is the more valuable half of the ticket.

Two smaller things worth knowing, both true today:

- The usage string thrown at `scripts/citations.mjs:229` on a missing file argument reads
  `usage: node scripts/citations.mjs <ticket-file> [--rev <sha>]` — it does
  **not** mention `--section`. The docblock and the error message already
  disagree with each other, which is a hint about which of them was intended.
- `main()` is not exported, so an argv test drives the CLI rather than calling
  it. `scripts/test/citations.test.ts:89` already does exactly that with
  `spawnSync`, so the
  pattern to copy is in the file.

## Build

1. **Fix the positional-argument parse** regardless of what is decided below.
   Consume each flag's value when the flag is recognised, rather than filtering
   on `--`.
2. **Reject an unknown flag** with the usage string and a non-zero exit. This is
   the part that turns every future version of this bug from silent into loud,
   and it is worth more than either resolution of the open question.
3. **Settle the open question below**, and make the usage line and the `main()`
   usage string agree with each other and with the code.

## Done when

1. `node scripts/citations.mjs <ticket> --nonsense` exits non-zero with the usage
   string, proven by a CLI test alongside the existing `spawnSync` one.
2. `node scripts/citations.mjs --rev <sha> <ticket>` resolves the ticket, not a
   file named after the sha — proven by a test, since this is a live defect in a
   shipped flag.
3. The usage line in the docblock, the usage string in `main()`, and the flags
   actually parsed all name the same set. If `--section` survives, a filtered run
   reports a strictly smaller citation count than an unfiltered one on the same
   record — asserted against a fixture with citations in two sections, so the
   test can fail.
4. `npm run check` and `npx vitest run scripts` pass.

## Open question — answered 2026-09-03: implement

**Implement `--section`, or delete it from the usage line?**

**Answered by the user: implement.** The reason is the lean recorded below — a
record's `## Review` section is precisely the thing one would want to scope a
check to. It landed on the same branch as steps 1 and 2, once the answer arrived
mid-build. The two options are kept exactly as filed, because the costs they
price are what the answer was weighed against; the three sub-questions the
"implement" option leaves open were settled by the builder and are argued in the
Log.

- **Implement.** Cost: section-splitting on `##`/`###` headings, a name-matching
  rule (exact? prefix? case-insensitive?), and a decision about what a section
  that matches nothing should do — `0/0 resolve` and exit 0 is defensible and is
  also exactly the silent-wrong-answer shape this ticket is about, so it probably
  wants to be an error. Buys real scoping on long records.
- **Delete.** Cost: one line. Buys honesty immediately and gives up a capability
  nobody has been able to use yet, since it has never worked.

**A lean, not a decision, from the coordinator who filed this:** a record's
`## Review` section is precisely the thing one would want to scope a check to,
which argues for implementing rather than deleting. Recorded as a lean because
whoever picks this up will have the section-splitting code in front of them and
is better placed to price it.

Note that step 2 (reject unknown flags) makes **deleting** the strictly safer of
the two in the short term: with validation in place, a removed `--section`
becomes a loud error rather than the silent no-op it is now.

## Log

- **2026-09-01** — Filed from dl-29's branch at the user's request, rather than as
  its own PR. Found by pl-37's builder, confirmed by the coordinator, and
  **reproduced independently here before being written up** — the three-way
  byte-comparison in the table above, including the nonexistent-section row, is
  this session's and is what rules out "implemented but buggy".

  The relayed report was that `--section` is a silent no-op. That reproduces. The
  argument-ordering defect in the section above was **not** in the report and was
  found while reading `main()` to confirm the first one; it is more serious,
  because it breaks `--rev`, which actually works. Filed as one ticket because
  both live on the same two lines of argument parsing and fixing either alone
  would leave the other.

  Not measured: no attempt was made to price the section-splitting work, which is
  why the open question carries costs in prose rather than a number.

- **2026-09-03** — **Steps 1 and 2 only; step 3 and the open question below are
  untouched, so this ticket stays `ready`.** Branched from `origin/main` at
  `91c117b`.

  **Landed.** `parseArgs` replaces `argv.find((a) => !a.startsWith("--"))`: it
  walks argv, consumes each recognised flag's value, and refuses an unrecognised
  flag, a flag with no value, and a second positional — each with one shared
  `USAGE` string and a non-zero exit. Five new tests: three driving the CLI
  through `spawnSync`, two on the now-exported `parseArgs`.

  **Run red first, against the unfixed source.** The three CLI tests were written
  and run with `scripts/citations.mjs` restored to `HEAD`; the unit tests were
  added only afterwards, deliberately, so that the red could not be a missing
  export standing in for a missing behaviour. 3 failed, 10 passed:

  ```
  × the CLI rejects an unknown flag with the usage string and a non-zero exit
      AssertionError: expected +0 not to be +0        # --nonsense accepted, exit 0
  × the CLI resolves the ticket rather than a file named after the sha, in either order
      + ENOENT: no such file or directory, open 'HEAD'
  × the CLI says --section did nothing rather than filtering silently
      AssertionError: expected 1 to be +0             # --section Log <ticket> exited 1
  ```

  **The brief was accurate — every checkable claim in it was re-checked and every
  one holds**, including `grep -c section` still being 1 at `origin/main` and the
  byte-identical three-way reproduction. Its own four citations resolve 4/4 at
  `origin/main`, checked by running this script against this ticket with the flag
  _first_ — an invocation the old code could not perform at all.

  **What it under-specified, which is the reason this was dispatched as a slice.**
  Step 2 says reject an unknown flag. Read literally, `--section` is unknown, so
  step 2 alone would make `--section Log` exit non-zero — which is precisely the
  observable behaviour the **delete** resolution would ship, reached without
  anyone deciding. The ticket half-sees this ("makes deleting the strictly safer
  of the two") and does not draw the conclusion. Resolved here by keeping
  `--section` a _known_ flag: its value is consumed, a warning on stderr says
  nothing was filtered, and the exit stays 0. That is neither endpoint —
  implement would filter, delete would refuse, this announces — so it fixes the
  reported harm (a reader can no longer believe they filtered) without spending
  the decision. **Carried to the orchestrator as an open decision**, because
  "warn now" versus "refuse now" is itself a call with two defensible answers.

  **Folded in**, all falling out of the rewritten loop rather than sought:
  a single-dash token is rejected instead of being taken as the ticket file
  (`-r HEAD <ticket>` used to say `ENOENT: -r` — this bug one dash over); a
  second positional is rejected instead of silently ignored; and the docblock
  usage line and the `main()` error string, which disagreed about `--section`,
  became one `USAGE` constant. That last one is load-bearing for step 2, not
  tidying: a refusal printing a usage line that omits an accepted flag tells the
  reader that flag is invalid too, which is the open question answered by an
  error message.

  **Read this ticket's Reproduction section with `--rev 91c117b`.** Two of its
  four citations drifted on this branch and now point at unrelated code while
  still resolving, which is the exact failure this script exists to catch and
  cannot catch: `citations.mjs:226` was `const file = argv.find(…)` and is now a
  `return` inside `checkCitations`; `:229` was the usage `throw` and is now
  blank. They are the finding's own evidence, so they stay as written.

  **Not done, deliberately:** step 3, and with it Done-when 3. The docblock, the
  usage string and the parsed set now name the same flags but not the same
  _status_ — `--section` appears in the one-line usage without its "not
  implemented" caveat, which lives in the docblock prose and the stderr warning
  instead. Folding the caveat into the usage line belongs with the resolution.
  Still not measured: the cost of section-splitting, so the open question below
  continues to carry prose rather than a number.

- **2026-09-03** — **Supersedes the entry above, which was written while the
  question was still open.** The user answered it mid-build — **implement
  `--section`** — so step 3 landed on the same branch and this ticket closes.

  **The three sub-questions the ticket left to whoever had the code in front of
  them.** Each decided, each tested:

  1. **Splitting.** A heading owns every line down to the next heading of the
     same level or higher, so `## Review` carries its `###` subsections. The
     alternative stops at the first subheading and drops the citations beneath
     it — this script's own failure mode, delivered by its own new flag. The case
     is not hypothetical: on `repo-12`, all 8 citations live inside
     `### Gate 1 — 2026-08-30`, so `--section Review` reports 8 under the nesting
     rule and would have reported 0 without it.

  2. **Fenced code is not searched for headings.** Measured before choosing, not
     assumed: 40 heading-looking lines sit inside fenced blocks across the work
     records, because records quote changelog fragments and those contain
     `### Fixes`. Reading one as a heading would end the enclosing section early
     and print the smaller count as the answer. Only heading _detection_ skips
     fences — `extractCitations` still reads every line exactly as before, so
     `--section` cannot change which citations a record has, only which of them
     are reported.

  3. **Name matching: case-insensitive, exact before prefix.** Headings here read
     `## Open question — do not settle it here` and `### Gate 1 — 2026-08-30`;
     requiring the em dash on a command line would make the flag unusable, and
     `--section Gate` now works. Exact winning outright is what keeps `Log`
     meaning `## Log` in a record that also has `## Logging notes`. **More than
     one match is an error naming the candidates**, never the first match — the
     rule `makeResolver` already applies to an ambiguous bare filename, for the
     reason it already states there.

  **A section matching nothing is an error. The ticket argued this and was right,
  but understated it.** Checked against the code rather than transcribed: a record
  with no citations already prints `0/0 resolve` and exits 0, legitimately. So a
  silent miss would not merely be quiet, it would be **indistinguishable from a
  correct result** — a typo'd section name reporting success having checked
  nothing at all. That is strictly worse than the defect filed here, which at
  least checked the whole file. The error lists the record's headings, so a typo
  costs one read rather than two. A section that exists and holds no citations
  still prints `0/0` and exits 0, and the two are asserted in one test, because
  being able to tell them apart is the point.

  **One output line changed** beyond the flag: the header names the scope, as in
  `8 citations in <record> under "Gate 1 — 2026-08-30" (record lines 78-122)`. A
  filtered count with no denominator on screen is the wrong-denominator failure
  over again. The `N/M resolve` summary and the per-citation lines were left
  alone; repo-18 owns those.

  **For whoever changes this next:** the filter selects by line span _after_
  `extractCitations` has run, rather than re-extracting from a slice of the
  markdown. `extractCitations` carries state across lines — a table's header row
  sets the column map for the rows beneath it — so extracting from a slice that
  started below a header would under-report that table in silence.

  **Run red first, again.** The three new CLI tests were run against the previous
  commit's accept-and-warn behaviour, before the splitter existed:

  ```
  × --section narrows the check to one heading's span, subsections included
      expected '4 citations in …' to match /3\/3 resolve/
  × a section that matches nothing is an error, while an empty one that exists is not
      AssertionError: expected +0 not to be +0     # exit 0 on a bogus section name
  × a --section name matching two sections fails and names them both
      AssertionError: expected +0 not to be +0
  ```

  **Known limitation, not measured away:** a record with two verbatim-identical
  headings — two `## Log` — makes that name ambiguous and the flag unusable for
  it. No record in the repo has one. Inventing a disambiguator (an index? the
  first?) for a case with no instance looked worse than the loud failure, and
  "the first" is the rubber-stamp shape this ticket is about.

- **2026-09-03 (gate fold-ins)** — Two low findings from the gate; one folded
  in, one declined with reasoning for whoever inherits it.

  **Folded in: `FLAGS`, `USAGE` and the docblock usage line are now tied
  together by a test**, not just by hand-checking. This is not general
  tidying — it is this ticket's own defect class. Repo-14 exists because a
  usage line advertised a flag the code did not implement; shipping the fix
  for that while leaving the same three-way agreement unenforced re-arms the
  same gun for the next flag someone adds. `FLAGS` is now exported alongside
  `USAGE`, and `scripts/test/citations.test.ts` extracts the `--flag` tokens
  from the docblock's `Usage:` line, from `USAGE`, and from `[...FLAGS.keys()]`
  and asserts they match. Checked that it actually catches drift, not just that
  it passes: dropped `[--section <name>]` from `USAGE` alone and reran the
  single test — it failed, restored, green again.

  **Declined: the output header still has no unfiltered-total denominator next
  to a filtered count.** `citations.mjs`'s header line
  (`N citations in <record>[ under "X" (record lines A-B)], resolved against …`)
  already prints the scope inline on _every_ invocation, filtered or not — a
  reader cannot get a number back without also seeing the word `under` and a
  heading name on the same line if one was given. Adding the unfiltered total
  next to it would answer a question nobody asked with this flag: unlike the
  filed defect, where the same output was produced with and without `--section`
  and the reader had no way to tell, a filtered run today looks visibly
  different from an unfiltered one. Left as-is; repo-18 inherits this reasoning,
  not an open question, if it wants a different header for its own reasons.

  **Why the ticket's own framing hid the third path.** "Implement or delete" are
  the two states of the _feature_; they are not the two states of the _code_,
  and the code had a third: a flag can be a member of the parser's known set
  without being wired to any effect. Step 2 (reject unknown flags) collapses
  onto the feature framing only if "known to the parser" and "does something"
  are the same axis — they are not, and treating them as one axis is what made
  rejecting `--section` read as an implicit "delete" instead of a third, orthogonal
  state that answers neither.
