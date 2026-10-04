// @vitest-environment jsdom

/**
 * The home screen (lg-5): each person's own money in the mortgage bucket, who
 * has paid extra and by how much, and the buffer's balance. The fake is the API
 * client module; the figures are invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { BucketsResponse } from "@ledger/contract";
import { fetchBuckets } from "../src/api/buckets.ts";
import { Home } from "../src/home/Home.tsx";

vi.mock("../src/api/buckets.ts", () => ({ fetchBuckets: vi.fn() }));

const buckets = vi.mocked(fetchBuckets);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const FIGURES: BucketsResponse = {
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
  unclassified: 1,
};

function section(name: string): ReturnType<typeof within> {
  const heading = screen.getByRole("heading", { name });
  const card = heading.closest("section");
  if (card === null) throw new Error(`no section for ${name}`);
  return within(card);
}

test("shows each person's own money in the mortgage, who has paid extra, and the buffer's balance", async () => {
  buckets.mockResolvedValue(FIGURES);

  render(<Home />);

  await screen.findByRole("heading", { name: "Mortgage" });
  const mortgage = section("Mortgage");
  expect(
    within(mortgage.getByText("alex").closest("li") as HTMLElement).getByText("149.99 $"),
  ).toBeTruthy();
  expect(
    within(mortgage.getByText("sam").closest("li") as HTMLElement).getByText("50.00 $"),
  ).toBeTruthy();
  expect(mortgage.getByText("alex has paid 99.99 $ more.")).toBeTruthy();
  expect(mortgage.getByText("In the bucket: 199.99 $")).toBeTruthy();

  const buffer = section("Buffer");
  expect(
    within(buffer.getByText("Balance").closest("p") as HTMLElement).getByText("130.00 $"),
  ).toBeTruthy();
  expect(buffer.getByText("300.00 $")).toBeTruthy();

  // A row the inbox still holds is not in either figure, and the screen says so.
  expect(screen.getByText(/1 row in the inbox is not counted yet/u)).toBeTruthy();
});

test("says when the two have paid the same", async () => {
  buckets.mockResolvedValue({ ...FIGURES, mortgage: { ...FIGURES.mortgage, lead: null } });

  render(<Home />);

  expect(await screen.findByText("Both have paid the same.")).toBeTruthy();
});

test("says what the server said when the figures cannot be read", async () => {
  buckets.mockRejectedValue(new AppError("UNREACHABLE", "The ledger API is not answering."));

  render(<Home />);

  expect((await screen.findByRole("alert")).textContent).toBe("The ledger API is not answering.");
});
