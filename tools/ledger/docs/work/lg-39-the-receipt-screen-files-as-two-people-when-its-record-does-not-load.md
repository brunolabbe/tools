---
id: lg-39
tool: ledger
title: The receipt screen shows the two-person form, and files as one, when the household record does not load
kind: fix
status: ready
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
