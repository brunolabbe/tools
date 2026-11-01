---
id: lg-85
tool: ledger
title: The Stats layout case fails from the 1st to the 14th of every month
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# lg-85 — The Stats layout case fails from the 1st to the 14th of every month

## Why

`e2e/layout.spec.ts` › "Stats fits a phone and a desktop" waits for `/89\.99 \$/u`,
the seeded fixed item, before it measures the screen. The seed charged that item on
the 15th (`startDate: "2026-08-15"`). `recurringDates` in `books/src/periods.ts`
generates one charge per month on the start date's day, up to today, and the "Fixed
items by month" card's text names only the latest month, which is the current one.
So until the 15th, the current month reads `Internet and phone 0.00 $`, the pattern
never matches, and the case times out. Nothing on screen is wrong; the test reads
the server's clock.

Reproduced on 2026-11-01 on a clean worktree at `main` `126e1ddf`:
`npm run e2e:ledger -- layout.spec.ts -g "Stats"` → 1 failed,
`Expected pattern: /89\.99 \$/u`, received text containing
`2026-11: Internet and phone 0.00 $, Total 0.00 $.` It passed on 2026-10-31.

## Build

Date the fixed item on the 1st (`startDate: "2026-08-01"`), so today's month always
has a charge, whatever the day. The closed period ends on 2026-09-30 with no start,
so it still holds two charges, August's and September's, and the settlement
figure the same case asserts (`29.27 $`) is unchanged.

## Done when

1. The Stats case passes on a day from the 1st to the 14th.
2. Every other ledger e2e case still passes.

## Log

**2026-11-01 — filed and fixed in one change.** Found while verifying #697 (the
footer's GitHub links), whose ledger browser run would have been red until the
15th. Owner chose to fix it now in a separate pull request.

- Done when 1: on 2026-11-01, the day of the reproduction, `npm run e2e:ledger`
  passes the Stats case at 360 px and desktop.
- Done when 2: the same run, 29 passed, 0 failed.
