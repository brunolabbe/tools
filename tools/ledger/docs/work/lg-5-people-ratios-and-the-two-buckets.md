---
id: lg-5
tool: ledger
title: People, salaries and ratios over time, and what each bucket owes whom
kind: work-package
status: done
milestone: P2
depends_on: [lg-4]
difficulty: hard
awaiting: Done when 4 — the two CodeQL alerts on routes/rules.ts and routes/salaries.ts read dismissed or suppressed on the security tab after the push to main that runs security.yml's dismissal step
---

# lg-5 — People, salaries and ratios over time, and what each bucket owes whom

## Why

This is the screen the workbook exists to produce: is the mortgage even, and
what is in the buffer ([00-ANALYSIS.md §4–5](../00-ANALYSIS.md)). It also lays
down the salary and ratio history the owner wants charted (§9).

## Build

1. Migration:
   - `people`, holding the display names. The email mapping stays in lg-3's
     configuration.
     - lg-4 already stores a **person id** (`Person.id`, the configured name)
       on rules and classifications, as plain text with no foreign key, and
       serves `GET /api/people` from that configuration. When this table lands,
       point that route at it, and keep the ids equal to the configured names
       so the rows lg-4 stored still name someone.
   - `salaries`: person, amount in cents, year, entered-at.
   - `ratios`: parts per million per person, effective-from date, and the
     salary records it came from, if any.
     All three are append-only, and a correction supersedes the earlier record.
2. `books`, pure:
   - **mortgage:** each person's own money in the bucket, which is their
     deposits − ½ × payments, as of any date.
     - The bucket is **not** shared (analysis §4). The two amounts sum to its
       balance exactly, and nothing in it is common.
     - Rounding: an odd-cent payment's halves differ by a cent. Give the extra
       cent to one person by a fixed rule, and assert that the sum still
       equals the balance.
   - **buffer:** the current-expenses balance as of any date, and each person's
     cumulative contributions to it.
   - **ratio from salaries:** parts per million, rounded half-up, with the two
     people summing to exactly 1 000 000.
3. Money is integer cents throughout. No `number` holding dollars crosses a
   function boundary.
4. `web`:
   - the home screen: each person's own money in the mortgage bucket, who has
     paid extra and by how much, and the buffer's
     balance;
   - a screen for entering a year's salaries, which proposes the derived ratio
     and its effective date for the person to confirm.

## Done when

1. Unit tests on a synthetic history prove:
   - each person's own money in the mortgage bucket, and that the two sum
     to its balance to the cent, including after an odd-cent payment;
   - the buffer's balance as of a past date, where a later row changes the
     present one;
   - that a derived ratio's two halves sum to 1 000 000.
2. Entering a corrected salary keeps the earlier one, and the earlier ratio
   still reads as in effect for its own dates.
3. The home screen shows both figures. A web test proves it.
4. Gates green.

## Review

**Gate: CONCERNS** — 2026-10-04 · `3a7d8a9..4a7647b` · Sonnet 5.5, depth full

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a. Each person's own money in the mortgage bucket, summing to its balance to the cent, including after an odd-cent payment | `books/test/buckets.test.ts` › "the two sum to the balance to the cent, right after an odd-cent payment" (`sumOwn` equals `balanceCents` after a -70001 payment) and › "the parts sum to the balance on every date of a long, varied history, and never drift" (every row date of a 400-day history, 20+ odd joint rows). Through the API: `api/test/buckets.test.ts` › "each person's own money in the mortgage bucket sums to its balance, odd cent and all". **proven** |
| 1b. The buffer's balance as of a past date, where a later row changes the present one                                       | `books/test/buckets.test.ts` › "its balance as of a past date leaves out a later row that changes today's" (two different balances for 2026-02-12 and 2026-02-28); `api/test/buckets.test.ts` › "the buffer's balance as of a past date leaves out the later row". **proven**                                                                                                                                                                                              |
| 1c. A derived ratio's two halves sum to 1 000 000                                                                           | `books/test/ratio.test.ts` › "rounds half-up, and the two halves still sum to exactly 1 000 000", › "on an exact half both would round up, so the first takes it and the sum holds" and › "sums to 1 000 000 and is within half a part of exact, over many salaries" (2000 varied pairs, `total(shares)` asserted on each). **proven**                                                                                                                                     |
| 2. Entering a corrected salary keeps the earlier one, and the earlier ratio still reads as in effect for its own dates      | `api/test/salaries.test.ts` › "a corrected salary keeps the earlier record, and the earlier ratio still reads as in effect for its own dates": both salary rows are read back with the `supersedes` link, and `inEffect` is asserted for four dates across three ratios and for a date before the first (`null`). **proven**                                                                                                                                               |
| 3. The home screen shows both figures; a web test proves it                                                                 | `web/test/home.test.tsx` › "shows each person's own money in the mortgage, who has paid extra, and the buffer's balance": asserts alex `149.99 $`, sam `50.00 $`, "alex has paid 99.99 $ more.", "In the bucket: 199.99 $" and the buffer's `Balance` `130.00 $`. Each is a positive `getByText`, so empty output fails it. **proven**                                                                                                                                     |
| 4. Gates green                                                                                                              | **unproven (gate)**. Local: `npm run check` exit 0; `npm test -- --project ledger` 28 files / 391 tests passed here (base 3a7d8a9, same command: 21 files / 333 tests). CI on 4a7647b (`gh pr checks 354`, `headRefOid` confirmed): `check` ×2, `changes`, `docker`, `codeql` workflow, `dependency-review`, `test (ubuntu-latest)` and `test (windows-latest, informational)` pass, 8 of 9; the code-scanning check **`CodeQL` is FAILURE** — see the first bullet.       |

- **med** · Done when 4 depends on it · The `CodeQL` check run on this head failed with two "Missing rate limiting (High)" alerts: the `GET /api/people` handler in `routes/rules.ts` and the `GET /api/salaries` handler in `routes/salaries.ts` (read from the check run's page, since `gh` shows no annotations). **Both routes are limited**: `app.printRoutes({ includeHooks: true })` lists `rateLimit()` in each one's `onRequest` (as it does for every route and `HEAD` but `/api/health`), and `api/test/route-limits.test.ts` › "GET %s refuses the second request in a minute too" returns 429 for both `GET /api/salaries` and `GET /api/ratios`. This is the class `repo-91` records (CodeQL does not model core's limiter), made new on this branch because `GET /api/people` now reads the database and `GET /api/salaries` is new. **Open decision** (owner's: dismissal is not available to the builder): (1) dismiss both alerts as false positives with the written reason, as was done on #345 — recommended, it is the precedent `repo-91` cites; (2) hold the PR for `repo-91`'s decision. Observed, not explained: all the handlers flagged on this PR are `async () =>` with no parameter, and the two database-reading `GET`s here that take `request` (`/api/buckets`, `/api/ratios`) are not flagged — a data point for `repo-91`'s Log.
- **low** · no `Done when` depends on it · no live call site until a configured name changes before the first boot of this branch · **a person id lg-4 stored that the configuration no longer names is never enrolled.** Migration 3 only creates `people`; the table is filled from `ACCESS_PEOPLE` at boot. Reproduction: a database written by the base branch's two migrations, holding a rule naming `casey` and a mortgage row classified to `casey`; boot this branch with a configuration naming only alex and sam. `people` is `[alex, sam]`, `GET /api/people` is `{"people":["alex","sam"]}`, and `GET /api/buckets?asOf=2026-09-30` answers `own` for **three** people (`alex 16666, casey -10989, sam 26668`) with `lead: null`. The figures still sum (books adds any id a row names), so no money is lost. Every id that was configured at the first boot, which is every id lg-4 could have stored if the configuration did not change, resolves: `api/test/people.test.ts` › "the person ids lg-4 stores on rules and classifications all name someone" (written with this branch's code, so it does not exercise the gap). Remedy if wanted: enroll the distinct `person_id`s from `rules` and `classifications` in the same step as the configuration's names; migration 3 is unshipped, so it may still be edited.
- **low** · no `Done when` depends on it · no live call site while the household's names are fixed · **open decision: a person can never be retired.** `people` is append-only and `GET /api/people` reads it, so a configured name that is renamed or replaced leaves the old one listed for good. Reproduction: boot, then reboot with `sam@…=samuel` in place of `sam@…=sam`: `GET /api/people` is `{"people":["alex","sam","samuel"]}`. By reading `web/src/salaries/Salaries.tsx` (not rendered here): the form asks a salary of every listed person, and the API derives a ratio only between exactly two salaries, so a former member blocks the form; the mortgage split would be three ways. Options: (A) leave it and state in `tools/ledger/CLAUDE.md` that a name in `ACCESS_PEOPLE` is permanent — recommended now; (B) add a way to retire a person (and have `/api/people`, the splits and the salary form use the active ones), when someone first needs it.
- **low** · no live call site · `web/src/home/Home.tsx` prints "Both have paid the same." whenever `mortgage.lead` is `null`, but `books/src/buckets.ts` documents `lead` as `null` also "when there are not exactly two people", so the first bullet's three-person state would read that sentence over three unequal figures. By reading the source; the screen was not rendered in that state.
- **low** · no live call site · "today" is the UTC date: `todayOf` in `api/src/salaries.ts` and `asOfOf` in `api/src/routes/buckets.ts` both take `toISOString().slice(0, 10)`. With the clock at 21:30 on 2026-10-03 in Montreal (01:30Z on the 4th), `POST /api/salaries` proposes `effectiveFrom: 2026-10-04` and `GET /api/buckets` answers `asOf: 2026-10-04`. The Log records "the day of entry by the API's clock" as a decision, and the person can change the date before confirming; recorded so it is a choice and not a surprise.
- **dropped** · "`mortgageAsOf` throws `INTERNAL` with no people and a joint row": reproduced against the books function, but `ACCESS_PEOPLE` empty means every request is refused before any route runs, so the API cannot reach it.
- **dropped** · "a ratio can be confirmed with an `effectiveFrom` before the salaries' year" (1999 from 2026 salaries was accepted): the brief is silent, the ratio reads as in effect only from its own date, and a back-dated ratio is a product choice, not a defect.
- **dropped** · "the API suite passes with per-payment rounding planted" (215 of 215 passed): the books test "never drift" is the proof the brief asks for and caught it, and the builder's Log discloses `1 failed | 10 passed (11)`. I reproduced that number.
- **dropped** · "`people` holds no display name although the brief says it holds the display names": the id is the configured name, which is what is shown, and the brief itself requires the ids to equal the configured names; a separate column is a design choice the builder flagged.
- **findings** · the hunt returned 9; 5 carried (1 med, 4 low), 4 dropped. Nothing found is a `high`.

**What I ran to check the money, before reading the tests.** `mortgageAsOf` and `bufferAsOf` against a second method that does not use `splitCents` (the second person takes `trunc(J/2)` of the joint total `J`, the first takes the rest) over 20 000 random histories (odd and even joint payments, refunds, person-filed deposits and withdrawals, buffer rows, same-day rows) on 8 dates plus one before and one after: 160 000 as-of checks, 48 887 of them with an odd joint total, 0 failures. The same through `GET /api/buckets` on stored rows and classifications: 480 requests, 186 odd, 0 failures. A history entered by paste, rules and two ratios (odd joint payments -70001, -3, -70003, -1 interleaved with a +333 and a +1 refund and deposits of 3 and 40001 cents, ratio changed 600000/400000 to 636364/363636 on 2026-02-05): 11 dates, 0 mismatches, parts equal the balance on every date. Ratios: 160 800 salary pairs (0 to 400 each) against exact rational rounding, 0 wrong, every pair summing to 1 000 000; `1 : 1999999` (the exact tie) gives 1 / 999 999; `MAX_SAFE_INTEGER` salaries sum correctly. As-of: before the first row both buckets are zero; before the first ratio `inEffect` is `null`; a ratio is read on its first day and not the day before.

**Positive control.** The harness fails when it should: with `splitCents` giving no one the odd cent and the sum check disabled, the books fuzz reports 97 774 failures and the API fuzz 372, and `books/test/buckets.test.ts` goes 6 failed of 11 (`api/test/buckets.test.ts` 2 failed of 6, after rebuilding books' `dist`, which the API reads). With the sum check left in place the same mutation also fails 6 of 11 (error text not read). Planting per-payment rounding instead fails exactly 1 of 11 in `books/test/buckets.test.ts` ("never drift", `expected 2 to be less than or equal to 1`) and none of the API's 215. Every mutation was applied to `books/src/buckets.ts` alone, restored with `git checkout`, `dist` rebuilt, the restored `dist` grepped for the mutation (0 matches), `git status --short` empty and the fuzz re-run at 0 failures.

**The seam to lg-4, and the migration.** `git diff 3a7d8a9...4a7647b -- tools/ledger/api/src/db/schema.ts` is 67 additions and 0 deletions: migration 3 is appended and no shipped migration changed. A database written by the base's migrations 1 and 2 (rules and classifications naming alex, sam) opens at `user_version` 3 and `GET /api/people` answers `["alex","sam"]`. `api/test/people.test.ts` › "a person the configuration stops naming stays, so their rows still name someone" holds the other half.

**The taxonomy.** `SALARY_NOT_FOUND` is a domain code (a salary record is this tool's), is raised as `new AppError("SALARY_NOT_FOUND")` with the contract's default message (no re-worded copy at the raise site), has its 404 in `api/src/http-errors.ts` in the same change, and follows `RULE_NOT_FOUND` and `ROW_NOT_FOUND`. It is not `NOT_FOUND` (no route) or `JOB_NOT_FOUND` (no job). The exhaustive maps over the code type: `DEFAULT_ERROR_MESSAGES` in `contract/src/errors.ts` is `Record<ErrorCode, string>` and has the entry; `STATUS_BY_CODE` is `Partial` and has the entry; `api/test/http-errors.test.ts` walks `LEDGER_ERROR_CODES` for "has a status line and does not answer 500". The ledger's web has no map over the code type.

**Invariants walked.** Every new route is limited (`printRoutes` above; `GET /api/people` and the two `GET`s that share a path with a `POST` are covered by `route-limits.test.ts`). Every failure in the new sources is an `AppError` with a ledger or core code; no `console`, no `any`, no `UPDATE` or `DELETE` in the added source (`api/test/classification-schema.test.ts` still scans for it). `packages/core/test/image-closure.test.ts` and `spawn-safety.test.ts` pass (25 tests) and the `docker` job is green on this head. Contract edits are the ticket's own seam (new route names and request schemas, one code), and the brief names them. Skipped: SSRF, redaction and process-tree rules (no URL, header or subprocess in the diff). Tests are registered: the 7 new spec files are inside the existing `*/test` projects and run in the count above (28 files against 21 at the base).

**Unmeasured.** Neither screen was rendered in a browser or on a phone (jsdom only, as the Log says). The Windows leg is informational and passed. The CodeQL alert list came from a fetch of the check run's page (a summary of it), not from a command.

- NFR: security ✓ (identity on every route, limits, strict zod bodies, no values in errors) · performance n/a (rows are read once per request and filtered per person; household scale) · reliability ✓ (the books refuse to answer rather than show parts that do not sum; salary and ratio writes run in immediate transactions; one unmeasured: concurrent confirm races, serialised by `.immediate()` and the unique indexes) · maintainability — the three low bullets above.

### Gate 2

**Gate: CONCERNS** — 2026-10-05 · `4a7647b..ce0a97b` · Sonnet 5.5, depth full

Only `git diff 4a7647b..ce0a97b` was reviewed. Nothing found in it is a `high`, and nothing is a `med`; no third gate is needed.

| Gate 1 finding                                                                       | Verdict                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **med**, CodeQL "Missing rate limiting" on `GET /api/people` and `GET /api/salaries` | **Excused in code as the owner chose (a); the check is red, as that choice expects.** Each rule of adr/005 is checked below. The `CodeQL` check on this head is still FAILURE with the same two alerts, each moved down with the comment that was inserted above it; no third alert appeared. |
| **low**, a stored person id no longer configured is never enrolled                   | **Fixed**, and the fix is proven by a test that can fail. Two lows on its edges follow.                                                                                                                                                                                                       |
| **low**, a person can never be retired                                               | **Recorded as the owner decided (A).** `docs/00-ANALYSIS.md` §7 (Identity) says a name in `ACCESS_PEOPLE` is permanent, and `tools/ledger/CLAUDE.md` points to it consistently. One sentence in it overclaims; see the first new low.                                                         |
| **low**, `lead: null` reads "Both have paid the same."                               | Not changed by this round (`web/src/home/Home.tsx` is outside the diff). Still recorded; the owner did not open it.                                                                                                                                                                           |
| **low**, "today" is the UTC date                                                     | Not changed by this round (`api/src/salaries.ts` and `routes/buckets.ts` are outside the diff). Still recorded; the owner did not open it.                                                                                                                                                    |

**adr/005 `## Decision`, rule by rule, for the two `codeql[js/missing-rate-limiting]` comments** (`routes/rules.ts` and `routes/salaries.ts`):

- **All five fields are present in each**: the query id (`js/missing-rate-limiting`, also in the tag), the file (named in the comment and the one it sits in), the date (2026-10-05), the reasoning (CodeQL models `express-rate-limit` and its kin and not core's `RateLimiter`; the route is limited per person), and the guard test. Each reads as the ADR's template does, including "that, not this comment, is what protects the design".
- **The guard is named and measured, and I re-measured it.** With `{ onRequest: read }` taken off `GET /api/people`, `npx vitest run tools/ledger/api/test/route-limits.test.ts` answers `1 failed | 21 passed (22)`, the failing test being "people refuses the second request in a minute, as RATE_LIMITED". Off `GET /api/salaries`: `1 failed | 21 passed (22)`, "GET salaries refuses the second request in a minute too". Both match the comments' wording and count; each source file restored with `git checkout`, `git status --short` empty. Rule 3 (no test, no excuse) is met.
- **Placement, rule 1.** Each `codeql[...]` line is the last comment line, alone on its line, directly above the `app.get(` line, never at the end of a line. The check run reports each alert on the handler's **last** line (as the `#345` alerts were: reading `inbox.ts` and `rules.ts` at the two commits `repo-91` cites, the reported lines are each handler's closing `});`), which is below the line the comment's scope covers. What I could establish: `AlertSuppression.qll`'s scope for a comment on its own line is exactly the next line (`covers` with columns 0 and 0, read through a page fetch, which reproduced it verbatim), and `MissingRateLimiting.ql` reports at `useSite`, the route installation (also a page fetch's account of it). A multi-line result starts on the `app.get(` line. **Not established, and not observable before merge**: whether CodeQL's matching covers a multi-line alert from its first line. This is the first low below.
- **The CodeQL check, read once.** `gh pr checks 354` at head `ce0a97b` (confirmed by `headRefOid`): 8 of 9 pass — `check` ×2, `changes`, `docker`, `codeql`, `dependency-review`, `test (ubuntu-latest)`, `test (windows-latest, informational)`. **`CodeQL` is FAILURE**, and the check run's page lists exactly two alerts, "Missing rate limiting" on `routes/rules.ts` and `routes/salaries.ts`, neither marked suppressed (a page fetch's summary, not a command). Under adr/005 the comment is the register, and the dismissal step in `security.yml` runs only on a push to `main`, so a red check here is the expected state. I did not verify that it clears after merge: nothing here can, and `repo-16`'s `awaiting` line still waits on that observation for the mechanism itself.

**Done when 4** stays **unproven (gate)** by the rule that a leg only CI can prove has to run green on this head; the one red leg is the one the owner accepted. Everything else is verified at this head: `npm run check` exit 0; `npm test -- --project ledger` 28 files, 392 tests passed (391 at gate 1, plus the one new test); the Windows leg and `docker` pass in CI.

**The enrolment in migration 3, attacked.**

- **Append-only relative to what shipped.** `git diff 3a7d8a9..ce0a97b -- tools/ledger/api/src/db/schema.ts` removes exactly two lines, the `migrate` signature and its loop bound; migrations 1 and 2 are byte-identical. Migration 3 is unshipped: `.release-please-manifest.json` has `tools/ledger` at `0.0.0` and no ledger tag exists, so editing it was allowed.
- **A database at migration 2 with no rows**: migrates to version 3 with `people` empty (`GROUP BY` yields no row, where a bare `min()` would have yielded a null one). A fresh database also has no people (the existing test).
- **`added_at`**: the earliest record naming the id, across both tables. On a database where `dana` is named by two rules (09-05 and 09-04) and two classifications (09-03 and 09-06), `people.added_at` for `dana` is `2026-09-03T00:00:00.000Z`. An id that boot also names keeps the migration's earlier time (`INSERT OR IGNORE`).
- **Duplicates and case**: one row per exact id; `Dana` and `dana` enrol as two people, the same exact-name identity the configuration has. Not a defect.
- **`migrate(db, target)`**: `target 2` stops at 2; a lower target than the current version does nothing; `99` is clamped to the last migration; no argument is the old behaviour, which is all `createApp` calls.
- **Round 1's reproduction, re-run at this head** (a database written by the base's two migrations, a rule and a row naming `casey`, configuration naming alex and sam): `people` is `[alex, casey, sam]` and `GET /api/people` is `{"people":["alex","casey","sam"]}`; it was `["alex","sam"]`. That three-person state (Salaries cannot propose a ratio, "Both have paid the same." over three) is the one the owner settled with "leave it", and is not reopened.
- **Positive control.** `api/test/people.test.ts` › "every person id its rules and classifications name is enrolled, configured or not": with the enrolment made a no-op (`GROUP BY person_id HAVING 0`) it fails, `expected [ 'alex', 'sam' ] to deeply equal [ 'alex', 'casey', 'dana', 'sam' ]`, `1 failed | 7 passed (8)`. With only the rules half disabled it fails (`casey` missing); with only the classifications half disabled it fails (`dana` missing). Each mutation restored by `git checkout`, `git status --short` empty.

**Findings (lines this round touched only)**

- **low** · no live call site · open decision · **the enrolment covers `person_id` and not the three `*_by` columns, and three sentences say it covers more.** `rules.created_by`, `classifications.classified_by` and `statement_imports.imported_by` also hold a configured `Person.id` (the schema says so in each). Reproduction: a database at migration 2 where `eli` only ever classified a joint row, `fay` only created a joint rule and `casey` only imported a paste, migrated: `people` holds none of the three. The overclaiming text: the migration's own comment ("so no stored row names nobody"), `tools/ledger/CLAUDE.md` ("enrols every id lg-4 had already stored") and `docs/00-ANALYSIS.md` §7 ("holds every name the configuration or a stored row has ever used"); `api/src/people.ts` is exact ("on a rule or a classification"). Nothing reads a `*_by` column against `people`, which is why this is graded low and not as shipped text false against the code: the sentences' own subject is the names the books name people by, and only a reading that includes the `*_by` columns fails. **Options:** (1) narrow the three sentences to "a person id on a rule or a classification" — recommended, since enrolling an id that only ever acted adds another person to a salary form the owner has already said should not grow; (2) enrol the `*_by` columns too, making the sentences true. Migration 3 is unshipped, so either is cheap.
- **low** · the new test cannot tell the earliest record from the latest. The fixture names each id once, so "Added when the id was first recorded, not when the upgrade ran" is asserted for `dana`, whose single record is the only candidate. Reproduction: change `min(at)` to `max(at)` in migration 3 and `npx vitest run tools/ledger/api/test/people.test.ts` answers `Tests  8 passed (8)`. The behaviour is right (my own run above gives `2026-09-03` for `dana` across both tables); only the test's claim is thin. Fix: name one id on two records, in different tables.
- **low** · no live call site · placement of the two comments is unproven until the first push to `main`: see "Placement, rule 1" above. The builder's Log infers the comment goes above `app.get(` "where the handler starts"; that is the same inference I reached, and neither of us measured it. After the merge, the security tab should read the two alerts as dismissed with `Suppressed via SARIF`; if they read open, placement is the first suspect (and, equally, `repo-16`'s still-awaited observation of the mechanism itself).
- **dropped** · "the comment pins `4a7647b`, a branch sha squash removes from `main`": true (`git merge-base --is-ancestor 4a7647b origin/main` exits 1), and so is the existing excusal's pin to `6e273cc` (exit 1); it is the template's behaviour in this repo, not this branch's defect.
- **dropped** · "`migrate`'s `target` parameter is test-only code in production": it is documented in the function's comment, defaults to the old behaviour, and the only production caller passes nothing.
- **findings** · the hunt returned 5; 3 carried (all low), 2 dropped. Nothing found is a `high`.

**Unmeasured.** The SARIF region of the two alerts (no tool here reads it), so the placement question; the CodeQL check's behaviour after a push to `main`; the alert list is a page fetch's summary and not a command.

- NFR: security ✓ (the excusal rests on a guard test that fails when the limiter is removed; the enrolment adds no input path) · performance n/a (one `INSERT … SELECT` at the first boot after upgrade) · reliability ✓ (runs in the migration's transaction; an empty database is a no-op) · maintainability — the three lows above.

## Log

- 2026-10-04 — Built, on `origin/main` at `3a7d8a9`: migration 3 (`people`,
  `salaries` with `current_salaries`, `ratios` with `current_ratios`, and
  `ratio_shares`) in `api/src/db/schema.ts`; `mortgageAsOf`, `bufferAsOf`,
  `splitCents`, `ratioFromSalaries` and `ratioInEffect` in `books`;
  `api/src/people.ts`, `api/src/buckets.ts` and `api/src/salaries.ts`;
  `GET /api/buckets`, `GET`/`POST /api/salaries` and `GET`/`POST /api/ratios`,
  each rate limited; one code, `SALARY_NOT_FOUND` (404); and in `web` a home
  screen, now the first tab, and a salaries screen.
  - **The suite passes.** `npm test -- --project ledger` → `Test Files 28 passed
(28)`, `Tests 391 passed (391)`; `npm run check` exit 0.
  - **Done when, and where each is proved.** (1) `books/test/buckets.test.ts`:
    "the two sum to the balance to the cent, right after an odd-cent payment",
    "each person's own money is their deposits less half of every payment", and
    "the parts sum to the balance on every date of a long, varied history, and
    never drift"; "its balance as of a past date leaves out a later row that
    changes today's"; `books/test/ratio.test.ts`, "rounds half-up, and the two
    halves still sum to exactly 1 000 000", "on an exact half both would round
    up, so the first takes it and the sum holds" and "sums to 1 000 000 and is
    within half a part of exact, over many salaries". The same, through the
    API, in `api/test/buckets.test.ts`. (2) `api/test/salaries.test.ts`, "keeps
    the earlier record, and the earlier ratio still reads as in effect for its
    own dates". (3) `web/test/home.test.tsx`, "shows each person's own money in
    the mortgage, who has paid extra, and the buffer's balance".
  - **The tests can fail.** Each mutation applied to the source alone and
    restored; books rebuilt where the API reads its `dist`. Dropping the odd cent
    in `splitCents` (`index < 0`): the two bucket suites → `10 failed | 7 passed
(17)`, the API's included, since the sum check throws. The same with the sum
    check disabled → `8 failed | 9 passed (17)`. Rounding each joint row
    separately instead of the cumulative total → `1 failed | 10 passed (11)`,
    the long history's "never drift". Rounding both ratio shares on their own →
    `1 failed | 7 passed (8)` (the exact half); truncating → `2 failed`.
    Ignoring `asOf` in the books → `6 failed | 5 passed (11)`. Taking the latest
    ratio whatever the date → `1 failed | 11 passed (12)`, Done-when 2's test. A
    correction that deletes the earlier salary → 4 failed, the source scan among
    them. The home screen showing the mortgage's balance as the buffer's, or the
    first person's amount on both lines → `1 failed | 2 passed (3)` each.
    `GET /api/people` answered from the configuration again → `1 failed`.
  - **The seam facts held.** `routes/rules.ts` served `GET /api/people` from
    `peopleOf(context)` with "lg-5 gives people a table of their own"; the schema
    had no `people` table; new routes take `rateLimitsFor`. All four checked
    before relying on them.
  - **Decisions the brief left open, made here.**
    - **People.** `people(id, added_at)`, where `id` is the configured name,
      which is what is shown. Boot adds each name `ACCESS_PEOPLE` holds that the
      table does not (`INSERT OR IGNORE`), and nothing removes one, so a person
      the configuration stops naming still names their rows. `GET /api/people`
      and the check on a rule's or a salary's person read the table. No separate
      display-name column: see the open decision in the report.
    - **The odd cent** is split once, on the cumulative joint total and never
      per payment, and goes to the person whose id sorts first, whichever sign
      it has. A row filed to a person is wholly theirs and a joint row is halved,
      which is `deposits − ½ × payments` exactly, and also places a joint rebate
      or a person's own withdrawal without a special case. `mortgageAsOf`
      throws `INTERNAL` if the parts ever stop summing to the balance.
    - **The ratio's rounding.** The first person by id takes their share
      rounded half-up and the second the remainder: equal to rounding both
      whenever that sums to 1 000 000, and on the exact tie the first takes the
      extra part. Arithmetic in `bigint`.
    - **Contributions to the buffer** are the sum of the rows filed to that
      person, so a row filed to them that took money out counts against them.
      Joint rows (payments out) are nobody's. **lg-6 reads "every deposit"; this
      is that, net of money returned to the same person.**
    - **A ratio is confirmed by naming salary records**, and the API derives it
      again from them; a record corrected since the proposal is
      `SALARY_NOT_FOUND`. Confirming another ratio for a day that has one
      supersedes it; the same one twice is one record. The proposal's date is
      the day of entry by the API's clock, which the person can change.
    - **A corrected salary does not move a confirmed ratio.** It proposes a new
      one; until that is confirmed the earlier stands, so a settlement made with
      it stays recomputable.
    - **Same salary sent again files nothing.** A year re-sent unchanged adds no
      record.
    - **Ratios have a fourth table**, `ratio_shares`, one row per person, rather
      than per-person columns, so the schema does not fix the household at two.
      The arithmetic does: the ratio is between two people, and the lead is
      `null` for any other number.
    - **The home screen counts what is unclassified**, since neither bucket
      includes a row the inbox still holds.
  - **What the brief had wrong.** "All three are append-only, and a correction
    supersedes the earlier record" fits salaries and ratios; `people` has nothing
    to correct once a name is its id. The brief names three tables; the ratio's
    per-person parts take a fourth.
  - **Fold-in: none taken.** `tools/ledger/CLAUDE.md` and `README.md` were
    updated to say what lg-5 adds, which is this ticket's own work. Nothing else
    specified was made free.
  - **Not covered.** No e2e spec and no browser: both screens ran in jsdom with
    the API client faked. Five tabs now wrap on a narrow screen; that was not
    looked at on a phone. Neither bucket counts the account's balance before the
    first stored row, so until lg-7 imports the history the two balances sum to
    the account's balance less that opening amount.

- 2026-10-05 — Round 1 after gate 1 (CONCERNS at `4a7647b`), with the owner's
  three answers.
  - **The `CodeQL` alerts are excused in code, per `docs/adr/005`** (the
    owner's choice (a), over the gate's (b), UI dismissal). Two `// codeql[...]`
    comments, one above `GET /api/people` in `routes/rules.ts` and one above
    `GET /api/salaries` in `routes/salaries.ts`, each with the five fields. The
    rule id is `js/missing-rate-limiting`: the check run's page names the alerts
    "Missing rate limiting", "This route handler performs a database access, but
    is not rate-limited", and that is the `@name` and message of
    `javascript/ql/src/Security/CWE-770/MissingRateLimiting.ql` in
    github/codeql, whose `@id` is `js/missing-rate-limiting`. The page shows
    lines 62 and 29, each the handler's last line, so the comment sits above the
    `app.get(` line where the handler starts. **The guard was measured, not
    argued:** taking `{ onRequest: read }` off `GET /api/people` makes `npx
vitest run tools/ledger/api/test/route-limits.test.ts` answer `1 failed |
21 passed (22)` ("people refuses the second request in a minute, as
    RATE_LIMITED"); off `GET /api/salaries`, `1 failed | 21 passed (22)` ("GET
    salaries refuses the second request in a minute too"). Both restored.
  - **The display name stays as built** (`people(id, added_at)`), by the owner's
    answer.
  - **A name in `ACCESS_PEOPLE` is permanent**, by the owner's choice (A),
    recorded in `docs/00-ANALYSIS.md` §7. Retiring a person is future work.
  - **Migration 3 now enrols every person id lg-4 stored** on a rule or a
    classification, as of the first record naming it; migration 3 is unshipped,
    so it was edited rather than followed by a fourth. `migrate` takes an
    optional target version so a test can build a database as lg-4 left it.
    `api/test/people.test.ts`, "every person id its rules and classifications
    name is enrolled, configured or not", failed before the change (`expected [
'alex', 'sam' ] to deeply equal [ 'alex', 'casey', 'dana', 'sam' ]`) and
    passes after.
  - **What three people does, reproduced** on a database at migration 2 with
    rows classified to alex, sam and casey, the configuration naming alex and
    sam. Before the change `GET /api/people` was `["alex","sam"]`, so the
    salaries screen asked for two salaries and worked; after it, it is
    `["alex","casey","sam"]`, and rendered with three people the screen refuses
    a blank casey ("casey's salary is not an amount") and, with casey at 0,
    stores three salaries and proposes no ratio, so there is no Confirm button.
    The home screen's "Both have paid the same." over three unequal amounts was
    reachable before the change too: `GET /api/buckets` already answered `own`
    for all three with `lead: null`. Reported as an open decision.

- 2026-10-05 — The owner's decisions after gates 1 and 2, each as question,
  answer and whose recommendation it followed. The first three are recorded
  above; the recommendation each followed was not.
  - **CodeQL alerts: excuse in code or dismiss in the UI?** In code, per
    `docs/adr/005`. This **overrode gate 1's recommendation** of a UI dismissal,
    as on #345. The `CodeQL` code-scanning check is expected to stay red until
    merge, because `dismiss-alerts` clears the alerts on push to `main`; gate 2
    left the comments' placement unproven until then.
  - **The `people` display name: add a column or keep `people(id, added_at)`?**
    Kept as built. This **followed the builder's recommendation**.
  - **Retiring a person: document it now, or leave it?** (A), document it now,
    in `docs/00-ANALYSIS.md` §7. This **followed gate 1's recommendation**.
  - **A third enrolled person blocks the Salaries form: what to do?** Leave it.
    This **followed the orchestrator's recommendation**. The other options were
    removing the enrolment, asking only the configured people, and skipping blank
    salaries.
  - **The enrolment covers `person_id` but not the `*_by` columns, and three
    sentences said it covers more: narrow the sentences, or enrol the columns?**
    Narrow the sentences. This **followed gate 2's recommendation**, option (1),
    over "record only" and option (2). Changed, words only: the migration 3
    comment in `api/src/db/schema.ts`, the sentence in `tools/ledger/CLAUDE.md`
    and the sentence in `docs/00-ANALYSIS.md` §7 now say the person ids on
    `rules` and `classifications` are enrolled, and nothing else. `npx vitest run
tools/ledger/api/test/schema.test.ts tools/ledger/api/test/people.test.ts` →
    `Test Files 2 passed (2)`, `Tests 13 passed (13)`.
- 2026-10-06 — An `awaiting` line added, from repo-88's rule: Done when 4,
  "Gates green", was `unproven (gate)` in both gates only because the `CodeQL`
  check was red under the owner's adr/005 excusal, and the owner decided on
  2026-10-06 (repo-88, option A) that such a line is `awaiting` on the push to
  `main` that runs the dismissal step. The reading has not been taken: the
  alerts' state needs the security tab, and `gh api` is denied here. Whoever
  reads it deletes the line, beside `repo-16`'s own.
