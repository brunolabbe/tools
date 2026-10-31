// @vitest-environment jsdom

/**
 * No screen prints a generated id (lg-76). A person added since lg-76 has a UUID
 * for an id and the name typed for them as their shown name; every component
 * that renders a person must print the name.
 *
 * The cases are exactly the list in lg-76's Log, which the grep there finds:
 * every `web/src` file that prints a person through `shownName` or a helper
 * built on it (`labels.ts`, `mortgage.ts`). Each case renders its component
 * with the people under generated ids, the shown names in the map the shell
 * hands down (or, for the household and admin screens, in their own answer),
 * waits for a sentence that names someone, and then reads everything a person
 * can see or hear: the text, every field's value, and every label, title and
 * placeholder. No UUID may be in it, and the names must be.
 *
 * The fixtures are the other suites' own, written with alex and sam and turned
 * to generated ids by `generated`, so a fixture reads as it does there.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  AdminHousehold,
  AutoFiledRow,
  BucketsResponse,
  ClosedPeriod,
  ContributionsResponse,
  HouseholdResponse,
  InboxRow,
  MortgageOwnResponse,
  MortgageSplit,
  OpenPeriodResponse,
  PeriodLine,
  Ratio,
  RecurringItem,
  Rule,
  SalariesStatsResponse,
  Salary,
  SettlementFigures,
  SettlementsStatsResponse,
  SpendingCategory,
  StoredRow,
  UploadedReceipt,
} from "@ledger/contract";
import { Admin } from "../src/admin/Admin.tsx";
import { fetchBuckets } from "../src/api/buckets.ts";
import { fetchAdminHouseholds, fetchHousehold } from "../src/api/households.ts";
import { fetchAutoFiled, fetchInbox } from "../src/api/inbox.ts";
import { fetchMe as fetchMeResponse } from "../src/api/me.ts";
import { fetchMortgage } from "../src/api/mortgage.ts";
import { fetchMortgageSplits } from "../src/api/mortgage-splits.ts";
import { fetchMe, fetchOpenPeriod, fetchPeriods, fetchRecurring } from "../src/api/periods.ts";
import { uploadReceipt } from "../src/api/receipts.ts";
import { fetchRows } from "../src/api/rows.ts";
import { fetchPeople, fetchRules } from "../src/api/rules.ts";
import { fetchRatios, fetchSalaries } from "../src/api/salaries.ts";
import { fetchSpendingCategories, fetchSpendingLines } from "../src/api/spending.ts";
import {
  fetchContributions,
  fetchMortgageOwn,
  fetchSalariesStats,
  fetchSettlementsStats,
} from "../src/api/stats.ts";
import { History } from "../src/history/History.tsx";
import { Home } from "../src/home/Home.tsx";
import { Household } from "../src/household/Household.tsx";
import { MemberForm } from "../src/household/MemberForm.tsx";
import { Inbox } from "../src/inbox/Inbox.tsx";
import { PeopleNamesProvider, UNNAMED } from "../src/people.tsx";
import type { ShownNames } from "../src/people.tsx";
import { Periods } from "../src/periods/Periods.tsx";
import { Receipts } from "../src/receipts/Receipts.tsx";
import { Rules } from "../src/rules/Rules.tsx";
import { MortgageSplitCard } from "../src/salaries/MortgageSplit.tsx";
import { Salaries } from "../src/salaries/Salaries.tsx";
import {
  ContributionCards,
  MortgageOwnCard,
  SalaryCards,
  SettlementsCard,
} from "../src/stats/Cards.tsx";
import { PeriodLines } from "../src/stats/PeriodLines.tsx";
import { EQUAL_SPLIT, LIVE } from "./mortgage-fixtures.ts";

vi.mock("../src/api/buckets.ts");
vi.mock("../src/api/households.ts");
vi.mock("../src/api/inbox.ts");
vi.mock("../src/api/me.ts");
vi.mock("../src/api/mortgage.ts");
vi.mock("../src/api/mortgage-splits.ts");
vi.mock("../src/api/periods.ts");
vi.mock("../src/api/receipts.ts");
vi.mock("../src/api/rows.ts");
vi.mock("../src/api/rules.ts");
vi.mock("../src/api/salaries.ts");
vi.mock("../src/api/spending.ts");
vi.mock("../src/api/stats.ts");

/** alex's and sam's generated ids, and how they are shown. */
const ALEX = "6f1c2a3b-0d4e-4f5a-8b6c-7d8e9f0a1b2c";
const SAM = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d";
const NAMES: ShownNames = { [ALEX]: "Alex", [SAM]: "Sam" };
/** An address that has signed in (lg-75), so the Admin fixture carries no mark. */
const SIGNED_IN = "2026-10-30T08:00:00.000Z";

const ANY_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;

/** A fixture written with the ids alex and sam, with each turned to its generated id. */
function generated<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, field: unknown) =>
    field === "alex" ? ALEX : field === "sam" ? SAM : field,
  ) as T;
}

/** Everything on the page a person can see or hear. */
function seen(): string {
  const parts = [document.body.textContent ?? ""];
  for (const element of document.body.querySelectorAll("*")) {
    for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
      const value = element.getAttribute(attribute);
      if (value !== null) parts.push(value);
    }
    if (
      (element instanceof HTMLInputElement && element.type !== "hidden") ||
      element instanceof HTMLTextAreaElement
    ) {
      parts.push(element.value);
    }
  }
  return parts.join("\n");
}

/** Waits for `anchor` to be on the page, then holds the page to no UUID and both names. */
async function showsNamesOnly(anchor: string | RegExp, names = ["Alex", "Sam"]): Promise<void> {
  await waitFor(() => expect(seen()).toMatch(anchor), { timeout: 4000 });
  const page = seen();
  expect(page).not.toMatch(ANY_UUID);
  for (const name of names) expect(page).toContain(name);
}

function withNames(element: React.ReactElement, names: ShownNames = NAMES): React.ReactElement {
  return <PeopleNamesProvider value={names}>{element}</PeopleNamesProvider>;
}

const NONE = { from: null, to: null };

function category(id: number, name: string): SpendingCategory {
  return {
    id,
    name,
    retired: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "migration",
  };
}

const CATEGORIES = [category(1, "Groceries"), category(4, "Pharmacy")];

const RULE: Rule = {
  id: 7,
  descriptionPattern: "Virement entre folios /Caisse du Lac",
  category: "Virements",
  amountCents: 40000,
  personId: "sam",
  bucket: "mortgage",
  spendingCategoryId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "alex",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(generated(["alex", "sam"]));
  vi.mocked(fetchSpendingCategories).mockResolvedValue(CATEGORIES);
  vi.mocked(fetchMortgage).mockResolvedValue(generated(LIVE));
});

afterEach(cleanup);

describe("no generated id reaches a screen (lg-76)", () => {
  // home/Home.tsx — Home: each person's own money, who leads, the buffer.
  test("home/Home.tsx: Home", async () => {
    const figures: BucketsResponse = {
      asOf: "2026-10-03",
      mortgage: {
        balanceCents: 19999,
        own: [
          { personId: "alex", ownCents: 14999 },
          { personId: "sam", ownCents: 5000 },
        ],
        lead: { personId: "alex", byCents: 9999 },
      },
      buffer: {
        balanceCents: 13000,
        contributions: [
          { personId: "alex", contributedCents: 0 },
          { personId: "sam", contributedCents: 30000 },
        ],
      },
      unclassified: 0,
    };
    vi.mocked(fetchBuckets).mockResolvedValue(generated(figures));
    render(withNames(<Home />));

    await showsNamesOnly("Alex has paid 99.99 $ more.");
  });

  // history/History.tsx — History: the person filter and each row's filing.
  test("history/History.tsx: History", async () => {
    const row: StoredRow = {
      id: 1,
      date: "2026-09-20",
      category: "Épicerie",
      description: "Marché",
      amountCents: -100,
      balanceCents: 100000,
      classification: { bucket: "mortgage", personId: "alex", source: "manual" },
      spendingCategory: { id: 1, source: "map" },
    };
    vi.mocked(fetchRows).mockResolvedValue(generated({ rows: [row], total: 1 }));
    render(withNames(<History />));

    await showsNamesOnly("Alex · Mortgage");
  });

  // inbox/Inbox.tsx — Inbox and InboxItem: a suggestion, an earlier answer, the
  // person picker; inbox/AutoFiled.tsx — AutoFiled and AutoFiledItem.
  test("inbox/Inbox.tsx: Inbox, InboxItem; inbox/AutoFiled.tsx: AutoFiled, AutoFiledItem", async () => {
    const odd: InboxRow = {
      id: 11,
      date: "2026-09-14",
      category: "Virements",
      description: "Virement entre folios /Caisse du Lac",
      amountCents: 45000,
      balanceCents: 123456,
      reason: "differs",
      suggestion: RULE,
      history: { personId: "alex", bucket: "current-expenses", times: 1 },
      spendingCategory: null,
      matching: [],
    };
    const filed: AutoFiledRow = {
      id: 21,
      date: "2026-09-25",
      category: "Épicerie",
      description: "Achat /Boulangerie Exemple",
      amountCents: -1150,
      balanceCents: 100000,
      classification: {
        id: 40,
        bucket: "current-expenses",
        personId: "sam",
        classifiedAt: "2026-10-03T09:30:00.000Z",
      },
      restsOn: [1].map((n) => ({
        classificationId: 30 + n,
        rowId: n,
        date: "2026-09-01",
        description: "Achat /Boulangerie Exemple",
        amountCents: -1000,
        bucket: "current-expenses" as const,
        personId: "sam",
        source: "manual" as const,
        classifiedAt: "2026-09-10T09:30:00.000Z",
        classifiedBy: "alex",
      })),
      spendingCategory: { id: 1, source: "map" },
    };
    vi.mocked(fetchInbox).mockResolvedValue(generated([odd]));
    vi.mocked(fetchAutoFiled).mockResolvedValue(generated([filed]));
    render(withNames(<Inbox />));

    await showsNamesOnly("Alex · Current expenses, last time");
    fireEvent.click(await screen.findByRole("button", { name: "Review 1 filed automatically" }));
    await showsNamesOnly("answered by Alex");
  });

  // rules/Rules.tsx — Rules; rules/RuleForm.tsx — RuleForm, opened to edit.
  test("rules/Rules.tsx: Rules; rules/RuleForm.tsx: RuleForm", async () => {
    vi.mocked(fetchRules).mockResolvedValue(generated([RULE]));
    render(withNames(<Rules />));

    await showsNamesOnly("Virements, 400.00 $ → Sam · Mortgage", ["Sam"]);
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${RULE.descriptionPattern}` }));
    await showsNamesOnly(/Save|Edit the rule|Person/u);
  });

  // periods/Periods.tsx — Periods; periods/LineForm.tsx — LineForm; periods/Recurring.tsx — Recurring.
  test("periods/Periods.tsx: Periods; periods/LineForm.tsx: LineForm; periods/Recurring.tsx: Recurring", async () => {
    const owed: SettlementFigures = {
      formula: "v3",
      ratioId: 1,
      shares: [
        { personId: "alex", partsPerMillion: 600_000, salaryId: 1 },
        { personId: "sam", partsPerMillion: 400_000, salaryId: 2 },
      ],
      deposits: [{ personId: "alex", depositCents: 15_000 }],
      transfers: [{ fromId: "alex", toId: "sam", cents: 6_000 }],
    };
    const open: OpenPeriodResponse = {
      start: "2026-07-01",
      end: "2026-10-03",
      first: false,
      lines: [
        {
          date: "2026-08-03",
          personId: "sam",
          amountCents: 2_000,
          chargedTo: "alex",
          category: null,
          spendingCategoryId: null,
          note: "A book",
          lineId: 8,
          recurringItemId: null,
          late: false,
        },
      ],
      settlement: owed,
    };
    const item: RecurringItem = {
      id: 4,
      personId: "alex",
      monthlyCents: 8_000,
      startDate: "2026-01-10",
      endDate: null,
      label: "Internet",
      supersedes: null,
      enteredAt: "2026-01-10T12:00:00.000Z",
      enteredBy: "alex",
    };
    const closed: ClosedPeriod = {
      id: 1,
      start: null,
      end: "2026-06-30",
      closedAt: "2026-06-30T20:00:00.000Z",
      closedBy: "sam",
      settlement: owed,
      deposit: {
        status: "expected",
        deposits: [{ personId: "alex", depositCents: 15_000, status: "expected", rowId: null }],
      },
    };
    vi.mocked(fetchMe).mockResolvedValue(SAM);
    vi.mocked(fetchOpenPeriod).mockResolvedValue(generated(open));
    vi.mocked(fetchPeriods).mockResolvedValue(generated([closed]));
    vi.mocked(fetchRecurring).mockResolvedValue(generated([item]));
    render(withNames(<Periods />));

    await showsNamesOnly("Paid by Sam");
    // LineForm, for sam: the line is the other person's, alex's.
    expect(seen()).toContain("This was Alex's");
    // Recurring: the item and whose it is.
    expect(seen()).toContain("Internet · Alex");
  });

  // salaries/Salaries.tsx — Salaries.
  test("salaries/Salaries.tsx: Salaries", async () => {
    const salary = (id: number, personId: string, amountCents: number): Salary => ({
      id,
      personId,
      year: 2025,
      amountCents,
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: "alex",
    });
    const ratio: Ratio = {
      id: 1,
      effectiveFrom: "2025-01-01",
      shares: [
        { personId: "alex", partsPerMillion: 600_000, salaryId: 1 },
        { personId: "sam", partsPerMillion: 400_000, salaryId: 2 },
      ],
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: "alex",
    };
    vi.mocked(fetchSalaries).mockResolvedValue(
      generated([salary(1, "alex", 6_000_000), salary(2, "sam", 4_000_000)]),
    );
    vi.mocked(fetchRatios).mockResolvedValue(
      generated({ asOf: "2026-10-03", ratios: [ratio], inEffect: ratio }),
    );
    render(withNames(<Salaries />));

    await showsNamesOnly("Ratio in effect: Alex 60.0000 % · Sam 40.0000 %, since 2025-01-01.");
  });

  // salaries/MortgageSplit.tsx — MortgageSplitCard.
  test("salaries/MortgageSplit.tsx: MortgageSplitCard", async () => {
    const split: MortgageSplit = {
      id: 1,
      effectiveFrom: "2026-02-01",
      mode: "shares",
      shares: [
        { personId: "alex", partsPerMillion: 250_000 },
        { personId: "sam", partsPerMillion: 750_000 },
      ],
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: "alex",
    };
    vi.mocked(fetchMortgageSplits).mockResolvedValue(
      generated({ asOf: "2026-10-03", splits: [split], inEffect: split }),
    );
    render(withNames(<MortgageSplitCard />));

    await showsNamesOnly("by shares: Alex 25.0000 % · Sam 75.0000 %");
  });

  // receipts/Receipts.tsx — Receipts: who files the line, and whose an item was.
  test("receipts/Receipts.tsx: Receipts", async () => {
    const receipt: UploadedReceipt = {
      id: 3,
      mediaType: "image/jpeg",
      bytes: 1_234,
      uploadedAt: "2026-10-05T15:00:00.000Z",
      uploadedBy: "alex",
      reader: "claude-haiku-5-5",
    };
    const household: HouseholdResponse = {
      household: { id: "home", name: "Home" },
      members: [
        { address: "alex@example.test", person: "alex", name: "Alex" },
        { address: "sam@example.test", person: "sam", name: "Sam" },
      ],
      history: [],
    };
    vi.mocked(fetchMeResponse).mockResolvedValue(
      generated({
        person: { id: "alex", email: "alex@example.test", household: "home" },
        admin: false,
      }),
    );
    vi.mocked(fetchHousehold).mockResolvedValue(generated(household));
    vi.mocked(uploadReceipt).mockResolvedValue(generated(receipt));
    render(withNames(<Receipts />));
    const camera = screen.getByLabelText("Take a photo of a receipt");
    const photo = new File([new Uint8Array(1_234)], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(camera, { target: { files: [photo] } });
    fireEvent.click(await screen.findByRole("button", { name: "Type it in" }));

    await showsNamesOnly("File as Alex’s line");
  });

  // stats/Cards.tsx — MortgageOwnCard, ContributionCards, SalaryCards, SettlementsCard.
  test("stats/Cards.tsx: MortgageOwnCard, ContributionCards, SalaryCards, SettlementsCard", async () => {
    const shares = [
      { personId: "alex", partsPerMillion: 555_556 },
      { personId: "sam", partsPerMillion: 444_444 },
    ];
    const own: MortgageOwnResponse = {
      range: NONE,
      people: ["alex", "sam"],
      points: [
        {
          date: "2026-01-05",
          balanceCents: 50000,
          own: [
            { personId: "alex", ownCents: 50000 },
            { personId: "sam", ownCents: 0 },
          ],
          split: EQUAL_SPLIT,
          splitChanged: false,
        },
      ],
      split: EQUAL_SPLIT,
    };
    const contributions: ContributionsResponse = {
      range: NONE,
      people: ["alex", "sam"],
      series: [
        {
          bucket: "mortgage",
          points: [
            {
              date: "2026-01-05",
              contributions: [
                { personId: "alex", contributedCents: 50000 },
                { personId: "sam", contributedCents: 0 },
              ],
            },
          ],
        },
      ],
    };
    const salaries: SalariesStatsResponse = {
      range: NONE,
      people: ["alex", "sam"],
      years: [
        {
          year: 2025,
          salaries: [
            { personId: "alex", amountCents: 5_000_000 },
            { personId: "sam", amountCents: 4_000_000 },
          ],
          ratio: { effectiveFrom: "2025-01-01", shares },
          changes: [{ effectiveFrom: "2025-01-01", shares }],
        },
      ],
    };
    const settlements: SettlementsStatsResponse = {
      range: NONE,
      periods: [
        {
          id: 1,
          start: null,
          end: "2026-01-31",
          closedAt: "2026-01-31T12:00:00Z",
          closedBy: "alex",
          settlement: {
            formula: "v3",
            ratioId: 1,
            shares: [],
            deposits: [{ personId: "alex", depositCents: 12000 }],
            transfers: [{ fromId: "alex", toId: "sam", cents: 6000 }],
          },
          deposit: {
            status: "expected",
            deposits: [{ personId: "alex", depositCents: 12000, status: "expected", rowId: null }],
          },
        },
      ],
    };
    vi.mocked(fetchMortgageOwn).mockResolvedValue(generated(own));
    vi.mocked(fetchContributions).mockResolvedValue(generated(contributions));
    vi.mocked(fetchSalariesStats).mockResolvedValue(generated(salaries));
    vi.mocked(fetchSettlementsStats).mockResolvedValue(generated(settlements));
    render(
      withNames(
        <>
          <MortgageOwnCard range={NONE} mortgage={generated(LIVE)} />
          <ContributionCards range={NONE} />
          <SalaryCards range={NONE} />
          <SettlementsCard range={NONE} />
        </>,
      ),
    );

    // Each card has drawn its chart before the page is read.
    await waitFor(
      () => {
        for (const title of ["Own money in the mortgage", "Salaries by year", "Settlements"]) {
          const card = screen.getAllByRole("heading", { name: title })[0]?.closest("section");
          if (card === null || card === undefined) throw new Error(`no card for ${title}`);
          within(card).getAllByRole("slider");
        }
        expect(screen.getAllByRole("slider").length).toBeGreaterThanOrEqual(4);
      },
      { timeout: 4000 },
    );
    await showsNamesOnly(/Alex/u);
  });

  // stats/PeriodLines.tsx — PeriodLines: who paid each card line, and whom it charged.
  test("stats/PeriodLines.tsx: PeriodLines", async () => {
    const line: PeriodLine = {
      id: 5,
      personId: "alex",
      date: "2026-02-10",
      amountCents: 4000,
      category: null,
      spendingCategoryId: 1,
      note: "Café",
      source: "manual",
      chargedTo: "sam",
      supersedes: null,
      enteredAt: "2026-02-10T12:00:00.000Z",
      enteredBy: "alex",
    };
    vi.mocked(fetchSpendingLines).mockResolvedValue(generated({ lines: [line], total: 1 }));
    render(
      withNames(
        <PeriodLines
          start="2026-02-01"
          end="2026-02-28"
          filter={null}
          categories={CATEGORIES}
          onChanged={() => undefined}
        />,
      ),
    );

    await showsNamesOnly(/Paid by Alex\s*, charged to Sam\./u);
  });

  // admin/Admin.tsx — Admin, HouseholdCard, RenamePerson; and the MemberForm on each card.
  test("admin/Admin.tsx: Admin, HouseholdCard, RenamePerson", async () => {
    const household: AdminHousehold = {
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      name: "Home",
      members: [
        { address: "alex@example.test", person: "alex", name: "Alex", firstSignIn: SIGNED_IN },
        { address: "sam@example.test", person: "sam", name: "Sam", firstSignIn: SIGNED_IN },
      ],
      people: [
        { person: "alex", name: "Alex", standing: "in" },
        { person: "sam", name: "Sam", standing: "in" },
      ],
    };
    vi.mocked(fetchAdminHouseholds).mockResolvedValue(generated([household]));
    // An admin may be in no household, so has no map from the shell.
    render(<Admin />);

    await showsNamesOnly("Home: Alex and Sam");
    fireEvent.click(screen.getByRole("button", { name: "Rename Alex" }));
    await showsNamesOnly("New name for Alex");
  });

  // household/Household.tsx — Household, and its MemberForm. The shell's map is
  // left empty: the screen's own answer names everyone the household has held,
  // a person who left before the books enrolled them included.
  test("household/Household.tsx: Household", async () => {
    const at = "2026-10-01T00:00:00.000Z";
    const household: HouseholdResponse = {
      household: { id: "home", name: "Home" },
      members: [{ address: "alex@example.test", person: "alex", name: "Alex" }],
      history: [
        { address: "alex@example.test", person: "alex", action: "add", at, by: "operator" },
        { action: "name", person: "alex", name: "Alex", at, by: "operator" },
        { address: "sam@example.test", person: "sam", action: "add", at, by: "operator" },
        { action: "name", person: "sam", name: "Sam", at, by: "operator" },
        { address: "sam@example.test", person: "sam", action: "remove", at, by: "operator" },
        { action: "rename", person: "sam", name: "Samuel", at, by: "admin@example.test" },
      ],
    };
    vi.mocked(fetchHousehold).mockResolvedValue(generated(household));
    vi.mocked(fetchMortgage).mockResolvedValue(LIVE);
    render(withNames(<Household id="home" />, {}));

    await showsNamesOnly("Sam renamed Samuel, by admin@example.test", ["Alex", "Samuel"]);
    // A first name is no change of its own: four lines, not six.
    const [, history] = screen.getAllByRole("list");
    expect(history?.querySelectorAll("li")).toHaveLength(4);
    expect(seen()).toContain("sam@example.test removed as Samuel, by the operator");
  });

  // household/MemberForm.tsx — MemberForm, on its own: the people it offers, and
  // the one it starts with.
  test("household/MemberForm.tsx: MemberForm", async () => {
    render(
      <MemberForm
        people={[ALEX, SAM]}
        names={NAMES}
        onAdd={async () => ({ address: "x@example.test", person: ALEX, name: "Alex" })}
      />,
    );

    await showsNamesOnly("Person");
  });

  // people.tsx: a person the map has not heard of yet, before it answers or
  // when it fails, is "Someone", never their generated id.
  test("people.tsx: a generated id the map does not hold is Someone", async () => {
    vi.mocked(fetchBuckets).mockResolvedValue(
      generated({
        asOf: "2026-10-03",
        mortgage: { balanceCents: 0, own: [], lead: { personId: "alex", byCents: 100 } },
        buffer: { balanceCents: 0, contributions: [] },
        unclassified: 0,
      } satisfies BucketsResponse),
    );
    render(withNames(<Home />, {}));

    await showsNamesOnly(`${UNNAMED} has paid 1.00 $ more.`, [UNNAMED]);
  });
});

// lg-76: the books give a ratio's shares and a split's parts in id order, which
// for generated ids means nothing; a sentence lists them by shown name.
describe("people listed in a sentence read by shown name (lg-76)", () => {
  // SAM's id sorts before ALEX's, so the books' order is sam first.
  const ID_ORDER = [
    { personId: SAM, partsPerMillion: 400_000, salaryId: 2 },
    { personId: ALEX, partsPerMillion: 600_000, salaryId: 1 },
  ];

  test("a ratio's shares on the salaries screen", async () => {
    expect(SAM < ALEX).toBe(true);
    const ratio: Ratio = {
      id: 1,
      effectiveFrom: "2025-01-01",
      shares: ID_ORDER,
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: ALEX,
    };
    const salary = (id: number, personId: string): Salary => ({
      id,
      personId,
      year: 2025,
      amountCents: 100,
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: ALEX,
    });
    vi.mocked(fetchSalaries).mockResolvedValue([salary(2, SAM), salary(1, ALEX)]);
    vi.mocked(fetchRatios).mockResolvedValue({
      asOf: "2026-10-03",
      ratios: [ratio],
      inEffect: ratio,
    });
    render(withNames(<Salaries />));

    await showsNamesOnly("Ratio in effect: Alex 60.0000 % · Sam 40.0000 %, since 2025-01-01.");
    const records = [...document.querySelectorAll("ul.figures li")].map((item) => item.textContent);
    expect(records).toEqual([
      expect.stringContaining("2025 · Alex"),
      expect.stringContaining("2025 · Sam"),
    ]);
  });

  test("a split's parts on the mortgage split card", async () => {
    const split: MortgageSplit = {
      id: 1,
      effectiveFrom: "2026-02-01",
      mode: "shares",
      shares: ID_ORDER.map(({ personId, partsPerMillion }) => ({ personId, partsPerMillion })),
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: ALEX,
    };
    vi.mocked(fetchMortgageSplits).mockResolvedValue({
      asOf: "2026-10-03",
      splits: [split],
      inEffect: split,
    });
    render(withNames(<MortgageSplitCard />));

    await showsNamesOnly("by shares: Alex 60.0000 % · Sam 40.0000 %");
  });
});
