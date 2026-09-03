---
id: repo-14
tool: repo
title: citations.mjs documents a --section flag it does not implement, and accepts it silently
kind: fix
status: ready
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

## Open question — do not settle it here

**Implement `--section`, or delete it from the usage line?**

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
