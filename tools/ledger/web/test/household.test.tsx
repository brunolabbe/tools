// @vitest-environment jsdom

/**
 * A member's household screen (lg-22): the members and the history, adding a
 * member with the Access policy named, and no way to remove anyone. The fakes
 * are the API client module; the addresses are invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { HouseholdResponse } from "@ledger/contract";
import { addHouseholdMember, fetchHousehold } from "../src/api/households.ts";
import { fetchMortgage } from "../src/api/mortgage.ts";
import { Household } from "../src/household/Household.tsx";
import { LIVE } from "./mortgage-fixtures.ts";

vi.mock("../src/api/mortgage.ts", () => ({ fetchMortgage: vi.fn(), saveMortgage: vi.fn() }));
vi.mock("../src/api/households.ts", () => ({
  fetchHousehold: vi.fn(),
  addHouseholdMember: vi.fn(),
}));

const HOME: HouseholdResponse = {
  household: { id: "home", name: "The test household" },
  members: [
    { address: "alex@example.test", person: "alex", name: "alex" },
    { address: "sam@example.test", person: "sam", name: "sam" },
  ],
  history: [
    {
      address: "alex@example.test",
      person: "alex",
      action: "add",
      at: "2026-10-01T00:00:00.000Z",
      by: "operator",
    },
    {
      address: "sam@example.test",
      person: "sam",
      action: "add",
      at: "2026-10-02T00:00:00.000Z",
      by: "admin@example.test",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchHousehold).mockResolvedValue(HOME);
  vi.mocked(fetchMortgage).mockResolvedValue(LIVE);
});

afterEach(cleanup);

test("shows the household's members and its history, newest first, with who made each change", async () => {
  render(<Household id="home" />);

  expect(await screen.findByRole("heading", { name: "Household" })).toBeTruthy();
  expect(vi.mocked(fetchHousehold).mock.calls[0]?.[0]).toBe("home");
  expect(screen.getByText("The test household")).toBeTruthy();
  const [members, history] = screen.getAllByRole("list");
  expect(members?.textContent).toContain("alex alex@example.test");
  expect(members?.textContent).toContain("sam sam@example.test");
  const changes = history?.querySelectorAll("li") ?? [];
  expect(changes[0]?.textContent).toBe(
    "2026-10-02 sam@example.test added as sam, by admin@example.test",
  );
  expect(changes[1]?.textContent).toBe(
    "2026-10-01 alex@example.test added as alex, by the operator",
  );
});

test("adds a member, tells them the address must be admitted on Access, and shows the list again", async () => {
  vi.mocked(addHouseholdMember).mockResolvedValue({
    address: "sam.phone@example.test",
    person: "sam",
    name: "sam",
  });
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Household" });
  expect(screen.getByText(/must also be admitted on the ledger.s Access policy/u)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Address"), {
    target: { value: "sam.phone@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "admit sam.phone@example.test on its Access policy",
  );
  expect(vi.mocked(addHouseholdMember)).toHaveBeenCalledWith("home", {
    address: "sam.phone@example.test",
    person: "sam",
  });
  await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2));
});

test("puts the server's one sentence in front of a refused address", async () => {
  vi.mocked(addHouseholdMember).mockRejectedValue(new AppError("MEMBER_NOT_ADDED"));
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Household" });

  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "kim@away.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "That address cannot be added to this household.",
  );
});

test("offers no way to remove anyone", async () => {
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Household" });
  await screen.findByRole("heading", { name: "Mortgage" });

  expect(screen.queryByRole("button", { name: /remove/iu })).toBeNull();
  // The second is the mortgage setting (lg-55); neither removes anyone.
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Add member",
    "Save",
  ]);
});

// lg-33: a person is shown by name, and a rename is its own line in the history.
test("shows a renamed person by name, and the rename as its own line", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue({
    ...HOME,
    members: [
      { address: "alex@example.test", person: "alex", name: "Alex" },
      { address: "sam@example.test", person: "sam", name: "sam" },
    ],
    history: [
      ...HOME.history,
      {
        action: "rename",
        person: "alex",
        name: "Alex",
        at: "2026-10-17T00:00:00.000Z",
        by: "admin@example.test",
      },
    ],
  });
  vi.mocked(addHouseholdMember).mockResolvedValue({
    address: "alex.phone@example.test",
    person: "alex",
    name: "Alex",
  });
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "Household" });

  const [members, history] = screen.getAllByRole("list");
  expect(members?.textContent).toContain("Alex alex@example.test");
  const changes = history?.querySelectorAll("li") ?? [];
  expect(changes[0]?.textContent).toBe("2026-10-17 alex renamed Alex, by admin@example.test");
  expect(changes[2]?.textContent).toBe(
    "2026-10-01 alex@example.test added as Alex, by the operator",
  );

  // The form offers Alex and sends the id.
  fireEvent.change(screen.getByLabelText("Address"), {
    target: { value: "alex.phone@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "Alex" } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  await waitFor(() =>
    expect(vi.mocked(addHouseholdMember)).toHaveBeenCalledWith("home", {
      address: "alex.phone@example.test",
      person: "alex",
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "Added alex.phone@example.test as Alex.",
  );
});
