---
id: repo-26
tool: repo
title: No test runs a script as a process, so a dead entry point is invisible
kind: chore
status: done
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

## Decision — answered 2026-09-07, not open

**The question was:** which entry points need a process-level test — only the
scripts a hook or commit hook shells out to (a), every `scripts/*.mjs` with an
entry-point guard (b), or a self-maintaining scan over the tree (c)?

**The answer, from the owner, relayed through the orchestrator: option (a).** It
was this ticket's own recommendation, so it overrode nobody. Recorded
2026-09-07; **nothing below has been built.**

**The scope that answer fixes:** `scripts/commit-message.mjs`, and nothing else.
`.githooks/commit-msg` and `.claude/hooks/check-pr-title.sh` are the two callers
that shell out to it, and no other script in `scripts/` is shelled out to by a
hook today.

**Carry the objection with the answer**, or the next builder rediscovers it from
scratch — it is stated in this ticket's own text and it is the standing cost of
(a), not a reason to revisit it:

- **The set in (a) is invisible and unenforced.** It is a judgement made at the
  call site and written down nowhere a machine reads, so **a future hook that
  shells out to a new script inherits the gap with nothing noticing** — the same
  silence this ticket exists to describe, one level up. That is the price of the
  cheap option and it is accepted, not answered.
- **(b) was not rejected as wrong**; it is the option that closes exactly that
  hole, and it stays the right answer if the hook set ever grows past one
  script. It was declined on cost — a process spawn per script, for scripts
  whose guards do not fail silently.
- **(c) stays recorded as a shape, not as a plan.** It is self-maintaining, and
  it needs a per-script notion of "input it must reject" that not every script
  has. Kept so it is not re-proposed as new.

The reasoning that produced the question stands, and is kept because it is what
makes the answer legible:

**Which entry points need a process-level test?**

- **(a) Only the scripts a hook or githook shells out to — chosen.** Today that is
  `scripts/commit-message.mjs` and nothing else: `.githooks/commit-msg` and
  `.claude/hooks/check-pr-title.sh` both invoke it. Cheapest, and it covers
  every case where a dead entry point silently disables a guard — which is the
  actual harm. Risk: the set is not enforced anywhere, so a future hook that
  shells out to a new script inherits the gap without anyone noticing.
- **(b) Every `scripts/*.mjs` with an entry-point guard — not chosen, and not wrong.** Uniform, needs no
  judgement at the call site, and cannot go stale as hooks are added. Costs a
  process spawn per script in the suite, and most of those scripts have no guard
  whose death would be silent — `status.mjs` and `citations.mjs` are run by
  humans and agents who would notice an empty answer immediately.
- **(c) A scan rather than per-script tests — not chosen.** One test that finds every
  `scripts/*.mjs` containing an entry-point guard and asserts each exits
  non-zero on input it must reject. Self-maintaining, but it needs a
  per-script notion of "input it must reject", which not every script has.

**Recommendation was: (a), with the reasoning recorded**, because the harm is
specifically "a guard that silently stops guarding" and that set is exactly the
scripts a hook depends on. But (b) is defensible on the grounds that the set in
(a) is invisible and unenforced, and this was a real choice rather than a
formality — which is why this ticket was `needs-decision`. **The answer went to
(a), and the objection stands as recorded above.**

**Do not answer it by sweeping the tree first.** The count of affected scripts is
not known and is deliberately not measured here; measuring it is the first step
of the work, not of the filing.

## Build

The decision is answered, so this is startable. **The steps below are marked in
place rather than rewritten** — the answer narrows them, it does not replace
them.

1. Add a process-level test for each entry point the answer covers — **settled
   by the decision above: `scripts/commit-message.mjs` alone** — asserting
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
4. ~~If the answer is (c), the scan belongs beside the existing repo-wide scans
   in `packages/core/test/`, which is where `spawn-safety` and `image-closure`
   already live.~~ **`n/a` — the answer is (a), not (c).** Left in place rather
   than deleted, so a later reader meeting the scan idea in the Decision section
   can see where it would have gone and that it was not overlooked.

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

## The gate on this filing

**Gate: PASS** — 2026-09-06 · reviewed at `0803da9` · a filing only, no work performed on `repo-26` itself — per `docs/01-TICKETS.md`'s review gate and the `dl-29` precedent, recorded under this heading rather than `## Review` since `status: needs-decision` plus a `## Review` heading would read as work that merged without status reflecting it

- **Carries both a reproduction and a decision, as required.** The reproduction is the CI elimination table (which `check-pr-title` cases reach `commit-message.mjs`, sorted by required outcome) plus the direct string measurement (`file://D:\a\...` vs `file:///D:/a/...`, unequal). The decision is three honestly-costed options for which entry points need a process-level test, with an explicit counter-argument recorded against the recommended one ("(a)... Risk: the set is not enforced anywhere... (b) is defensible on the grounds that the set in (a) is invisible and unenforced").
- **`needs-decision` is the right status, and it is correctly withheld.** `node scripts/status.mjs -- --ready` does not list it; `node scripts/status.mjs --json` exits `0`; `--show repo-26` reports "waiting on a decision — not startable until someone answers it."
- **The ticket explicitly declines to prejudge its own decision** by not sweeping `scripts/*.mjs` for other instances of the same guard shape first, and says so — the right restraint for a ticket whose Build step 3 already measures "exactly one occurrence existed repo-wide" as a side effect of fixing this one.
- **Not settled here.** The three options and the recommendation are the owner's to weigh; I have not picked one.
- **findings** · 0 returned, 0 carried, 0 dropped.
- NFR: not applicable — no code in this filing.

## Review

### Gate: PASS — 2026-09-07 · reviewed at `f343bc2` · base `origin/main@e9054c5`

Built by **Opus**, gated by **Sonnet**. Separate from `## The gate on this
filing` above, which gated the 2026-09-06 filing and is left as it stands; this
one gates the close-out. Long form is on the pull request thread.

**Zero findings against this ticket.** The three findings that gate returned are
all against repo-15 and are recorded there.

**Acceptance-to-test traceability.** All four `Done when` lines proven or
verified, each re-run by the gate:

| `Done when`                                                                 | Verdict                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — a process-level test asserting a non-zero exit on input it must reject  | proven                      | `scripts/test/commit-message.test.ts:304`, `run as a process, a bad message is rejected`                                                                                                                                                                                                                                                                                                       |
| 2 — replacing the guard with `if (false)` fails at least one test           | **verified, independently** | The gate mutated `scripts/commit-message.mjs:317` itself and got `1 failed \| 26 passed (27)`, failing exactly that test with `expected '' to contain 'not a conventional commit'` — an exact match to the builder's claim, assertion text included. Restored, `git status --porcelain` empty, back to `27 passed`. This is the line that had never been measured outside repo-22's own branch |
| 3 — no test asserts only the accepting direction for a silent-failure guard | proven                      | `scripts/test/commit-message.test.ts:312` is the accepting half, labelled weak in a comment in the file, and paired with `:304`                                                                                                                                                                                                                                                                |
| 4 — `npm run check` and `status --json` exit 0                              | verified                    | both run by the gate                                                                                                                                                                                                                                                                                                                                                                           |

It also checked the close-out's honesty rather than only its claims: that the
work is attributed to **repo-22 / PR #161** and not to this branch, and that the
Log's reading of its own standing objection holds — repo-15's new hook names
`scripts/commit-message.mjs` only inside printed advice text and never invokes
it, so the set in option (a) is genuinely unchanged.

**What this gate did not do.** It did not re-run the Windows reproduction, which
cannot run on this platform and which this ticket's own Log already forbids
citing as a red-green. It performed no work on repo-26 — the ticket closes as
already built.

**Findings** · 0 returned, 0 carried, 0 dropped. **NFR** · not applicable; no
code changed on this ticket.

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

- **2026-09-07 — the decision was answered by the owner: option (a).** Only the
  scripts a hook or commit hook shells out to, which today is
  `scripts/commit-message.mjs` and nothing else. It was this ticket's own
  recommendation, so it overrode nobody; (b) was declined on cost rather than on
  the idea, and (c) is kept so it is not re-proposed. `status: needs-decision` →
  `ready`. The Decision section is now `## Decision — answered 2026-09-07, not
open`, and Build step 4 is marked `n/a` because it was conditional on (c).

  **The objection carried with the answer**, in this ticket's own words: the set
  in (a) is invisible and unenforced, so a future hook that shells out to a new
  script inherits the gap with nothing noticing. That is accepted as a standing
  cost, not resolved. Whoever builds this should not treat it as an oversight to
  fix in passing — widening to (b) is a different answer, not a better build of
  this one.

  **Build step 3 still expects to find nothing**, and is deliberately left as
  written. The measurement it rests on was not re-run here; nothing on this
  branch touched `scripts/`.

  **Recorded, not built.** This entry is bookkeeping from a branch that answers
  four tickets' decisions in one sitting and implements none of them. The next
  reader should treat this as a brief whose open question is closed, not as work
  in progress.

- **2026-09-07 — closed as already built. `status: ready` → `done`.** Every step
  of this Build landed on `main` with **repo-22 / PR #161**, before the decision
  above was even recorded; this ticket then sat `ready` describing work that was
  already merged. Nothing was implemented here and **the Build steps above are
  left exactly as written** — they are the brief repo-22 satisfied, not a
  to-do list. Closed from the repo-15 branch because that was the session
  already holding `docs/work/`.

  **Verified against this branch's tip, off `origin/main@e9054c5`, not
  relayed.** Every coordinate below was re-resolved by `grep` after the branch
  was cut, because line numbers move:

  - The rejecting process-level test is `scripts/test/commit-message.test.ts:304`,
    `run as a process, a bad message is rejected` — it spawns the script with
    `shell: false` and asserts `status` 1 and `not a conventional commit` on
    stderr. That is `Done when` line 1 for the one entry point option (a)
    covers.
  - Its accepting half is at `scripts/test/commit-message.test.ts:312`, and is
    **labelled weak in a comment in the file**: "a dead entry point also exits
    0, so this pairs with the test above rather than standing in for it". That
    is Build step 2 and `Done when` line 3.
  - The guard itself is `scripts/commit-message.mjs:317`, spelled
    `pathToFileURL(process.argv[1]).href` — the correct comparison, not the
    broken concatenation.
  - Build step 3's sweep returns nothing:
    `command grep -n 'file://\${' scripts/*.mjs` exits 1 with no output across
    all four scripts (`citations.mjs`, `commit-message.mjs`, `next-id.mjs`,
    `status.mjs`). Run with `command grep` rather than the devcontainer's
    ignore-file-honouring wrapper, so "no matches" is a fact about the tree.
    The step expected an empty result and got one.

  **`Done when` line 2 was the one line never measured outside repo-22's own
  branch, and it was re-measured here.** The claim is that replacing the
  entry-point condition with `if (false)` fails at least one test.

  - **Positive control first**, because a red is not evidence until the harness
    is shown able to be green: unmutated,
    `npx vitest run scripts/test/commit-message.test.ts` → `Tests 27 passed
(27)`, exit 0.
  - Mutated `scripts/commit-message.mjs:317` to `if (false) {`, same command →
    `Tests 1 failed | 26 passed (27)`, failing exactly
    **`run as a process, a bad message is rejected`** with
    `AssertionError: expected '' to contain 'not a conventional commit'`. That
    is precisely what this line predicted from repo-22's branch — one named
    failure, the other 26 green.
  - Restored with `git checkout -- scripts/commit-message.mjs`; line 317 reads
    the `pathToFileURL` form again, `git status --porcelain -- scripts/commit-message.mjs`
    is empty, and the spec is back to `27 passed`.

  Only that one spec file was run, deliberately: it is the narrowest thing that
  can fail, and the whole `scripts/test/` directory costs roughly twenty times
  as much for identical evidence.

  **The objection recorded with the decision is not retired by closing this.**
  The set in (a) is still invisible and unenforced — it is a judgement made at
  the call site, written down nowhere a machine reads — so a future hook that
  shells out to a new script still inherits the gap with nothing noticing.
  **This branch is itself the first test of that**, and it passes for a reason
  worth writing down rather than by luck: repo-15 adds
  `.claude/hooks/check-main-writes.sh`, a third hook under the `PreToolUse`
  `Bash` matcher — but it invokes only `jq`, `sed`, `grep` and
  `git symbolic-ref`. It names `scripts/commit-message.mjs` exactly once, inside
  the advice text it prints on a refusal, and never runs it. So the set in (a)
  is unchanged and is still exactly `scripts/commit-message.mjs`. **Had the new
  hook called a script, nothing here would have said so** — which is the
  objection, demonstrated rather than restated. (b) remains the option that
  closes that hole, declined on cost.
