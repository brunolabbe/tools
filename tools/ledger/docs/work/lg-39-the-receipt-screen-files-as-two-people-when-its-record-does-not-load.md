---
id: lg-39
tool: ledger
title: The receipt screen shows the two-person form, and files as one, when the household record does not load
kind: fix
status: done
milestone: null
depends_on: [lg-30]
difficulty: standard
---

# lg-39 — The receipt screen files as two people when the household record does not load

## Why

lg-30 made the receipt screen's load a chain of two requests: `fetchMe` for the
signed-in person's household, then `fetchHousehold` for its members, beside the
categories in a `Promise.all` (`web/src/receipts/Receipts.tsx`). When the record
does not load, or is slow, the screen does not say so where it matters and files
a receipt as though the household had two people.

Gate 1 of lg-30 (`01c30bf7`) found it and measured that the behaviour is
inherited, not new: the same probe at `main` with `fetchPeople` rejecting prints
the same results. What lg-30 changed is the length of the window, one request to
two. Nothing in the repo pins any of it.

## Reproduction

A jsdom spec in the shape of `web/test/receipts.test.tsx`, with the screen's
own mocks, rendering a receipt of three items (one `theirs`) in three cases:
`fetchHousehold` rejecting, `fetchMe` rejecting, and `fetchHousehold` never
answering. All three give, at `01c30bf7`:

```
household fails: first screen alert "Something went wrong on our end."
household fails: alerts on the form []
household fails: share output "Not shared 0.00 $ · The other's 15.54 $ · Shared 9.22 $"; whose-select present false; checkbox "This was the other person's"; categories offered ["None"]
household fails: filed with items [["shared",null],["theirs",null],["shared",null]] destination.chargedTo null (the box "This was ..." was ticked)
me fails:        (identical four lines)
household slow:  alerts on the form []; (identical share output, no select, categories ["None"]; chargedTo null with the box ticked)
main, people fail: first screen alert "Something went wrong on our end." / "The other's" / ["None"] / destination.chargedTo null (the box was ticked)
```

That is: an alert on the first screen only (the first action clears it); no
categories, since `Promise.all` drops both when one rejects; the two-person form
("The other's", no "Whose is" select); and ticking "This was the other person's"
files `destination.chargedTo: null`, which is the payer's shared line, not a
charge to anyone.

## Build

1. Add the three cases above as web tests at the end of
   `web/test/receipts.test.tsx`, asserting what the screen should do, and watch
   them fail at the head this ticket starts from.
2. Make the screen not offer a filing it cannot name: while the record has not
   loaded, and after it failed, the form must not present itself as the
   two-person form or accept a charge as `chargedTo: null`. The shape (hold the
   form behind the load with a visible failure and a retry, or load the
   categories on their own so one failed request does not drop the other) is the
   builder's, recorded in the Log with the reason.
3. Keep `fetchMe` and `fetchHousehold` as lg-30 left them; the record itself is
   not in question.

## Done when

1. With `fetchHousehold` rejecting, `fetchMe` rejecting, and `fetchHousehold`
   never answering, the receipt screen does not offer "This was the other
   person's" as though the household had two people, and no filing is sent with
   `destination.chargedTo: null` for an item marked as someone else's
   (`web/test/receipts.test.tsx`, a test per case).
2. A failed load is shown where the person is working, not only on the first
   screen, and the categories the other request returned are still offered.
3. `npm run check` and `npm test -- --project ledger` pass.

## Review

**Gate: CONCERNS** — 2026-10-18 · `029641b4..c658e8e8` · Opus 5.5, depth standard

| Done when                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Household rejecting, `fetchMe` rejecting, household never answering: no "This was the other person's", no `chargedTo: null` filing | `web/test/receipts.test.tsx` › "the household's record failing holds the form, says so where the person is, and retries (lg-39)", › "the signed-in person failing to load holds the form the same way (lg-39)", › "a household that has not answered yet holds the form, and files nothing (lg-39)" ✓ — `expectNoTwoPersonForm` asserts no form, no checkbox, no "File as" button, no split line, `fileReceipt` not called. Positive control: with the guard removed (people falling back to `[]`), all three go red; with the guard removed and a failure alert kept above the form, all three go red on the form's presence, `3 failed \| 20 passed (23)` both times |
| 2. A failed load shown where the person works, and the other request's categories still offered                                       | same spec › "the household's record failing holds the form…" ✓ — the `alert` on the form's screen, and after "Try again" the item's picker offers "Alcohol" with `fetchSpendingCategories` called once; the converse case › "categories failing to load do not hold the form, and can be asked for again (lg-39)" ✓                                                                                                                                                                                                                                                                                                                                                    |
| 3. `npm run check` and `npm test -- --project ledger` pass                                                                            | **verified** — check exit 0; ledger project exit 0, `1251 passed (1251)` in 62 files; the test diff adds four tests and edits none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

- **med** · no `Done when` line depends on it · `nfr:reliability` — a household that **loads** with one member (or none) still gets the two-person form: the checkbox reads "This was the other person's", the item button "The other's", the split "The other's 15.54 $", and ticking the checkbox files `destination.chargedTo: null`, the payer's own shared line, with nothing said. `others` in `Receipts` is empty, so `wholeWhose` is `null`. Inherited: the lines that compute it (`others`, `wholeWhose`, the checkbox label, `fileAs`'s `destination`) are untouched by the diff (read from the diff, not run at the base). A household with one member happens: the directory adds members one at a time and allows removing them. The server refuses an item marked `theirs` here ("There is nobody else in the household to charge an item to."), but it cannot tell a ticked box from a shared line. **Open decision**, recommendation first: (a) fix it on this branch — no checkbox, and no `theirs` share, when `others` is empty, plus a test — since it is the same wrong output from a member list that is partial, in the same file; (b) file it as a new ticket with this reproduction.
- **low** · `nfr:maintainability` — when the categories fail, every picker shows "None" while the filing sends the reader's categories (`[1,2,null]` for the items, `1` for the line). The screen shows less than it files, and the alert beside the form explains why, so the error is on the safe side. Inherited (at the base `Promise.all` left the categories `[]` too). The Log's "the form offers 'None' until it comes" does not mention it.
- **low** · `nfr:reliability` — the held "Loading the household…" view has no buttons (`[]`), and the API client has no timeout, so a request that never answers leaves no Start over and no retry on that screen. The way out is another tab, which remounts the screen and asks again; the draft and the reading are lost.
- **low** · the "Photo kept." screen says nothing about a household that has failed and still offers "Read it", so the photo goes out to be read before the person learns the form will be held. After "Try again" the reading is kept; after "Start over" it is lost.
- **dropped** · a double-click on "Try again": measured as one extra request, not two (`fetchMe` 2 and `fetchHousehold` 2 after one failure and two clicks), and the button is gone after the first click. Not a defect.
- **dropped** · a stale answer landing after an unmount: it did not overwrite the new mount's three-person form. React logged no `console.error` after an unmount mid-load. Not a defect.
- **dropped** · the categories getting stuck after a retry: a second failure keeps the alert, and a third request recovers ("Groceries", "Alcohol"; household asked for once). Not a defect.
- **findings** · the hunt returned 7: 4 carried, 3 dropped.
- CI on `c658e8e8`: every check passes except `test (windows-latest, informational)`, which was still pending when read. No line depends on it.
- NFR: security n/a (no new input, URL or log line) · performance ✓ (two independent requests where `Promise.all` held one) · reliability — the med and the two lows above · maintainability — the categories low above.

### Gate 2

**Gate: PASS** (was CONCERNS) — 2026-10-18 · `c658e8e8..59d863dd`, the round is `22c1e672` · Opus 5.5, depth standard

| Done when                                                                                                                             | Proof                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Household rejecting, `fetchMe` rejecting, household never answering: no "This was the other person's", no `chargedTo: null` filing | unchanged by the round: `web/test/receipts.test.tsx` › the three lg-39 hold tests ✓; the spec runs `25 passed (25)` at `59d863dd`                                                  |
| 2. A failed load shown where the person works, and the other request's categories still offered                                       | unchanged by the round: same spec › "the household's record failing holds the form…" and › "categories failing to load do not hold the form, and can be asked for again (lg-39)" ✓ |
| 3. `npm run check` and `npm test -- --project ledger` pass                                                                            | **verified** — check exit 0; ledger project exit 0, `1253 passed (1253)` in 62 files (gate 1: 1251, plus the round's two `test.each` cases)                                        |

- **F1 (med) · fixed in part.** These are fixed, each checked against `59d863dd` with gate 1's one-member and no-member probes re-run:
  - The "This was …" checkbox is gone (`checkbox false`).
  - A tap cycles Shared ↔ Not shared and never lands on someone else's.
  - The line is never sent with a charge: it files `chargedTo: null` only once nothing is someone else's.
  - The round's new test, `web/test/receipts.test.tsx` › "%s: nobody to charge, so no one else's box, no one else's share, and a read one is not filed (lg-39)" (one member, no member), goes red three separate ways:
    - against `c658e8e8`'s source: `2 failed | 23 passed (25)`, the checkbox present;
    - with only the filing block removed: `Unable to find role="alert"`;
    - with only the tap's skip removed: `Unable to find … "PAIN, Shared"`.

  **One clause is not fixed**: the text "The other's" stays.
  - The split line reads `The other's 0.00 $` in every one-member or no-member household, even when nothing is someone else's.
  - An item that was read as someone else's keeps the button `BIERE 6X355, The other's` until it is tapped.
  - The med was the silent misfiling, and nothing is filed on the strength of this text. The block shows a message right beside the item. So I grade the remaining clause **low**: false text that nothing relies on. No `Done when` line depends on it.

- **The extension (a read item marked someone else's blocks the filing), attacked:**
  - **No good filing is blocked.** With nothing marked someone else's, one-member and no-member households file at once. A two-member household still files a read `theirs` item as before (`[["shared",null],["theirs",null],["shared",null]]`). The block fires only where the server would refuse anyway (`chargedToOf`: "There is nobody else in the household to charge an item to.").
  - **One tap clears it.** It moves `theirs` → `Shared`, the hint goes away, and the next "File as" goes through. Attaching to a joint-account row is blocked by the same message. It would have been refused anyway, under the row's own rule.
  - **The message is where the person works.** A live `hint bad` line sits inside the items fieldset before any click, and the click adds an `alert` at the foot of the form.
- **low** · new, in the lines the round touched (`fileAs` and `unfileable`) · after the tap clears the block, the foot `alert` "There is nobody else in the household to charge an item to." stays up until the next action that runs a request, while the hint beside the items is already gone. The falsehood is on the safe side: it says the receipt cannot be filed when it now can. Any problem set by `fileAs` behaves the same way, so the pattern is older than this round.
- **dropped** · none.
- **findings** · the round's hunt returned 1 new finding (the low above), carried. F1 is a verdict, not a new finding. F2–F4 are not in the round and are not regraded.
- CI on `59d863dd`:
  - pass: CodeQL, `changes`, `check` ×2, `codeql`, `dependency-review`, `docker`;
  - pending when read: `test (ubuntu-latest)` and `test (windows-latest, informational)`.

  No line is proven only by a CI leg, since Done when 3 was re-run locally.

- NFR: security n/a · performance n/a · reliability ✓ (the server's refusal now shows up on the client, before the request) · maintainability — the two lows above.

## Log

- 2026-10-18 — Filed at the landing of lg-30 (PR #529) by owner choice, as
  gate 1's finding F5 (low): "the receipt screen's load, which this branch
  changed, has no test for a failed or slow record, and its behaviour is
  inherited." The reproduction above is the gate's section 5, pasted. The probe
  spec was `gate-web.test.tsx` in the gate's scratch directory, which does not
  outlive the batch; the cases are described above so it can be written again.

- 2026-10-18 — Built (branch `lg-39-receipts-wait-for-household`, from
  `029641b4`). **The choice (Build 2): both options, because they answer
  different halves.** The form is held behind the household's load, and the
  categories load on their own.
  - _Why hold the form rather than only disable the filing._ The "someone
    else's" label, the share buttons, the live split line and the whole-receipt
    checkbox are all computed from the member list; with it unknown each is a
    guess that reads as a fact ("The other's", a two-person split). Holding the
    whole form leaves no such surface, and the wait is normally invisible: the
    form is reached after an upload and, usually, a read, both slower than two
    small requests. The held screen says "Loading the household…" (a `status`),
    or the failure with "Try again" and "Start over" (an `alert`), on the screen
    the person is working on; `run` clears `problem`, which is why the old
    first-screen alert vanished at the first action.
  - _Why load the categories apart._ `Promise.all` dropped both when one
    rejected. Each request is now its own `useLoad`, so the household failing
    keeps the categories (retrying the household does not ask for them again)
    and the categories failing does not hold the form: it shows its own alert
    with a retry beside the form, and the form offers "None" until it comes.
  - Not a contract or another screen's change: `Receipts.tsx` only; `fetchMe`
    and `fetchHousehold` are untouched (Build 3).
  - Red/green: the four new tests at the end of `web/test/receipts.test.tsx`
    fail at the base source (`4 failed | 19 passed (23)`) and pass with the
    change (`23 passed (23)`), `npx vitest run tools/ledger/web/test/receipts.test.tsx`.
    One test per case in Done when 1 (household rejects, `fetchMe` rejects,
    household never answers), plus the categories case.
  - Fold-in considered: none. The categories failure was not in the brief's
    reproduction but is the same `Promise.all` and is covered above.

- 2026-10-18 — Round 1, gate 1's F1 (med). **The question:** a household that
  _loads_ with one member (or none) still got the two-person form: "This was the
  other person's", "The other's", and a ticked box filed `destination.chargedTo:
null`, the payer's own shared line, with nothing said. The lines that compute
  it were untouched by this branch (inherited), but it is the same wrong output
  from a partial member list, in the same file. **Options:** (a) fix it on this
  branch, recommended; (b) file it as its own ticket. **Answer:** owner,
  2026-10-18, (a). **Done:** with `others` empty the whole-receipt box is not
  rendered and `chargedTo` is never sent; a tap cycles shared and not shared and
  skips someone else's (`nextShare`); an item that was _read_ as someone else's
  is said to be unfileable ("There is nobody else in the household to charge an
  item to.", the server's own words) and is not filed until tapped off it. One
  member and no member are the same case here (`others` is empty), so one
  `test.each` covers both; the zero-member case is the household's own record
  missing the payer, which the screen cannot tell from one. Red at `c658e8e8`:
  `2 failed | 23 passed (25)` (the box present); green: `25 passed (25)`,
  `npx vitest run tools/ledger/web/test/receipts.test.tsx`. F2 to F4 (lows) are
  left recorded as the gate wrote them, by owner choice.
