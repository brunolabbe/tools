---
id: repo-26
tool: repo
title: No test runs a script as a process, so a dead entry point is invisible
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-26 — no test runs a script as a process, so a dead entry point is invisible

**Files:** `scripts/test/*.test.ts` (the shape), `scripts/*.mjs` (the surface).

**Filed out of repo-22**, which hit this the expensive way. This ticket is about
the **test shape**, not about the Windows bug — that one is already fixed on
repo-22's branch. What is unfixed is the reason it survived, and the same shape
plausibly hides the same class in the other scripts.

## Why

Every test in `scripts/test/` exercises a script by **importing** it:

```ts
import { releasingTypes, TYPES, validate } from "../commit-message.mjs";
```

Nothing ran a script **as a process** until repo-22 added two such tests. And a
script's entry-point guard —

```js
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

— is **the one line an import can never reach**. Importing the module is
precisely the case the guard exists to suppress, so a test suite built entirely
out of imports cannot tell a working guard from one that never fires.

### The reproduction, which is a real failure and not a hypothetical

`scripts/commit-message.mjs` shipped with that line written as
`` import.meta.url === `file://${process.argv[1]}` ``. Concatenating a path into
a URL is correct only when the path starts with `/`. On Windows `argv[1]` is
`D:\a\...`, giving `file://D:\a\...` against an `import.meta.url` of
`file:///D:/a/...`. They never matched, `main()` never ran, and **the script
exited 0 for every message.**

Two guards were dead on Windows for as long as that line existed:

- `.githooks/commit-msg`, which execs the script to reject a bad commit message.
- `.claude/hooks/check-pr-title.sh`, which runs it with `--text` to reject a bad
  pull request title.

Both accepted anything there. **Every test passed the whole time**, on every
platform, because every test imported `validate` directly and `validate` was
never broken.

It surfaced on repo-22's branch in CI run `34004675405`, `test (windows-latest)`,
as two failures in `scripts/test/hooks.test.ts` — and the diagnosis came from
sorting the four `check-pr-title` cases by whether they reach the script:

| case                       | reaches the script?  | expected | Windows          |
| -------------------------- | -------------------- | -------- | ---------------- |
| `--fill`                   | no, exits before it  | 2        | pass             |
| `--title "feat(repo): x"`  | yes, must **accept** | 0        | pass             |
| `--title 'nope'`           | yes, must **reject** | 2        | **fail, exit 0** |
| `--title 'nope'<sentinel>` | yes, must **reject** | 2        | **fail, exit 0** |

Every case that must _reject_ failed; the one that must _accept_ passed. That
asymmetry is the whole finding.

### The transferable lesson, which is why this is worth a ticket

**A test that asserts only the accepting direction cannot detect a dead guard,
because a dead guard also accepts.** Exit 0 is both "valid input" and "nothing
ran". Only an assertion that bad input is **rejected** distinguishes them.

That generalises past entry points and past this repo: any check whose failure
mode is _silence_ needs at least one test asserting the negative direction, and
a suite of happy-path assertions will report a disabled check as healthy for as
long as it stays disabled. repo-22 was the first thing here to assert the
unfashionable direction, which is the only reason this was ever seen.

## Decision — open, and the reason this ticket is `needs-decision`

**Which entry points need a process-level test?**

- **(a) Only the scripts a hook or githook shells out to.** Today that is
  `scripts/commit-message.mjs` and nothing else: `.githooks/commit-msg` and
  `.claude/hooks/check-pr-title.sh` both invoke it. Cheapest, and it covers
  every case where a dead entry point silently disables a guard — which is the
  actual harm. Risk: the set is not enforced anywhere, so a future hook that
  shells out to a new script inherits the gap without anyone noticing.
- **(b) Every `scripts/*.mjs` with an entry-point guard.** Uniform, needs no
  judgement at the call site, and cannot go stale as hooks are added. Costs a
  process spawn per script in the suite, and most of those scripts have no guard
  whose death would be silent — `status.mjs` and `citations.mjs` are run by
  humans and agents who would notice an empty answer immediately.
- **(c) A scan rather than per-script tests** — one test that finds every
  `scripts/*.mjs` containing an entry-point guard and asserts each exits
  non-zero on input it must reject. Self-maintaining, but it needs a
  per-script notion of "input it must reject", which not every script has.

**Recommendation: (a), with the reasoning recorded**, because the harm is
specifically "a guard that silently stops guarding" and that set is exactly the
scripts a hook depends on. But (b) is defensible on the grounds that the set in
(a) is invisible and unenforced, and this is a real choice rather than a
formality — hence `needs-decision` rather than `ready`.

**Do not answer it by sweeping the tree first.** The count of affected scripts is
not known and is deliberately not measured here; measuring it is the first step
of the work, not of the filing.

## Build

Once the decision is answered:

1. Add a process-level test for each entry point the answer covers, asserting
   **the rejecting direction**. Pair it with an accepting assertion only if the
   pair is labelled — see step 2.
2. **Mark the accepting half weak wherever it appears.** A dead entry point exits
   0, so an accepting assertion passes against it and proves nothing about this
   class. `scripts/test/commit-message.test.ts` already carries that label and
   is the pattern to copy.
3. Check the remaining `scripts/*.mjs` for the same `` `file://${...}` ``
   spelling. `pathToFileURL(process.argv[1]).href` is the correct comparison.
   **Measured 2026-09-06: exactly one occurrence existed repo-wide** and it is
   fixed on repo-22's branch — so this step is expected to find nothing, and is
   here so that a later reader does not assume it was skipped.
4. If the answer is (c), the scan belongs beside the existing repo-wide scans in
   `packages/core/test/`, which is where `spawn-safety` and `image-closure`
   already live.

## Done when

- Every entry point the decision covers has a test that runs the script **as a
  process** and asserts a non-zero exit on input it must reject.
- Deleting the entry-point guard from `scripts/commit-message.mjs` (replacing the
  condition with `if (false)`) fails at least one test. **Measured on repo-22's
  branch: it fails exactly `run as a process, a bad message is rejected`, with
  the other 26 in that file green** — so this line is known to be able to fail.
- No test in `scripts/test/` asserts only that valid input is accepted for a
  guard whose failure mode is silence, without an accompanying rejecting
  assertion.
- `npm run check` passes and `node scripts/status.mjs --json` exits `0`.

## Log

**2026-09-06 — filed out of repo-22, from a failure it hit rather than a review
of the tree.** The Windows defect itself is fixed on
`repo-grep-wrapper-hook`; this ticket is only the test-shape gap that let it
live, and it deliberately fixes nothing.

- **The limit on the evidence, stated so nobody reads more into it.** The broken
  form **cannot be run red on Linux**, because on Linux the path starts with `/`
  and the concatenation is correct. The Windows half rests on a direct string
  measurement (`file://D:\a\…` against `file:///D:/a/…`, unequal) and on the CI
  elimination table above. It is not a red-green reproduction on this platform
  and must not be cited as one. CI run `34004675405` is red at `eb345b8` and the
  fix is green at `af657c7`.
- **A near-miss worth carrying, because it is the trap this class sets.** A
  symlink reproduces the _symptom_ — exit 0, silent, on a message that must be
  rejected — and was briefly taken for a local reproduction of the cause. It is
  not. A symlink breaks the comparison through **realpath resolution**, not
  through path-to-URL formatting, and `pathToFileURL` does not fix it. Two
  mechanisms, one symptom. Anyone tempted to use the symlink as this ticket's
  reproduction should not: it will go green for the wrong reason.
- **Not measured, on purpose:** how many other `scripts/*.mjs` have an
  entry-point guard, and how many of those are shelled out to by anything. That
  count is the first step of the work and would prejudge the Decision if taken
  now.
