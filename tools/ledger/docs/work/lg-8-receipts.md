---
id: lg-8
tool: ledger
title: Photograph a receipt, read it with a model, confirm, and file it
kind: work-package
status: done
milestone: P4
depends_on: [lg-3, lg-6]
difficulty: hard
---

# lg-8 — Photograph a receipt, read it with a model, confirm, and file it

**Packages:** a new `tools/ledger/receipts`, scoped `@ledger/receipts` — the
receipt reader, and the only package that talks to a model.

## Why

Receipts arrive both ways: on a personal card they are period lines, and on the
joint account's card they document a row that is already stored
([00-ANALYSIS.md §6](../00-ANALYSIS.md)). A model reads the photo when the
person asks it to, and a person confirms before anything is filed.

**Reads the total only.** Reading line items, taking out what is not shared,
and categorising are
[lg-10](./lg-10-receipt-items-exclusions-and-categories.md), which builds on
this ticket's seam.

## Build

1. **Measured — done 2026-10-12.** Fourteen real photos went through
   `ppu-paddle-ocr`, `tesseract.js` and two Claude models. The table and the
   owner's choice are on the Log: **Claude Haiku 5.5 alone, no local OCR.**
2. **`receipts`: one `ReceiptReader` seam, one implementation, the model.**
   - It takes its provider and model id as arguments, with `claude-haiku-5-5`
     as the default, and `api` reads the key. A tool never imports another
     tool, so this does **not** reuse the planner's provider. Load the
     `claude-api` skill before writing the call, rather than working from
     memory.
   - It returns a **list** of proposals, because one measured photo held two
     receipts side by side. Each is `{ merchant, date, subtotal, gst, qst,
total }` in cents, each field `null` when not read.
   - The photo goes as sent. The models read rotated photos without help, so
     there is no rotation step.
3. **The arithmetic check is pure and lives in `books`.** It checks subtotal +
   GST + QST = total, GST at 5 % and QST at 9.975 % of the taxable part, to the
   cent. It flags a proposal and never corrects one. A receipt with no tax
   lines, which is the measured case for zero-rated groceries, passes when
   subtotal equals total.
4. **Reading is a step the person takes.**
   - The screen names where the photo goes before it is sent, and nothing is
     sent silently.
   - The person can always type the proposal by hand instead, and the model is
     never called for that.
   - lg-10 extends this same call to items and categories.
5. **No reader classifies, computes a share or files anything.** Its output is
   a proposal the person edits.
6. `api`: upload a photo, and get the proposal back.
   - Store the image on the data volume, keyed by id. Never log it and never
     store it in a path taken from the request.
   - Cap the size.
   - Accept only image types, checked by content, not by extension.
7. **Filing:**
   - if a stored joint-account row matches the amount within a few days, offer
     it, and on confirmation attach the receipt to it;
   - otherwise it becomes a line in the open period for **the Access identity
     that uploaded it** (lg-3).
   - The measurement found two things filing must survive. A tip printed under
     the total (one receipt) makes the card charge differ from the total. A
     date missing from the photo (three of thirteen) means the proposal's date
     is `null`, and the form starts it at the upload date.
8. `web`, mobile first: the camera button, the "read it" step, which says the
   photo will leave the house, the proposal as an editable form, the match
   offer, and filing.
9. **Tests never call a real model.** A fake reader returns fixture proposals.
   The arithmetic check is tested on synthetic proposals.

## Done when

1. The measurement table is on the Log, and the owner's choice of engine is
   recorded beside it.
2. A fake-reader proposal, edited and confirmed, becomes a period line for the
   uploading person.
3. A proposal matching a stored joint-account row is offered as a match, and
   confirming it attaches the receipt without creating a period line.
4. The arithmetic check passes a proposal whose parts add up, and flags one a
   cent off, one with a wrong tax, and one with a `null` field.
5. The model is never called without the person asking. An API test proves it.
6. A non-image upload and an oversized upload are both refused.
7. Nothing is filed without a confirmation. An API test proves it.
8. Gates green.

## Review

**Gate: FAIL** — 2026-10-13 · `9580c2b1..43b36388` (three-dot, merge from main included) · Sonnet 5.5, depth full · lg-8, rated hard

FAIL because Done when 5 has a clause nothing asserts (F1, a one-assertion fix). Every other
line is proven, and the hunt found nothing above `med`. CI on this head: all 14 checks green
(see Done when 8). Settled, not graded: Haiku 5.5 alone with no live call; advisory flags;
the lg-22 overlap.

| Done when                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Measurement table and the owner's choice on the Log                                    | **verified** — read the base copy of the ticket: the "2026-10-12 — the measurement, and the owner's choice" entry holds the table and "Decided by the owner, 2026-10-12: Claude Haiku 5.5 alone". Nothing asserts a Log.                                                                                                                                                                                                                                                                                                           |
| 2. A fake-reader proposal, edited and confirmed, becomes a period line for the uploader   | `api/test/receipts.test.ts` › "a read proposal, edited and confirmed, becomes a period line for whoever uploaded it" ✓ — the assertion is on the stored line: `person_id` alex, `source` receipt, `entered_by` sam (sam confirmed).                                                                                                                                                                                                                                                                                                |
| 3. A matching joint-account row is offered, and confirming attaches without a period line | `api/test/receipts.test.ts` › "a proposal matching a stored joint-account row is offered, and confirming it attaches the receipt and adds no line" ✓ — one match with `daysApart` 1, filing has `rowId` and `periodLineId` null, `period_lines` count 0.                                                                                                                                                                                                                                                                           |
| 4. The check passes parts that add up; flags a cent off, a wrong tax, a `null` field      | `books/test/receipts.test.ts` › "passes a proposal whose parts add up and whose taxes fit one taxable part", "flags a total a cent off", "flags a wrong tax, even when the parts still add up", "flags %s not read, and guesses nothing" (3 cases) ✓. Second method: see _Arithmetic_ below.                                                                                                                                                                                                                                       |
| 5. The model is never called without the person asking; an API test proves it             | **unproven for the file route** — `api/test/receipts.test.ts` › "reaches the model only when the person asks, and answers each proposal checked" asserts 0 calls after upload and after matches, and 1 after read. It never files before its zero assertion, though its comment says "Uploading, asking for matches and filing by hand never call it". Planting a model call in the file route leaves the file green (F1). The code is right: **verified** by my run (upload 0, matches 0, file as row 0, file as line 0, read 1). |
| 6. A non-image and an oversized upload are both refused                                   | `api/test/receipts.test.ts` › "refuses %s as RECEIPT_NOT_AN_IMAGE, and keeps nothing" (text, GIF, PDF, empty) and "refuses a photo over the cap, before keeping any of it" ✓. My boundary run: exactly the cap 200, cap + 1 byte 413 `SIZE_LIMIT_EXCEEDED`, a chunked 8 MiB body with no content-length 413.                                                                                                                                                                                                                       |
| 7. Nothing is filed without a confirmation; an API test proves it                         | `api/test/receipts.test.ts` › "files nothing: a read proposal waits for the person" ✓ — `period_lines` and `receipt_filings` are both 0 after upload and read; the first upload test asserts the same 0s.                                                                                                                                                                                                                                                                                                                          |
| 8. Gates green                                                                            | `gh pr checks 474` at head `43b36388`: all 14 pass — `check` (CI), `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker` (ledger.yml), `CodeQL`, `codeql`, `dependency-review`, `pr-title`, the downloader and planner legs. My own: `npm run build` exit 0, `npm run check` exit 0, `npm test -- --project ledger` 56 files / 978 of 978, `node scripts/check-lockfile-sync.mjs` exit 0, `npx vitest run packages/core/test/image-closure.test.ts` 7 of 7.                                                     |

**Positive control** (isolation suite, `npx vitest run tools/ledger/api/test/isolation.test.ts`):

- Planted: the file route files into household `home`'s books for everyone (`routes/receipts.ts`
  hands `fileReceipt` home's handle; `server.ts` puts it on the context). Result, red:
  `Tests  1 failed | 1 passed (2)` — `AssertionError: away POST receiptFile: {"error":{"code":"RECEIPT_ALREADY_FILED",...}}: expected 409 to be 200`.
- Restored both files from the head sha: `Tests  2 passed (2)`.
- A second plant, `routes/receipts.ts` photos household hard-coded to `"home"`: red,
  `home's photos are 2dc66a9f-….jpg, c373e063-….jpg, e2eb844d-….jpg, fe33d14b-….jpg, its receipts name 2dc66a9f-….jpg, e2eb844d-….jpg` /
  `away's photos are , its receipts name c373e063-….jpg, fe33d14b-….jpg`. The Log's claim for it holds. Restored.
- The first plant was caught through an id collision (away's receipt id is also a home id). The suite's direct reads of
  both books files are a second net that this plant did not exercise separately: unmeasured.
- Other plants, each restored: route-limits red (`receiptRead refuses the second request in a minute` fails, 1 of 55) with the
  paid route's limiter removed; image-closure red (1 of 7, names the `receipts/dist` line) with that Dockerfile line deleted;
  the 6-day match window caught by the books suite (1 of 18).

**Findings**

- **med** · **Done when 5 depends on it** · **F1 — the file route's freedom from the model is asserted nowhere.**
  Reproduce: in `tools/ledger/api/src/routes/receipts.ts`, add `await reader?.read({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" });`
  as the first statement of the `ROUTES.receiptFile` handler, then `npx vitest run tools/ledger/api/test/receipts.test.ts` →
  `Tests  24 passed (24)`. The same test's comment claims filing is covered. Fix: file the receipt (as a line and onto a row)
  before the `calls` is asserted 0, or assert `counted.calls` at the end of the two filing tests.
- **med** · no Done when line depends on it · **OPEN DECISION · F2 — a photo that holds two receipts can file only one.**
  The brief returns a list "because one measured photo held two receipts side by side", and the screen asks which one. Then
  `receipt_filings.receipt_id` is unique, so the other proposal can never be filed. Reproduce (script in the scratch
  directory, `two-receipts.mts`, a fake reader returning two proposals): `read -> 200 proposals: 2`,
  `file Marché A -> 200 filed`, `file Quincaillerie B -> 409 RECEIPT_ALREADY_FILED`. The screen drops the unchosen proposal
  when filing (`startOver`), and the filed message says nothing of a second receipt, so it is simply forgotten; getting it
  needs the photo uploaded again and a second paid read. The Log does not mention this. Options: **(A) one filing per proposal**
  — migration 8 is unmerged, so changing `receipt_filings` now is free, and after the merge it is a migration 9;
  **(B) keep one filing per photo** and make the filed screen say that the photo held another receipt, filed by taking the
  photo again, with a test; **(C)** leave it and record it on lg-10. Recommend A (the case was measured, and A is free only
  until the merge); B if the owner wants to ship this round.
- **low** · **F3 — the attach path checks only that the row exists, and two receipts can document one row.** The "not
  offered again" rule is a read filter in `receiptMatches`; the write has no check and `receipt_filings_row` is a non-unique
  index. Reproduce (`api-harness.mts`, S4): two different receipts attached to the same row → `["200 ","200 "]`; a receipt
  proposing a total of 1 cent attached to a 26,49 row → 200; a receipt attached to the +5000,00 deposit row → 200. No path
  adds a line, and file-then-attach, attach-then-file, three concurrent files and attach-vs-line all answer one 200 and the
  rest 409 `RECEIPT_ALREADY_FILED` (lines and filings counted after each). Two members photographing one receipt is the way
  into the duplicate; lg-10 will read items against filings, so it matters then. No live consumer yet. Remedy: a partial
  unique index on `row_id` (also free until the merge) and a 409, and/or re-run `matchReceipt` at filing.
- **low** · **F4 — the paid route is cheap to repeat.** It takes the shared write bucket (60 a minute per person), a read of
  an already-filed receipt is allowed, concurrent reads are not coalesced, and a client that hangs up does not stop the call.
  Measured, default limits: 100 reads of one receipt in a burst → 59 answered and 41 `429`, 59 model calls; after filing,
  a read → 200 and one more model call; 20 concurrent reads of the filed receipt → 20 calls. At the Log's estimate of
  ≈ $0.0005 a read that is a ceiling near $0.03 a minute a person: insiders behind Access only, so no live call site.
  Remedy options: its own bucket (the planner's paid route has `RATE_LIMIT_RUNS_PER_MINUTE`, 5); a filed receipt
  refused a read as `RECEIPT_ALREADY_FILED`; the request's abort signal passed to `reader.read` (the reader already takes one).
- **low** · `nfr:reliability` · **F5 — photos accumulate with no cap and no delete, on the volume that holds every household's
  books.** Measured (`flood.mts`): 80 back-to-back cap-sized uploads → 61 accepted, 19 `429`, 427 MiB on disk, peak RSS
  215 MiB. `compose.ledger.prod.yaml` limits the container to 512m; concurrent uploads were not measured. Needs a member who
  scripts it, so no live call site; the Log accepts "an unfiled receipt is a kept photo" but not the growth.
- **low** · `nfr:maintainability` · **F6 — the host's environment reaches the API suite.** With both Anthropic variables set,
  `loadApiConfig` refuses to boot in every test that passes no `receiptReader` config, even one that hands in a fake reader.
  Reproduce: `export ANTHROPIC_API_KEY=sk-ant-host-key ANTHROPIC_CUSTOM_HEADERS="x-gateway: 1"` then
  `npx vitest run --project ledger tools/ledger/api` → `Test Files  17 failed | 11 passed (28)`, `Failed Tests  332`, all
  `AppError: ANTHROPIC_API_KEY and ANTHROPIC_CUSTOM_HEADERS are both set. ... so the ledger refuses to start with it.`,
  including both `isolation.test.ts` tests. With the key alone: `Tests  978 passed (978)` and the key in 0 output lines.
  `receipts.test.ts` pins `receiptReader: { apiKey: undefined, ... }` ("a key on the host must not reach a test"); the other
  files do not. CI and the devcontainer carry neither variable. Remedy: pin it in the shared helpers that build the app.
- **low** · **F7 — a test title overclaims.** `api/test/receipts.test.ts` › "never the photo, and never the key" asserts only
  the photo: its app has no key configured, so a log line carrying the key would pass it. The claim holds (measured with the
  real reader built from a configured key, a provider `401` whose body echoes the key, and 158 captured log lines: the key,
  `sk-ant` and the photo's base64 appear 0 times). Graded low because the table's `med` for an overclaiming title is an
  unproven acceptance line, and none of the eight names the key. Fix: configure a key and assert its absence, beside the
  existing non-empty companion.
- **low** · **F8 — a provider `400` or `408` is the server's fault to the person.** The magic-byte check accepts a 3-byte
  `FF D8 FF` as a JPEG (also a JPEG header followed by `<script>`, and a 12-byte `RIFF….WEBP`), and the reader sends a photo
  as uploaded; the API's own `400` (a corrupt image, a side over 8000 px per the vision docs) and `408` answer `INTERNAL`
  "Something went wrong on our end.", with only status and type logged. `reader-shapes.mts` (scratch directory): `HTTP 400 → INTERNAL`,
  `HTTP 408 → INTERNAL`. A phone photo is under both limits and Fastify rejects a truncated body, so no live call site.
- **dropped** · `amount()` in the reader checks `Number.isSafeInteger` after zod's `int()` already does: redundant, harmless.
- **dropped** · `key={JSON.stringify(checked.proposal)}` in the multi-receipt list repeats for two identical proposals: React warns, nothing mis-files, not a measured case.
- **dropped** · whitespace-only `ANTHROPIC_CUSTOM_HEADERS` beside a key boots: the SDK splits it on `:` and finds no header, so it changes nothing.
- **dropped** · a provider `429` answers `UNREACHABLE` where the planner answers `RATE_LIMITED`: both are in the taxonomy; the ledger has no domain code for it and `RATE_LIMITED` would tell a person to slow down. A choice, not a defect.
- **dropped** · "household B can tell a receipt exists in A": refuted. Away against home ids 2, 3 and a nonexistent 99, on read, matches, file-as-line and file-as-row: all twelve `404 RECEIPT_NOT_FOUND`, and the body for 2 equals the body for 99 byte for byte; zero model calls and zero rows written. An admin with no household gets `403 FORBIDDEN`.
- **findings** · the hunt returned 13; 8 carried (F1–F8), 5 dropped.

**Measured against the brief's attack list**

- **The model request** — `createModelReader` sends `POST https://api.anthropic.com/v1/messages` with `x-api-key`,
  `model: claude-haiku-5-5` (the id on the models overview), `max_tokens: 16000`, `output_config: { effort: "medium", format: { type: "json_schema", schema } }`
  (the shape the structured-outputs page gives; Haiku 5.5 is on its supported list; the schema uses `$defs` and `anyOf` with `null`,
  no unsupported keyword), and an `image` block (base64, the sniffed media type) then the prompt. Whether structured output combines
  with adaptive thinking on Haiku 5.5 is **unverified** — the page is silent and no live call was made. 42 canned replies (3 read, 39 refused), a hung call, a caller abort and two retry runs, through the real
  reader's `fetch` (`reader-shapes.mts`): every failure a typed `AppError`, none filed, 0 bare `Error`:
  stop reasons `refusal` (empty, with text, with schema-valid text), `max_tokens` (cut and valid-looking), `pause_turn`, `tool_use`,
  `stop_sequence`, `model_context_window_exceeded`, `null` → `RECEIPT_UNREADABLE`; an empty content array, thinking-only content, non-JSON, fenced
  JSON, `[]`, `null`, a wrong key, a string for an integer, a float, a missing field, 1e18 → `RECEIPT_UNREADABLE`; a thinking block then text → read;
  a 200 with an HTML body → `RECEIPT_UNREADABLE`, with invalid JSON → `INTERNAL`; HTTP 429/500/502/503/504/529 and a thrown `TypeError` → `UNREACHABLE`
  (`retryable: true`); 400/401/403/404/408/409/413/422 → `INTERNAL`; a hung call at 50 ms → `TIMEOUT`; a caller abort → `CANCELED`.
  Over HTTP, the same: 422 / 502 / 500, with the response body holding only code, message and `retryable`, and 0 filings and 0 lines afterwards.
  `ANTHROPIC_CUSTOM_HEADERS` + key → `AppError` naming the variable, repeating neither its value nor the key; headers alone, or with a blank key → boots.
- **Cost and abuse** — all four routes carry the identity hook and the `rateLimit` hook (`printRoutes({ includeHooks: true })`, which also
  lists the auto-generated `HEAD` of `matches`); keyed `<household>:<person>`; `route-limits.test.ts` walks them (`VERBS` has all four; removing the paid route's
  limiter turns it red). F4 for the rest.
- **Upload and storage** — the type comes from the bytes: a JPEG declared as `image/png`, `application/json`, `text/plain`, `multipart/form-data`, `x/y` or nothing is
  stored as `image/jpeg`; a PNG declared as JPEG is stored as `image/png`; GIF, HEIC, `RIFF….WAVE` and a multipart envelope around a real JPEG are 415. Stored names
  are `<uuid>.<jpg|png|webp>` in `receipts/home/`; with `?name=../../x.jpg` and `x-file-name: ../../x.jpg` sent, the data directory held only `households` and `receipts`, no
  `.part` left over. The household is `isHouseholdId`-checked and the path re-checked to sit directly in its directory. No route serves a photo.
- **Isolation** — above and in the positive control.
- **Filing** — F3 for the double-write results; no path double-counts or adds a line when attaching. A failed filing leaves nothing (unknown spending category → 404 and 0
  filings, 0 lines; `chargedTo` equal to the uploader → 400 and the receipt still unfiled). Match boundaries by HTTP, receipt dated 2026-10-10 for 26,50: rows at −6 and +6
  days not offered; −5, −4, 0, +4, +5 offered with `daysApart` 5, 4, 0, 4, 5; 26,49 and 26,51 not offered for 26,50; the +26,50 credit not offered for a purchase and the only
  offer for a refund (−26,50).
- **_Arithmetic_** (`arith.mts`, an independent BigInt half-up oracle): 0 false flags on 300,000 correct all-taxable receipts (0,01 $ to 3 000,00 $); 0 misses
  of 42,858 receipts a cent off in the total, in GST (parts still adding) or in QST (parts still adding); 0 disagreements with a brute-force "some taxable part" oracle on
  39,924 random receipts; a refund passes, mixed signs flag `signs-differ`, zero-rated passes. Receipts rounded by another rule are flagged (truncating: 7,500 of
  100,000; the pre-2013 compounded QST: 99,901 of 100,000): advisory by the owner's decision, and only half-up is modelled.
- **Closure** — `tsconfig.json` and `tsconfig.tests.json` reference `receipts`; `api/package.json` lists `@ledger/receipts`; both Dockerfile lines are present; the lockfile
  has the workspace link and its manifest; the `docker` job built and started the image on this head. I added the symlink `node_modules/@ledger/receipts` by hand (the farm lacks
  it) and ran no install.

**Invariants**: a tool imports nothing from another ✓; errors are `AppError` with ledger or core codes ✓ (the five new codes each have a status in `http-errors.ts`);
redaction ✓ (F7 for the test); contract edits are the types and codes this ticket first throws, as the ledger `CLAUDE.md` provides, plus the receipt source its own comment
announced ✓; tests registered (`receipts` reference line; the ledger project's glob covers `receipts/test`) ✓; the Dockerfile's two edits ✓; every new route enumerated by
`printRoutes` ✓; style (no `any`, no `console`, `import type`) ✓ — `npm run check` exit 0. Skipped: SSRF (the base URL is a constant, not user-influenced), shell and process
trees (none spawned), progress (the busy button states no number).

**NFR**: security ✓ (key never logged, SDK environment reads neutralised, isolation, identity and limit before the body, no path from the request) · performance — a 7 MiB photo is
buffered, base64-encoded and JSON-encoded per read; sequential peak RSS 215 MiB, concurrent unmeasured · reliability — typed on every shape; a hung read costs up to
3 × 60 s by the code's own comment, which would pass a 100 s proxy limit (unverified, not measured here); F5 · maintainability — F6, F7.

### Gate 2

**Gate: PASS** — 2026-10-13 · `43b36388..4fba1ff2` (one commit, no merge in the range) · Sonnet 5.5, depth full

Gate 1's `high`-or-FAIL cause (F1) and its other `med` (F2) are fixed and each fix reproduced; F3, F4, F6 and F7 are fixed;
F5 and F8 are left recorded by the owner's choice and are not re-graded. Four new `low` findings in the lines this round
touched (N1–N4). Every acceptance line is proven; CI on this head is green (below).

**Acceptance lines the round touched.** The round's test edits delete no assertion and reword none: the file helper in
`api/test/receipts.test.ts` gained `part: 1`, the paste fixture moved into `pasteRows`, and one test was strengthened.

| Done when                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5. The model is never called without the person asking | `api/test/receipts.test.ts` › "filing as a line and onto a row calls no reader" ✓ — files one receipt as a line and one onto a row with a counting reader and asserts `calls` is 0, beside the existing upload and matches zeros. Plant: a model call at the top of the file handler → that test and the filed-read test fail (`Tests  2 failed \| 84 passed (86)` over receipts and route-limits). Was **unproven** at gate 1.                                                                                                                    |
| 8. Gates green                                         | `gh pr checks 474` at `4fba1ff2`: 14 of 14 pass — `check`, `test (ubuntu-latest)` 7m26s, `test (windows-latest, informational)` 7m46s, `docker` ×3 (the ledger image built and started), `CodeQL`, `codeql`, `dependency-review`, `pr-title`, `e2e` ×3, `changes`. Mine: `npm run build` exit 0 (contract changed, so rebuilt, and `ROW_ALREADY_DOCUMENTED` found in `contract/dist`); `npm run check` exit 0 (15 warnings, none in a ledger file); `npm test -- --project ledger` with the host's Anthropic variables set: 56 files / 987 of 987. |
| 1, 2, 3, 4, 6, 7                                       | unchanged by the round; 2, 3 and 7 still proven by their gate 1 tests, which pass under the new contract (`api/test/receipts.test.ts` 31 of 31).                                                                                                                                                                                                                                                                                                                                                                                                   |

**Gate 1 findings**

- **F1 — fixed.** The test above. Verified red under the plant, green restored.
- **F2 — fixed (option A).** `receipt_filings` gains `part` (1..10) with `UNIQUE (receipt_id, part)`; `fileReceiptRequestSchema` requires it;
  the screen files each proposal under its index and goes back to the unfiled ones. Gate 1's script, with `part`
  (`round.mts` R1, scratch directory; the old `two-receipts.mts` unchanged now answers `400 BAD_REQUEST` for both, since `part` is required):
  `read -> 200, proposals 2`, `file part 1 -> 200`, `file part 2 -> 200`, `file part 2 again -> 409 RECEIPT_ALREADY_FILED`,
  `period_lines / receipt_filings [2,2]`, filings `(receipt 1, part 1, line 1)` and `(receipt 1, part 2, line 2)`.
  **Positive control** — the old migration 8 line put back (`receipt_id INTEGER NOT NULL UNIQUE REFERENCES receipts (id)`):
  `npx vitest run tools/ledger/api/test/receipts.test.ts` → `Tests  1 failed | 30 passed (31)`,
  `× files each receipt the photo holds, each once`,
  `AssertionError: {"error":{"code":"INTERNAL",...}}: expected [ 200, 500 ] to deeply equal [ 200, 200 ]`.
  Restored from the head sha: `Tests  31 passed (31)`. A second plant (the "already filed" lookup ignoring `part`) fails the same test.
- **F3 — fixed.** `receipt_filings_row` is a partial unique index and `fileReceipt` checks first. `round.mts` R2: two receipts onto one row
  → `["200","409 ROW_ALREADY_DOCUMENTED"]` sequentially and concurrently; `n 4, distinct 4` documented rows in the table;
  an absent row → `404 ROW_NOT_FOUND`; a refused attach leaves the receipt unfiled and the line count unchanged.
  Wiring of the new code, by `grep` of every file that names its sibling `RECEIPT_ALREADY_FILED`: `LEDGER_ERROR_CODES` ✓,
  `DEFAULT_ERROR_MESSAGES` (a `Record<ErrorCode, string>`, so the compiler forces it) ✓, `STATUS_BY_CODE` 409 ✓ — and
  `api/test/http-errors.test.ts` sweeps every ledger code for a status (passes) — the producer in `api/src/receipts.ts` ✓, the test ✓,
  `CLAUDE.md` ✓. The web has no map over the codes. Complete.
- **F4 — fixed.** `RATE_LIMIT_RECEIPT_READS_PER_MINUTE`, default 5, its own `RateLimiter` for the read route.
  Burst of 100 reads of one unfiled receipt: `[5, 95, 5]` (200s / 429s / model calls), `RateLimit-Limit 5`, `Retry-After 12` on a 429; sam has his own
  bucket (200); 20 uploads straight after the burst all 200 (the writes' bucket untouched). A filed receipt: 4 concurrent reads →
  four `409 RECEIPT_ALREADY_FILED`, 0 model calls. Abort, over real HTTP with the real reader and a stubbed fetch: a client that hangs up
  mid-read → `[SDK saw a signal, aborted] = [true, true]`, one `request rejected` line with `code CANCELED`, `status 499` logged at info; a normal
  read over HTTP → `[200, aborted false]` (the `writableEnded` guard holds). Plants, each restored: the read back on the writes' bucket →
  "takes a bucket of its own" fails; the filed check removed → "refuses to read a receipt already filed" fails; the signal dropped →
  "hands the reader the request's signal" fails; the read route's limiter removed → `api/test/route-limits.test.ts` › "receiptRead refuses the second request in a minute, as RATE_LIMITED" fails (`Tests  1 failed | 54 passed (55)`).
- **F5, F8 — left recorded, not re-graded.**
- **F6 — fixed, and scoped.** `vitest.config.ts` printed through `vitest-scope.mts`: root `test` has only `projects`; `core`, `repo`, `downloader` and
  `planner` all `setupFiles: null`; `ledger` alone has `["tools/ledger/api/test/helpers/no-model-environment.ts"]`. The diff to `vitest.config.ts` is
  the one project's block. With `ANTHROPIC_API_KEY`, `ANTHROPIC_CUSTOM_HEADERS` and `RECEIPT_MODEL` exported: `npx vitest run --project ledger tools/ledger/api`
  → `Test Files  28 passed (28)`, `Tests  525 passed (525)` (gate 1: 17 files and 332 tests failed); the whole project with `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`
  added → 56 files / 987 of 987. The tests that want a variable pass their own `env` or `vi.stubEnv`, and still pass. I did not run another project with the
  variables set to watch it keep them; the config print is the evidence.
- **F7 — fixed.** The test now builds the real reader from a configured key against a `401` that quotes the key, with a non-empty companion
  (`toContain("the receipt reader refused the request")`). Plant: a log field carrying the SDK error's message in `receipts/src/reader.ts`, `dist` rebuilt
  and grepped for the identifier → `× never the photo, and never the key`, `AssertionError: expected '{"level":"error",...' not to contain 'KEY-MARKER'`;
  restored, `dist` rebuilt, grep 0, `Tests  31 passed (31)`.

**The builder's three choices, attacked**

- **F6 placement** — above: scoped to the ledger project, nothing changes for the others. One cost: it deletes `ANTHROPIC_*` for the ledger's `web`,
  `books` and `receipts` files too, which read none.
- **`ROW_ALREADY_DOCUMENTED`** — wired everywhere a map over the code type exists (above).
- **`part`** (`round.mts` R3–R4):
  - Out-of-range values: `0`, `-1`, `11`, `1.5`, `"1"`, `null` and a missing `part` are each `400 BAD_REQUEST` and file nothing; `10` files.
  - **Beyond what the read proposed: yes.** A photo read as one receipt was filed by the client as parts 1, 2 and 3 → `["200","200","200"]`, three lines
    (N1).
  - **The same part as a line and onto a row: no.** Line then row, row then line, three concurrent lines, and a concurrent row-vs-line, each end with one 200
    and the rest `409 RECEIPT_ALREADY_FILED` (lines and filings counted after each). With a fresh row, part 1 onto the row → 200, part 2 onto the same row →
    `409 ROW_ALREADY_DOCUMENTED`, and part 1 again → `409 RECEIPT_ALREADY_FILED` (the part check wins).
  - **The read refusal does not stop filing part 2 by hand.** Part 1 filed; a read → `409 RECEIPT_ALREADY_FILED`, 0 model calls; part 2 filed with no read → 200.
    On the screen the same holds: after a filing, "Type another receipt from this photo" and "Type it in" both open the next unfiled part.
  - **No existence oracle.** Home and away seeded so their row ids collide (the first 11 ids equal). Home attaches its receipt to row 5 → 200; away attaches _its_ row 5
    → 200, not 409; a second away receipt on away's row 5 → `409 ROW_ALREADY_DOCUMENTED` in away's books only. An away member naming a row id that exists only in
    home's books → `404 ROW_NOT_FOUND`, the same answer as an id that exists nowhere (`99999`). Away against home's receipt ids 3 and 99 on read, matches, file-as-line and
    file-as-row: all eight `404 RECEIPT_NOT_FOUND`, and the bodies for 3 and 99 are byte-identical. An admin with no household: `403 FORBIDDEN`. Each household's
    books are a file of their own, so a documented row or a filed receipt in one is not visible from the other.

**New findings (lines this round touched)**

- **low** · **N1 — the server does not know how many receipts a photo holds.** A read stores nothing, so `part` is any of 1..10 whatever was proposed (measured:
  one proposal filed as parts 1–3, three lines). No new capability — `POST /api/period-lines` already adds any line — and the screen files each part once, so no live
  call site; but the contract still says a receipt is "filed once", which is now per part. Not worth recording the count; say so in the contract comment.
- **low** · **N2 — the reader can propose more receipts than can be filed.** `MAX_RECEIPTS_PER_PHOTO` is 10, the reader returns every receipt the model lists (500 in
  gate 1's run), the screen offers each, and `part` 11 is `400 BAD_REQUEST`. The measured maximum is two, so no live call site. A cap on the proposals the read route
  returns closes it.
- **low** · **N3 — the unique index on `row_id` is asserted by nothing.** Replacing it with a plain index leaves `Test Files  2 passed (2)`, `Tests  86 passed (86)`
  (receipts and route-limits): the in-transaction check is what answers, and removing _that_ shows the index works (`500` instead of `409`, no duplicate row). The index
  matters only to a second writer on the same file, and none exists today. A schema test inserting two filings for one row would pin it.
- **low** · **N4 — stale words on `RECEIPT_ALREADY_FILED`.** Its comment in `contract/src/errors.ts` still says "The receipt was filed already ... Filing it again would
  count it twice", and its default message "That receipt is filed already"; it now means one part is filed, and the read route also raises it for a receipt with any part
  filed. A second member's stale screen would be told the whole receipt is filed when part 2 is not.
- **dropped** · the Log's "13 of 31 red" and "4 of 9 red" for the new tests before the change: not re-run (I did not reconstruct the pre-change tree); the reds I produced
  by planting the old schema line and the other mutations are listed above and agree with the Log's descriptions.
- **dropped** · `RATE_LIMIT_RECEIPT_READS_PER_MINUTE` is not forwarded by `compose.ledger.prod.yaml`: neither is `RATE_LIMIT_READS_PER_MINUTE` nor the planner's runs limit, so a host sets all of them through an override file; the deployment doc's table says so for the key. Not new.
- **findings** · the hunt returned 6; 4 carried (N1–N4), 2 dropped.

**Invariants and NFR (the round's lines only)**: errors typed, one new ledger code with its status ✓; contract edited for the owner's decision, with its test ✓;
a migration that is unmerged was edited in place, which the ledger's append-only rule permits only because it has not shipped (`user_version` stays 8 and `schema.test.ts` still
says so) ✓; style and `npm run check` ✓; no shell, no SSRF surface touched. Security ✓ (the key in 0 of 246 captured lines across the harness, the oracle question answered
above) · performance — the paid route is now capped at 5 a minute a person · reliability ✓ (a hang-up cancels the model call; a failed attach leaves nothing) · maintainability —
N3 and N4.

**Gate 2 states plainly: nothing found in this round is a `high`.** A third gate is not called for.

## Log

### 2026-10-12 — the measurement, and the owner's choice

**The set.** There were 14 photos, taken by the owner. Twelve held 13 printed
receipts from grocers, hardware and electronics stores and a small shop,
including one refund and one too faded to name. One of those photos held
two receipts, and one was a second, rotated shot of another. The other two
photos were handwritten notes of 11 amounts. Ten of the photos were sideways
and none carried an EXIF rotation. The photos, the transcription, the harness
and every engine's raw output are in `~/ledger-receipts-lg8/` on the dev box,
**outside the repository**. Nothing here names an item or an amount from them.

**What counts as right.** Every receipt was transcribed by hand from upright,
full-resolution crops. Each transcription adds up from items and deposits to
the subtotal, and from the subtotal and taxes to the total. Two values are not
on the paper: one GST is too faded to read and was derived from the
arithmetic, and two items are struck through in pen.

**How each engine ran.**

- The local engines tried 0°, 90° and 270° and kept the most confident
  orientation. A throwaway keyword parser read their totals, and it tolerates
  `O`/`0`, `PARIIEL` and `TUQ`.
- For the local engines, "item prices" means the price appears in the OCR
  text, which is an upper bound for a parser that would still need writing.
- The models ran as Claude Code subagents, one photo each, on the
  1568-pixel image the API would receive, with the same prompt and schema as
  the API harness. **No API key was used, by the owner's choice.** Their cost
  is therefore estimated from tokens: 2,469 for the image and about 330 for the
  prompt in, about 140 out, with up to three times that out for thinking.

| Engine                | All four right | Subtotal | GST   | QST   | Total | Wrong but adds up | Item prices | Invented items | Tax flags | Deposits | Handwritten | Seconds per receipt        | Cost per receipt      |
| --------------------- | -------------- | -------- | ----- | ----- | ----- | ----------------- | ----------- | -------------- | --------- | -------- | ----------- | -------------------------- | --------------------- |
| PaddleOCR v6 tiny     | 9/13           | 10/13    | 10/13 | 9/13  | 10/13 | 0                 | 60/64       | n/a            | 59/64     | 5/5      | 1/11        | 1.3 upright (4.6 trying 3) | 0                     |
| PaddleOCR v6 small    | 7/13           | 9/13     | 8/13  | 9/13  | 8/13  | 0                 | 60/64       | n/a            | 57/64     | 5/5      | 2/11        | 3.8 upright (9.6 trying 3) | 0                     |
| tesseract.js 6, `fra` | 0/13           | 6/13     | 7/13  | 5/13  | 4/13  | 0                 | 36/64       | n/a            | 35/64     | 4/5      | 0/11        | 3–22 trying 3, under load  | 0                     |
| Claude Haiku 5.5      | 13/13          | 13/13    | 13/13 | 13/13 | 13/13 | 0                 | 62/64       | 0              | 62/64     | 5/5      | 10/11       | not measured (no API)      | ≈ $0.0004–0.0005, est |
| Claude Sonnet 5.5     | 13/13          | 13/13    | 13/13 | 13/13 | 13/13 | 0                 | 64/64       | 1              | 62/64     | 5/5      | 8/11        | not measured (no API)      | ≈ $0.007–0.010, est   |

- **"Wrong but adds up" is zero for every engine.** Every misread failed the
  arithmetic check, so the check is the safety net whichever engine reads.
- **The seconds are medians from the dev box** (Ryzen 5 3600, 12 threads), not
  the deploy machine. They were taken on a second pass started at load 2.9,
  but the OCR's own threads pushed the load to 9–21 while it ran. Tesseract's
  figure is from the first pass, at load 26.
- **Local OCR carries weight.** It adds 45 MB of onnxruntime for linux-x64 (the
  npm package ships 288 MB, every platform) and 6–37 MB of model files.

**What went wrong, per engine.**

- **PaddleOCR tiny** misread both receipts in the two-receipt photo, which a
  single-text parser cannot split. It also missed every item on the faded
  receipt, and on a blurred receipt it set the tax values one line
  below their labels.
- **Haiku** returned no items for the faded receipt, though it read all four
  totals. It left the two pen-struck items out. In both cases the items no
  longer summed to the subtotal, which lg-10's reconciliation catches. It
  also read a crossed-out amount on a handwritten note.
- **Sonnet** invented an item on the longest receipt, so the items no longer
  summed to the subtotal, which reconciliation also catches. It gave the
  faded receipt's two items plausible names that are not on the paper, and
  read a grocer's `*` promotion mark as a tax flag. It inferred the struck items'
  prices from the arithmetic, correctly.
- **Both models** read the two-receipt photo as two receipts, and the refund
  as negative. Neither was ever wrong on a printed total or tax.

**Decided by the owner, 2026-10-12: Claude Haiku 5.5 alone, with no local
OCR.** The options put were:

- Haiku alone, the one chosen;
- the hybrid as first written, with PaddleOCR tiny first and Haiku when the
  arithmetic fails or items are wanted;
- Sonnet alone.

The reasons that decided it:

- Haiku matched Sonnet on totals, at about a twentieth of the price: about 5¢
  per 100 receipts.
- lg-10 reads items line by line, so most grocery receipts would reach the
  model anyway.
- The local path would have added a runtime, a parser and a second code path.

**Also decided: the estimates stand.** The owner chose to accept the
subagent-based cost estimate rather than add a live API run to Done-when.
Seconds per model read remain unmeasured until the reader is built.

**Brief corrections made with this entry.**

- Build steps 2–3 dropped the local implementation, the parser and the
  routing.
- The reader returns a list, because of the two-receipt photo.
- Filing must survive a tip and a missing date.
- Done-when 4 now tests the arithmetic check, not an OCR parser.
- The same decision is recorded in analysis §6 and the roadmap. lg-10's step 1
  no longer says the model is called only for items.

### 2026-10-13 — built: the reader, the check, three routes and a screen

**What was built.**

- `receipts`: `createModelReader({ provider: "anthropic", apiKey, model })`,
  `claude-haiku-5-5` by default, behind the `ReceiptReader` seam. It sends the
  photo as uploaded, with the measured harness's prompt less the items, the
  deposits and the handwritten amounts, and the schema as
  `output_config.format`. It validates the answer itself, and refuses a
  refusal, a reading cut short, and anything that is not a reading, as
  `RECEIPT_UNREADABLE`. It reads no environment.
- `books`: `checkReceipt`, which flags and never corrects, and `matchReceipt`,
  the rows for exactly the charge within `RECEIPT_MATCH_DAYS` (5) either way.
- `api`: `POST /api/receipts` keeps the photo and reads nothing; only
  `POST /api/receipts/:id/read` calls the reader; `GET …/matches` offers rows;
  `POST …/file` is the confirmation and the only write to the books. Migration 8
  adds `receipts` and `receipt_filings`. Photos are files at
  `<data>/receipts/<household>/<uuid>.<ext>`.
- `web`: a Receipt tab. The model is named beside "Read it", with the sentence
  that the photo leaves the house.

**How a receipt files into lg-21's per-household books.** The code left one
answer: every step runs on `booksOf(request)`, the caller's household's books.
The photo goes in that household's directory, which `personOf(request)`
names. The isolation sweep now takes all four routes, and it compares each
household's photo directory with the photos its own receipts name. With the
household hard-coded to `home` in `routes/receipts.ts`, that comparison fails
(`npx vitest run tools/ledger/api/test/isolation.test.ts` → 1 failed, "home's
photos are …, away's photos are ,"). Every read still passed, since every
photo's name is new.

**The key.** `ANTHROPIC_API_KEY`, read in `api/src/config.ts`
(`loadReceiptReaderConfig`) and passed to the reader. With none set, a read is
refused as `RECEIPT_READER_UNCONFIGURED` (503) and typing still files. No
checked-in compose file names it. It reaches the container the way the
planner's does, through a host-only override file. `docs/02-DEPLOYMENT.md`
gained a "Reading receipts with a model" section, in place of the sentence
that promised one. `ANTHROPIC_CUSTOM_HEADERS` beside a key refuses to boot,
as it does for the planner.

**Done-when, with the test that proves each.**

1. The measurement table and the owner's choice are on this Log (2026-10-12).
2. `api/test/receipts.test.ts`, "a read proposal, edited and confirmed, becomes
   a period line for whoever uploaded it". Sam confirms Alex's receipt with a
   tip, and the line is Alex's, `source = 'receipt'`, entered by Sam.
3. Same file, "a proposal matching a stored joint-account row is offered, and
   confirming it attaches the receipt and adds no line".
4. `books/test/receipts.test.ts`: "passes a proposal whose parts add up…",
   "flags a total a cent off", "flags a wrong tax, even when the parts still
   add up", and "flags %s not read, and guesses nothing" (three cases).
5. `api/test/receipts.test.ts`, "reaches the model only when the person asks…".
   The counting reader stays at 0 calls through the upload and the matches,
   and reaches 1 on the read.
6. Same file, "refuses %s as RECEIPT_NOT_AN_IMAGE…" (four cases) and "refuses
   a photo over the cap…". Setting the route's `bodyLimit` to 1 MiB fails "takes
   a photo past the 1 MiB…" (1 of 24); dropping the byte check fails 4 of 24.
7. Same file, "files nothing: a read proposal waits for the person", and the
   first upload test.

**Measured.**

- `npx vitest run` on the four new receipt suites, one file at a time: 18 of 18
  (`books`), 15 of 15 (`receipts`), 24 of 24 (`api`), and 8 of 8 (`web`).
- `npm test -- --project ledger`: 56 files, 978 of 978.
- `npx vitest run packages/core/test/image-closure.test.ts`: 7 of 7. With the
  runtime `receipts/dist` line deleted from the `Dockerfile`, it fails 1 of 7,
  naming that line.

**What the brief had wrong, or left open.**

- **The upload answers with the model**, as `reader` (`UploadedReceipt`). The
  screen has to name where the photo goes before it is sent, and only the API
  knows which model reads, or whether one does.
- **A handwritten note gives no proposal.** The measured prompt listed its
  amounts, but a note is not a receipt, and there is no total to propose. The
  person types it in. lg-10 can add `handwritten_amounts` back if wanted.
- **The check flags; it does not block filing.** Step 3 says it "flags a
  proposal and never corrects one". A typed receipt with no subtotal, or a
  note, would otherwise be impossible to file. This is put to the owner as an
  open decision in the builder's report.
- **"Within a few days" is 5 days either way** (`RECEIPT_MATCH_DAYS`), and the
  match is on the amount charged, which the form starts at the total. A tip
  changes the charge, and the person edits it there.
- **A row a receipt already documents is not offered again.** A receipt is
  filed once (`RECEIPT_ALREADY_FILED`, 409).
- **Five error codes arrived:** `RECEIPT_NOT_AN_IMAGE` (415),
  `RECEIPT_NOT_FOUND` (404), `RECEIPT_ALREADY_FILED` (409),
  `RECEIPT_READER_UNCONFIGURED` (503) and `RECEIPT_UNREADABLE` (422). A model
  that is busy or unreachable answers core's `UNREACHABLE`, and a key the API
  refuses answers `INTERNAL`, with its status logged.
- **Seconds per read are still unmeasured**: no key was used here either, and
  no test reaches a model.
- **The photo is never served back**, and there is no list of receipts not yet
  filed. Neither is in the brief. An unfiled receipt is a kept photo, and the
  person takes it again.

**Fold-ins.** None was free. lg-10 extends this reader and is left to its own
ticket, as the dispatch said.

### 2026-10-13 — the owner's answers, and gate 1's findings repaired

**Decided by the owner, 2026-10-13.**

1. _Can a proposal the check flags be filed once the person confirms it?_ The
   options were that the flags stay advisory, or that filing is blocked until
   nothing is flagged. **Chosen: advisory, fileable once the person confirms.**
   The builder recommended this. A typed receipt with no subtotal, or a note,
   could not be filed otherwise.
2. _Gate 1, F2: a photo of two receipts could file only one._ The options were:
   - (A) one filing per proposal, by changing `receipt_filings` while migration
     8 is unmerged;
   - (B) one filing per photo, with the filed screen saying another receipt is
     in it;
   - (C) recording it on lg-10.

   **Chosen: (A).** The gate recommended it.

3. _Gate 1, F3 and F4, both low._ The options were to fix them now or to leave
   them recorded, which is the severity floor's default. **Chosen: fix both
   in this round.** The orchestrator recommended it.

**What changed.** Each new test failed before its change and passes after it.

- **F2.** A filing names its `part`, the receipt's place in the photo from 1,
  up to `MAX_RECEIPTS_PER_PHOTO` (10). Each part is filed once, as
  `UNIQUE (receipt_id, part)`. After one is filed, the screen goes back to the
  others, and "Type another receipt from this photo" files the next part by
  hand.
  - Red: the API test "files each receipt the photo holds, each once" failed,
    with every `part` refused by the old schema (13 of 31 red). The web test
    "files each receipt in a photo of two…", run against the committed screen,
    failed with `Unable to find role="button" and name "Marché Exemple, 26.50 $"`
    (4 of 9 red).
- **F3.** `receipt_filings_row` is now a partial unique index, and attaching a
  receipt to a row that already has one is refused as the new
  `ROW_ALREADY_DOCUMENTED` (409).
  - Red: with the index alone the API answered `500`, and without it `200`.
- **F4.** A receipt read takes a bucket of its own, five a minute a person
  (`RATE_LIMIT_RECEIPT_READS_PER_MINUTE`), and a receipt with anything filed
  from it is refused a read as `RECEIPT_ALREADY_FILED`. The route also passes
  the request's signal to `reader.read`, aborted when the response closes
  unsent. That was three lines, so it is in.
  - Red: the bucket test got `[200, 200, 200, 200, 200, 200]`. The filed test
    got `200`. The signal test got `expected undefined to be an instance of
AbortSignal`.
  - With the abort call removed, the signal test still fails:
    `expected false to be true`.
- **F1.** "filing as a line and onto a row calls no reader" files both ways
  and asserts no call. With the gate's mutation, a `reader.read` call at the
  top of the file handler, it fails with `expected 2 to be +0`.
- **F6.** The ledger's vitest project clears every `ANTHROPIC_*` variable and
  `RECEIPT_MODEL` before each file (`api/test/helpers/no-model-environment.ts`,
  from `setupFiles` in the root `vitest.config.ts`). Twelve test files build an
  app directly, so a helper would not have reached them all.
  - Red: with both variables set, `npx vitest run --project ledger
tools/ledger/api` gave 17 of 28 files and 332 of 525 tests failed.
  - After: 28 of 28 files, 525 of 525 tests.
- **F7.** "never the photo, and never the key" now builds the real reader from
  a configured key against a `401` that quotes the key back. It asserts that
  the key, `sk-ant` and the photo are absent from a non-empty log.
  - Red: adding `message: error.message` to the reader's failure log line fails
    it, with `not to contain 'KEY-MARKER'`.

**Left recorded, unfixed, as the dispatch said:** F5, the photos accumulating
with no cap, and F8, a provider `400` or `408` answering `INTERNAL`.

**What the first entry said that is no longer so.** "A receipt is filed once"
now means once per part. A row a receipt documents is refused a second one,
where before it was only left out of the offers.

### 2026-10-13 — gate 2's four lows, fixed at landing

**Decided by the owner, 2026-10-13.** _Gate 2 passed with four lows, N1–N4.
Should they be fixed?_ The options were to apply them at landing with no
re-gate, or to leave them recorded. **Chosen: apply them at landing, with no
re-gate.** The orchestrator recommended it.

- **N1 — the server does not know how many receipts a photo holds.** _Fixed at
  landing._ The contract's comment on `ReceiptFiling` now says that "once" is
  per part. It also says the part is the person's word, since a read stores
  nothing, and that storing the count would buy nothing.
- **N2 — a reader can propose more receipts than can be filed.** _Fixed at
  landing._ The read route answers at most `MAX_RECEIPTS_PER_PHOTO` (10)
  proposals.
  - Red: "answers no more proposals than a photo can file", with a fake reader
    returning 11, failed with `expected [ …(11) ] to have a length of 10 but
got 11`.
- **N3 — nothing asserts the unique index on `row_id`.** _Fixed at landing._
  `api/test/schema.test.ts` now has "refuse a second filing on a row a receipt
  already documents", which inserts two filings for one row.
  - Red: with a plain index in place of the unique one, it failed with
    `expected [Function] to throw an error`.
- **N4 — stale words on `RECEIPT_ALREADY_FILED`.** _Fixed at landing._ Its
  comment and its default message now speak of one receipt in the photo being
  filed, and of a read refused for a photo with one filed.
