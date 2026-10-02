---
id: lg-2
tool: ledger
title: Store a pasted statement, chained onto what is already stored
kind: work-package
status: ready
milestone: P2
depends_on: [lg-1]
difficulty: standard
---

# lg-2 — Store a pasted statement, chained onto what is already stored

## Why

A paste is only as good as its fit to the history already stored. Pastes
overlap routinely, and a gap between two pastes is money nobody can explain
([00-ANALYSIS.md §2](../00-ANALYSIS.md)).

## Build

1. Migration 1 in `api/src/db/schema.ts`: a `statement_rows` table holding
   everything `ParsedStatement` carries, plus the import it came from and when.
   `seq` comes back 0-based within the paste (oldest = 0): the parser cannot
   know the history, so offset it by what is already stored (lg-1).
   A row's identity is (date, description, amount, balance), with a unique index
   on it.
2. `POST` on a new route in `contract/src/api.ts`: paste text in, and a report
   out. The report gives rows added, rows already present, and the new tail
   balance.
3. **Chaining:**
   - the paste's oldest new row must continue from the stored row just before
     it (balance − amount = that row's balance), or overlap it exactly;
   - a gap is refused with the unexplained amount in the error;
   - the very first paste into an empty database is accepted as the anchor.
4. **Overlapping rows must be identical.** A pasted row that shares an identity
   with a stored row but disagrees elsewhere, such as its category, is refused
   and named.
5. **Never overwrite.** A stored row is never edited in place (§9 of the
   analysis).
6. `web`: a paste screen with a textarea, a preview of the parsed rows, a
   confirm button, and the report or the named error. It must be usable on a
   phone.

## Done when

1. Pasting the same text twice adds rows once. The API test proves it.
2. A paste that overlaps the stored tail adds only the new rows.
3. A paste that leaves a gap is refused, and the error states the unexplained
   amount.
4. An overlapping row whose fields differ is refused, and the error names it.
5. The paste screen shows the preview and the report. A web test proves it.
6. Gates green.

## Log

- 2026-10-02 — Built: migration 1 (`statement_imports`, `statement_rows`, a unique
  index on a row's identity and on `seq`), `importStatement` in
  `api/src/statements.ts`, `POST /api/statements` (`ROUTES.statements`) behind
  the identity check, and the paste screen in `web`. Contract: `ImportStatementRequest`
  and `ImportStatementReport` (`rowsAdded`, `rowsAlreadyPresent`,
  `tailBalanceCents`), and two codes, `STATEMENT_ROW_CONFLICT` and
  `STATEMENT_BEFORE_HISTORY`, both 422 in `api/src/http-errors.ts`.
  - **The suite passes.** `npm test -- --project ledger` → `Test Files 13 passed
(13)`, `Tests 179 passed (179)`; the four files this ticket touches,
    `npx vitest run` on `api/test/statements.test.ts`, `schema.test.ts`,
    `http-errors.test.ts` and `web/test/statement-paste.test.tsx` → `Tests 42
passed (42)`. `npm run check` exit 0.
  - **The tests can fail.** Each mutation was applied to `api/src/statements.ts`
    alone, run with `npx vitest run tools/ledger/api/test/statements.test.ts`:
    dropping `category` from the compared fields fails 1 of 20 (the category
    conflict); deleting the gap check fails 2 of 20 (both gap tests); setting
    `firstNew = 0` instead of the overlap's length fails 3 of 20 (the repeat, the
    overlap, the paste inside the history). In `StatementPaste.tsx`,
    `importStatement(text)` → `importStatement(text.trim())` fails 1 of 8 in
    `tools/ledger/web`. Reverting `detailKeys` in `server.ts` to
    `details: appError.details` fails the log test, 1 of 21.
  - **Chaining, as decided.** The anchor is the first paste into an empty
    database. After that, the oldest paste row that is already stored is found by
    identity; from there every row up to the stored tail must equal the stored
    row in its place, all five fields (identity leaves out the category, so the
    category is compared on purpose); what is left is new and takes the next
    `seq`s. A paste with nothing stored must open from the stored tail's balance.
    One `IMMEDIATE` transaction, so two pastes cannot both extend the same tail.
  - **A gap reuses `STATEMENT_CHAIN_BROKEN`**, with `details.unexplainedCents`
    the same as lg-1's in-paste break (signed: money out is negative), rather
    than a code of its own: it is the same proof failing one boundary further
    out, and the UI says "how much went missing" the same way for both.
  - **Two codes the brief did not name.** `STATEMENT_ROW_CONFLICT` is brief item
    4 (it names the stored and the pasted row, and the fields that differ).
    `STATEMENT_BEFORE_HISTORY` is a case the brief left out: a paste that reaches
    back before the oldest stored row (all older, or older and overlapping). Rows
    are numbered from the oldest and a stored row is never renumbered, so older
    history cannot be added in front; it is refused saying so, not reported as a
    "gap" with a meaningless amount. Backfilling older history is not built.
  - **Two rows that cannot be told apart** (the same date, description, amount
    and balance, which the analysis says cannot occur but a zero-amount pair
    does) would have met the unique index as a 500. They are refused as
    `STATEMENT_ROW_CONFLICT` instead (`two rows that cannot be told apart`).
  - **An empty paste** (lg-1 left it open) is a `BAD_REQUEST`, `400`, saying the
    paste holds no statement rows; an empty or missing `text` is the same.
  - **The body cap went from 64 KiB to 1 MiB** (`api/src/server.ts`, which had
    left this to the first route that takes a body). 500 synthetic rows measure
    70 865 bytes (about 140 each, a real description is longer) and the account
    makes about a hundred rows a year, so the old cap held a few years at best
    and the first paste may be the whole history. `a paste bigger than the old
64 KiB body cap is stored` holds it.
  - **Error details no longer reach the log as values.** lg-1's gate 1 dropped a
    finding saying the details carry the row's description and that "whether they
    reach a log is lg-2 to decide". They did: the error handler logged
    `details: appError.details` on every 4xx, so a refused paste put a bank row's
    description, amount and balance in the log. It now logs `detailKeys`, the
    names only; the response body is unchanged. The rule is written in
    `tools/ledger/CLAUDE.md`.
  - **`web` parses the preview itself**, with `@ledger/books`' `parseStatement`
    (pure, no node dependency), so the preview is exactly what the API will
    parse and there is no preview route to keep in step. The consequence is that
    the preview shows what the paste _says_, not how it chains onto what is
    stored: that answer is the confirm's, and a refusal keeps the text and the
    preview on screen. `web` and `api` now each declare `@ledger/books`;
    `package-lock.json` carries both lines (by hand) and
    `node scripts/check-lockfile-sync.mjs` → `up to date`; the Dockerfile has the
    manifest and `dist` pair, as lg-1's Log said the first importer would need.
  - **Fold-in considered.** Nothing that was already specified was made free
    by this work. The `README.md` still opens "A scaffold"; it is not touched,
    because rewriting the tool's status line is a decision about what "scaffold"
    still means once lg-3 and this have landed, not a sentence this ticket
    makes stale on its own. `tools/ledger/CLAUDE.md`'s own opening was updated.
  - **Merged records' citations.** The first draft moved five of them. lg-1
    cites two lines of `http-errors.test.ts`, which a longer `STATEMENT_CODES`
    list shifted, and one line of the tool's `CLAUDE.md`, which two new paragraphs
    above it shifted. Both were made line-neutral (the new codes got a block at
    the end of the test file; the new rules went to the end of `CLAUDE.md`), and
    `node scripts/citations.mjs` on lg-1's record went from `3 moved` to
    `1 moved`, the one already moved on `main` (the cited paragraph sits three
    lines below where the record says). Two of lg-3's could not be: the line of
    `Person` in the contract's `api.ts` (a route added to `ROUTES` above it) and
    the line of `registerNotFoundHandler` in `api/src/server.ts` (the body cap, the
    log fields and the new route, all above it). Both are repointed in lg-3's
    record, to one line later and eleven lines later; `node scripts/citations.mjs`
    on that record → `50 verified, 0 moved`.
  - **Not measured.** The paste screen was exercised in jsdom only; no real
    phone, no browser, and no running image (`.github/workflows/ledger.yml`
    owns the image). The mobile claim rests on the CSS (single column, 16 px
    textarea, 2.75 rem buttons) and has not been seen on a device.

- 2026-10-02 — After gate 1 (FAIL at `c214024`, nine findings). The entries above are
  left as written; where this one contradicts them, this one is right. Four
  decisions were the owner's, each put through AskUserQuestion on 2026-10-02.
  - **Decision 1 — F1, a row's identity is not unique.** The question: the
    brief's identity (date, description, amount, balance) repeats when a transfer,
    its reversal and the transfer again fall on one day, so a paste was silently
    dropped (a 200 with `rowsAdded: 0`) and the stretch could never be stored.
    Options: (A) keep the identity index and refuse the ambiguous case, correcting
    the analysis sentence; (A+B) A, plus, before migration 1 ships, drop the
    identity unique index, keep `seq` unique and match an overlap by position;
    (C) accept and document. **Chosen: A+B**, which **overrode the recommendation
    of the gate and the orchestrator, A alone.** **Build step 1's "unique index
    on [the identity]" is superseded by this decision**; the brief is not
    rewritten. Migration 1 now has `UNIQUE (seq)` and a plain index over the
    four fields (a lookup, not a constraint), and `docs/00-ANALYSIS.md`'s false
    sentence ("two rows identical in all four fields cannot occur") is corrected.
    lg-7's Build step 4 carries a note of what this means for the import.
  - **Decision 2 — F3, older history.** The question: `CHECK (seq >= 0)` and a
    next `seq` of the row count mean the first paste is the start of the books,
    and lg-7 imports the workbook since 2022 after pastes are stored. Options:
    (a) keep as built and tell lg-7; (b) before migration 1 ships, drop the check
    and take the next `seq` from the maximum plus one, keeping the refusal of an
    older paste; (c) order rows by something other than one global position.
    **Chosen: (b), the gate's recommendation.** `statement_rows.seq` is a
    position that may be negative, a new row takes the highest stored position
    plus one, and `STATEMENT_BEFORE_HISTORY` stays. lg-7's Build step 4 says so.
  - **Decision 3 — F4, the body cap.** The question: 1 MiB was set, but an
    over-cap body answered 400 `BAD_REQUEST` "The request could not be
    understood", so the person was not told the paste is too long. Options: (a)
    accept as built, the 400 being pl-51's shared rule; (b) also answer an
    over-cap body with core's `SIZE_LIMIT_EXCEEDED`. **Chosen: (b) ("also map
    oversize"), which overrode the recommendation, (a).** `api/src/http-errors.ts`
    maps Fastify's `FST_ERR_CTP_BODY_TOO_LARGE` to it, 413, with copy saying the
    paste is too long. The copy is replaced at the raise site because core's
    default speaks of a _result_; the repo's rule reads a replaced message as the
    sign of a wrong code, so this is recorded as the owner's choice rather than
    as a code that fits cleanly.
  - **Decision 4 — F5, an empty paste.** The question: it is `BAD_REQUEST` with
    its copy replaced at the raise site, which the root rule reads as the wrong
    code. Options: (a) keep it, since the screen refuses an empty paste before
    sending; (b) a ledger code, a contract change. **Chosen: (a), the
    recommendation.** Kept as built: an empty paste is the request being wrong,
    not a statement that fails a proof, and a new code would be a contract
    change for a case a person using the screen cannot reach.
  - **F1 reproduced, then fixed.** The gate's probe (`probe.test.ts.keep`) at
    `c214024`: stored `X +10.00 (60.00)` and `Retour −10.00 (50.00)`, then paste
    `X` alone → `200 {"rowsAdded":0,"rowsAlreadyPresent":1,"tailBalanceCents":5000}`
    with the row not stored; the whole `X, Retour, X` paste → 422
    `STATEMENT_ROW_CONFLICT` ("cannot be told apart"). At the new head the same
    probe gives `X, Retour, X` → `200 rowsAdded 3`, and `X` alone → 422
    `STATEMENT_ROW_CONFLICT` naming both readings (`1 already stored and 0 new,
or 0 already stored and 1 new`), nothing stored. **That second result is
    a refusal, not a store, on purpose:** the paste opens from the stored tail
    _and_ is the stored first row, which is the ambiguity decision 1 says to
    refuse (the first draft of the new test expected a 200 and was wrong about the
    decision). Pasting `Retour, X` from 60.00 stores the `X` (1 added, 1 present),
    and a longer stretch that starts on an earlier row settles any such case.
    - **How a paste is read now** (`api/src/statements.ts`). The paste's oldest
      `k` rows must equal the stored tail's last `k`, all five fields, with
      `k = 0` meaning it opens from the tail's balance; a paste wholly inside the
      history is every row already stored. The set of readings is computed; one
      is stored, none is the gap, older-history or conflict error it was, and
      two or more that would store different rows are refused. `Done when` 1 and
      2 keep their meaning; the cost is that a paste of rows the history holds
      twice over (`X, Retour, X` pasted again over a stored `X, Retour, X`) is
      refused rather than guessed at.
    - **Left unstorable, on purpose.** A stored history that is only `X, Retour`
      cannot be extended by pasting `X, Retour, X, Y` (the same ambiguity); the
      way out is a stretch starting on an earlier row, which an account whose
      first row is that `X` does not have. Rare, and the refusal names why.
  - **F2 reproduced, then fixed.** Stored `Depot +5.00 (15.00)`, then paste
    `Retrait −5.00 (10.00)`: at `c214024` 422 `STATEMENT_BEFORE_HISTORY`, one row
    stored; now 200, 1 added, tail 10.00. A continuation is read before anything
    is asked about older history.
  - **F6, fixed.** Stored rows 3 to 7, paste rows 0 and 1: at `c214024` 422
    `STATEMENT_CHAIN_BROKEN` with 749.49 $ "unexplained"; now
    `STATEMENT_BEFORE_HISTORY`. A paste that shares nothing with the history and
    ends before the oldest stored row's date, or on the balance that row opened
    from, is older history; only one that does neither is a gap.
  - **F7, partly fixed.** Another connection holding the write lock: at
    `c214024` 5086 ms then 500 `INTERNAL`. Now `SQLITE_BUSY` is caught in
    `importStatement` and answered as core's `TIMEOUT` (504, retryable, "the
    database was busy, try the paste again"): probe `P5b` → `504 TIMEOUT`, 5009 ms,
    and the retry 200. **The 5 s block is not fixed and is out of scope**: the
    driver is synchronous, so waiting on a lock holds the event loop, and
    avoiding it means a second connection or a worker thread, a design change
    for a case nothing in the app produces (a backup or an operator's shell
    can). The test sets `busy_timeout` to 50 ms so it does not wait.
  - **F8, fixed.** Two tests added in `web/test/statement-paste.test.tsx` for the
    no-rows refusal and Paste another. Removing `setText("")` from `startOver`
    and rewording the no-rows message each fail one of them (2 of 10).
  - **F9, corrected.** The first entry's mutation counts said "of 20" for
    `api/test/statements.test.ts`; the file held 21 then, and the `firstNew = 0`
    run measured 3 failed of 21.
  - **The tests can fail.** The new and rewritten tests were run against
    `c214024`'s `statements.ts`, `schema.ts` and `http-errors.ts` (checked out
    for the run, restored after): `npx vitest run` on `statements.test.ts` and
    `schema.test.ts` → `Tests 15 failed | 24 passed (39)`; against the new
    source, `Tests 39 passed (39)` in the same two files. The 15 are the schema's
    two (identity not unique, negative position), the twin rows, the silent drop,
    `Retour, X`, the whole stretch, the continuation that starts on a held row,
    the ambiguity refusal, the longer stretch, the twice-over refusal, the
    continuation that ends on the opening balance, the older paste, the next
    position, the oversize body and the busy database. One new test (a row before
    a shared stretch that is not the stored one) passes on both: it holds the
    old behaviour through the rewrite.
  - **Gates at this head.** `npm test -- --project ledger` exit 0, `Test Files 13
passed (13)`, `Tests 195 passed (195)`; `npm run check` exit 0; `node
scripts/citations-gate.mjs --against 24acb04` exit 0, `144 enforced, 0
failing`, `0 raised`. The probe's `P3d` case throws in its own reading of
    `.error.code` now, because one of its three pastes succeeds: that is the fix,
    and the three are asserted in `statements.test.ts` instead.
