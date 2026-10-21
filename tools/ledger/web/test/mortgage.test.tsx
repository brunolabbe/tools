// @vitest-environment jsdom

/**
 * A household with no mortgage, or one paid off (lg-55). What the household says
 * of it (`GET /api/mortgage`) closes the mortgage views of the stats and home
 * screens from the close, and the form on the household's screen says it. The
 * fakes are the API client modules; the figures are invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  BucketsResponse,
  MortgageOwnResponse,
  MortgagePaymentsResponse,
} from "@ledger/contract";
import { fetchBuckets } from "../src/api/buckets.ts";
import { fetchHousehold } from "../src/api/households.ts";
import { fetchMortgage, saveMortgage } from "../src/api/mortgage.ts";
import {
  fetchBufferStats,
  fetchContributions,
  fetchFixedItems,
  fetchMortgageOwn,
  fetchMortgagePayments,
  fetchSalariesStats,
  fetchSettlementsStats,
  fetchSpendingStats,
} from "../src/api/stats.ts";
import { Home } from "../src/home/Home.tsx";
import { Household } from "../src/household/Household.tsx";
import { mortgageStanding } from "../src/household/MortgageSetting.tsx";
import { endedSentence } from "../src/mortgage.ts";
import { Stats } from "../src/stats/Stats.tsx";
import {
  ENDED,
  ENDED_EMPTY,
  ENDED_OWES,
  ENDED_UNEVEN,
  EQUAL_SPLIT,
  LIVE,
  NONE,
} from "./mortgage-fixtures.ts";

vi.mock("../src/api/buckets.ts", () => ({ fetchBuckets: vi.fn() }));
vi.mock("../src/api/mortgage.ts", () => ({ fetchMortgage: vi.fn(), saveMortgage: vi.fn() }));
vi.mock("../src/api/households.ts", () => ({
  fetchHousehold: vi.fn(),
  addHouseholdMember: vi.fn(),
}));
vi.mock("../src/api/stats.ts", () => ({
  fetchMortgagePayments: vi.fn(),
  fetchSalariesStats: vi.fn(),
  fetchContributions: vi.fn(),
  fetchMortgageOwn: vi.fn(),
  fetchBufferStats: vi.fn(),
  fetchSpendingStats: vi.fn(),
  fetchFixedItems: vi.fn(),
  fetchSettlementsStats: vi.fn(),
}));

const NO_RANGE = { from: null, to: null };

/** Three equal payments, so no dot on the line is a renewal's: any dot is the end marker. */
const PAYMENTS: MortgagePaymentsResponse = {
  range: NO_RANGE,
  payments: [
    { date: "2026-01-15", cents: 70000, previousCents: null, changed: false },
    { date: "2026-02-15", cents: 70000, previousCents: 70000, changed: false },
    { date: "2026-03-15", cents: 70000, previousCents: 70000, changed: false },
  ],
};

const OWN: MortgageOwnResponse = {
  range: NO_RANGE,
  people: ["alex", "sam"],
  points: [
    {
      date: "2026-03-15",
      balanceCents: 19999,
      own: [
        { personId: "alex", ownCents: 14999 },
        { personId: "sam", ownCents: 5000 },
      ],
      split: EQUAL_SPLIT,
      splitChanged: false,
    },
  ],
  split: EQUAL_SPLIT,
};

const BUCKETS: BucketsResponse = {
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
    contributions: [{ personId: "sam", contributedCents: 30000 }],
  },
  unclassified: 0,
};

const EMPTY_BUCKETS: BucketsResponse = {
  ...BUCKETS,
  mortgage: {
    balanceCents: 0,
    own: [
      { personId: "alex", ownCents: 0 },
      { personId: "sam", ownCents: 0 },
    ],
    lead: null,
  },
};

const LIVE_EMPTY_PAYMENTS = "No payment came out of the mortgage bucket in this range.";
const LIVE_EMPTY_OWN = "The mortgage bucket did not move in this range.";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMortgage).mockResolvedValue(LIVE);
  vi.mocked(fetchBuckets).mockResolvedValue(BUCKETS);
  vi.mocked(fetchMortgagePayments).mockResolvedValue(PAYMENTS);
  vi.mocked(fetchMortgageOwn).mockResolvedValue(OWN);
  vi.mocked(fetchContributions).mockResolvedValue({ range: NO_RANGE, people: [], series: [] });
  vi.mocked(fetchBufferStats).mockResolvedValue({
    range: NO_RANGE,
    minDropCents: 50000,
    points: [],
    drops: [],
  });
  vi.mocked(fetchSalariesStats).mockResolvedValue({ range: NO_RANGE, people: [], years: [] });
  vi.mocked(fetchSpendingStats).mockResolvedValue({
    range: NO_RANGE,
    categories: [],
    periods: [],
  });
  vi.mocked(fetchFixedItems).mockResolvedValue({ range: NO_RANGE, months: [], series: [] });
  vi.mocked(fetchSettlementsStats).mockResolvedValue({ range: NO_RANGE, periods: [] });
});

afterEach(cleanup);

/** Stats, once the mortgage has been read and the other cards have drawn. */
async function stats(): Promise<void> {
  render(<Stats />);
  await screen.findByRole("heading", { name: "Settlements" });
  await waitFor(() => expect(vi.mocked(fetchMortgage)).toHaveBeenCalled());
  // Let the answer land: the mortgage cards are held until it does.
  await new Promise((done) => setTimeout(done, 0));
}

/** From the first day of a range picked by hand. */
function pickFrom(day: string): void {
  fireEvent.click(screen.getByRole("button", { name: "Pick days" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: day } });
}

function pickTo(day: string): void {
  fireEvent.click(screen.getByRole("button", { name: "Pick days" }));
  fireEvent.change(screen.getByLabelText("To"), { target: { value: day } });
}

function card(title: string): ReturnType<typeof within> {
  const section = screen.getByRole("heading", { name: title }).closest("section");
  if (section === null) throw new Error(`no card for ${title}`);
  return within(section);
}

test("stats of books ended, over a range wholly after the close, draw no payment card and neither empty message", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED_EMPTY);
  vi.mocked(fetchMortgagePayments).mockResolvedValue({ range: NO_RANGE, payments: [] });
  vi.mocked(fetchMortgageOwn).mockResolvedValue({
    range: NO_RANGE,
    people: [],
    points: [],
    split: EQUAL_SPLIT,
  });
  await stats();

  pickFrom("2026-05-01");

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Mortgage payment" })).toBeNull(),
  );
  expect(screen.queryByText(LIVE_EMPTY_PAYMENTS)).toBeNull();
  expect(screen.queryByText(LIVE_EMPTY_OWN)).toBeNull();
  // Nothing is left in the bucket, so the own-money card has nothing to say either.
  expect(screen.queryByRole("heading", { name: "Own money in the mortgage" })).toBeNull();
  // The other cards are still there.
  expect(screen.getByRole("heading", { name: "Settlements" })).toBeTruthy();
});

test("stats of books ended with money left name each person's part as their own, in a range after the close", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED);
  vi.mocked(fetchMortgagePayments).mockResolvedValue({ range: NO_RANGE, payments: [] });
  vi.mocked(fetchMortgageOwn).mockResolvedValue({
    range: NO_RANGE,
    people: [],
    points: [],
    split: EQUAL_SPLIT,
  });
  await stats();

  pickFrom("2026-05-01");

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Mortgage payment" })).toBeNull(),
  );
  const own = card("Own money in the mortgage");
  expect(
    own.getByText(
      "The mortgage ended on 2026-03-31. 199.99 $ is left in the bucket. It is each person's own, theirs to take back: alex 149.99 $, sam 50.00 $.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(LIVE_EMPTY_OWN)).toBeNull();
  expect(screen.queryByText(LIVE_EMPTY_PAYMENTS)).toBeNull();
});

test("a range that spans the close charts every earlier payment and marks the last", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED);
  await stats();

  await waitFor(() =>
    expect(
      card("Mortgage payment").getAllByText("Last payment on 2026-03-15; the mortgage ended."),
    ).toBeTruthy(),
  );
  const payment = card("Mortgage payment");
  const chart = payment.getByRole("slider");
  expect(chart.querySelectorAll("circle.marker")).toHaveLength(1);

  // The table twin holds all three payments, and says which is the last.
  fireEvent.click(payment.getByRole("button", { name: "Show as a table" }));
  const rows = payment.getAllByRole("row").slice(1);
  expect(rows.map((row: HTMLElement) => row.textContent)).toEqual([
    "2026-03-15700.00 $Last payment",
    "2026-02-15700.00 $",
    "2026-01-15700.00 $",
  ]);
});

test("the line's earlier payments do not carry the end note", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED);
  await stats();
  await waitFor(() =>
    expect(card("Mortgage payment").getAllByText(/Last payment on 2026-03-15/u)).toBeTruthy(),
  );
  const payment = card("Mortgage payment");

  fireEvent.keyDown(payment.getByRole("slider"), { key: "ArrowLeft" });

  expect(payment.queryAllByText(/Last payment on/u)).toHaveLength(0);
});

test("a range entirely before the close charts exactly as it did", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED);
  await stats();
  await waitFor(() =>
    expect(card("Mortgage payment").getAllByText(/Last payment on 2026-03-15/u)).toBeTruthy(),
  );

  pickTo("2026-03-20");

  await waitFor(() =>
    expect(card("Mortgage payment").queryAllByText(/Last payment on/u)).toHaveLength(0),
  );
  const payment = card("Mortgage payment");
  expect(payment.getByRole("slider").querySelectorAll("circle.marker")).toHaveLength(0);
  expect(screen.getByRole("heading", { name: "Own money in the mortgage" })).toBeTruthy();
});

test("home of books ended with money left names each person's part and whose it is", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED);

  render(<Home />);

  const heading = await screen.findByRole("heading", { name: "Mortgage" });
  const mortgage = within(heading.closest("section") as HTMLElement);
  expect(
    within(mortgage.getByText("alex").closest("li") as HTMLElement).getByText("149.99 $"),
  ).toBeTruthy();
  expect(
    within(mortgage.getByText("sam").closest("li") as HTMLElement).getByText("50.00 $"),
  ).toBeTruthy();
  expect(
    mortgage.getByText(
      "The mortgage ended on 2026-03-31. 199.99 $ is left in the bucket. It is each person's own, theirs to take back: alex 149.99 $, sam 50.00 $.",
    ),
  ).toBeTruthy();
  // In place of who is ahead.
  expect(mortgage.queryByText(/has paid/u)).toBeNull();
});

test("home of books ended with the bucket at zero has no mortgage section", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED_EMPTY);
  vi.mocked(fetchBuckets).mockResolvedValue(EMPTY_BUCKETS);

  render(<Home />);

  await screen.findByRole("heading", { name: "Buffer" });
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

test("stats of books recorded as none draw no mortgage card", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(NONE);
  await stats();

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Mortgage payment" })).toBeNull(),
  );
  expect(screen.queryByRole("heading", { name: "Own money in the mortgage" })).toBeNull();
  expect(screen.queryByText(LIVE_EMPTY_PAYMENTS)).toBeNull();
  expect(screen.queryByText(LIVE_EMPTY_OWN)).toBeNull();
  expect(screen.getByRole("heading", { name: "Settlements" })).toBeTruthy();
});

test("home of a household recorded as none has no mortgage section", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(NONE);
  vi.mocked(fetchBuckets).mockResolvedValue(EMPTY_BUCKETS);

  render(<Home />);

  await screen.findByRole("heading", { name: "Buffer" });
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

test("with no record the stats and home are what they were", async () => {
  vi.mocked(fetchMortgagePayments).mockResolvedValue({ range: NO_RANGE, payments: [] });
  vi.mocked(fetchMortgageOwn).mockResolvedValue({
    range: NO_RANGE,
    people: [],
    points: [],
    split: EQUAL_SPLIT,
  });
  await stats();

  pickFrom("2030-01-01");

  expect(await screen.findByText(LIVE_EMPTY_PAYMENTS)).toBeTruthy();
  expect(await screen.findByText(LIVE_EMPTY_OWN)).toBeTruthy();
  cleanup();

  render(<Home />);
  const heading = await screen.findByRole("heading", { name: "Mortgage" });
  expect(
    within(heading.closest("section") as HTMLElement).getByText("alex has paid 99.99 $ more."),
  ).toBeTruthy();
});

test("a mortgage that could not be read leaves the screens as they were", async () => {
  vi.mocked(fetchMortgage).mockRejectedValue(new AppError("UNREACHABLE"));

  render(<Home />);

  const heading = await screen.findByRole("heading", { name: "Mortgage" });
  expect(
    within(heading.closest("section") as HTMLElement).getByText("alex has paid 99.99 $ more."),
  ).toBeTruthy();
});

test("books ended with the bucket at zero but parts that are not, draw no Own card and no Home section", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED_UNEVEN);
  vi.mocked(fetchBuckets).mockResolvedValue({
    ...BUCKETS,
    mortgage: {
      balanceCents: 0,
      own: ENDED_UNEVEN.own,
      lead: { personId: "alex", byCents: 100000 },
    },
  });
  vi.mocked(fetchMortgagePayments).mockResolvedValue({ range: NO_RANGE, payments: [] });
  vi.mocked(fetchMortgageOwn).mockResolvedValue({
    range: NO_RANGE,
    people: [],
    points: [],
    split: EQUAL_SPLIT,
  });
  await stats();

  pickFrom("2026-05-01");

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Mortgage payment" })).toBeNull(),
  );
  expect(screen.queryByRole("heading", { name: "Own money in the mortgage" })).toBeNull();
  cleanup();

  render(<Home />);
  await screen.findByRole("heading", { name: "Buffer" });
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

test("a part above zero is owed, not theirs to take back, once a part is below zero, on Home and on the Own card", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(ENDED_OWES);
  const expected = `The mortgage ended on 2026-03-31. ${formatCents(60000)} is left in the bucket. alex is owed ${formatCents(110000)}, sam owes ${formatCents(50000)}.`;
  expect(expected).not.toMatch(/take back/u);
  vi.mocked(fetchBuckets).mockResolvedValue({
    ...BUCKETS,
    mortgage: { balanceCents: 60000, own: ENDED_OWES.own, lead: null },
  });

  render(<Home />);
  const heading = await screen.findByRole("heading", { name: "Mortgage" });
  const home = within(heading.closest("section") as HTMLElement);
  expect(home.getByText(expected)).toBeTruthy();
  // Nobody is told that a negative sum is theirs.
  expect(home.getByText(expected).textContent).not.toMatch(/\s[-\u2212]\d/u);
  cleanup();

  vi.mocked(fetchMortgagePayments).mockResolvedValue({ range: NO_RANGE, payments: [] });
  vi.mocked(fetchMortgageOwn).mockResolvedValue({
    range: NO_RANGE,
    people: [],
    points: [],
    split: EQUAL_SPLIT,
  });
  await stats();
  pickFrom("2026-05-01");
  expect(await card("Own money in the mortgage").findByText(expected)).toBeTruthy();
});

test("the sentence drops the balance when it is zero, and says a short bucket is short", () => {
  expect(endedSentence(ENDED_UNEVEN, {})).toBe(
    `The mortgage ended on 2026-03-31. alex is owed ${formatCents(50000)}, sam owes ${formatCents(50000)}.`,
  );
  expect(
    endedSentence(
      { ...ENDED_OWES, balanceCents: -10000, own: [{ personId: "sam", ownCents: -10000 }] },
      { sam: "Sam" },
    ),
  ).toBe(
    `The mortgage ended on 2026-03-31. The bucket is ${formatCents(10000)} short. Sam owes ${formatCents(10000)}.`,
  );
});

test("with a part below zero the parts above it are owed, so three people do not each take back more than the bucket holds", () => {
  const names = { alex: "Alex", kim: "Kim", sam: "Sam" };
  expect(
    endedSentence(
      {
        ...ENDED_OWES,
        balanceCents: 90000,
        own: [
          { personId: "alex", ownCents: 110000 },
          { personId: "kim", ownCents: 30000 },
          { personId: "sam", ownCents: -50000 },
        ],
      },
      names,
    ),
  ).toBe(
    `The mortgage ended on 2026-03-31. ${formatCents(90000)} is left in the bucket. Alex is owed ${formatCents(110000)}, Kim is owed ${formatCents(30000)}, Sam owes ${formatCents(50000)}.`,
  );
  expect(
    endedSentence(
      {
        ...ENDED_OWES,
        balanceCents: -40000,
        own: [
          { personId: "alex", ownCents: 10000 },
          { personId: "sam", ownCents: -50000 },
        ],
      },
      names,
    ),
  ).toBe(
    `The mortgage ended on 2026-03-31. The bucket is ${formatCents(40000)} short. Alex is owed ${formatCents(10000)}, Sam owes ${formatCents(50000)}.`,
  );
});

test("the household screen's line says a short bucket is short, as Home does", () => {
  expect(mortgageStanding({ ...ENDED, balanceCents: -50000, left: true })).toBe(
    `The mortgage ended on 2026-03-31. The bucket is ${formatCents(50000)} short.`,
  );
  expect(mortgageStanding(ENDED)).toBe(
    "The mortgage ended on 2026-03-31. 199.99 $ is left in the bucket.",
  );
});

test("a household recorded as none never draws the mortgage cards or asks for their series", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue(NONE);
  await stats();

  expect(screen.queryByRole("heading", { name: "Mortgage payment" })).toBeNull();
  expect(vi.mocked(fetchMortgagePayments)).not.toHaveBeenCalled();
  expect(vi.mocked(fetchMortgageOwn)).not.toHaveBeenCalled();
});

test("the mortgage cards wait for the read, and a failed read draws them as live", async () => {
  const held: { answer?: (value: typeof LIVE) => void } = {};
  vi.mocked(fetchMortgage).mockReturnValue(
    new Promise((done) => {
      held.answer = done;
    }),
  );
  render(<Stats />);
  await screen.findByRole("heading", { name: "Settlements" });
  expect(screen.queryByRole("heading", { name: "Mortgage payment" })).toBeNull();
  expect(vi.mocked(fetchMortgagePayments)).not.toHaveBeenCalled();

  held.answer?.(LIVE);
  expect(await screen.findByRole("heading", { name: "Mortgage payment" })).toBeTruthy();
  cleanup();

  vi.mocked(fetchMortgagePayments).mockClear();
  vi.mocked(fetchMortgage).mockRejectedValue(new AppError("UNREACHABLE"));
  render(<Stats />);
  expect(await screen.findByRole("heading", { name: "Mortgage payment" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Own money in the mortgage" })).toBeTruthy();
  expect(vi.mocked(fetchMortgagePayments)).toHaveBeenCalled();
});

test("the end marker is told from a renewal's: unequal payments, the last one a payment after the end date", async () => {
  vi.mocked(fetchMortgage).mockResolvedValue({
    ...ENDED,
    endedOn: "2026-03-01",
    lastPaymentOn: "2026-03-15",
    closedOn: "2026-03-15",
  });
  vi.mocked(fetchMortgagePayments).mockResolvedValue({
    range: NO_RANGE,
    payments: [
      { date: "2026-01-15", cents: 70000, previousCents: null, changed: false },
      { date: "2026-02-15", cents: 71234, previousCents: 70000, changed: true },
      { date: "2026-03-15", cents: 71234, previousCents: 71234, changed: false },
    ],
  });
  await stats();

  const payment = card("Mortgage payment");
  // The renewal's dot and the end's: two, and only the last point says it ended.
  expect(payment.getByRole("slider").querySelectorAll("circle.marker")).toHaveLength(2);
  expect(
    payment.getAllByText("Last payment on 2026-03-15; the mortgage ended.").length,
  ).toBeGreaterThan(0);
  fireEvent.keyDown(payment.getByRole("slider"), { key: "ArrowLeft" });
  expect(payment.getAllByText("Changed from 700.00 $ to 712.34 $.").length).toBeGreaterThan(0);
  expect(payment.queryAllByText(/Last payment on/u)).toHaveLength(0);
});

// --- The form ---

const HOUSEHOLD = {
  household: { id: "home", name: "The test household" },
  members: [{ address: "alex@example.test", person: "alex", name: "alex" }],
  history: [],
};

function form(): ReturnType<typeof within> {
  const heading = screen.getByRole("heading", { name: "Mortgage" });
  return within(heading.closest("section") as HTMLElement);
}

test("the household screen shows what stands and sets an end date", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(HOUSEHOLD);
  vi.mocked(saveMortgage).mockResolvedValue(ENDED);
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Mortgage" });
  expect(form().getByText("The mortgage is still being paid.")).toBeTruthy();

  fireEvent.click(form().getByLabelText("The mortgage has ended"));
  fireEvent.change(form().getByLabelText("Ended on"), { target: { value: "2026-03-31" } });
  fireEvent.click(form().getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(vi.mocked(saveMortgage)).toHaveBeenCalledWith({ state: "ended", endedOn: "2026-03-31" }),
  );
  expect(
    await form().findByText("The mortgage ended on 2026-03-31. 199.99 $ is left in the bucket."),
  ).toBeTruthy();
});

test("the household screen says there is no mortgage, and takes either back", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(HOUSEHOLD);
  vi.mocked(saveMortgage).mockResolvedValueOnce(NONE).mockResolvedValueOnce(LIVE);
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Mortgage" });

  fireEvent.click(form().getByLabelText("There is no mortgage"));
  fireEvent.click(form().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(vi.mocked(saveMortgage)).toHaveBeenLastCalledWith({ state: "none" }));
  expect(await form().findByText("The household has no mortgage.")).toBeTruthy();

  fireEvent.click(form().getByLabelText("The mortgage is still being paid"));
  fireEvent.click(form().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(vi.mocked(saveMortgage)).toHaveBeenLastCalledWith({ state: "live" }));
  expect(await form().findByText("The mortgage is still being paid.")).toBeTruthy();
});

test("an end with no day is not sent, and a refusal from the server is shown", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(HOUSEHOLD);
  vi.mocked(saveMortgage).mockRejectedValue(new AppError("UNREACHABLE"));
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Mortgage" });

  fireEvent.click(form().getByLabelText("The mortgage has ended"));
  fireEvent.click(form().getByRole("button", { name: "Save" }));
  expect((await form().findByRole("alert")).textContent).toBe("Give the day the mortgage ended.");
  expect(vi.mocked(saveMortgage)).not.toHaveBeenCalled();

  fireEvent.change(form().getByLabelText("Ended on"), { target: { value: "2026-03-31" } });
  fireEvent.click(form().getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(form().getByRole("alert").textContent).toBe("The site could not be reached."),
  );
});
