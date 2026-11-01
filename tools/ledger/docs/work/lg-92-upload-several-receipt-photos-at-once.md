---
id: lg-92
tool: ledger
title: Upload several receipt photos at once, and confirm them from a queue
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# lg-92 — Upload several receipt photos at once, and confirm them from a queue

## Why

The receipt screen takes one photo at a time (`web/src/receipts/Receipts.tsx`,
a `type="file"` input with `capture="environment"` and no `multiple`). One
photo can already hold up to `MAX_RECEIPTS_PER_PHOTO` (10) receipts side by
side, each filed as its own `part`. But lg-8 measured only two side by side,
and long grocery receipts placed next to each other get small in the image. The
owner asked on 2026-11-01 to read "a bunch of receipts at the same time", for
example a week's worth after shopping.

## Decision — answered 2026-11-01 by the owner

Asked through `AskUserQuestion`. **Chosen: build multi-photo upload.** The other
options were to first measure several long receipts in one photo with a paid
read, and to leave it as it is.

## Build

This is web only. The contract and the routes do not change. Each photo goes
through the same three routes as today:

1. `POST ROUTES.receipts` to upload;
2. `POST ROUTES.receiptRead` to read;
3. `POST ROUTES.receiptFile` to file each part.

The fact that shapes the build: **reads are rate-limited to 5 a minute per
person** (`rateLimitReceiptReadsPerMinute`, `api/src/config.ts`, the paid
route's own bucket, lg-8 gate 1, F4). A batch of twelve would get 429s. Do not
raise the limit to fit the batch. It is the cap on what a person can spend.

1. Add a second input that takes several photos (`multiple`, no `capture`, so
   a phone opens its gallery). The camera input stays as it is.
2. Check each photo's size before upload, as today. One that is too large is
   listed as refused, and the rest go on.
3. Upload the photos one at a time. As today, a photo leaves the house only on
   the person's tap: show one **Read all** button with the same notice naming
   the model.
4. Read the photos **one at a time**. On a 429, wait as long as the response's
   `Retry-After` header says, then go on. Show "`n` of `N` read". That count
   is real, so it is not faked progress. A read that fails stays in the queue
   with a retry button and does not stop the others.
5. The queue lists every receipt each photo produced (a photo can produce
   several parts). Opening one shows today's confirmation form, unchanged,
   including lg-89 and lg-90's item controls once those have landed. Filing it
   returns to the queue and marks it filed. Nothing is filed without the
   person's tap on that receipt, as today.
6. The queue lives in the screen's state. Leaving the screen loses the
   unfiled readings, but not the photos, which are stored. Say so beside
   **Read all**. Bringing back stored, unread photos is not part of this ticket.
7. `e2e/layout.spec.ts`: a case with a queue of several receipts at 360 px and
   1280 px.

If lg-90 has merged when this is built, rebase onto it, since both touch
`Receipts.tsx`. Neither changes the other's logic.

## Done when

1. A web test selects three photos and proves three uploads and, after
   **Read all**, three reads, one at a time. Nothing is read before the tap.
2. A web test proves that a 429 with `Retry-After` on the second read delays
   that read and does not drop it, and the count reaches "3 of 3 read". Use
   fake timers, not a real wait.
3. A web test proves that a read failing for another reason leaves that photo
   with a retry and the others read.
4. A web test proves a photo of two receipts gives two queue entries, and
   filing one marks only that one filed.
5. `e2e/layout.spec.ts` covers the queue at 360 px and 1280 px with no
   horizontal page scroll.
6. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass.

## Review

**Gate: CONCERNS** — 2026-11-01 · `54df4ee6..0587e1d3` (stacked on lg-89's head, PR #717) · Opus 5.5, depth full

| Done when                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Three photos, three uploads, three reads one at a time after **Read all**, none before                   | `web/test/receipts.test.tsx` › "three photos go up one at a time and nothing is read before Read all, then three reads, one at a time (lg-92)" ✓: three uploads in selection order, `readReceipt` not called before the tap, reads `[11, 12, 13]`, `widest` 1. Red under a `Promise.all` fan-out of `readThese`                                                                          |
| 2. A 429 with `Retry-After` on the second read delays it, drops nothing, reaches "3 of 3 read", fake timers | `web/test/receipts.test.tsx` › "a 429 with Retry-After delays that read, drops nothing, and the count reaches 3 of 3 (lg-92)" ✓ (two calls at 6,999 ms, `[11, 12, 12, 13]` at 7,000 ms, "3 of 3 read"), with the header's path into `details` in `web/test/client-retry-after.test.ts` › "a 429 carries the Retry-After header's seconds, over the body's copy" ✓. Red under the fan-out |
| 3. A read failing for another reason keeps a retry, the others read                                         | `web/test/receipts.test.tsx` › "a read that fails for another reason keeps that photo with a retry and reads the rest (lg-92)" ✓                                                                                                                                                                                                                                                         |
| 4. A photo of two receipts gives two entries; filing one marks only that one                                | `web/test/receipts.test.tsx` › "a photo of two receipts gives two entries, and filing one marks only that one (lg-92)" ✓                                                                                                                                                                                                                                                                 |
| 5. `e2e/layout.spec.ts` covers the queue at 360 and 1280 px, no horizontal page scroll                      | `e2e/layout.spec.ts` › "the receipt queue fits a phone and a desktop, kept and then read" ✓, ledger.yml `e2e` pass on `0587e1d3`, and passed locally. A queue state it does not reach scrolls: F1                                                                                                                                                                                        |
| 6. `npm run check`, `npm test -- --project ledger`, `npm run e2e:ledger` pass                               | ci.yml `check` pass, `test (ubuntu-latest)` pass (`--project ledger --project repo --project core`, 2,748 of 2,748), ledger.yml `e2e` pass, all on `0587e1d3`. Locally, `npx vitest run tools/ledger/web` gave 316 of 316                                                                                                                                                                |

- **med** · Done when 5 depends on it · `nfr:layout`: the queue's "Photos left out" list overflows a 360 px phone. Its `li.name` sits outside `.queue`, so the new `.queue .name { overflow-wrap: anywhere }` in `web/src/styles.css` does not reach it. With an oversize photo and a failed upload, both 80-character names, the page measured `scrollWidth=749` in a 360 px window (card, `h2` and `div.bad` past the edge). At 1280 px it fits, and so do ten 80-character names kept and read at 360 px. `.claude/rules/responsive-layout.md` forbids this. It is a `med` and not a `high` because it needs a long name with no break in it. Direction, not run: let the left-out names break like the queue's, and add a left-out state to the layout case.
- **med** · no `Done when` line depends on it · a receipt filed from a photo that was **not read** (a kept photo's "Type it in", or a failed photo's) is not shown as filed, and it is filed again as part 1. `markFiled` records the part, but the kept and failed rows never show `filed`, and both "Type it in" buttons open part 1, not `nextPart(photo.filed)`. Measured: after filing a kept photo the row still reads "Kept, not read yet. Type it in". **Read all** then pays to read that photo (reads `[11, 12]`). A second receipt typed from the same kept photo files `[[11,1],[11,1]]`, which the API refuses as `RECEIPT_ALREADY_FILED`. A failed photo still reads "The read failed … Try again · Type it in" after its receipt is filed. This path will be used: in a household with no reader, every photo is typed in from these rows. Brief step 5 asks that filing "marks it filed". **Open decision** — should **Read all** skip a photo that already has a filed part? (a) Skip it: no paid read for a photo already handled (recommended). (b) Read it anyway, since it may hold more receipts.
- **low** · the Log says "The brief's `Retry-After` header was not reachable from the screen". The header was not, but its number was. At the base, `requestJson` already passed the body's `details` through, and `api/src/rate-limit.ts` puts `retryAfterSec` there, so the queue could have read the wait without the `client.ts` change. The claim is false in the safe direction: the change is harmless, and every header in the swept population gives a bounded wait.
- **low** · "Start over" stays enabled while photos upload, and it does not stop them. All three uploads finished after it was tapped. The photos stay on the household's server and do not appear on screen. No read is sent.
- **low** · `nfr:maintainability` — no test covers the double-tap guard (`readingNow`), the cap of five waits, or reading stopping on unmount. All three hold when probed (see the full report).
- **dropped** · a double tap on the form's File button filed twice (`fileReceipt` 2 calls). This was my harness: both clicks ran in one `act`. As two separate events the button is disabled after the first, and there was 1 call.
- **dropped** · leaving the screen during a `Retry-After` wait leaves one pending timer (up to 120 s). When it fires it reads nothing and updates no state: no observable effect.
- **findings** · the hunt returned 7; 5 carried, 2 dropped.
- NFR: security ✓ (web only; no new route; a read happens only on the tap that names the model) · performance ✓ (reads one at a time; waits held to 1–120 s, 15 s with no number) · reliability — F2 above · maintainability — the low above.

### Gate 2

**Gate: PASS** — 2026-11-01 · `0587e1d3..987a3461` (round: `12be04fc`, `987a3461`; stacked on lg-89's head, PR #717) · Opus 5.5, depth medium

| Done when                                                                                 | Proof                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Three photos, three uploads, three reads one at a time after **Read all**, none before | `web/test/receipts.test.tsx` › "three photos go up one at a time and nothing is read before Read all, then three reads, one at a time (lg-92)" ✓. Red under the fan-out control (`expected 3 to be 1`)                                                                                                                         |
| 2. A 429 with `Retry-After` delays the second read, drops nothing, reaches "3 of 3 read"  | `web/test/receipts.test.tsx` › "a 429 with Retry-After delays that read, drops nothing, and the count reaches 3 of 3 (lg-92)" ✓. Red under the fan-out control                                                                                                                                                                 |
| 3. A read failing for another reason keeps a retry, the others read                       | `web/test/receipts.test.tsx` › "a read that fails for another reason keeps that photo with a retry and reads the rest (lg-92)" ✓                                                                                                                                                                                               |
| 4. A photo of two receipts gives two entries; filing one marks only that one              | `web/test/receipts.test.tsx` › "a photo of two receipts gives two entries, and filing one marks only that one (lg-92)" ✓                                                                                                                                                                                                       |
| 5. `e2e/layout.spec.ts` covers the queue at 360 and 1280 px, no horizontal page scroll    | `e2e/layout.spec.ts` › "the receipt queue fits a phone and a desktop, kept and then read" ✓ and › "the receipt queue fits a phone and a desktop with photos left out, by long names" ✓. The second is red with the selector put back to `.queue .name` ("697 px wide in a 360 px window"). ledger.yml `e2e` pass on `987a3461` |
| 6. `npm run check`, `npm test -- --project ledger`, `npm run e2e:ledger` pass             | ci.yml `check` and `test (ubuntu-latest)` pass, ledger.yml `e2e` pass, all on `987a3461`. Locally, `npx vitest run tools/ledger/web` gave 322 of 322                                                                                                                                                                           |

Gate 1's findings:

- **F1 (med, Done when 5) · fixed.** Gate 1's `e2e.sh` probe, with 80-character names for an oversize photo and a failed upload, now measures `scrollWidth=360` at 360 px (749 at `0587e1d3`) and 1280 at 1280 px. The 360 px screenshot shows the names breaking inside the card. The wider `.name` selector reaches the left-out `li.name` and the queue's `span.name` in `receipts/Queue.tsx`, and nothing else. A scan of every class expression in the ledger's `web/src`, `packages/ui/src` and `index.html` (64 files, 457 expressions, string and ternary forms) found no other `name` token. `packages/ui`'s header uses `app-header__name`, which `.name` does not match. No other stylesheet declares `.name`.
- **F2 (med) · fixed, as the owner chose (Read all skips it).** Gate 1's probes now give `[[11,1],[11,2]]` for a kept photo typed in twice (was `[[11,1],[11,1]]`). A failed photo reads "1 receipt typed in from this photo, filed." once its receipt is filed. The edge cases:
  - A read photo with two receipts, one of them filed, is not read again: adding a photo and tapping Read all reads `[11,12]`. Its second part stays a button and files as part 2.
  - A kept photo with a typed-in receipt is skipped by Read all, which reads `[12]`.
  - "n of N read" leaves out exactly the typed-in photos, and nothing else. It cannot show more read than N: a read photo has `read !== null`, so it is never counted as typed in. With 4 photos, one typed in and one failed, it read "2 of 3", and "2 of 2" once the failed photo was typed in. A failed photo nobody types in still keeps the count below N, as it did at `0587e1d3`.
- **F3 (low) · fixed.** The Log's correction says what gate 1's finding said: the header was not reachable from the screen, but its number was, through the body's `details`.
- **F4 (low) · fixed.** "Start over" is disabled while a photo is going up. Measured:
  - It is enabled again once the uploads settle, including when every upload fails, and in a mixed batch of a failure and a slow upload.
  - "Add more photos" stays enabled during uploads, as before.
  - Nothing else's `disabled` changed in the diff.
- **F5 (low) · fixed.** I planted each mutation alone. Each turns exactly one test red, and the other 38 of 39 stay green:
  - With the `readingNow` guard removed, "a second Read all while one is running reads nothing twice" fails (`[11,12,12]`).
  - With `MAX_WAITS` at 1,000,000, "a photo refused five times in a row …" fails (61 calls, not 6).
  - With the `alive` check after the sleep removed, "leaving the screen during a wait reads nothing more" fails (6 calls, not 1).

  The guard test calls `readAll` twice through the hook, and that reaches the same guard the screen relies on. Gate 1's A1 probe double-taps Read all through the screen within one `act`. With the guard removed it reads `[11,12,12,13,13]` with two reads in flight at once, against `[11,12,13]` with one at the head.

New in the round:

- **low** · no `Done when` line depends on it · **open decision**: a photo with a typed-in receipt can no longer be read at all. The round removes "Try again" from a failed photo once one of its receipts is filed, and a kept photo with a typed-in receipt has no read control at all. Measured: the only buttons left are "Type it in", the read parts and "Start over". The owner's answer covered **Read all**, not the per-photo retry. The Log records that the retry is dropped, but not why. Nothing is lost, because "Type it in" still files the next part. Options:
  - (a) Keep it, and say in the Log that a typed-in photo is not read again (recommended). By `ReceiptQueueView`, a read part's "filed" mark is matched to the filed parts by index. A later read's part 1 would therefore show as filed whether or not it is the receipt that was typed in.
  - (b) Restore "Try again" on such a photo, and accept that mismatch.
- **low** · `nfr:reliability` · if an upload stalls, "Start over" stays disabled. `uploadReceipt` passes no signal and `requestJson` sets no timeout, so the button stays disabled until the browser gives up on the request. Leaving the Receipt tab is the way out. Not measured in a browser.
- **dropped** · the bare `.name` selector as a risk to other elements: it reaches only the two intended elements (F1 above).
- **dropped** · whether the hook-level guard test misses the screen's path: the screen reaches the same `readThese` guard (F5 above).
- **dropped** · "n of N" exceeding N: impossible by construction, and never seen in the measurements (F2 above).
- **findings** · the hunt returned 5; 2 carried, 3 dropped.
- NFR: security n/a (no route, no request added; a typed-in photo now sends fewer reads) · performance ✓ · reliability — the low above · maintainability ✓ (each new test is red under its own mutation). Layout: left-out state at 360 and 1280 px measured and screenshot read.

## Log

2026-11-01, builder (Sonnet 5.5), branch `lg-92-multi-photo-queue`, stacked on
lg-89's landed head `54df4ee6` (PR #717): web only, as the Build says. The
contract and the routes did not change.

- **Where it lives.** `web/src/receipts/Queue.tsx` holds the queue (a hook,
  `useReceiptQueue`, and its view); `Receipts.tsx` gained a `queue` stage and a
  second input, "Choose several photos" (`multiple`, no `capture`), on the photo
  step. The queue's state is the hook's, held by `Receipts`, so it survives
  opening a form and coming back; `Start over` clears it. The form is today's,
  with lg-89's Rebate input untouched; from the queue its last button reads
  "Back to the queue" instead of "Start over", and filing returns to the list
  with that receipt marked "filed".
- **The brief's `Retry-After` header was not reachable from the screen.**
  `requestJson` threw an `AppError` that dropped the response headers. The
  server sends the same number in the body (`details.retryAfterSec`,
  `rate-limit.ts`), but the Build says the header, so `client.ts` now puts the
  header's seconds into `details.retryAfterSec` of a `RATE_LIMITED` error, over
  the body's copy, and the queue reads that. A wait is held between 1 and 120 s,
  and 15 s with no usable number; five waits in a row on one photo and the read
  is reported failed, with its retry. Not a contract or route change.
- **Upload failures** are listed with the oversize photos as left out, rather
  than kept in the queue: the file is not held for a retry, and choosing it
  again is the retry. The Build named only the size check.
- **Existing e2e case changed.** `Receipt fits a phone and a desktop, with a
  photo kept and an item typed` found its file input with
  `input[type="file"]`, which the screen's second input made ambiguous; it now
  asks for it by the camera label.
- **Not folded in:** nothing else already specified became free. lg-90 and lg-91
  (per-item checkbox, leaving an item out of a joint row) are unbuilt and wait
  on lg-89's merge; their item controls were left alone.

Proof, from the worktree root (`/tmp/.../lg-92/build/` holds the logs):

- `npx vitest run tools/ledger/web/test/receipts.test.tsx`: 33 of 33 (28 before
  this change; the five new are at the end of the file: the four below and a
  size-limit one).
- Done when 1: "three photos go up one at a time and nothing is read before Read
  all, then three reads, one at a time": three uploads in selection order, no read
  before the tap, reads `[11, 12, 13]`, at most one in flight.
- Done when 2: "a 429 with Retry-After delays that read, drops nothing, and the
  count reaches 3 of 3": fake timers; 7 s wait, still two calls at 6,999 ms,
  reads `[11, 12, 12, 13]` at 7,000 ms, "3 of 3 read".
- Done when 3: "a read that fails for another reason keeps that photo with a
  retry and reads the rest": "2 of 3 read", the failure shown, `Try again` reads
  that photo alone, "3 of 3 read".
- Done when 4: "a photo of two receipts gives two entries, and filing one marks
  only that one": one `file` request with `part: 1`, the other still a button.
- `npx vitest run tools/ledger/web/test/client-retry-after.test.ts`: 3 of 3 (the
  header over the body's copy; no header keeps the body; a 500 is given no wait).
- `npx vitest run tools/ledger/web`: 316 of 316 in 25 files.
- Done when 5: `E2E_PORT=8392 npm run e2e:ledger`: 30 passed, exit 0, including
  `the receipt queue fits a phone and a desktop, kept and then read` at the end
  of the suite, which measures the queue before a read and after one (four
  photos with 70-character names, a 55-character merchant) at 360 and 1280 px.
  The 360 px screenshots were opened: names wrap, buttons stay inside the card.
- Done when 6: `npm run check` exit 0. `npm test -- --project ledger` was not run
  whole on this first build (CI runs it on the draft); the web project is the
  316 above.

2026-11-01, builder, round 1: gate 1 (Opus, CONCERNS at `0587e1d3`), five
findings, fixed in `12be04fc`. The owner's answers (2026-11-01, asked through
`AskUserQuestion`): F2 "Fix it; Read all skips it" (the other options were "Fix
it; Read all still reads" and "Leave F2 recorded"); the lows "F3 + F4 + F5" (the
other option was "None"), F4 as "also disable Start over while photos are
uploading". F1 needed no answer. The F1, F2 and F4 tests failed before their fixes (F5 is below); the
full outputs are in `/tmp/.../lg-92/build/red-left-out.log` and `red-unit.log`.

- **F1, the left-out names overflowed 360 px.** `.queue .name` did not reach
  `li.name` in the "Photos left out" list, which is outside `.queue`; the rule is
  now `.name`. New case at the end of `e2e/layout.spec.ts`, "the receipt queue
  fits a phone and a desktop with photos left out, by long names": 80-character
  names, one over 7 MiB, one refused by the server (a route answering 500), one
  kept. Before the fix: `Error: Receipt queue (left out) is 697 px wide in a 360
  px window`. After: passes; the 360 px screenshot was opened.
- **F2, a receipt typed in from a photo that was not read.** The kept and failed
  rows now say "n receipt(s) typed in from this photo, filed."; both "Type it
  in" buttons open `nextPart(photo.filed)`; **Read all** skips a photo with a
  filed part and the "n of N read" total leaves it out (it would never be read);
  a failed photo with a filed part drops its failure and its retry. Tests
  "a receipt typed in from a kept photo shows it filed, files the next one as part
  2, and Read all spends no read on it" and "a receipt typed in from a photo
  whose read failed shows it filed and drops the failure". Before:
  `TestingLibraryElementError: Unable to find an element with the text: 1 receipt
  typed in from this photo, filed.` in both. After: `fileReceipt` calls
  `[[11,1],[11,2]]` and reads `[12]`.
- **F3, a claim of the first entry above is corrected.** It says the brief's
  `Retry-After` header "was not reachable from the screen". The header was not,
  but its number was: at the base `requestJson` already passed the body's
  `details` through, and `api/src/rate-limit.ts` puts `retryAfterSec` there, so
  the queue could have read the wait without the `client.ts` change. That change
  is kept (the brief says the header, and the header is what every client is told
  to obey); it was not needed to make the wait readable.
- **F4, Start over during uploads.** It is disabled while any photo is going up
  (and while a read runs, as before). Test "Start over waits while photos are
  still going up". Before: `AssertionError: expected false to be true`.
- **F5, three behaviours that held and had no test.** "a second Read all while
  one is running reads nothing twice" (the `readingNow` guard, called twice in
  one tick through the hook, since a disabled button would hide it), "a photo
  refused five times in a row is reported failed, with a retry, and not asked
  again" (the cap: six asks) and "leaving the screen during a wait reads nothing
  more" (unmount). They pass on the code, so each was planted red, all three in
  one run: the guard line removed, `MAX_WAITS` replaced by 1,000,000, the
  `alive` check after the sleep removed. Result: `expected [ 11, 12, 12 ] to
  deeply equal [ 11, 12 ]`; `expected "vi.fn()" to be called 6 times, but got 61
  times`; `expected "vi.fn()" to be called 1 times, but got 13 times`. Restored
  with `git checkout 12be04fc -- <file>`; 39 of 39 again.

Proof at the round's head: `npx vitest run tools/ledger/web`: 322 of 322 in 25
files (316 before, six new in `receipts.test.tsx`); `npm run e2e:ledger`: 31
passed (30 before, one new); `npm run check` exit 0.

2026-11-01, lander (`fixer`, Sonnet 5.5), the owner's answer to gate 2's open
decision, asked through `AskUserQuestion`:

- **The question.** A photo with a typed-in receipt can no longer be read at all:
  round 1 removed "Try again" from a failed photo once one of its receipts is
  filed, and a kept photo with a typed-in receipt has no read control (Read all
  skips it). The owner's earlier answer covered Read all, not the per-photo
  retry.
- **The options.** (a) Keep it, and say here that a typed-in photo is not read
  again (recommended). (b) Restore "Try again" on such a photo and accept the
  mismatch below.
- **The owner chose (a), 2026-11-01.** A photo with a typed-in receipt is not
  read again, by Read all or by a retry.
- **Why.** In `ReceiptQueueView` a read part's "filed" mark is matched to the
  filed parts by position (index). A later read's part 1 would show as filed
  whether or not it is the receipt that was typed in, so a retry could mark the
  wrong part filed. Nothing is lost: "Type it in" still files the next part of
  the photo.
- No code changed for this entry.

2026-11-01, after the merge, the owner's follow-up on the photo step (asked
through `AskUserQuestion`). **This supersedes Build step 1's "the camera input
stays as it is".**

- **The question.** The photo step showed two browser file boxes, "Take a photo
  of a receipt" and "Choose several photos", which read as a form, and behind
  them two paths that did the same thing differently. One input with `multiple`
  and no `capture` was the obvious merge, but recent Android Chrome's gallery
  picker offers no camera (a tester's report on Android 16, Chrome 151,
  Aug 2026), and the household has at least one Android phone. iPhone keeps the
  camera in its picker's menu; a desktop ignores `capture`.
- **The owner chose:** every photo goes through the queue, from either source;
  the two sources are icon tiles (a camera, and a stack of photos), the camera
  tile on a touch screen only (`@media (hover: hover) and (pointer: fine)` hides
  it). The queue's words follow its count: "Read it" and "Receipt" for one
  photo, "Read all" and "Receipts" for several.
- **What went.** The single photo's `kept` and `filed` stages and its `choose`
  handler. What they did that the queue did not is now the queue's: one photo
  of one receipt opens straight into its form after the read, and a read photo
  whose receipts are all filed offers "Type another receipt from this photo".
  The gallery input's name is now "Choose photos of receipts".
- **What the e2e found.** `layout.spec.ts` takes touch off for every case, so a
  touch-only element is hidden there unless a `describe` turns touch back on;
  the photo-sources case does, and a desktop case checks the camera tile is
  hidden.
- **After lg-73 (#726).** The tiles take the base's quiet look as `.button`
  labels; `.pick` keeps only their size and the focus and disabled states a
  hidden input cannot show. **Read it / Read all** is the queue card's one
  `primary`; the photo step's card has none (its tiles are labels). The
  pickers moved to `receipts/PhotoPickers.tsx`, since the photo step and the
  queue both use them. They stay in the ledger until a second tool takes a
  file (`.claude/rules/ui-package.md`).
