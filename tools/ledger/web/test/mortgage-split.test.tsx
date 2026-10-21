// @vitest-environment jsdom

/**
 * The mortgage split on the screens (lg-63): the own-money card names the split
 * standing at the range's end, marks the day it changed with the new split in
 * its note, and says on each row of its table how a payment splits; the form
 * beside the salaries files a split from a date. The fakes are the API client
 * modules; the figures are invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { MortgageOwnResponse, MortgageSplit, MortgageSplitOn } from "@ledger/contract";
import { fetchMortgageSplits, fileMortgageSplit } from "../src/api/mortgage-splits.ts";
import { fetchPeople } from "../src/api/rules.ts";
import { fetchMortgageOwn } from "../src/api/stats.ts";
import { MortgageSplitCard } from "../src/salaries/MortgageSplit.tsx";
import { MortgageOwnCard } from "../src/stats/Cards.tsx";
import { EQUAL_SPLIT, LIVE } from "./mortgage-fixtures.ts";

vi.mock("../src/api/stats.ts", () => ({ fetchMortgageOwn: vi.fn() }));
vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/mortgage-splits.ts", () => ({
  fetchMortgageSplits: vi.fn(),
  fileMortgageSplit: vi.fn(),
}));

const NO_RANGE = { from: null, to: null };

const BY_SHARES: MortgageSplitOn = {
  mode: "shares",
  effectiveFrom: "2026-02-01",
  noRatio: false,
  parts: [
    { personId: "alex", partsPerMillion: 250_000 },
    { personId: "sam", partsPerMillion: 750_000 },
  ],
};

const BEFORE_ANY_RATIO: MortgageSplitOn = { ...EQUAL_SPLIT, mode: "ratio", noRatio: true };

function point(
  date: string,
  alex: number,
  sam: number,
  split: MortgageSplitOn,
  splitChanged: boolean,
): MortgageOwnResponse["points"][number] {
  return {
    date,
    balanceCents: alex + sam,
    own: [
      { personId: "alex", ownCents: alex },
      { personId: "sam", ownCents: sam },
    ],
    split,
    splitChanged,
  };
}

/** At the ratio before any ratio in January, then by shares from February. */
const CROSSING: MortgageOwnResponse = {
  range: NO_RANGE,
  people: ["alex", "sam"],
  points: [
    point("2026-01-15", 164_999, 165_000, BEFORE_ANY_RATIO, false),
    point("2026-02-15", 147_499, 112_500, BY_SHARES, true),
    point("2026-03-15", 129_998, 59_999, BY_SHARES, false),
  ],
  split: BY_SHARES,
};

function record(id: number, effectiveFrom: string, split: Partial<MortgageSplit>): MortgageSplit {
  return {
    id,
    effectiveFrom,
    mode: "equal",
    shares: [],
    supersedes: null,
    enteredAt: "2026-10-03T09:30:00.000Z",
    enteredBy: "alex",
    ...split,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMortgageOwn).mockResolvedValue(CROSSING);
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchMortgageSplits).mockResolvedValue({
    asOf: "2026-10-03",
    splits: [],
    inEffect: null,
  });
});

afterEach(cleanup);

async function ownCard(): Promise<ReturnType<typeof within>> {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    const section = screen
      .getByRole("heading", { name: "Own money in the mortgage" })
      .closest("section");
    if (section === null) throw new Error("no card");
    within(section).getByRole("slider");
    found = section;
  });
  if (found === null) throw new Error("no card");
  return within(found);
}

// Done when 7.
test("over a range that crosses a change, the own-money card marks it and names the new split", async () => {
  render(<MortgageOwnCard range={NO_RANGE} mortgage={LIVE} />);
  const card = await ownCard();

  expect(
    card.getByText(
      "Each person's own money in the bucket: their deposits less their share of every payment, as the split on the payment's date sets it. Now a payment splits by shares: alex 25.0000 % · sam 75.0000 %. A larger dot is a change of split. It is not shared money.",
    ),
  ).toBeTruthy();
  // The day it changed has a larger dot on each person's line.
  expect(card.getByRole("slider").querySelectorAll("circle.marker")).toHaveLength(2);

  fireEvent.keyDown(card.getByRole("slider"), { key: "ArrowLeft" });
  expect(
    card.getByText(
      "The split changed: a payment now splits by shares: alex 25.0000 % · sam 75.0000 %",
    ),
  ).toBeTruthy();

  fireEvent.click(card.getByRole("button", { name: "Show as a table" }));
  expect(card.getByText("Changed: By shares")).toBeTruthy();
  // A payment at the ratio before any ratio split equally, and its row says so.
  expect(card.getByText("Equally: no ratio yet")).toBeTruthy();
});

test("a range that holds no change marks nothing, and its caption names the split on its last day", async () => {
  vi.mocked(fetchMortgageOwn).mockResolvedValue({
    ...CROSSING,
    range: { from: null, to: "2026-01-31" },
    points: CROSSING.points.slice(0, 1),
    split: BEFORE_ANY_RATIO,
  });
  render(<MortgageOwnCard range={{ from: null, to: "2026-01-31" }} mortgage={LIVE} />);
  const card = await ownCard();

  expect(
    card.getByText(
      /On 2026-01-31 a payment splits equally between alex and sam, no ratio being in effect yet\./u,
    ),
  ).toBeTruthy();
  expect(card.getByRole("slider").querySelectorAll("circle.marker")).toHaveLength(0);
});

test("the split form says what stands, and files shares from a day as parts per million", async () => {
  vi.mocked(fetchMortgageSplits).mockResolvedValue({
    asOf: "2026-10-03",
    splits: [record(1, "2026-01-01", { mode: "ratio" })],
    inEffect: record(1, "2026-01-01", { mode: "ratio" }),
  });
  const filed = record(2, "2026-02-01", {
    mode: "shares",
    shares: BY_SHARES.parts,
  });
  vi.mocked(fileMortgageSplit).mockResolvedValue(filed);
  render(<MortgageSplitCard />);

  expect(
    await screen.findByText(
      "The mortgage's payments split at the ratio in effect on each payment's date, since 2026-01-01.",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByLabelText("By shares"));
  fireEvent.change(screen.getByLabelText("alex’s part, in %"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("sam’s part, in %"), { target: { value: "75,0" } });
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
  vi.mocked(fetchMortgageSplits).mockResolvedValue({
    asOf: "2026-10-03",
    splits: [record(1, "2026-01-01", { mode: "ratio" }), filed],
    inEffect: filed,
  });
  fireEvent.click(screen.getByRole("button", { name: "File the split" }));

  expect(await screen.findByText("Split filed, in effect from 2026-02-01.")).toBeTruthy();
  expect(vi.mocked(fileMortgageSplit)).toHaveBeenCalledWith({
    effectiveFrom: "2026-02-01",
    mode: "shares",
    shares: BY_SHARES.parts,
  });
  const history = await screen.findByRole("list", { name: "Mortgage splits filed" });
  expect(within(history).getByText("by shares: alex 25.0000 % · sam 75.0000 %")).toBeTruthy();
});

test("parts that do not make 100 % are not sent, and a refusal is said", async () => {
  render(<MortgageSplitCard />);

  expect(
    await screen.findByText("The mortgage's payments split equally: no split has been filed."),
  ).toBeTruthy();
  fireEvent.click(screen.getByLabelText("By shares"));
  fireEvent.change(screen.getByLabelText("alex’s part, in %"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("sam’s part, in %"), { target: { value: "70" } });
  fireEvent.click(screen.getByRole("button", { name: "File the split" }));

  expect(await screen.findByText("The parts make 100 %. These make 95.0000 %.")).toBeTruthy();
  expect(vi.mocked(fileMortgageSplit)).not.toHaveBeenCalled();

  vi.mocked(fileMortgageSplit).mockRejectedValue(new AppError("MORTGAGE_SHARES_WRONG_PEOPLE"));
  fireEvent.change(screen.getByLabelText("sam’s part, in %"), { target: { value: "75" } });
  fireEvent.click(screen.getByRole("button", { name: "File the split" }));

  expect(
    await screen.findByText(
      "Those parts do not name exactly the people in the books on that day. Give each of them a part, and nobody else.",
    ),
  ).toBeTruthy();
});
