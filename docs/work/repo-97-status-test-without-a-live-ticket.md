---
id: repo-97
tool: repo
title: A status test asked the live board for a ticket whose awaiting line was meant to be deleted
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-97 — A status test asked the live board for a ticket whose awaiting line was meant to be deleted

## Why

On `origin/main` at `1a044437`, `scripts/test/status.test.ts` fails:

```
$ npx vitest run scripts/test/status.test.ts -t "real outstanding obligation"
 FAIL  |repo| scripts/test/status.test.ts > the repo's own board surfaces at least one real outstanding obligation
AssertionError: expected [ 'dl-73' ] to include 'repo-16'
 ❯ scripts/test/status.test.ts:1642:33
 Tests  1 failed | 133 skipped (134)
```

The test did `expect(owed.map((t) => t.id)).toContain("repo-16")` over
`readTickets(REPO)`. #418 ("close repo-46's and repo-16's awaiting lines from
their readings") removed repo-16's `awaiting:` line, which is the field's whole
lifecycle: a line is written when a ticket owes something and **deleted** when
the reading arrives (`docs/01-TICKETS.md`). So the test was written to fail
the first time anyone used the field as designed.

`main` did not go red where anyone looked: #418 changed only `.md` files, and
`ci.yml`'s `changes` job skips the unit matrix for an all-markdown change
(`gh run view 38089787446 --json jobs` shows `test (…)` skipped at
`1a044437`). Every branch that then merges `main` fails `test (ubuntu-latest)`
and `test (windows-latest, informational)`. Found by a gate on dl-103.

Two defects, one fix and one decision:

1. **The test depends on a ticket's lifecycle state.** Fixed here.
2. **A markdown-only change can break a unit test while CI skips the unit
   tests.** Not fixed here, by the owner's instruction (`ci.yml` and the
   `changes` filter are out of scope). The Log lists every other test that
   reads live ticket state, and puts the question to the owner as options.

## Build

1. Replace the test with two that never name a live ticket:
   - a synthetic tree (`repoWith`) holding a ticket with an `awaiting` line and
     one without, asserting the first parses to its text and the second to
     `null`. It cannot be vacuous, because the fixture carries the line;
   - a real-board cross-check that for every ticket file on the board, the
     frontmatter contains an `awaiting:` line exactly when `readTickets`
     returns a string for it. It holds on a board with no `awaiting` line at
     all, so closing the last one stays legal.
2. Show both fail with the field's parsing removed, and that deleting the one
   real `awaiting` line left on the board (dl-73's) leaves the suite green.

## Done when

1. `npx vitest run scripts/test/status.test.ts` passes on this branch, where it
   failed on `origin/main` at `1a044437`.
2. Both new tests fail with the field's parsing removed (`ticket.awaiting =
null` in `readTickets`, and separately the `FIELDS` entry deleted).
3. Deleting every real `awaiting:` line leaves `status.test.ts` green.
4. The Log names every other test that reads live ticket state, and the open
   decision about the markdown-only gap is stated as options.

## Log

- 2026-10-10 — filed and fixed in one branch from a gate's finding on dl-103,
  confirmed by running the test on `origin/main@1a044437` (output above).
  Owner's choice that day, from "owner raises it with the peer", "builder
  dispatched for a small repo PR" (recommended, chosen) and "file a repo ticket
  only": make the test prove the mechanism without depending on any live
  ticket's awaiting line.

  **What the old test protected, and what the new ones do and do not.** The
  old test was written against the real board so that it "has to be able to
  fail first": with the field absent from the parser the property was
  `undefined` on every ticket, and a `!== null` check passed all of them. It
  protected (a) the parser reads `awaiting`, (b) a line a person really wrote,
  in the shape people write it, survives the parse, and (c) the real board
  held an obligation at all. The new pair keeps (a) and (b) and drops (c).
  The synthetic test is the mechanism, with a fixture that carries the line, so
  it is never vacuous; the cross-check is (b) restated as an agreement between
  the file and the parse, so it needs no particular ticket and passes on an
  empty set. **What is lost:** nothing now asserts that the board has an
  outstanding obligation. That was never a property worth asserting; it was
  the test's proxy for "the real format reaches the parse", and (b) now says
  that directly. The cross-check is vacuous on its real-board half whenever no
  ticket owes anything, which is why the synthetic half exists.

  **Fail first**, both measured here by editing `scripts/status.mjs` and
  reverting with `git checkout`:
  - `ticket.awaiting ??= null;` changed to `ticket.awaiting = null;`: both new
    tests fail (`expected [] to deeply equal [ [ 'pl-1', …(1) ] ]`, and
    `expected [ 'dl-73' ] to deeply equal []`).
  - the `awaiting: { required: false },` entry in `FIELDS` deleted: both fail,
    with `"awaiting" is not a ticket field` for `pl-1-slug.md` and for dl-73.
  - dl-73's `awaiting:` line deleted from its file, then `git checkout`:
    `scripts/test/status.test.ts` 135 of 135 pass, which the old test could not
    do.

  **Every other test that reads live ticket state.** Found by grepping the
  test trees for `readTickets(REPO)`, a rootless `run([...])`, `docs/work`,
  `docs/01-TICKETS.md` and `readFileSync`/`readdirSync` of repo paths. All are
  in `scripts/test/status.test.ts`; `status-gate-record.test.ts`, `next-id`,
  `preflight`, `review-record` and `hooks` build their own trees or only name
  a ticket file inside a string, and `cloudflare-setup`'s `readdirSync` reads
  compose files.

  | Test                                                               | Reads                                           | Fails on                                                                            |
  | ------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
  | `every ticket in the repo parses, and its dependencies resolve`    | every ticket, and the tool set against `tools/` | a malformed ticket, a dangling dependency, a tool directory the board does not know |
  | `no ticket on the board is ready with a gate record already on it` | every ticket                                    | a ready ticket carrying `## Review`                                                 |
  | `repo-wide tickets live in docs/work`                              | every `repo` ticket path                        | a repo ticket filed elsewhere                                                       |
  | `no tool keeps a status page, and neither does the repo`           | `docs/` and `tools/*/docs`                      | a returned `03-STATUS.md`                                                           |
  | `the ticket format states the rule the parser enforces`            | `docs/01-TICKETS.md`                            | the quoting paragraph rewritten away                                                |
  | `the ticket format documents the field and says who clears it`     | `docs/01-TICKETS.md`                            | the `awaiting` row or its "deletes the line" sentence rewritten away                |
  | the new cross-check                                                | every ticket file                               | the parse dropping a written `awaiting` line                                        |

  None of them fails on a ticket doing what the format intends; each fails only
  on a defect, which is the difference from the repo-16 case. Two of them
  (`parses` and `ready with a gate record`) are also covered on an all-markdown
  change by `ci.yml`'s `node scripts/status.mjs --json` step in `check`. The
  other four read the repo for something `--json` does not look at, so **a
  markdown-only change can break them and CI will not run them** (the header
  above them in the file says so for the first group already).

  **Open decision, for the owner, not settled here.** Should a markdown-only
  change still run the tests that read markdown?
  1. **Leave it** (recommended). Each remaining test guards a defect, not a
     lifecycle, so a late red is a correct signal; the cost was one case, now
     removed, and the next one would be a real regression.
  2. **Run `npx vitest run scripts/test/status.test.ts` in `check`.** Measured
     at 3.9 s for 135 tests here. Closes the gap for the four uncovered tests,
     changes `ci.yml`, and puts a vitest run in a job that has none.
  3. **Let the `changes` filter treat `docs/**` and `docs/work/` as code for
     the `repo` project only.** Closes it without a new step, but widens a
     filter whose width is argued in `ci.yml`'s header, and runs the whole
     `repo` project (minutes, not seconds) on every ticket flip.
