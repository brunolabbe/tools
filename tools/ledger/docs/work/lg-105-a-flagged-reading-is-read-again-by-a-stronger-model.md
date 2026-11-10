---
id: lg-105
tool: ledger
title: A reading the arithmetic flags is read again by a stronger model
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: hard
---

# lg-105 — A reading the arithmetic flags is read again by a stronger model

## Why

The arithmetic check (`checkReceipt` in `books`, lg-8, lg-10, lg-26) catches a
misread: an item price a few cents off, or a rebate folded in or left out.
`items-differ` blocks filing, in the screen and in the API
(`RECEIPT_DOES_NOT_ADD_UP`). What happens next is manual. A flagged reading
reaches the person, who finds the wrong line on the photo and corrects it by
hand. Nothing hands the reading back to a model.

The owner reports (2026-11-09) that this happens often enough to matter: some
receipts have their rebates placed correctly and some do not, and some have an
item a few cents off. The check flagged each one, and the owner fixed them by
hand. The check works; the cost is the manual correction afterwards.

## Decision — answered 2026-11-09 by the owner

Asked through `AskUserQuestion`: what should happen to a reading flagged
`items-differ` (or another arithmetic flag) before the person sees it?

- Haiku re-reads once, told the gap the check found. One more Haiku call per
  flagged read; keeps lg-8's Haiku-only choice.
- **A stronger model (Sonnet) re-reads the photo (chosen).** Probably more
  accurate per retry, costs several times more per retry, and amends lg-8's
  choice of Haiku as the only reader (2026-10-12).
- Haiku re-reads with the gap, then Sonnet if it still does not add up: most
  accurate, but two mechanisms to build and measure.
- Keep it manual.

This amends lg-8 rather than replacing it: Haiku still reads first and every
receipt that adds up is read once, by Haiku alone.

## Build

1. **`api/src/config.ts`.** Add `RECEIPT_ESCALATION_MODEL` to
   `ReceiptReaderConfig` as `escalationModel: string | null`, defaulting to
   `claude-sonnet-5-5` (export the default from `@ledger/receipts` beside
   `DEFAULT_RECEIPT_MODEL`). An empty value turns escalation off, so the owner
   can go back to Haiku alone without a deploy. Document it wherever
   `RECEIPT_MODEL` is documented (grep for it: the README, the compose file, the
   setup docs).
2. **`api/src/server.ts` (or wherever the reader is built).** Build a second
   reader with `createModelReader` and the escalation model, when one is
   configured. Same key, same options. `receipts/src/reader.ts` does not change:
   the reader stays "reads, and does nothing else". The decision to read again
   belongs to `api`, which already owns the check.
3. **`readReceipt` in `api/src/receipts.ts`.** After the first reading is
   repaired and checked as today, escalate when **any** proposal carries a flag
   from `RECEIPT_FLAGS`. Read the whole photo again with the escalation reader,
   with the same offered categories, then repair and check that reading exactly
   as the first.
   - **Keep the escalated reading only if it is strictly better**: fewer
     proposals carrying `items-differ`, or, when those are equal, fewer flags
     in total; and never a reading with fewer proposals than the first (the
     owner's answer of 2026-11-10, in the Log). Otherwise keep the first. Compare whole readings, never mix proposals from the two:
     a photo holding two receipts may come back in a different order or count,
     and matching proposals across readings is a guess.
   - **One escalation, never a loop.** A reading that is still flagged goes to
     the person, as it does today.
   - **An escalation that fails** (timeout, unreachable, busy, refused) keeps the
     first reading and logs the failure through the existing logger, with the
     usual redaction. The person must not lose a reading Haiku already
     answered because Sonnet failed.
   - `signal` is passed to both reads, so a person who hangs up stops either.
4. **`ReadReceiptResponse.model`** already names the model whose reading is
   returned. Set it to the escalation model when its reading is kept. The
   screen says the photo went to that model, which is now true of both.
   **Trap:** the upload answer's `reader` (`UploadedReceipt`) names the one
   model the photo _will_ go to, before the person asks for a read. With
   escalation the photo may go to two. Saying both needs a contract field,
   and changing `@ledger/contract` means stopping to ask the owner. Whether
   the screen's sentence must name the second model is that question; until
   it is answered, word the screen's existing sentence so it stays true
   ("read by Claude"), if that needs no contract change.

   **Answered 2026-11-10 by the owner, at intake** (relayed in the builder's
   dispatch). The question: the upload answer's `reader` names the one model
   the photo will go to, but with escalation a flagged photo goes to two; how
   should the screen handle that?
   - **Reword the screen's existing sentence to "read by Claude". No contract
     change; the response's `model` still names the model whose reading was
     kept (chosen).**
   - Add a contract field to `UploadedReceipt` naming the escalation model, so
     the screen can say both.
   - Leave the sentence naming the first model only.

   So `@ledger/contract` is not changed. The "until it is answered" above is
   superseded by this answer: the rewording is the decision, not a stopgap. If
   the rewording turns out to need a contract change, the build stops and
   reports it as an open decision.

5. **Timeout.** Two reads can take twice as long. The route's own timeout, if
   there is one above the reader's per-attempt `DEFAULT_READ_TIMEOUT_MS`, must
   leave room for the second. Measure it: find what stops the request, rather
   than assuming there is nothing.

**Not in scope.** A rebate folded into the wrong item still adds up, so nothing
here escalates it; only the person catches it (`reader.ts`'s header says so).
Do not escalate on anything but a flag.

## Done when

- A test in `api/test` with a fake first reader that answers a reading flagged
  `items-differ` and a fake escalation reader that answers one that adds up
  shows the response carries the escalated reading, with no flags, and
  `model` naming the escalation model.
- A test with an escalation reading that is no better (no fewer `items-differ`
  proposals, and no fewer flags when those tie; or fewer proposals in all than
  the first, whatever its flags) shows the first reading is
  returned, with `model` naming the first model.
- A test with a first reading that adds up shows the escalation reader is never
  called.
- A test with an escalation reader that throws shows the first reading is
  returned and the failure is logged, with no credential in the log line.
- A test with `RECEIPT_ESCALATION_MODEL` set empty shows no second reader is
  built and a flagged reading is returned as read.
- `npm run check` and the ledger suite pass.

## Review

**Gate: CONCERNS** — 2026-11-10 · `a100f429..ada61718` · Sonnet 5.5, depth full

| Done when                                                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fake first reader answers `items-differ`, fake escalation reader answers one that adds up: response carries the escalated reading, no flags, `model` naming the escalation model | **proven** — `api/test/receipt-escalation.test.ts` › "an escalated reading that adds up is answered, with no flags, named by the escalation model": asserts both readers called once, `model` is `fake-sonnet`, flags are `[[]]` (a one-element list, so it fails on empty output), proposal equals the adding-up fixture                                                                                                                                                                                                                                                                                                           |
| Escalation reading that is no better (same or more flags): first reading returned, `model` naming the first                                                                      | **unproven (open decision)** — the test `api/test/receipt-escalation.test.ts` › "an escalated reading that is no better is not kept: same flags, or more" proves the line's own two inputs (same flags; more flags with `items-differ` unchanged) and fails when the call site always keeps the second reading. Two facts contradict on one subcase: Build 3 ranks fewer `items-differ` proposals as strictly better whatever the total, the line's gloss calls "more flags" no better. `isBetter` follows Build 3, so it keeps a second reading with fewer `items-differ` and more flags in total. No test asserts either way (F1) |
| First reading that adds up: escalation reader never called                                                                                                                       | **proven** — `api/test/receipt-escalation.test.ts` › "a first reading that adds up never reaches the escalation reader": calls are `[1, 0]`; escalating on every read fails it                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Escalation reader that throws: first reading returned, failure logged, no credential in the log line                                                                             | **proven** — `api/test/receipt-escalation.test.ts` › "an escalation reader that throws leaves the first reading answered, and the failure logged with no credential": exactly one `was not read again` line (the companion that fails on an empty log), its `level`, `model`, `code`, `outOfTime` asserted, no `KEY-MARKER` or `sk-ant` anywhere in the log; logging the error object fails it                                                                                                                                                                                                                                      |
| `RECEIPT_ESCALATION_MODEL` set empty: no second reader built, flagged reading returned as read                                                                                   | **proven** — `api/test/receipt-escalation.test.ts` › "with RECEIPT_ESCALATION_MODEL set empty, no second reader is built and a flagged reading is returned as read": the factory's built list is exactly the first model, one read, flags `[["items-differ"]]`; its sibling "unset, the second reader is built with the same key and options…" builds two                                                                                                                                                                                                                                                                           |
| `npm run check` and the ledger suite pass                                                                                                                                        | **verified** — PR #780's CI at `ada61718`: `check` (npm run check) and `test (ubuntu-latest)` (projects ledger, repo, core: 130 files, 3,021 tests) both success; `e2e`, `docker`, `codeql`, `dependency-review` and the informational Windows leg also success. Locally `receipt-escalation.test.ts` is 13 of 13                                                                                                                                                                                                                                                                                                                   |

- **med** · Done when 2's parenthetical depends on it; **open decision** · `isBetter` in `api/src/receipts.ts` ranks the count of proposals carrying `items-differ` before the total flags. No test asserts the order: the mutants "total flags only", "disjunctive" (`a || b`) and "flags first" each pass 13 of 13, because the test titled "fewer proposals that do not add up wins; then fewer flags; a tie keeps the first" only has pairs where both criteria agree. Over 1,452 enumerated pairs (a flagged first, a second with at least as many proposals) the order decides 274 against flags-only and 192 are kept with at least as many flags in total as the first (`[items-differ]` then `[parts-differ, tax-differs]`: `items-differ` 1 to 0, flags 1 to 2), which Done when 2's gloss would refuse. Options: **A (recommended)** keep the order, reword Done when 2's parenthetical to "no fewer `items-differ` proposals, and no fewer flags when those tie", add two assertions (fewer `items-differ` with more flags is kept; more `items-differ` with fewer flags is refused) which kill all three mutants; **B** total flags only, as the gloss reads, which drops a second reading that clears the filing blocker but adds two other flags; **C** the disjunctive "or else", which keeps a reading that adds a blocking proposal when its total is lower (82 pairs). Either way the owner decides before a fix round.
- **low** · no `Done when` line depends on it · `readReceipt`'s `left <= 0` branch is asserted by no test: deleting it passes 13 of 13 (a negative delay is refused by `AbortSignal.timeout` inside the `try`, so the first reading is still kept; only the log's `outOfTime` and `code` differ). Run by hand it answers 200 with the second reader never called.
- **low** · no `Done when` line depends on it · the second reading gets whatever time is left, with no minimum: with the first read at 260 ms of a 300 ms deadline the photo still went to the second model, one request sent and aborted at the deadline. Live only after an SDK retry on the first read (60 s per attempt), so rare.
- **low** · `nfr:maintainability` · shipped comments the build left false in the safe direction: `web/src/receipts/Receipts.tsx` header says the screen names the model beside the button, and `receipts/src/reader.ts` header says "Claude Haiku 5.5 alone". The `@ledger/contract` comments on `UploadedReceipt` and `ReadReceiptResponse` say the same and are covered by the owner's 2026-11-10 answer, so not a finding.
- **low** · `RECEIPT_ESCALATION_MODEL` unset defaults to Sonnet whatever `RECEIPT_MODEL` is: with `RECEIPT_MODEL=claude-sonnet-5-5` (the configuration `receipts.test.ts` itself pins) a flagged read is read twice by the same model, and the deployment row says nothing of it. Equal models build two readers (matrix run). The brief's default, so a note for the owner, not a defect.
- **low** · the owner's 2026-11-10 answer on fewer proposals is on no page of the branch: Build 3 still reads "or else fewer flags in total" and the Log calls it "the builder's call". The lander records it.
- **dropped** · deadlines of 0, -5, 0.5, 1, NaN, Infinity, 2^31 and 2^32+5 through `receiptReadDeadlineMs`: every one answered 200 with the first reading kept or the second read, none a 500. The option is test-only, with no live call site.
- **dropped** · "a timer that is not cleared": `AbortSignal.timeout` is unref'd (a process holding `AbortSignal.timeout(100000)` exits in 63 ms) and every vitest run here ended on its own.
- **dropped** · "real network reachable from a test": across 108 configurations (key set or not, six escalation values, three handed-in first readers, three handed-in second readers) no reader was built without a key, and every built reader was the counting factory's.
- **dropped** · a hang-up during the second read logs the "not read again" warning: noise only, the first reading is answered to nobody.
- **findings** · the hunt returned 11; 6 carried, 5 dropped (the contract comments are the fifth, in the bullet above).
- NFR: security ✓ (the failure line holds `model`, `code`, `outOfTime` and nothing else; boot lines hold a model name; the receipt-read rate limit bounds the extra paid call to one per read) · performance ✓ (a flagged read waits for the first plus at most the rest of 100 s; Cloudflare's 125 s is the repo's figure, not re-measured) · reliability ✓ (any failure, abort, deadline or throw in repair or check of the second reading leaves the first answered) · maintainability — above (four test-only knobs plumbed through `createApp`, the route options and `ReceiptReaders`). 360 px: the one web change rewords a sentence, no new control, `e2e (ledger)` green.

### Gate 2

**Gate: PASS** — 2026-11-10 · `ada61718..c7767dd8` · Sonnet 5.5, depth narrow (the four named attacks and the acceptance table, plus a read of the round's diff)

| Done when                                                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fake first reader answers `items-differ`, fake escalation reader answers one that adds up: response carries the escalated reading, no flags, `model` naming the escalation model | **proven** — unchanged from gate 1: `api/test/receipt-escalation.test.ts` › "an escalated reading that adds up is answered, with no flags, named by the escalation model"; the file is 15 of 15 at the head                                                                                                                                                                                                                                                         |
| Escalation reading that is no better (no fewer `items-differ` proposals, and no fewer flags when those tie): first reading returned, `model` naming the first                    | **proven** — `api/test/receipt-escalation.test.ts` › "an escalated reading that is no better is not kept: same flags, or more" (equal `items-differ` with equal flags, then with more flags: `model` is `fake-haiku`, the first proposal and its flags answered), and the order itself by › "fewer proposals that block filing outranks fewer flags in total", both directions. The open decision of gate 1 is closed by the owner's answer A and the reworded line |
| First reading that adds up: escalation reader never called                                                                                                                       | **proven** — unchanged: › "a first reading that adds up never reaches the escalation reader"                                                                                                                                                                                                                                                                                                                                                                        |
| Escalation reader that throws: first reading returned, failure logged, no credential in the log line                                                                             | **proven** — unchanged: › "an escalation reader that throws leaves the first reading answered, and the failure logged with no credential"                                                                                                                                                                                                                                                                                                                           |
| `RECEIPT_ESCALATION_MODEL` set empty: no second reader built, flagged reading returned as read                                                                                   | **proven** — unchanged: › "with RECEIPT_ESCALATION_MODEL set empty, no second reader is built and a flagged reading is returned as read"                                                                                                                                                                                                                                                                                                                            |
| `npm run check` and the ledger suite pass                                                                                                                                        | **verified** — PR #780's CI at `c7767dd8`: `check` and `test (ubuntu-latest)` success (the ledger project is in that run), `e2e`, `docker`, `codeql`, `dependency-review`, and the informational Windows leg success. Locally the spec file is 15 of 15 and `oxfmt --check` is clean on the five changed files                                                                                                                                                      |

Verdicts on gate 1's findings:

- **F1 (med, `isBetter`'s order): fixed.** `TAX_OFF` joins the fixtures (its two flags asserted in "the fixtures say what the tests take them to") and the new › "fewer proposals that block filing outranks fewer flags in total" asserts both directions. Gate 1's mutants on the head: `flagsonly`, `disjunctive` and `flagsfirst` each fail exactly that test (1 of 15); the unmutated head is 15 of 15 (the positive control). Two more mutants that return a constant (`isBetter` always false, always true) fail 5 and 4 tests, so neither assertion passes on a default output. Over 118,712 enumerated pairs (a flagged first of 1 to 3 proposals, a second of 0 to 4, five flag sets) Done when 2's parenthetical is never true of a pair `isBetter` keeps (0), and Build 3's sentence equals `isBetter` on every pair (0 mismatches). On gate 1's own 1,452-pair population the parenthetical is the exact complement of `isBetter` (nothing the code refuses is left unnamed).
- **F2 (low, `left <= 0`): fixed.** › "a first read that has used the whole deadline is not followed by a second, and the log says so" fails when the branch is deleted (1 of 15), 10 of 10 runs pass on the head (a 120 ms first read against a 50 ms deadline). The Log's account of why it fails is wrong: N1.
- **F4 (low, stale comments): fixed in part.** The `Receipts.tsx` header and the `receipts/src/reader.ts` header now say what the screen says ("Anthropic and Claude", no one model) and that a flagged reading is read again. Remaining, the same mechanism: the doc comment on `ReceiptReader.model` in `receipts/src/reader.ts` still reads "which the screen names before the photo is sent", and the Log says that file "no longer" says it. The same words in `api/test/receipts.test.ts` (a comment on the upload's `reader`) mirror the contract's, which the owner's answer covers. Low, safe direction (it promises a disclosure the screen no longer makes, and nothing relies on it).
- **F6 (low, the owner's answer on fewer proposals on no page): fixed.** Build 3 now reads "fewer proposals carrying `items-differ`, or, when those are equal, fewer flags in total; and never a reading with fewer proposals than the first (the owner's answer of 2026-11-10, in the Log)", and the Log's build entry no longer calls it the builder's call. Both match the code on the enumerated population.
- **Not in the round, left as gate 1 recorded them, not re-raised:** the second read's missing minimum time, and the escalation default when `RECEIPT_MODEL` is Sonnet.

The owner's `tools/ledger/CLAUDE.md` sentence reads exactly "and the screen says, beside that button, that the photo goes to Anthropic to be read by Claude; a reading the arithmetic flags is read again, once, by `RECEIPT_ESCALATION_MODEL` (lg-105);". A word-level diff of the file against `ada61718` has two hunks, both inside that sentence; nothing else in the file changed, and it is the only `CLAUDE.md` the round touches. The screen's own text ("Reading sends this photo out of the house, to Anthropic, where it is read by Claude.") says what the sentence says.

The round changes no source apart from comments: `git diff ada61718 c7767dd8 -- '*/src/*'` is two files, 16 changed lines, 0 of them outside a doc comment.

New findings in the lines the round touched:

- **low** · no `Done when` line depends on it · **N1**, the Log's F2 entry says "Deleting the branch fails it (1 of 15): the second reader is then asked". It is not asked: with the branch deleted `AbortSignal.timeout` refuses the negative delay inside the `try`, `second.calls` stays 0 and the first reading is answered; the test fails on the log's `outOfTime` (`false`, where the test asserts `true`). So the assertion that guards the branch is the log field, not the call count. Reproduction: mutate `receipts.ts` by deleting the `if (left <= 0)` line and run the test: `expected { level: 'warn', …(7) } to match object { level: 'warn', …(2) }`, `- "outOfTime": true`, `+ "outOfTime": false`, at the `toMatchObject` line that follows `expect(second.calls).toBe(0)`. A Log sentence false about a detail nothing relies on.
- **low** · no `Done when` line depends on it · **N2**, Done when 2's parenthetical (gate 1's own recommended wording) says what is no better by two conditions and is silent on the third rule, a second reading with fewer proposals than the first, which `isBetter` refuses whatever its flags: 2,912 of 118,712 enumerated pairs are refused by the code and not named by the parenthetical, all with fewer proposals; none in gate 1's population, which only held seconds with at least as many. The parenthetical is a sufficient condition, not the whole rule; Build 3 states the whole. Safe direction.

- **dropped** · the reader header naming `DEFAULT_ESCALATION_MODEL` where the `CLAUDE.md` names the variable: the header states the default, and is true.
- **dropped** · the new wall-clock test as flaky: 10 of 10 pass, and the margin (120 ms against 50 ms) only grows under load.
- **dropped** · Build 3's long wrapped line: `oxfmt --check` passes (prose is preserved), cosmetic.
- **dropped** · `docs/02-DEPLOYMENT.md` saying "adds up better" where `00-ANALYSIS.md` says "strictly better": not in the round, and true under either order.
- **findings** · the hunt returned 7; 3 carried (F4's remainder, N1, N2), 4 dropped. Nothing is a `high` or a `med`.
- NFR: security ✓ (no source changed; the failure line still holds `model`, `code`, `outOfTime` only, and the new test asserts no `code` on the out-of-time path) · performance n/a (comments and tests; the new test adds about 150 ms) · reliability ✓ (new timing test 10 of 10) · maintainability — above · 360 px n/a (a comment in a `web/src` file only).

## Log

### 2026-11-10 — build (builder, Opus 5.5)

Built on `a100f429`. Steps 1–5 are in place, with the owner's answer above for
step 4: `@ledger/contract` is not changed.

- **Step 1.** `RECEIPT_ESCALATION_MODEL` → `ReceiptReaderConfig.escalationModel`,
  `DEFAULT_ESCALATION_MODEL = "claude-sonnet-5-5"` exported from
  `@ledger/receipts` beside `DEFAULT_RECEIPT_MODEL`. Unset is the default and
  empty (or blank) is `null`, unlike every other variable in `config.ts`, where
  blank is unset. Documented in `tools/ledger/.env.example` and in the root
  `docs/02-DEPLOYMENT.md` table, the two places `RECEIPT_MODEL` is. **The
  brief named a compose file and a README: neither names `RECEIPT_MODEL`.**
  `compose.ledger.prod.yaml` passes only the key, and the deployment doc says
  the other rows go in an override file, so the new row follows it.
- **Step 2.** Built in `api/src/server.ts` (`receiptReadersFor`) with the same
  key, logger and options; only `model` differs. `receipts/src/reader.ts` gains
  only the constant: the reader is unchanged. **Built from configuration only
  when the first reader is**: beside a handed-in `receiptReader`, the
  escalation is `escalationReader` or none, so a test that hands in a fake
  reader and a key (`receipts.test.ts`'s "what is logged" does) cannot build a
  real Sonnet reader by accident. Two test-only options, `modelReader` (the
  factory, `createModelReader` by default) and `receiptReadDeadlineMs`.
  `api/test/helpers/no-model-environment.ts` clears `RECEIPT_ESCALATION_MODEL`
  from the host too.
- **Step 3.** `readReceipt` reads again when any proposal carries any flag, with
  the same categories and the same repair and check, and keeps the second
  reading only when `isBetter` says so. **The brief's rule, applied as written,
  keeps a reading that dropped a receipt**: an empty reading ("not a receipt")
  has no flags, and a reading of one receipt out of two has fewer. `isBetter`
  never keeps a reading with fewer proposals than the first. The builder
  reported it as an open decision, and the owner answered it (below). The
  failure log line is
  `warn "a flagged receipt was not read again; the first reading is kept"`
  with `model`, `code` (`AppError.from(error).code`) and `outOfTime`. It holds
  no message, cause, URL or header, so `redactHeaders` and `redactUrl` have
  nothing to redact.
- **Step 4.** `model` names the escalation model when its reading is kept. The
  screen's sentence now reads "where it is read by Claude." / "where they are
  read by Claude, one at a time." The upload's `reader` still decides whether
  the offer shows. **The brief says "the screen says the photo went to that
  model"**: no screen reads `ReadReceiptResponse.model` (`grep -rn "\.model"
  tools/ledger/web/src` → nothing), so only the upload's sentence named a
  model.
- **Step 5, measured.** Nothing in the API stops a slow read. The scratch run
  (`what-stops.mts`: the app listening, a fake reader answering after 130 s,
  Node's `fetch`):
  `server timeouts (ms): requestTimeout=0 headersTimeout=60000 timeout=0 keepAliveTimeout=72000`
  then `read 200 after 130.0 s`. `headersTimeout` bounds only the request's
  own headers. The web's `requestJson` sets no timeout. What stops it is the
  edge. `docs/02-DEPLOYMENT.md` says Cloudflare answers `524` to an origin
  silent for 125 s, and keeps the downloader's wait under 100 s. The
  Cloudflare docs did not load here (WebFetch failed on both pages), so that
  figure is the repo's, not re-measured. The first read is already up to
  3 × 60 s per lg-8's gate, which is unchanged. The second read is therefore
  given `READ_DEADLINE_MS = 100_000` from the route's start, minus what the
  first took. A second reading still going then is aborted, and the first
  reading is answered (`outOfTime: true` in the log line).
- **A defect the tests found in the build itself:** `AbortSignal.timeout`
  refuses a fractional delay. The first cut passed
  `deadline - performance.now()` straight in, and every escalating read
  answered 500, losing the first reading. The delay is now floored. Everything
  the second reading takes is inside its `try`, so nothing it throws can cost
  the first reading again.

Tests: `tools/ledger/api/test/receipt-escalation.test.ts`, 13 tests: one per
Done-when line, plus the deadline, both signals, the factory's "same key and
options", "nothing built beside a handed-in reader", and `isBetter`. In
`web/test/receipts.test.tsx`, the two assertions that read the model's name in
the sentence now read "read by Claude".

Fold-in: none was free. The ledger `CLAUDE.md`'s "the screen names the model
beside that button" (Rules, receipts paragraph) and "Claude Haiku 5.5 through
Anthropic's SDK" (Layout) are now stale. A `CLAUDE.md` is edited only when the
Build names it, so both are proposed to the orchestrator instead.

### 2026-11-10 — owner's answers after gate 1 (recorded by the fixer, Sonnet 5.5)

Three questions, answered by the owner on 2026-11-10 and relayed in the fixer's
dispatch.

1. **Gate 1, F1: which criterion ranks first in `isBetter`?** `isBetter` counts
   the proposals carrying `items-differ` before it counts flags in total, and no
   test asserted the order; Done when 2's parenthetical read as total flags
   only. Options: **A, keep the order (`items-differ` first), reword Done when
   2, add two assertions (chosen; the gate's recommendation)**; B, total flags
   only, which drops a second reading that clears the filing blocker but adds
   two other flags; C, either criterion wins (`a || b`), which keeps a reading
   that adds a blocking proposal when its total is lower. Done when 2 and Build
   3 now say the order; the assertions are in the next entry.
2. **The builder's open decision: a second reading with fewer proposals than
   the first.** Read as written, Build 3 keeps it whenever it has fewer flags,
   and an empty reading ("not a receipt") has none. Options: **1, never keep a
   second reading with fewer proposals (chosen; the builder's recommendation,
   already built)**; 2, the brief literally; 3, require the same count. So
   this is the owner's answer, not "the builder's call" as the build entry first
   wrote it; Build 3's "or else fewer flags in total" is corrected to say what
   is built.
3. **`tools/ledger/CLAUDE.md`'s receipts paragraph, stale after the build.**
   Options: **the lander or this branch edits it (chosen)**; the owner edits it;
   file a ticket. The owner authorised that one sentence ("and the screen names
   the model beside that button"), which now reads that the screen says the
   photo goes to Anthropic to be read by Claude, and that a flagged reading is
   read again, once, by `RECEIPT_ESCALATION_MODEL`. Nothing else in any
   `CLAUDE.md` changed, so the Layout line "Claude Haiku 5.5 through
   Anthropic's SDK" the build entry named stays as it was.

### 2026-11-10 — gate 1 findings applied (fixer, Sonnet 5.5)

- **F1** (`isBetter`'s order). `TAX_OFF` (two flags, none `items-differ`) joins
  the fixtures, and "fewer proposals that block filing outranks fewer flags in
  total" asserts both directions: `TAX_OFF` over `CENTS_OFF` is kept, the
  reverse is refused. Mutants run with gate 1's `mutate.mjs` on the committed
  tree, 1 of 15 failing each: total flags only, `a || b`, and flags first.
- **F2** (`left <= 0`). A first reader that answers a flagged reading after
  120 ms against a 50 ms deadline: the second reader is called 0 times, the
  first reading is answered, and the one `was not read again` line carries
  `outOfTime: true` and no `code`. Deleting the branch fails it (1 of 15) on the
  log's `outOfTime`, `false` where `true` is asserted: the negative delay is
  refused inside the `try`, so the second reader is still never called.
- **F4** (stale headers). `Receipts.tsx` and `receipts/src/reader.ts` no longer
  say the screen names one model or that Haiku reads alone. The
  `@ledger/contract` comments are untouched, as the owner's answer of
  2026-11-10 covers them.
- **F6.** The owner's answer on fewer proposals is above, and Build 3 says what
  is built.
- Not this round, left as gate 1 wrote them: no minimum time for the second
  read, and the escalation default being Sonnet when `RECEIPT_MODEL` is Sonnet.

### 2026-11-10 — owner's answer at the landing (recorded by the lander, Sonnet 5.5)

- **The Layout line of `tools/ledger/CLAUDE.md`: does the lander add the second
  model?** Options: **add "and Sonnet 5.5 for a flagged reading (lg-105)" after
  "Anthropic's SDK" (chosen, the orchestrator's recommendation)**; leave the
  line as it was. The owner's answer, 2026-11-10, relayed in the lander's
  dispatch. Only that sentence changed, re-wrapped; the entry above that said
  the Layout line stays is superseded by this answer.
- 2026-11-10 — Fixed at landing by owner choice: the Layout line of `tools/ledger/CLAUDE.md`
  naming Sonnet 5.5 for a flagged reading. `git diff c7767dd8 HEAD -- tools/ledger/CLAUDE.md | grep -v 'Fixed at landing' | grep -c '^+.*Sonnet 5.5 for a flagged reading'` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F4 remainder — "the doc comment on `ReceiptReader.model` in `receipts/src/reader.ts`". It now says the screen names Anthropic and Claude, not the model. `git diff c7767dd8 HEAD -- tools/ledger/receipts/src/reader.ts | grep -c '^-.*which the screen names before the photo is sent'` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N1 — "the Log's F2 entry says deleting the branch fails the test because the second reader is then asked". The F2 entry now names the log's `outOfTime` as what fails. `git diff c7767dd8 HEAD -- tools/ledger/docs/work/lg-105-a-flagged-reading-is-read-again-by-a-stronger-model.md | grep -c '^-.*second reader is then asked'` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N2 — "the reworded Done when 2 parenthetical names two conditions and is silent on the third rule". The parenthetical now adds "or fewer proposals in all than the first, whatever its flags", the whole rule, matching Build 3. `git diff c7767dd8 HEAD -- tools/ledger/docs/work/lg-105-a-flagged-reading-is-read-again-by-a-stronger-model.md | grep -c '^-.*and no fewer flags when those tie) shows the first reading is'` → 1.
