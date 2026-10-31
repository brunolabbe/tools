---
id: lg-81
tool: ledger
title: The e2e server reads without a rate limit
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# lg-81 — The e2e server reads without a rate limit

## Why

The ledger's e2e suite drives one browser, and the API sees that browser as one
key. A key gets 120 reads a minute (`rateLimitReadsPerMinute: 120` in
`tools/ledger/api/src/config.ts`, line 141, overridable by
`RATE_LIMIT_READS_PER_MINUTE`). The layout spec's reads, taken together, go past
that once the spec holds about seventeen cases, and the reads past the limit are
refused and their cases fail. The planner's and the downloader's e2e configs
already switch their limiters off for this reason
(`RATE_LIMIT_RUNS_PER_MINUTE: "0"` in `tools/planner/playwright.config.ts`;
`RATE_LIMIT_PROBE_PER_MINUTE` and `RATE_LIMIT_JOBS_PER_MINUTE: "0"` in
`tools/downloader/playwright.config.ts`). The ledger's config did not.

**It is latent on `main`.** Measured at base `c7bdef21`, before any change, the
suite holds fifteen cases and all of them pass, with no `"rate limited"` line in
its output (Log, 2026-10-31). The defect shows on the branch that adds the rename
cases, lg-77 (PR #686), whose head holds seventeen.

The reproduction is lg-77's CI, read by the filer:

- Run `41223738914`, job `124603455298` (`e2e`), `npm run e2e:ledger`, head
  `a87da359dc6911770785382956c018595c3b650b`, seventeen cases. The server logged
  `"scope":"reads" … "msg":"rate limited"` repeatedly.
- Two cases failed. `✘ 16 … Household fits a phone and a desktop titled by an
  80-character household name, and renaming it`: `Error: Household (long household
  name) at 360 px: the cards …`, `Expected: >= 2`. `✘ 17 … Admin fits a phone and a
  desktop with a household's rename open (1.0m)`: `Error: locator.click: Test
  timeout of 60000ms exceeded.`
- Summary: `2 failed / 15 passed (1.4m)`.

Relayed from lg-80's builder, not re-run by this ticket's author: with the line
below, lg-80's eighteen-case suite passed `18 passed (26.6s)`, against `1.4 min
with failures` without it.

The line is one `env` entry, not a change to the suite, because the limiter's
own behaviour is the API's to test: `packages/core/src/rate-limit.ts` says
"False when `perMinute` was zero, in which case `check` always allows", and the
config accepts zero (`int(…, { min: 0 })`, `tools/ledger/api/src/config.ts`
line 313).

## Build

1. In `tools/ledger/playwright.config.ts`, in the `webServer` `env` block, add
   `RATE_LIMIT_READS_PER_MINUTE: "0",` after `LOG_LEVEL: "warn",`, with a short
   comment saying why, in the style of the planner's and downloader's configs.
   Change nothing else.
2. Leave the other limits as they are. Writes (60 a minute) and receipt and
   workbook reads (5 a minute each) keep their own settings. A run that shows
   `"rate limited"` under another scope is a finding for the Log, not part of
   this change.
3. Measure the failure mode before trusting the grep: with the value set to
   `"10"` the same suite must refuse reads and fail. Then restore `"0"` and
   confirm the diff is the comment and the line only.
4. Verify on the restored tree: `npm run check`, then
   `E2E_PORT=<free port> npx playwright test -c tools/ledger/playwright.config.ts`,
   and `grep -c '"rate limited"'` over its output.

## Done when

1. `tools/ledger/playwright.config.ts`'s `webServer` `env` carries
   `RATE_LIMIT_READS_PER_MINUTE: "0"` after `LOG_LEVEL`, with a comment, and the
   branch's diff touches that file and this ticket only. Proof:
   `git diff --name-only origin/main...HEAD`, and
   `grep -n RATE_LIMIT_READS_PER_MINUTE tools/ledger/playwright.config.ts`.
2. The ledger e2e suite passes every case it holds on the branch, and its output
   has no `"rate limited"` line. Proof: `npx playwright test -c
   tools/ledger/playwright.config.ts` on the branch, summary `15 passed`, and
   `grep -c '"rate limited"'` over its output `0` (Log, 2026-10-31).
3. With the value lowered to `"10"` the same suite refuses reads and fails, so the
   grep in line 2 counts something. Proof: the mutation run in the Log.
4. `npm run check` exits 0 on the branch. Proof: its exit code, in the Log.

## Log

### 2026-10-31 — filed with its fix (maintenance dispatch, builder)

**Owner's decision, 2026-10-31.** The line goes in its own pull request, not in
lg-80's. The options were: keep it in lg-80's pull request, which its builder and
the orchestrator recommended; or split it into its own pull request. The owner
chose the split.

**The brief's premise, corrected.** The brief said the layout spec fails once it
holds seventeen or eighteen cases. That holds for lg-77's head, not for `main`:
on `c7bdef21` the suite holds fifteen and passes. The defect is latent here and
becomes live when lg-77 (PR #686) lands, so this change should land no later than
that one, or #686's e2e fails. The reproduction in the Why is lg-77's CI, not a
run on this branch.

Commands, all from the worktree, on base `c7bdef21` before any change:

- `npx playwright test -c tools/ledger/playwright.config.ts`, with
  `E2E_PORT=8131`: `15 passed (22.5s)`. `grep -c '"rate limited"'` over the
  output: `0`.

Mutation, temporary, with the value set to `"10"` and then restored:

- `E2E_PORT=8132`, same command: `2 failed`, `12 did not run`, `1 passed
  (21.9s)`. `grep -c '"rate limited"'`: `14`. The refusal and its failures happen
  on this tree, so the zero below is measured against a suite that can fail.

The fix, commit `1d4627f0`: `RATE_LIMIT_READS_PER_MINUTE: "0",` after
`LOG_LEVEL: "warn",`, with its comment. Then:

- `npm run check`: exit `0`. Its 18 oxlint warnings are all in other files, and
  none is in `playwright.config.ts`.
- `E2E_PORT=8133 npx playwright test -c tools/ledger/playwright.config.ts`:
  `15 passed (22.6s)`. `grep -c '"rate limited"'` over the output: `0`.

**Status, left `ready`.** The brief said to set `done` with the fix. Committed as
`done`, `node scripts/preflight.mjs --only review --base origin/main` fails:

```
FAIL  tools/ledger/docs/work/lg-81-the-e2e-server-reads-without-a-rate-limit.md is marked done but has no ## Review section
preflight failed: review (exit 4)
```

The builder page (`roles/builder.md`, _Scope_) says a ticket filed on a branch is
left `ready`, and the lander sets `done` with the gate record. The brief's
instruction to set `done` here conflicts with that and with this check, so the
status is `ready`. Nothing has been reviewed yet; the gate's `## Review` is what
makes `done` true.
