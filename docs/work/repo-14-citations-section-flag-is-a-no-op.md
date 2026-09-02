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
