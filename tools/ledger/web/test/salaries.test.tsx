// @vitest-environment jsdom

/**
 * The salaries screen (lg-5): a year's salaries are saved, the ratio they give
 * is proposed with its effective date, and the person confirms it. The fakes are
 * the API client modules; the salaries are invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { Ratio, Salary } from "@ledger/contract";
import { fetchPeople } from "../src/api/rules.ts";
import { confirmRatio, enterSalaries, fetchRatios, fetchSalaries } from "../src/api/salaries.ts";
import { Salaries } from "../src/salaries/Salaries.tsx";

vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/salaries.ts", () => ({
  fetchSalaries: vi.fn(),
  fetchRatios: vi.fn(),
  enterSalaries: vi.fn(),
  confirmRatio: vi.fn(),
}));

const entered = vi.mocked(enterSalaries);
const confirmed = vi.mocked(confirmRatio);

function salary(id: number, personId: string, year: number, amountCents: number): Salary {
  return {
    id,
    personId,
    year,
    amountCents,
    supersedes: null,
    enteredAt: "2026-10-03T09:30:00.000Z",
    enteredBy: "alex",
  };
}

const RATIO: Ratio = {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchSalaries).mockResolvedValue([
    salary(1, "alex", 2025, 6_000_000),
    salary(2, "sam", 2025, 4_000_000),
  ]);
  vi.mocked(fetchRatios).mockResolvedValue({
    asOf: "2026-10-03",
    ratios: [RATIO],
    inEffect: RATIO,
  });
});

afterEach(cleanup);

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

test("shows the ratio in effect, and fills in a year's salaries on record to correct from", async () => {
  render(<Salaries />);

  expect(
    await screen.findByText("Ratio in effect: alex 60.0000 % · sam 40.0000 %, since 2025-01-01."),
  ).toBeTruthy();
  fireEvent.change(field("Year"), { target: { value: "2025" } });
  expect(field("alex’s salary").value).toBe("60000.00 $");
  expect(field("sam’s salary").value).toBe("40000.00 $");
});

test("saving a year's salaries proposes the ratio, and confirming sends its records and the chosen day", async () => {
  entered.mockResolvedValue({
    salaries: [salary(3, "alex", 2026, 6_123_456), salary(4, "sam", 2026, 4_000_000)],
    proposal: {
      effectiveFrom: "2026-10-03",
      shares: [
        { personId: "alex", partsPerMillion: 604_877, salaryId: 3 },
        { personId: "sam", partsPerMillion: 395_123, salaryId: 4 },
      ],
    },
  });
  confirmed.mockResolvedValue({ ...RATIO, id: 2, effectiveFrom: "2027-01-01" });
  render(<Salaries />);
  await screen.findByLabelText("Year");

  fireEvent.change(field("Year"), { target: { value: "2026" } });
  fireEvent.change(field("alex’s salary"), { target: { value: "61234.56" } });
  fireEvent.change(field("sam’s salary"), { target: { value: "40000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save salaries" }));

  expect(entered).toHaveBeenCalledWith({
    year: 2026,
    salaries: [
      { personId: "alex", amountCents: 6_123_456 },
      { personId: "sam", amountCents: 4_000_000 },
    ],
  });
  expect(await screen.findByText("alex 60.4877 % · sam 39.5123 %")).toBeTruthy();
  // Nothing is confirmed by saving: the person chooses the day, then confirms.
  expect(confirmed).not.toHaveBeenCalled();
  expect(field("In effect from").value).toBe("2026-10-03");

  fireEvent.change(field("In effect from"), { target: { value: "2027-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm ratio" }));

  await waitFor(() =>
    expect(confirmed).toHaveBeenCalledWith({ effectiveFrom: "2027-01-01", salaryIds: [3, 4] }),
  );
  expect(await screen.findByText("Ratio confirmed, in effect from 2027-01-01.")).toBeTruthy();
});

test("an amount that is not one is refused before anything is sent", async () => {
  render(<Salaries />);
  await screen.findByLabelText("Year");

  fireEvent.change(field("alex’s salary"), { target: { value: "lots" } });
  fireEvent.change(field("sam’s salary"), { target: { value: "40000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save salaries" }));

  expect((await screen.findByRole("alert")).textContent).toMatch(/alex's salary is not an amount/u);
  expect(entered).not.toHaveBeenCalled();
});

test("a salary corrected under the proposal says what the server said", async () => {
  entered.mockResolvedValue({
    salaries: [salary(3, "alex", 2026, 6_000_000), salary(4, "sam", 2026, 4_000_000)],
    proposal: {
      effectiveFrom: "2026-10-03",
      shares: [
        { personId: "alex", partsPerMillion: 600_000, salaryId: 3 },
        { personId: "sam", partsPerMillion: 400_000, salaryId: 4 },
      ],
    },
  });
  confirmed.mockRejectedValue(
    new AppError("SALARY_NOT_FOUND", "That salary is not the one on record."),
  );
  render(<Salaries />);
  await screen.findByLabelText("Year");
  fireEvent.change(field("alex’s salary"), { target: { value: "60000" } });
  fireEvent.change(field("sam’s salary"), { target: { value: "40000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save salaries" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm ratio" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "That salary is not the one on record.",
  );
});
