---
id: lg-2
tool: ledger
title: Store a pasted statement, chained onto what is already stored
kind: work-package
status: done
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

## Review

### Gate 1

**Gate: FAIL** — 2026-10-02 · `24acb04...c214024` (`origin/main` still at `24acb04` after fetch) · code-review at medium · unpinned coordinates re-resolved at `38bc60e`

Re-issued at `38bc60e` with gates 2 to 4, words, rows and verdicts unchanged: every coordinate is re-resolved there, and the five code citations whose text the round under gate 2 deleted or whose claim it corrected (three in `api/src/statements.ts`, one each in `api/src/db/schema.ts` and `contract/src/errors.ts`) are prose naming `c214024`.

| Done when                                              | Proof                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Same text twice adds rows once                      | `tools/ledger/api/test/statements.test.ts:169 "rowsAlreadyPresent: 6,"` and `tools/ledger/api/test/statements.test.ts:175 "expect(imports).toEqual({ n: 1 });"` ✓ — red with `firstNew = 0` (3 of 21 fail)                                                                                                                                            |
| 2. Overlap adds only the new rows                      | `tools/ledger/api/test/statements.test.ts:187 "rowsAlreadyPresent: 2,"` and `tools/ledger/api/test/statements.test.ts:194 "row.import_id)).toEqual"` ✓ — red with `firstNew = 0` (3 of 21) and with the next seq off by one (4 of 21)                                                                                                                 |
| 3. Gap refused, error states the unexplained amount    | `tools/ledger/api/test/statements.test.ts:243 "unexplainedCents: missing"` and `tools/ledger/api/test/statements.test.ts:245 "395.00 $ is unexplained"` ✓ — red with the sign flipped (2 of 21) and with the refusal removed (3 of 21)                                                                                                                |
| 4. Overlapping row with other fields refused and named | `tools/ledger/api/test/statements.test.ts:276 "stored: { seq: 4, category:"` and `tools/ledger/api/test/statements.test.ts:277 "pasteIndex: 1, category:"` ✓ — red with the category ignored (1 of 21) and with the details and message emptied (1 of 21)                                                                                             |
| 5. Paste screen shows preview and report, web test     | `tools/ledger/web/test/statement-paste.test.tsx:70 "-700.00 $"` and `tools/ledger/web/test/statement-paste.test.tsx:88 "1 already stored"` ✓ — red with the preview order and the report wording changed (2 of 5)                                                                                                                                     |
| 6. Gates green                                         | **verified** locally: `npm run check` exit 0; `npm test` 3756 passed, 2 skipped (3758) at the head against 3722, 2 skipped (3724) at the base, +34, no test line deleted; `node scripts/citations-gate.mjs --against 24acb04` exit 0, 144 enforced, 0 failing. **unproven (gate)** for the image, which `ledger.yml` builds and this gate did not run |

- **high** · (F1, two findings, one mechanism) The row identity the brief prescribes is not unique, and the analysis sentence it rests on is false: `tools/ledger/docs/00-ANALYSIS.md@24acb04:104 "four fields cannot occur, because the balance moved"`. A transfer, its reversal and the transfer again on one day (+10.00, −10.00, +10.00, one description) gives two rows with the same date, description, amount and balance. Measured with a throwaway spec at `c214024`: (a) **a row is dropped with a 200**: store `X +10.00 (60.00)` and `Retour −10.00 (50.00)`, then paste `X +10.00 (60.00)` alone, a true continuation from 50.00: 200, `rowsAdded 0, rowsAlreadyPresent 1`, tail still 50.00, the row not stored, because the identity lookup at `const overlapAt = rows.findIndex` in `statements.ts` at `c214024` takes it for the stored one. (b) **the stretch can never be stored**: pasting `X, Retour, X, Y` whole is refused `STATEMENT_ROW_CONFLICT` by the twin check, `seen.has(key)` in `statements.ts` at `c214024`; with X and Retour stored, a paste from the second X conflicts and one after it is a gap, so every later paste is refused. The Log's twin entry names only a zero-amount pair. lg-7 leans on the same identity (`tools/ledger/docs/work/lg-7-import-the-workbook.md@24acb04:41 "Where a pasted row covers the same"`). **Open decision**: (A) keep the identity index, and refuse the ambiguous case — the paste's oldest row matches a stored row and also opens from the stored tail — as a conflict naming both readings, correcting the analysis sentence; (b) stays unstorable. (B) before migration 1 ships, drop the identity unique index, keep `seq` unique and match an overlap by position, refusing ambiguity as in A; this departs from brief Build 1. (C) accept and document the limit. Recommend A in this branch, which closes the silent drop in a few lines, and B put to the owner before migration 1 ships, after which it costs a migration 2.
- **med** · (F2) A valid continuation is refused as older history. The test `newest.balanceCents === head.balanceCents - head.amountCents` in `statements.ts` at `c214024` runs before the continuation test, so a paste that opens exactly from the stored tail and ends on the balance the stored history opened from is refused. Measured: store `Depot +5.00 (15.00)` from 10.00, paste `Retrait −5.00 (10.00)`: 422 `STATEMENT_BEFORE_HISTORY`, nothing stored. A balance returning to an earlier figure, zero most plainly, is ordinary. Remedy: accept a paste whose oldest row opens from the tail before asking whether it ends at the head.
- **med** · (F3, open decision, shape-level) Older history can never be added, a product choice the brief does not make, and a ready sibling needs the opposite. `STATEMENT_BEFORE_HISTORY` (its message in `contract/src/errors.ts`) and `CHECK (seq >= 0)` in migration 1, both at `c214024`, make the first paste the start of the books, and the next `seq` is the row count, which holds only while `seq` is dense from 0. lg-7 imports the workbook since 2022 as statement rows, after P2's pastes are stored (`tools/ledger/docs/work/lg-7-import-the-workbook.md@24acb04:40 "Rows go in as statement rows"`). Options: (a) keep as built and write into lg-7's Build that older rows need a table rebuild or must land before the first paste; (b) before migration 1 ships, drop the `seq >= 0` check and take the next `seq` from the maximum plus one, so older rows can later be numbered below the oldest, keeping this ticket's refusal for pastes; (c) order rows by something other than one global position. Recommend (b): free now, a table rebuild later. Whichever is chosen goes into lg-7's Build in this pull request.
- **low** · (F4, open decision) The body cap went from 64 KiB to 1 MiB, `tools/ledger/api/src/server.ts:59 "const MAX_BODY_BYTES = 1024 * 1024;"`; the base left the size to this route (`tools/ledger/api/src/server.ts@24acb04:52 "decides whether this is enough"`) and the comment gives the arithmetic. Measured: 1 MiB plus 10 bytes answers 400 `BAD_REQUEST`, "The request could not be understood.", so the person pasting is not told the paste is too long. Options: (a) accept 1 MiB as built; (b) also answer an over-cap body with core's `SIZE_LIMIT_EXCEEDED`, already 413 here, and copy that says so. Recommend (a): the 400 is pl-51's shared rule, and changing it is its own ticket.
- **low** · (F5, open decision) An empty paste is `BAD_REQUEST` with its copy replaced at the raise site, `tools/ledger/api/src/statements.ts:116 "The paste holds no statement rows."`, which the root rule reads as the wrong code. Options: (a) keep it, since the screen refuses an empty paste before sending; (b) a ledger code for it, a contract change. Recommend (a).
- **low** · (F6) An older paste that stops short of the stored head is reported as a gap with a meaningless amount: store rows 3 to 7, paste rows 0 and 1: 422 `STATEMENT_CHAIN_BROKEN`, 749.49 $ unexplained where one row of −700.00 $ is missing, and the message advises a longer overlapping paste, which then meets `STATEMENT_BEFORE_HISTORY`. The Log's "not reported as a gap with a meaningless amount" holds only for a paste ending exactly at the head.
- **low** · (F7) `nfr:reliability`: a write lock held by another connection blocks the whole server for the 5 s busy timeout, the driver being synchronous, then answers 500 `INTERNAL` (measured 5086 ms, 500; the retry 200). Nothing in the app opens a second connection; a backup or an operator's shell would.
- **low** · (F8) Two branches of `StatementPaste.tsx` have no test: the no-rows refusal and the Paste another button.
- **low** · (F9) The Log's mutation counts say `of 20` for the API spec, which holds 21 (`firstNew = 0` measured 3 failed, 18 passed, 21).
- **dropped** · the overlap loop compares the paste's rows from index 0, not from the first stored one; every path where those differ throws first. Not a defect.
- **dropped** · a 500's log line carries no cause: so at the base, out of range.
- **findings** · code-review at medium returned 12; 10 carried in 9 bullets (F1 is two), 2 dropped.
- Probes, all at `c214024`: a paste wholly inside the history, at its head or its middle, 200 with 0 added and 3 present; a paste reaching before the oldest and past the tail, 422 `STATEMENT_BEFORE_HISTORY`, nothing stored; two same-day same-amount rows with distinct balances stored, then 0 added on repeat; empty text, whitespace and newlines only, all 400; two overlapping pastes at once on one app, both 200, ten rows. Logs: two sites reach a statement, the error handler's `info` and `error`, and both carry `detailKeys` only (`tools/ledger/api/src/server.ts:157 "detailKeys: Object.keys"`); the log test went red with the details or the message added. Records: lg-3's two repoints are coordinate-only, anchors unchanged at `736aa7a`, `24acb04` and the head, which is the repair the tool's own advice names for moved text; lg-1's one `MOVED` was already moved at the base. Packaging: `@ledger/books` is declared by `api` and `web`, the Dockerfile has its manifest and `dist` lines, and the closure test went red with either removed.
- NFR: security ✓ · performance ✓ · reliability — F1, F7 · maintainability — F3, F8.

### Gate 2

**Gate: CONCERNS** — 2026-10-02 · `c214024..b189ceb` only (`origin/main` still at `24acb04`) · re-gate of F1 to F9 and the lines the round touched · unpinned coordinates re-resolved at `38bc60e`

Re-issued at `38bc60e` with gates 3 and 4, words, rows and verdicts unchanged: every coordinate is re-resolved there, and the two code citations whose text the round under gate 3 deleted or whose claim it corrected (one each in `api/src/statements.ts` and `api/src/http-errors.ts`) are prose naming `b189ceb`.

The owner decided four findings on 2026-10-02: F1 A+B, F3 (b), F4 also map oversize, F5 keep. Of the round's 16 new or rewritten API tests, 15 fail against `c214024`'s `statements.ts`, `schema.ts`, `http-errors.ts` and contract source and pass at the head (15 failed, 24 passed of 39 there; 39 of 39 here); the 16th holds old behaviour through the rewrite. The ledger project is 13 files and 195 tests, `npm test` 3772 passed and 2 skipped (+16 on gate 1), `npm run check` exit 0. Two existing tests changed meaning, both by decision 1: the schema test now asserts the four fields may repeat, and the twin-row test expects both rows stored.

| Finding | Verdict                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 high | **fixed** as decided (A+B). Ambiguous readings are refused at `tools/ledger/api/src/statements.ts:147 "throw ambiguous(oldest, rows.length, found)"`; taking the first reading there instead fails 3 of 34. Probes: `X, Retour, X` in one paste 200, 3 added; `X` alone after `X, Retour` 422 naming both readings, nothing stored; `X, Y` after it 200, 2 added |
| F2 med  | **fixed**: a continuation is read before older history; the probe now answers 200, 1 added                                                                                                                                                                                                                                                                       |
| F3 med  | **fixed** as decided (b): `seq` may be negative and the next is `tools/ledger/api/src/statements.ts:159 "coalesce(max(seq), -1) + 1"`; lg-7's Build carries the note                                                                                                                                                                                             |
| F4 low  | **fixed** as decided: 413 `SIZE_LIMIT_EXCEEDED` for a JSON body, a streamed body with no length, a declared 2 MiB length and a `text/plain` body. Costs below, in G4                                                                                                                                                                                             |
| F5 low  | **kept** as decided; the Log's Decision 4 entry records the question, the options and the choice                                                                                                                                                                                                                                                                 |
| F6 low  | **fixed**: an older paste stopping short of the head is now `STATEMENT_BEFORE_HISTORY`. G2 is the new edge of the same test                                                                                                                                                                                                                                      |
| F7 low  | **partly fixed**: 500 became 504 `TIMEOUT`, retryable; the 5 s event-loop block remains (measured 5031 ms), which the Log names out of scope                                                                                                                                                                                                                     |
| F8 low  | **fixed**: two web tests; deleting the box reset and rewording the no-rows copy fails both (2 of 7)                                                                                                                                                                                                                                                              |
| F9 low  | **fixed** in the Log                                                                                                                                                                                                                                                                                                                                             |

- **low** · (G1, open decision) How often a realistic paste is refused as ambiguous, measured rather than judged. Two readings both fit in exactly two shapes: the stored rows a paste repeats at its start add up to zero, so it also opens from the stored tail's balance (a deposit and the payment it covers, pasted again from the deposit); or a run of rows repeats itself at the tail (`X, Retour, X`). A throwaway simulation drove `importStatement` over synthetic 20-month histories, every paste from up to 25 rows before a stored tail to 25 after it across 25 tails, every paste wholly inside the history, and every window of 1 to 34 rows pasted twice. Ordinary months (transfers in, mortgage, insurance, groceries, fees): 0 refused of 11 475 overlapping pastes, 424 repeats and 510 inside pastes, and no wrong answer. Add an exact monthly top-up (a deposit of the mortgage amount, then the mortgage): 78 of 14 175 overlapping pastes, 8 of 478 repeats and 3 of 630 inside pastes refused, each one whose stored overlap is exactly that pair; no wrong answer. The window `tools/ledger/api/src/statements.ts:232 "const window = latest(db"` compares fields and balances and never dates, so with the deposit a day before the mortgage every one of those refusals has a second reading that would book an earlier-dated row after the stored tail; with both on one day, none does. Options: (a) leave it as built; (b) drop a reading whose first new row is dated before the stored tail, which first needs the parser to refuse a paste whose dates run backwards, since it takes the listed order and never checks dates (`tools/ledger/books/src/statement.ts@24acb04:11 "the parser never sorts by date"`). Recommend (a): the refusals measured are the net-zero pair alone, and the message says how to settle them.
- **low** · (G2) A gap dated after the stored history is called older history when it ends on the balance the history opened from: the older-history test in `statements.ts` at `b189ceb` (`newest.date < head.date`, or the balance alone) asks for either condition, not both. Measured: store `Depot +5.00 (15.00)` dated 2026-10-01 from 10.00, then paste `Achat −2.00 (10.00)` dated 2026-10-05, opening from 12.00: 422 `STATEMENT_BEFORE_HISTORY`, where `−3.00` is unexplained. Still refused; the advice is wrong.
- **low** · (G3) The Log entry "Left unstorable, on purpose" says a stored `X, Retour` cannot be extended without a stretch starting before `X`. The branch's own test extends it by pasting from the reversal (`tools/ledger/api/test/statements.test.ts:466 "of([RETOUR, X], 6000)"`), and probe `X, Y` from 50.00 stores 2 rows. Only `X` pasted alone, or a paste that repeats the stored pair whole, stays refused.
- **low** · (G4) F4's costs beyond the replaced copy. Core files `SIZE_LIMIT_EXCEEDED` under artifacts as an output size (`packages/core/src/errors.ts@24acb04:145 "Output would exceed the configured"`), so the ledger now uses it for a request size that core's taxonomy does not name. The sentence The paste is too long to store in one go, in `http-errors.ts` at `b189ceb`, sits in the tool-wide mapper, so every body over the cap on any route, present or future, is called a paste; today one route takes a body. 413 is the right status for both readings. For F7, core's `TIMEOUT` copy (`packages/core/src/errors.ts@24acb04:188 "The operation took too long and was stopped."`) already describes a lock wait past the busy timeout, so its replacement at `tools/ledger/api/src/statements.ts:124 "database was busy. Try the paste again."` is wording, not a code mismatch. Its `retryable: true` reaches a web client that never reads `retryable`. Whether Cloudflare passes an origin 504 through or shows its own page is unverified (WebFetch is blocked here).
- **low** · (G5) lg-7's note goes past recording. Its second bullet records decision 2. Its first, labelled not new work, also sets a behaviour for the import, refusing an ambiguous reading (`tools/ledger/docs/work/lg-7-import-the-workbook.md:50 "the import refuses rather than guessing"`), and redefines the existing "must agree" as a comparison by position. That is a design constraint on lg-7 written from lg-2. The analysis edit (`tools/ledger/docs/00-ANALYSIS.md:102 "A row has no identity of its own."`) records decision 1 and adds no work.
- Done when 1 under A+B: no paste stored a row twice in any probe or simulation run. A second paste of the same text is refused instead of being a no-op when its rows add up to zero (8 of 478 in the top-up model, 0 of 424 in the ordinary one), when its first rows repeat its last ones (`X, Retour, X`), or when it is one zero-amount row. Otherwise it answers 200 with every row already present.
- Probes re-run at `b189ceb`: inside the history 200 with 0 added; reaching back 422 `STATEMENT_BEFORE_HISTORY`; empty 400; two posts at once both 200 with ten rows; a 5000-row paste stored in 82 ms and pasted again in 91 ms.
- **findings** · re-gate at medium returned 6; 5 carried, 1 dropped.
- **dropped** · the readings loop copies a prefix per overlap length, quadratic in the paste; measured at 5000 rows it costs 91 ms. Not a defect.
- NFR: security ✓ · performance ✓ · reliability — F7 remainder, G2 · maintainability — G4, G5.

### Gate 3

**Gate: CONCERNS** — 2026-10-03 · `b189ceb..1234701` only (`origin/main` still at `24acb04`) · re-gate of G1 to G5 and the lines the round touched · unpinned coordinates re-resolved at `38bc60e`

Re-issued at `38bc60e` with gate 4, words, rows and verdicts unchanged: every coordinate is re-resolved there, and the one code citation whose text the round under gate 4 rewrote (in `api/src/statements.ts`) is prose naming `1234701`.

The owner decided on 2026-10-02: G1 left as built, F7's remaining block accepted and noted, G4's sentence moved to the route, G5 kept and relabelled. The round's 3 new tests fail against `b189ceb`'s `api/src` (3 failed, 46 passed of 49) and pass at the head; `npm test` 3775 passed and 2 skipped (+3), `npm run check` exit 0. The verdict rests on gate 1's image row, still unproven (gate); nothing this round is above low.

| Finding      | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1           | **closed** by decision 5. Re-run at the head the simulation gives gate 2's counts exactly, with no wrong answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G2           | **fixed**, and the builder's refutation of the relayed remedy holds: requiring both conditions would turn F6's older paste, which ends on another balance, back into a gap. The balance clause now holds only on the head's own day (`newest.date === head.date && newest.balanceCents` in `statements.ts` at `1234701`). Measured: G2's case 422 `STATEMENT_CHAIN_BROKEN`, −3.00 unexplained; the day before the head, on its opening balance or another, `STATEMENT_BEFORE_HISTORY`; the head's day on its opening balance, and a paste on that day running into the head, `STATEMENT_BEFORE_HISTORY`. H1 is the edge left                                                                                                                                                               |
| G3           | **fixed**: the Log bullet is rewritten in place and marked corrected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| G4           | **fixed** as decided. The mapper says `tools/ledger/api/src/http-errors.ts:93 "The request is too large."` unless the route declared a sentence, and only `tools/ledger/api/src/routes/statements.ts:23 "app.post(ROUTES.statements, { config }"` does; the handler reads it at `tools/ledger/api/src/server.ts:139 "request.routeOptions.config.tooLargeMessage"`. Fastify refuses an oversize body after routing, so the route's options are there: the paste sentence on all four oversize shapes (JSON, a stream with no length, a declared 2 MiB, `text/plain`); the generic one on a POST to `/api/nope`, `/api/me`, `/api/health` and `/`, the not-found route's empty options; and 403 before any body is read without an identity. Removing the route's declaration fails 1 of 35 |
| G5           | **fixed** as decided: `tools/ledger/docs/work/lg-7-import-the-workbook.md:43 "A constraint on this ticket"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F7 remainder | **closed** by decision 6 and noted in the Log; 5017 ms measured at the head                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

- **low** · (H1) A paste dated on the oldest stored row's own day and ending on another balance is called a gap, even when the history runs past that day so the paste cannot follow the tail. Measured: history `Depot H +5.00` on 2026-10-10 from 10.00 and `Achat T −1.00` on 2026-10-20, then paste `Achat O −0.50 (9.50)` dated 2026-10-10: 422 `STATEMENT_CHAIN_BROKEN`, −4.00 unexplained, F6's shape on the head's day. Still refused; the advice is wrong. Remedy: a paste dated no later than the head's day and before the tail's is older history. With a history of one day, a paste on it ending on the head's opening balance fits both older history and a gap and is called older history; either label is defensible. It does not hold the landing.
- **low** · (H2) Decision 7's Log entry lists two of F7's costs, the `retryable` the web client never reads and the unverified Cloudflare 504, as costs of G4's mapping. Both belong to the 504 `TIMEOUT`, not to the 413.
- **low** · (H3) lg-3's merged record: the round repointed its `registerNotFoundHandler` citation to a bare line a second time (170, then 174). The anchor is at `tools/ledger/api/src/server.ts@24acb04:159 "function registerNotFoundHandler"`, the same line lg-3's gate read at `736aa7a`, and the `Person` citation the branch repointed is at `tools/ledger/contract/src/api.ts@24acb04:33 "export interface Person {"`. The lander should pin both to `@24acb04` with those lines, which restores the coordinates lg-3's gate read: content that predates the branch pins to a `main` commit that holds it, and a pin does not move when the next ledger branch edits either file. Dry-run: lg-3's record with both pins verifies, and the whole-corpus gate stays at 0 failing.
- **low** · (H4) For the landing: the ticket still says `status: ready` at `1234701`, and a `## Review` record on a `ready` ticket fails `node scripts/status.mjs --json` in CI and the status suite's reviewed-but-ready test. Measured: preflight over the three sections spliced with the status left `ready` exits 33 on those two, beside one planner web test that timed out under load and passes alone; with `status: done` set in the same splice it exits 0. The landing's first record commit has to set `status: done`.
- **dropped** · a malformed URL escape (`/api/%E0%A4%A`) answers Fastify's own 400 body, not the ledger's error shape; Fastify answers it before routing, so the error handler and the round's read never run. Out of range.
- **findings** · re-gate at medium returned 5; 4 carried, 1 dropped.
- Probes re-run at `1234701` give gate 2's results: inside the history 200 with 0 added; reaching back `STATEMENT_BEFORE_HISTORY`; `X` alone after `X, Retour` refused naming both readings; `X, Y` stores; a continuation ending on the opening balance 200; the busy database 504 `TIMEOUT` after 5017 ms, then 200; an oversize body 413 with the paste sentence; a 5000-row repeat 100 ms.
- NFR: security ✓ · performance ✓ · reliability — H1 · maintainability — H2, H3, H4.

### Gate 4

**Gate: CONCERNS** — 2026-10-03 · `1234701..38bc60e` only (`origin/main` still at `24acb04`) · re-gate of H1 and H2 · unpinned coordinates resolve at `38bc60e`

The owner chose on 2026-10-02 to fix H1 in this round rather than file it. The verdict still rests on gate 1's image row, unproven (gate); nothing open is above low.

| Finding | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1      | **fixed**: on the oldest stored row's day a paste is older history when the tail is on a later day, `tools/ledger/api/src/statements.ts:313 "newest.date < tail.date"`, and a one-day history is still told apart by the opening balance. `tools/ledger/api/test/statements.test.ts:705 "is older history when the history runs past that day"` fails against `1234701`'s `statements.ts` (1 failed, 39 passed of 40) and passes at the head (40 of 40). Gate 3's edge table re-run: the H1 case is now `STATEMENT_BEFORE_HISTORY`; the day before on either balance, the oldest row's day on its opening balance, a paste running into it, and a one-day history on its opening balance stay `STATEMENT_BEFORE_HISTORY`; after the history on its opening balance, and a one-day history on another balance, stay `STATEMENT_CHAIN_BROKEN` |
| H2      | **fixed**: Decision 7's entry is rewritten in place and marked corrected, and both costs now sit under decision 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| H3, H4  | the lander's: lg-3's two citations pinned at `24acb04`, and `status: done` in the first record commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

- No new finding in the round's lines; `api/src/server.ts` is untouched. `npm test -- --project ledger` 203 passed, `npm run check` exit 0.
- **findings** · re-gate at medium returned 0; 0 carried, 0 dropped.
- NFR: security ✓ · performance ✓ · reliability ✓ · maintainability ✓.

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
    - **Refused, on purpose, and settled by where the paste starts.** _(Corrected
      after gate 2, G3; the first draft said the history could not be extended at
      all, which the branch's own tests contradict.)_ With a stored `X, Retour`,
      `X` pasted alone and `X, Retour, X, Y` pasted whole are refused, since each
      fits as rows already stored and as new ones. The same rows are stored by
      starting the paste somewhere that fits one way: `Retour, X` from 60.00, or
      `X, Y` from 50.00 (`api/test/statements.test.ts`, "starting the same paste
      on the reversal" and "a continuation from the stored tail may start with a
      row the history already holds").
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

- 2026-10-02 — After gate 2 (CONCERNS at `b189ceb`; F1 to F9 closed except the
  F7 block). Four more decisions were the owner's, each through AskUserQuestion on
  2026-10-02; each matched the gate's and the orchestrator's recommendation, so
  none overrode anyone.
  - **Decision 5 — G1, how often an ambiguity refusal bites.** The question: the
    gate's simulation drove `importStatement` over synthetic 20-month histories
    and found 0 refusals in ordinary months (0 of 11 475 overlapping pastes, 424
    repeats and 510 inside pastes) and, where an exact monthly deposit covers a
    same-day or next-day mortgage payment, 78 of 14 175 overlapping pastes (0.55 %),
    8 of 478 repeats and 3 of 630 inside pastes, each one whose stored overlap is
    exactly that pair; no wrong answer. Options: (a) leave it as built; (b) drop a
    reading whose first new row is dated before the stored tail, which first needs
    the parser to refuse dates that run backwards. **Chosen: (a), the
    recommendation.** Dates are not used to settle a reading. Done when 1 therefore
    holds with this exception, measured and not argued: a second paste of the same
    text is refused, not a no-op, when its rows add up to zero (8 of 478 in the
    top-up model, 0 of 424 in the ordinary one), when its first rows repeat its
    last ones (`X, Retour, X`), or when it is one zero-amount row; otherwise it
    answers 200 with every row already present.
  - **Decision 6 — F7's remainder, the 5 s event-loop block.** The question: a
    write lock held past `busy_timeout` blocks the whole server for those 5 s
    (measured 5009 and 5031 ms) because the driver is synchronous. Options: fix
    it (a second connection or a worker thread), file it, or accept and note it.
    **Chosen: accept and note it as a known limit**: not fixed here and not filed.
    What is fixed is the answer: a retryable 504 `TIMEOUT` where it was a 500.
    Its costs, named by the gate: `retryable: true` reaches a web client that
    never reads it, and whether Cloudflare passes an origin 504 through or shows
    its own page is unverified.
  - **Decision 7 — G4, where the paste copy lives.** The question: "The paste is
    too long" sat in the tool-wide mapper, so a body over the cap on any route,
    present or future, was called a paste. Options: put the copy at the route; or
    leave it in the mapper. **Chosen: at the route.** `SIZE_LIMIT_EXCEEDED` and 413
    stay. The mapper's message is now "The request is too large." and
    `toErrorResponse` takes an optional `{ tooLargeMessage }`; a route declares its
    own sentence as `config: { tooLargeMessage }`, which the error handler reads
    from `request.routeOptions.config`. Only `routes/statements.ts` declares one. Tests:
    `http-errors.test.ts` ("a body over the cap": the default is generic and names
    no paste or statement; a declared sentence is used) and `statements.test.ts`
    (an oversize body on the statements route says "The paste is too long").
    The cost of the mapping the gate named and the owner accepted: core files
    `SIZE_LIMIT_EXCEEDED` under artifacts (an output size), so the ledger uses it
    for a request size that core does not name. _(Corrected after gate 3, H2: this
    entry first listed two more costs here, `retryable: true` on the 504 reaching a
    web client that never reads it, and whether Cloudflare passes an origin 504
    through being unverified. Those are costs of F7's `TIMEOUT` answer, not of the
    oversize mapping; both stand, under decision 6.)_
  - **Decision 8 — G5, lg-7's note.** The question: the first note in lg-7's Build
    step 4 was labelled "not new work" but sets a behaviour for the import
    (refuse an ambiguous reading; "must agree" compares rows by position).
    Options: keep it and relabel it; or drop that part. **Chosen: keep it and
    relabel it.** It now reads "A constraint on this ticket, following from lg-2's
    decision of 2026-10-02, which the import must meet"; the content is unchanged.
  - **G2 reproduced, then fixed.** Stored `Depot +5.00 (15.00)` dated 2026-10-01
    from 10.00, then paste `Achat −2.00 (10.00)` dated 2026-10-05, opening from
    12.00: at `b189ceb` 422 `STATEMENT_BEFORE_HISTORY` where −3.00 is unexplained.
    The older-history test took either condition (ends before the oldest stored
    row's day, or ends on the balance that row opened from). The balance clause is
    now only for the same day, so a later-dated paste is a gap: 422
    `STATEMENT_CHAIN_BROKEN`, `unexplainedCents: -300`. The older paste that stops
    short of the head (F6) and the one that ends exactly at it are both still
    older history. The test, appended in `statements.test.ts` ("older history, or
    a gap after the history"), failed before and passes after.
  - **G3, corrected.** The "Left unstorable, on purpose" bullet in the entry above
    is rewritten in place and marked as corrected: with a stored `X, Retour` only
    `X` alone and `X, Retour, X, Y` whole are refused; `Retour, X` from 60.00 and
    `X, Y` from 50.00 store.
  - **A merged record's citation moved again.** Reading the route's declared
    sentence in the error handler added lines above `registerNotFoundHandler` in
    `api/src/server.ts`, so lg-3's one citation of it is repointed once more, four
    lines later than the earlier repoint; `node scripts/citations.mjs` on lg-3's
    record → `0 moved`.
  - **The tests can fail.** `npx vitest run` on `statements.test.ts` and
    `http-errors.test.ts` with the new tests and the old source (`b189ceb`'s):
    `Tests 3 failed | 46 passed (49)`; the three are the two mapper tests and the
    gap-after-history test. With the new source, `npx vitest run tools/ledger/api`
    gives `Test Files 8 passed (8)`, `Tests 111 passed (111)`. The oversize-body
    test on the statements route passed on both: it holds the route's sentence
    through the move from mapper to route.

- 2026-10-03 — After gate 3 (CONCERNS at `1234701`; G1 to G5 closed, and the gate
  upheld the G2 refutation: requiring both conditions would have undone F6).
  - **Decision 9 — H1, fix now or file.** The question: a paste dated on the
    oldest stored row's day, ending on another balance, was called a gap even when
    the history runs past that day, so it cannot follow the tail; still refused,
    the advice wrong. Options: land and file a ticket; or fix it in one more round.
    **Chosen on 2026-10-02: fix it now, in one more round, which overrode the
    orchestrator's recommendation, to land and file.** The two other gate items,
    pinning lg-3's two citations at `24acb04` (H3) and setting `status: done`
    (H4), are the lander's and are not done here.
  - **H1 reproduced, then fixed.** Stored rows 3 to 7 (the oldest on 2026-09-12,
    the newest on 2026-10-01), paste one row dated 2026-09-12 from 10.00: at
    `1234701` 422 `STATEMENT_CHAIN_BROKEN`; now `STATEMENT_BEFORE_HISTORY`. A
    paste on the oldest row's day is older history when the tail is on a later
    day; with a one-day history the day cannot tell the two apart, so the balance
    the oldest row opened from does, as before. Gate 3's edge table, each row a
    test in `statements.test.ts` ("a paste that shares nothing with the history, by
    date", and "older history, or a gap after the history" for the first row):
    dated after the history on its opening balance → `STATEMENT_CHAIN_BROKEN`,
    −3.00; the day before the oldest row, on its opening balance and on another
    → `STATEMENT_BEFORE_HISTORY`; the oldest row's day, on its opening balance →
    `STATEMENT_BEFORE_HISTORY`; the oldest row's day, other balance, history
    spanning days → `STATEMENT_BEFORE_HISTORY` (the H1 case); a one-day history,
    paste ending on its opening balance → `STATEMENT_BEFORE_HISTORY`. "Oldest
    row's day, rows running into it" was already the straddling-paste test.
  - **The test can fail.** `npx vitest run tools/ledger/api/test/statements.test.ts`
    with the five new tests and `1234701`'s source: `Tests 1 failed | 39 passed
(40)`, the H1 case; with the fix, `Tests 40 passed (40)`. The other four are
    regressions held through the change, not red.
  - **H2, corrected.** Decision 7's entry listed two of F7's costs as costs of the
    oversize mapping. It is rewritten in place and marked corrected, and the two
    costs now sit under decision 6.
