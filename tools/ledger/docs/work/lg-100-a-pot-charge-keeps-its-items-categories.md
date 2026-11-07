---
id: lg-100
tool: ledger
title: A person's charge to the pot keeps no category when their items span two
kind: fix
status: ready
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

**Chosen by the owner on 2026-11-07: option A**, one pot charge per person per
category. The steps are:

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

No contract change, no migration. `Done when` below is written for A, the option the
owner chose on 2026-11-07.

## Decision — answered 2026-11-07 by the owner

**Chosen: A, one pot charge per person per category**, the option this ticket
recommends. Asked through AskUserQuestion, with the four options below; not
chosen: B, a slice list on the charge's own line (a migration and a `PeriodLine`
contract change); C, read the items at chart time; D, leave it and say so. The
Build and `Done when` below are written for A.

The question as it was asked, and its options as written then:

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

Written for A, the option the owner chose on 2026-11-07; it needed no rewording.

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

### 2026-11-07, decision

- 2026-11-07 — The owner answered the `## Decision` question through AskUserQuestion:
  **A, one pot charge per person per category**, this ticket's recommendation. Not
  chosen: B (a slice list on the charge's own line, a migration and a `PeriodLine`
  contract change), C (read the items at chart time), D (leave it and say so). The
  question and its options are kept under the heading, unedited.
- Status moved `needs-decision` → `ready` in the commit that records the answer, as
  `roles/builder.md` says; that is the only frontmatter change.
- `Done when` is written for A already, so it needs no rewording; its line "Written
  for A; reworded with the owner's answer" is left as it stands.
- The Build's first line, "Pending the decision below", is left as written, since this
  commit changes nothing else. It is stale now: the Build is option A's, as written.
- The 2026-11-01 landing entry's "stays open" refers to the question open on that day,
  and stands as history.
- Round 1 (gate 1 on lg-103's filing, PR #754, `5629dcab`, F5): the three sentences
  that the answer made false are reworded, and nothing else in the ticket changed. The
  Build's opening, "Pending the decision below. The recommended option (A) is:", now
  reads "Chosen by the owner on 2026-11-07: option A". The Build's closing sentence and
  the `Done when` preamble now say the owner chose A on 2026-11-07. The fourth bullet
  above, "left as written", and the third, "left as it stands", are superseded by this
  one.

### 2026-11-07, build

Built on `origin/main` at `08f78f69`, branch `lg-100-pot-charge-per-category`. Option A,
as the Build says; the brief had three things to correct, found by an intake read and
confirmed here.

- **`filePotCharges`** (`api/src/receipts.ts`) divides each person's charge among the
  categories of their `theirs` items with `splitByCategory(charge.cents, { date, items })`
  and files one pot charge per slice (the merchant as note, the row's date, source
  `receipt`). It now answers a function from an item to its line, not a person-keyed
  map. A person whose charge `splitByCategory` cannot divide (its sign guard) gets one
  line under no category, which every one of their items names (`undivided`).
- **The line path is unchanged.** `fileLines` still fills a person-keyed
  `Map<string, number>`, and `fileReceipt` wraps it as
  `(item) => lines.chargeLines.get(item.chargedTo)` beside the new function; `insertItem`
  calls the one `chargeLineOf` for both. Answer A concerns pot charges, and a line has
  its one category (the destination's), so a person's items in two categories stay one
  charge there. The test that shows it: `api/test/receipts.test.ts`, "filed as a line, a
  person's items in two categories are still one charge, as lg-30 filed it", which
  passes at the base too.
- **Build step 3 was in the wrong file.** The message is `filedAs` in
  `web/src/receipts/filing.ts`, called from `Receipts.tsx` and `Queue.tsx`; it now names
  each person once (a `Set` over `charge.chargedTo`) and says "charges" when the filing
  holds more than one, so one person's two lines read "sam's items as charges to the
  pot". Both callers are covered by the one change.
- **The reproduction's third test** ("sam's items in two categories: the charge has
  none") is rewritten as "the chart keeps the categories the items carry, none
  uncategorised, making the row's amount": Groceries 523, Alcohol 1 553, Household 574,
  sum 2 650.
- **Not covered: the sign-guard fallback.** A scratch search over 1 452 two-category
  charges (prices from -5,00 $ to 5,00 $, taxable or not, with and without a deposit,
  taxes printed to match) found 0 where `splitByCategory` answered none for a charge
  `splitReceipt` had computed, so the branch is not reachable through the API as far as
  measured and has no test. It is kept because the guard exists in `splitByCategory`,
  and one uncategorised line is what lg-91 filed.
- Red at the base: `git checkout 08f78f69 -- tools/ledger/api/src/receipts.ts tools/ledger/web/src/receipts/filing.ts`
  then `npx vitest run tools/ledger/api/test/receipts.test.ts tools/ledger/web/test/receipts.test.tsx`
  → `4 failed | 190 passed (194)`: the one-line-per-category test, the chart, the
  removal, and the web message. The settlement test and the line-path test pass at the
  base by design (same total; unchanged path).

### 2026-11-07, owner's answers to the build's two open items

Given to the orchestrator and relayed in the dispatch of the round; recorded here before
the work they change.

- **The `splitByCategory` → `[]` fallback.** Question: "what should happen to it?"
  Options: keep it and test it directly (the orchestrator's recommendation); keep it
  untested, with the Log saying why (the builder's recommendation); drop the fallback.
  **Chosen by the owner: keep it, test it directly**, which overrides the builder's
  recommendation. The test drives the branch with `splitByCategory` forced to answer
  `[]`, since 0 of 1 452 charges reach it through the API (the 2026-11-07 build entry),
  and shows red with the branch planted out and green with it in.
- **The contract's doc comment on `ReceiptFiling.charges`**
  (`tools/ledger/contract/src/receipts.ts`), which says "one per person". Question:
  "fix it in this PR?" Options: fix it in #757 (the orchestrator's recommendation);
  leave it. **Chosen by the owner: fix it in #757**, as one doc-comment edit with no type
  change, saying that on a row there is one charge per person per category (lg-100). It
  is the only contract edit approved. The builder had not folded it in because the
  contract is an owner stop.

Both applied in the same round:

- **The fallback is tested directly.** `api/test/receipts.test.ts`, "a charge
  splitByCategory cannot divide is filed as one line under no category, named by every
  item of the person", mocks `@ledger/books` so `splitByCategory` answers `[]` while a
  flag is set, files sam's beer and soap on the joint row, and asserts one pot line of
  2 127 with `spending_category_id` `null`, one charge on the filing, and both `theirs`
  items naming that line. Red with the branch planted out
  (`const parts = slices;` in place of the fallback): `1 failed | 95 passed (96)`,
  `AssertionError: expected [] to deeply equal [ ObjectContaining{…} ]`. Green with it
  restored. The earlier statement stands as the reason a mock is needed: the search over
  1 452 two-category charges (prices -5,00 $ to 5,00 $, taxable or not, with and without
  a deposit, taxes printed to match) found 0 that `splitByCategory` could not divide, so
  the branch is not reachable through the API.
- **The contract comment** on `ReceiptFiling.charges` now adds that on a row it is one
  per person per category their items fall in (lg-100), so a person can appear twice.
  Comment only; `git diff` on `contract/src/receipts.ts` is the one hunk.
- `npx vitest run` on `tools/ledger/api/test/receipts.test.ts` and
  `tools/ledger/web/test/receipts.test.tsx` → exit 0, `195 passed (195)`;
  `npm run check` → exit 0.
