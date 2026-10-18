// @vitest-environment jsdom

/**
 * The admin's screen (lg-22): every household with its members, a new
 * household, adding and removing a member, and every address to admit on the
 * Access policy. The fakes are the API client module; the addresses are
 * invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { AdminHousehold } from "@ledger/contract";
import {
  adminAddMember,
  adminRemoveMember,
  adminRenamePerson,
  createHousehold,
  fetchAdminHouseholds,
} from "../src/api/households.ts";
import { Admin } from "../src/admin/Admin.tsx";

vi.mock("../src/api/households.ts", () => ({
  fetchAdminHouseholds: vi.fn(),
  createHousehold: vi.fn(),
  adminAddMember: vi.fn(),
  adminRemoveMember: vi.fn(),
  adminRenamePerson: vi.fn(),
}));

const HOUSEHOLDS: AdminHousehold[] = [
  {
    id: "away",
    name: "The other household",
    members: [{ address: "kim@away.test", person: "kim", name: "kim" }],
  },
  {
    id: "home",
    name: "The test household",
    members: [
      { address: "alex@example.test", person: "alex", name: "alex" },
      { address: "sam@example.test", person: "sam", name: "sam" },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAdminHouseholds).mockResolvedValue(HOUSEHOLDS);
});

afterEach(cleanup);

function card(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: new RegExp(`^${name}`, "u") });
  const section = heading.closest("section");
  if (section === null) throw new Error(`no section for ${name}`);
  return section;
}

test("shows every household with its members, and every address to admit on Access", async () => {
  render(<Admin />);

  expect(await screen.findByRole("heading", { name: "Households" })).toBeTruthy();
  expect(
    within(card("The other household")).getByText("kim@away.test", { exact: false }),
  ).toBeTruthy();
  expect(
    within(card("The test household")).getByText("sam@example.test", { exact: false }),
  ).toBeTruthy();
  const admit = screen.getByRole("list", { name: "Addresses to admit" });
  expect([...admit.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "kim@away.test",
    "alex@example.test",
    "sam@example.test",
  ]);
  expect(
    screen.getAllByText(/must also be admitted on the ledger.s Access policy/u),
  ).not.toHaveLength(0);
});

test("creates a household, adds a member to it and shows the list again", async () => {
  vi.mocked(createHousehold).mockResolvedValue({ id: "cabin", name: "The cabin" });
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  const fresh = card("New household");
  fireEvent.change(within(fresh).getByLabelText("Id"), { target: { value: "cabin" } });
  fireEvent.change(within(fresh).getByLabelText("Name"), { target: { value: "The cabin" } });
  vi.mocked(fetchAdminHouseholds).mockResolvedValue([
    ...HOUSEHOLDS,
    { id: "cabin", name: "The cabin", members: [] },
  ]);
  fireEvent.click(within(fresh).getByRole("button", { name: "Create household" }));

  expect(await screen.findByRole("heading", { name: /^The cabin/u })).toBeTruthy();
  expect(vi.mocked(createHousehold)).toHaveBeenCalledWith({ id: "cabin", name: "The cabin" });
  expect(within(card("The cabin")).getByText("Nobody yet.")).toBeTruthy();

  vi.mocked(adminAddMember).mockResolvedValue({
    address: "robin@cabin.test",
    person: "robin",
    name: "robin",
  });
  const cabin = card("The cabin");
  fireEvent.change(within(cabin).getByLabelText("Address"), {
    target: { value: "robin@cabin.test" },
  });
  fireEvent.change(within(cabin).getByLabelText("Person"), { target: { value: "robin" } });
  fireEvent.click(within(cabin).getByRole("button", { name: "Add member" }));

  await waitFor(() =>
    expect(vi.mocked(adminAddMember)).toHaveBeenCalledWith("cabin", {
      address: "robin@cabin.test",
      person: "robin",
    }),
  );
  await waitFor(() => expect(vi.mocked(fetchAdminHouseholds)).toHaveBeenCalledTimes(3));
});

test("removes a member only once the removal is confirmed", async () => {
  vi.mocked(adminRemoveMember).mockResolvedValue({
    address: "sam@example.test",
    person: "sam",
    name: "sam",
  });
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  fireEvent.click(screen.getByRole("button", { name: "Remove sam@example.test" }));
  expect(vi.mocked(adminRemoveMember)).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove sam@example.test" }));
  fireEvent.click(
    within(card("The test household")).getByText("Remove sam@example.test", { selector: "button" }),
  );

  await waitFor(() =>
    expect(vi.mocked(adminRemoveMember)).toHaveBeenCalledWith("home", "sam@example.test"),
  );
  expect(vi.mocked(adminRemoveMember)).toHaveBeenCalledTimes(1);
});

test("puts the server's own sentence in front of a refused address", async () => {
  vi.mocked(adminAddMember).mockRejectedValue(
    new AppError(
      "ADDRESS_ALREADY_A_MEMBER",
      'That address already belongs to the household "away", as kim. Remove it first.',
    ),
  );
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  const home = card("The test household");
  fireEvent.change(within(home).getByLabelText("Address"), { target: { value: "kim@away.test" } });
  fireEvent.click(within(home).getByRole("button", { name: "Add member" }));

  expect((await within(home).findByRole("alert")).textContent).toContain('household "away"');
});

// lg-33: a Rename beside each person, which sends their id and the new name, and
// the list shows the name the household answers with afterwards.
test("renames a person, and prints the shown name after the rename, not the id", async () => {
  vi.mocked(adminRenamePerson).mockResolvedValue({ person: "alex", name: "Alex" });
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const home = card("The test household");
  const people = within(home).getByRole("list", { name: "People in The test household" });
  expect([...people.querySelectorAll("strong")].map((name) => name.textContent)).toEqual([
    "alex",
    "sam",
  ]);

  vi.mocked(fetchAdminHouseholds).mockResolvedValue([
    HOUSEHOLDS[0] as AdminHousehold,
    {
      id: "home",
      name: "The test household",
      members: [
        { address: "alex@example.test", person: "alex", name: "Alex" },
        { address: "sam@example.test", person: "sam", name: "sam" },
      ],
    },
  ]);
  fireEvent.click(within(home).getByRole("button", { name: "Rename alex" }));
  fireEvent.change(within(home).getByLabelText("New name for alex"), {
    target: { value: " Alex " },
  });
  fireEvent.click(within(home).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(
      within(card("The test household")).getByRole("button", { name: "Rename Alex" }),
    ).toBeTruthy(),
  );
  expect(vi.mocked(adminRenamePerson)).toHaveBeenCalledWith("home", {
    person: "alex",
    name: "Alex",
  });
  const after = card("The test household");
  expect([...after.querySelectorAll("strong")].map((name) => name.textContent)).toEqual([
    "Alex",
    "sam",
    "Alex",
    "sam",
  ]);
  // The id is gone from the card, but for the address it is part of.
  expect(after.textContent?.replaceAll("alex@example.test", "")).not.toMatch(/\balex\b/u);
});

test("puts the server's sentence in front of a refused rename", async () => {
  vi.mocked(adminRenamePerson).mockRejectedValue(new AppError("PERSON_NAME_TAKEN"));
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const home = card("The test household");

  fireEvent.click(within(home).getByRole("button", { name: "Rename alex" }));
  fireEvent.change(within(home).getByLabelText("New name for alex"), { target: { value: "sam" } });
  fireEvent.click(within(home).getByRole("button", { name: "Save" }));

  expect((await within(home).findByRole("alert")).textContent).toBe(
    "Another person in this household is already shown under that name.",
  );
});
