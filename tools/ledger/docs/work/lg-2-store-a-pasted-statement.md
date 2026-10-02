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
  - **Not measured.** The paste screen was exercised in jsdom only; no real
    phone, no browser, and no running image (`.github/workflows/ledger.yml`
    owns the image). The mobile claim rests on the CSS (single column, 16 px
    textarea, 2.75 rem buttons) and has not been seen on a device.
