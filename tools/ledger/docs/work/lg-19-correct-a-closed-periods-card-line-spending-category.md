---
id: lg-19
tool: ledger
title: Correct the spending category of a closed period's card line from the web
kind: fix
status: ready
milestone: P5
depends_on: [lg-18]
difficulty: standard
---

# lg-19 — Correct the spending category of a closed period's card line from the web

## Why

[lg-18](./lg-18-show-a-filed-rows-spending-category-where-it-can-be-changed.md) lets a
person open the bank rows behind a period of the spending chart and give one a
category. The chart also counts the period's **card lines** (what the cards paid
toward the household), and those cannot be reached: a card line filed under the
wrong spending category, in a period already closed, is a slice of the wrong
colour that nothing on the web can fix. The owner chose on 2026-10-11, asked in
lg-18, to list bank rows only there and file this.

**Reproduction**, on `main` as of lg-18's base (55214e67):

```bash
grep -rn "ROUTES.periodLine\b\|correctLine" tools/ledger/web/src
```

prints nothing, though `POST /api/period-lines/:id` exists and is the correction
(`api/src/routes/periods.ts`). The web's only writers of a line are
`addLine` (`ROUTES.periodLines`) and `retireLine`, both in `web/src/api/periods.ts`.
And no route reads a closed period's lines: `GET /api/period/open` takes its start
from the last close (`openPeriod`, `api/src/periods.ts`), so it lists only the open
period's lines and those entered late.

## Build

A person looking at a closed period of the spending chart can see its card lines
and correct a line's spending category.

- **Read.** A route listing the stored lines dated in a span, additive in
  `@ledger/contract`. Recurring-generated lines are not stored and are not charted
  as spending, so they are not listed.
- **Write.** Reuse `POST /api/period-lines/:id`, which takes the whole draft and
  appends a line that supersedes the old one. `firstEntered` follows that chain, so
  a correction is not counted as entered late and cannot move the line into the next
  close. A test should prove that, since it is the reason no override table is
  needed. The web needs a `correctLine` wrapper.
- **Where.** The list lg-18 opens below the spending chart, so a period shows its
  bank rows and its card lines together; replace lg-18's on-screen notice that card
  lines are corrected elsewhere.

## Done when

1. A card line in a closed period can be given another spending category from the
   web, and the stats screen then shows it under the new one. A web test proves it.
2. The correction does not change the period's settlement. An API test proves it.
3. Gates green.

## Log

- 2026-10-11 — Filed from lg-18's phase 1, at the owner's choice of "bank rows only"
  for that ticket. Reproduction above run on the lg-18 branch: no output.
