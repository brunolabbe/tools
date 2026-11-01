---
id: lg-100
tool: ledger
title: A person's charge to the pot keeps no category when their items span two
kind: fix
status: needs-decision
milestone: null
depends_on: [lg-91]
difficulty: standard
---

# lg-100 — A person's charge to the pot keeps no category when their items span two

## Why

lg-91 lets a receipt filed on a joint-account row leave an item out as a charge
to the pot (`api/src/receipts.ts`, `filePotCharges`). It files **one charge line
per person**, and gives that line a spending category only when all of the
person's items share one. When they do not, the line has none.

The joint row's chart (`api/src/slices.ts`, `receiptsOnRows` and `chartedAs`)
leaves a charged item out of the row, because its charge charts it instead
(`api/src/stats.ts`, `spendingStats`, which reads the line's own
`spendingCategoryId`). So a person whose items span two categories has both
categories leave the row's slices and come back as one **uncategorised** amount.
The receipt's reader had proposed a category for every item, and the filing
stores them (`receipt_items.spending_category_id`), but nothing downstream reads
them for a charge.

It is a chart-reading defect, not a money defect: the settlement counts the
charge whole, as it should, and the row plus its lines still chart the row's
amount (2 650 cents in the reproduction below) between them. What goes wrong is
the _split_ — the Spending screen's category bars and the list opened from them.

lg-91's gate 1 found it by reading the code, and rated it `low`: no `Done when`
line depended on it, since the brief fixed "one line per person" and a line's
fallback category is the receipt's own, which a row destination does not have
(`lg-91`, `## Review`, the second `low`; the owner chose on 2026-11-01 to record
it and file this ticket). The reproduction below ran it.

## Reproduction

On `main` at `bd95ab0b` (lg-91 merged as `a5f4acf2`). Everything is in
`tools/ledger/api/test/receipts.test.ts`'s own helpers; nothing is added to the
repo.

1. `cp tools/ledger/api/test/receipts.test.ts tools/ledger/api/test/receipts-lg100-scratch.test.ts`
2. In the copy, add `SpendingStatsResponse,` to the `import type { … } from "@ledger/contract"`
   list, and `import { splitByCategory } from "@ledger/books";` above the
   `@ledger/receipts` import.
3. Append this to the end of the copy:

```ts
// --- lg-100: a person's items in two categories, on a joint-account row ---

/** The open period's spending by category name, as `GET /api/stats/spending` answers it. */
async function chartedByName(target: App): Promise<[string, number][]> {
  const response = await send(target, "GET", ROUTES.statsSpending);
  expect(response.statusCode, response.body).toBe(200);
  const stats = response.json<SpendingStatsResponse>();
  const names = new Map(stats.categories.map((category) => [category.id, category.name]));
  const open = stats.periods.find((period) => period.open);
  return (open?.categories ?? []).map((entry) => [
    entry.categoryId === null ? "(uncategorised)" : (names.get(entry.categoryId) ?? "?"),
    entry.cents,
  ]);
}

/** Files `proposal` on the 26,50 $ joint row, counted as joint spending, and reads the chart. */
async function chartAfterFiling(proposal: ReceiptProposal) {
  const target = await start();
  await pasteRows(target);
  const rowId = chargeRow(target);
  const classified = await send(target, "POST", ROUTES.classifications, {
    rowId,
    personId: null,
    bucket: "current-expenses",
  });
  expect(classified.statusCode, classified.body).toBe(200);
  const receipt = await uploaded(target);
  const filed = await file(target, receipt.id, { proposal, destination: { to: "row", rowId } });
  expect(filed.statusCode, filed.body).toBe(200);
  const chart = await chartedByName(target);
  const lines = potLines(target);
  await app?.shutdown();
  app = undefined;
  return { chart, lines };
}

describe("lg-100: a joint row's charge to the pot, and the categories of the items behind it", () => {
  test("nothing left out: the whole row charts by its items' categories", async () => {
    const { chart, lines } = await chartAfterFiling(named(BASKET));
    expect(lines).toEqual([]);
    expect(chart).toEqual([
      ["Groceries", 349],
      ["Alcohol", 1727],
      ["Household", 574],
    ]);
  });

  test("sam's items all in one category: the charge carries it, and Alcohol is charted once", async () => {
    const { chart, lines } = await chartAfterFiling(named(BASKET, "shared", ["theirs", "sam"]));
    expect(lines).toEqual([
      expect.objectContaining({ amount_cents: 1554, spending_category_id: ALCOHOL }),
    ]);
    expect(chart).toEqual([
      ["Groceries", 349],
      ["Alcohol", 1554],
      ["Household", 747],
    ]);
  });

  test("sam's items in two categories: the charge has none, and both categories leave the chart", async () => {
    const { chart, lines } = await chartAfterFiling(
      named(BASKET, "shared", ["theirs", "sam"], ["theirs", "sam"]),
    );
    // One line, for the beer (Alcohol) and the soap (Household) together: no category.
    expect(lines).toEqual([
      expect.objectContaining({ amount_cents: 2127, spending_category_id: null }),
    ]);
    // Alcohol and Household are gone from the row's slices, and the 21,27 $ comes
    // back as one uncategorised amount.
    expect(chart).toEqual([
      ["Groceries", 523],
      ["(uncategorised)", 2127],
    ]);
  });

  test("what one charge per person per category would have charted", () => {
    const sams = named(BASKET, "shared", ["theirs", "sam"], ["theirs", "sam"]).items.slice(1);
    expect(
      splitByCategory(2127, { date: BASKET.date, items: sams }).map(({ categoryId, cents }) => [
        categoryId,
        cents,
      ]),
    ).toEqual([
      [ALCOHOL, 1553],
      [HOUSEHOLD, 574],
    ]);
  });
});
```

4. `npx vitest run tools/ledger/api/test/receipts-lg100-scratch.test.ts -t "lg-100"`
   from the repo root, after `npm run build` (the API reads `@ledger/books` and
   `@ledger/contract` through their `dist`). Four tests pass on `main`. The third
   passes **because the defect is there**: it asserts the uncategorised charge.
   When the defect is fixed it is the test that turns red, and its assertion is the
   one to rewrite.
5. `rm tools/ledger/api/test/receipts-lg100-scratch.test.ts`. A copy left in
   `test/` fails the next `npm run check` on `oxfmt --check`.

What the chart reads, 26,50 $ joint row, bread 3,49 $ (Groceries), a six-pack with
its deposit and taxes 15,54 $ (Alcohol), soap 5,74 $ (Household), the rest of the
26,50 $ being the receipt's rounding and tip:

| Left out as sam's               | Charge to the pot      | Chart, the open period                      |
| ------------------------------- | ---------------------- | ------------------------------------------- |
| nothing                         | none                   | Groceries 349, Alcohol 1 727, Household 574 |
| the six-pack (one category)     | 1 554, Alcohol         | Groceries 349, Alcohol 1 554, Household 747 |
| the six-pack and the soap (two) | 2 127, **no category** | Groceries 523, **(uncategorised) 2 127**    |

In the third row Alcohol and Household both vanish from the bars. What leaves the
row is the beer and the soap together; what comes back is 2 127 under no category.
Groceries rises from 349 to 523 because the row's rounding and tip, which go to its
largest remaining category, now land on the bread.

## Build

**Pending the decision below.** The recommended option (A) is:

1. **`api/src/receipts.ts`, `filePotCharges`.** For each person with a charge, group
   their `theirs` items by `spendingCategoryId` and divide the person's charge
   (`splitReceipt`'s `charge.cents`) among the groups with `splitByCategory`
   (`@ledger/books`; it already makes the slices sum to the amount to the cent, the
   remainder going to the largest). File one pot charge line per group, dated the
   row's date, carrying that group's category, the merchant as its note, source
   `receipt`. When `splitByCategory` answers `[]` (its sign guard, a refund-shaped
   charge), file one line with no category, as today.
2. **The item-to-line record.** `chargeLines` is a `Map<string, number>` keyed by
   person, and `fileReceipt`'s `insertItem` looks a line up by `item.chargedTo`.
   Key it by person and category, so each `receipt_items.charge_line_id` names the
   line of its own category. `receiptsOnRows` and `standingCharges` (`slices.ts`)
   already follow `charge_line_id` per distinct line, so a charge removed or
   corrected gives back exactly its own items, with no change there.
3. **`web/src/receipts/Receipts.tsx`, the message after filing.** `filing.charges`
   gains a second entry for the same person, and the message builds "sam's and
   sam's items". Name each person once.
4. Tests: `api/test/receipts.test.ts` for two lines, their categories and amounts
   (1 553 Alcohol, 574 Household, in the reproduction), the settlement unchanged
   from one line of 2 127, and the chart; one removed; the sign-guard fallback.
   `web/test/receipts.test.tsx` for the message.

No contract change, no migration. `Done when` below is written for A and is
reworded with whichever option the owner chooses.

## Decision — open

**Who decides:** the owner. Where a person's charge takes its category on a
joint-account row is a design choice that changes what the period screen lists
and, for two of the options, the contract. lg-91's own Build fixed "one line per
person", so A supersedes a sentence of a finished ticket's brief.

Every reader of a pot charge's category, from a grep of `spendingCategoryId` and
`spending_category_id` across `api/src`, `books/src` and `web/src` on `bd95ab0b`:

- `api/src/stats.ts` `spendingStats` — charts a line by its own category: the
  reading that goes wrong.
- `api/src/periods.ts` `listLines` — the list opened from a chart bar filters
  `current_period_lines` on `spending_category_id` in SQL; it agrees with the
  chart today, uncategorised included.
- `api/src/periods.ts` `addPotCharge`, `correctLine`, `toLine` — write, correct and
  read the one column.
- `api/src/spending-backfill.ts` (lg-53) — fills a line with no category from its
  free-text `category`; a pot charge has none (`category` is `null`), so it is
  counted among `bareLines`, never filled.
- `api/src/receipts.ts` `merchantCategory` — walks from `receipt_filings.period_line_id`,
  which is `null` on a row filing, so it never reads a pot charge's category; it
  reads `receipt_items` for the merchant's most common one.
- `web/src/stats/PeriodLines.tsx` — a per-line category picker that sends the
  line back through `correctLine`; the way to categorise a pot charge by hand
  today.
- `web/src/periods/Periods.tsx` — shows the category name on the line.

Beyond `merchantCategory`'s most-common-category read above, nothing reads the
item categories of a row filing except `receiptsOnRows` (slices.ts), for the
shared items.

1. **A. One pot charge per person per category — recommended.** Described under
   Build. Costs: `receipts.ts` and one web message; the period screen's "Owed to
   the pot" list shows two lines for one receipt (same date and merchant, one per
   category); a category's line can differ by a cent from that category's share of
   the row (1 553 against 1 554 in the reproduction), because the person's total
   is fixed first and the remainder goes to their largest category; supersedes
   lg-91's "one line per person" for the multi-category case. Settlement is
   unaffected: the person's lines sum to what the one line was, dated alike.
   Keeps the single `spending_category_id` column, so no migration, no contract
   change, and the existing picker, `listLines` filter and backfill work as they do.
2. **B. A category on the charge's own lines.** One line per person still, carrying
   several category amounts (a slice list, as a receipted row has). Needs a
   migration for the slices and a change to `PeriodLine` in `@ledger/contract`,
   which is an owner stop. `spendingStats` reads the slices, `listLines`'s SQL
   filter joins them, the picker on `PeriodLines.tsx` has to mean something for a
   line with several categories, and a corrected amount has to re-divide them.
   Keeps the period screen as lg-91 built it. The largest change, and the one that
   makes a pot line unlike every other line.
3. **C. Read the items at chart time.** Leave the line uncategorised and have
   `spendingStats` divide it by its `receipt_items` categories when it has none.
   No schema or contract change. The list opened from a bar still filters on the
   column (`listLines`), so the chart and the list disagree for these lines, which
   `slices.ts` exists to prevent (lg-28); and a person's own category on the line
   has to win, and a corrected amount to rescale. A second reader of the same
   fact.
4. **D. Leave it, and say so.** Nothing changes: the 21,27 $ charts as
   uncategorised until a person sets a category on the line from the stats
   screen's picker, which works on a pot charge today but sets one category for
   the whole charge, so the split does not come back (measured: Alcohol 2 127,
   with the soap's 574 under Alcohol). Costs nothing now. The
   reader's item categories are thrown away on every such receipt, and a
   household that files its groceries this way reads a growing "uncategorised"
   bar.

Recommended: **A**. It is the only option that adds no second reader, no schema
and no contract change, and its cost, two lines on the period screen, is visible
rather than hidden.

## Done when

Written for A; reworded with the owner's answer.

1. An `api` test files a receipt on a joint row with one member's items in two
   categories and proves: two pot charge lines, each carrying its category, the
   amounts making the person's charge (2 127 in the reproduction) to the cent; and
   the settlement equal to the one line's.
2. An `api` test reads `GET /api/stats/spending` after that filing and proves the
   categories are the ones the items carry (Groceries 523, Alcohol 1 553,
   Household 574 in the reproduction, making the row's 2 650), none uncategorised.
3. An `api` test proves removing one of the two lines gives only its items back to
   the row's chart, and the other line stands.
4. The reproduction's third test is rewritten to the new reading, not deleted.
5. A web test proves the message after filing names the person once.
6. `npm run check` and `npm test -- --project ledger` pass.

## Log

### 2026-11-01, filing

Filed at the owner's choice from lg-91's gate 1. The options for its three lows
were: reword one and record two; that, and also file this one (chosen, on the
orchestrator's recommendation); record all three. The finding was read from the
code by the gate; this entry runs it.

```
git fetch origin; node scripts/next-id.mjs lg --rev origin/main
  next free: lg-100
git ls-remote --heads origin 'lg-100*'
  (nothing)
npm run build                                        exit 0
npx vitest run tools/ledger/api/test/receipts-lg100-scratch.test.ts -t "lg-100" --reporter=verbose
  ✓ … > nothing left out: the whole row charts by its items' categories 142ms
  ✓ … > sam's items all in one category: the charge carries it, and Alcohol is charted once 36ms
  ✓ … > sam's items in two categories: the charge has none, and both categories leave the chart 24ms
  ✓ … > what one charge per person per category would have charted 0ms
  Test Files  1 passed (1)
       Tests  4 passed | 80 skipped (84)
```

The scratch file was a copy of `receipts.test.ts` with the Reproduction's block
appended, and was removed afterwards; `git status --short` printed nothing. A first
run of the same filings printed the chart as JSON before the assertions were
written, and read the same figures: the two-category filing's pot line was
`amount_cents` 2 127, `spending_category_id` `null`, with the chart
`[["Groceries",523],["(uncategorised)",2127]]`.

WITHDRAWN — do not cite this paragraph.

**What the gate had right, and what it had not run.** The finding reproduces as
described. One addition: the gate wrote that the person's items "re-enter it
uncategorised"; the amount that re-enters is the _whole_ charge (2 127), not only
the part that had no category, so the chart loses both categories' bars at once.

Retraction, by the lander at the owner's choice, on gate 1's finding: the filer
(builder-standard) was wrong. lg-91's gate wrote "them", which already meant all
of the person's items, so the whole 2 127 re-entering is what the gate said and
nothing is added. And "the chart loses both categories' bars at once" is true of
this reproduction only; elsewhere a category's bar shrinks by the amount.

**Not measured:** the web screens (the Spending bars and the period screen) were
not rendered; the figures above are the API's. Option A's 1 553 against 1 554 was
computed by running `splitByCategory` on the person's two items (the fourth test),
not by filing under A.

### 2026-11-01, landing

- 2026-11-01 — Owner's answer on gate 1's four findings (one medium, three lows),
  given to the orchestrator. Options: all four at landing (the orchestrator's
  recommendation); the medium only at landing; record all four. The owner chose
  **all four at landing**, with no re-gate. The `## Decision — open` section above
  is a different question and stays open.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the medium — "so any
  option but D supersedes a sentence of a finished ticket's brief". Now "so A
  supersedes …". `git diff 7576eb26 HEAD -- tools/ledger/docs/work/lg-100-a-pot-charge-keeps-its-items-categories.md | grep -c '^-.*any option but D'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the first low — "Nothing
  reads the item categories of a row filing except `receiptsOnRows`". Now opens
  with the `merchantCategory` read the ticket's own bullet names. `git diff 7576eb26 HEAD -- tools/ledger/docs/work/lg-100-a-pot-charge-keeps-its-items-categories.md | grep -c '^-.*Nothing reads the item categories'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the second low — the
  Log's "What the gate had right" paragraph, which claimed an addition to lg-91's
  gate. Withdrawn in place with a retraction beneath, not deleted. `git diff 7576eb26 HEAD -- tools/ledger/docs/work/lg-100-a-pot-charge-keeps-its-items-categories.md | grep -v 'Fixed at landing' | grep -c '^+.*Retraction, by the lander'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the third low — Option
  D's cost left out what the stats picker does to a pot charge. Option D now says
  the picker puts the whole charge under one category, with the measured figures.
  `git diff 7576eb26 HEAD -- tools/ledger/docs/work/lg-100-a-pot-charge-keeps-its-items-categories.md | grep -v 'Fixed at landing' | grep -c '^+.*so the split does not come back'` → 1.
- 2026-11-01 — Gate 1's full report is on the pull request thread, #743; status
  unchanged (`needs-decision`). Filed by builder-standard (Sonnet 5.5, high), gated
  by ticket-reviewer-opus (Opus 5.5, high), landed by the fixer (Sonnet 5.5, high).
