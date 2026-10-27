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
  adminChangeAddress,
  adminRemoveMember,
  adminRenamePerson,
  adminRetirePerson,
  createHousehold,
  fetchAdminHouseholds,
} from "../src/api/households.ts";
import { Admin } from "../src/admin/Admin.tsx";

vi.mock("../src/api/households.ts", () => ({
  fetchAdminHouseholds: vi.fn(),
  createHousehold: vi.fn(),
  adminAddMember: vi.fn(),
  adminChangeAddress: vi.fn(),
  adminRemoveMember: vi.fn(),
  adminRenamePerson: vi.fn(),
  adminRetirePerson: vi.fn(),
}));

const HOUSEHOLDS: AdminHousehold[] = [
  {
    id: "away",
    name: "The other household",
    members: [{ address: "kim@away.test", person: "kim", name: "kim" }],
    people: [{ person: "kim", name: "kim", standing: "in" }],
  },
  {
    id: "home",
    name: "The test household",
    members: [
      { address: "alex@example.test", person: "alex", name: "alex" },
      { address: "sam@example.test", person: "sam", name: "sam" },
    ],
    people: [
      { person: "alex", name: "alex", standing: "in" },
      { person: "sam", name: "sam", standing: "in" },
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
  const admit = screen.getByRole("list", { name: "Emails to admit" });
  expect([...admit.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "kim@away.test",
    "alex@example.test",
    "sam@example.test",
  ]);
  expect(
    screen.getAllByText(/must also be admitted on the ledger.s Access policy/u),
  ).not.toHaveLength(0);
});

// lg-71: a household is made by adding its first person; the answer is its card.
const CABIN: AdminHousehold = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Home",
  members: [{ address: "robin@cabin.test", person: "robin", name: "robin" }],
  people: [{ person: "robin", name: "robin", standing: "in" }],
};

test("creates a household from its first person, shows its card without asking again, and adds a member", async () => {
  vi.mocked(createHousehold).mockResolvedValue(CABIN);
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  const fresh = card("New household");
  fireEvent.change(within(fresh).getByLabelText("Email"), {
    target: { value: " robin@cabin.test " },
  });
  fireEvent.change(within(fresh).getByLabelText("Person"), { target: { value: "robin" } });
  fireEvent.click(within(fresh).getByRole("button", { name: "Create household" }));

  expect(await screen.findByRole("heading", { name: "Home: robin" })).toBeTruthy();
  expect(vi.mocked(createHousehold)).toHaveBeenCalledWith({
    address: "robin@cabin.test",
    person: "robin",
  });
  expect(vi.mocked(fetchAdminHouseholds)).toHaveBeenCalledTimes(1);
  // The UUID is nowhere on the screen.
  expect(document.body.textContent).not.toContain(CABIN.id);
  expect(within(card("Emails to admit")).getByText("robin@cabin.test")).toBeTruthy();
  expect((within(fresh).getByLabelText("Email") as HTMLInputElement).value).toBe("");

  vi.mocked(adminAddMember).mockResolvedValue({
    address: "lee@cabin.test",
    person: "lee",
    name: "lee",
  });
  const cabin = card("Home: robin");
  fireEvent.change(within(cabin).getByLabelText("Email"), {
    target: { value: "lee@cabin.test" },
  });
  fireEvent.change(within(cabin).getByLabelText("Person"), { target: { value: "lee" } });
  fireEvent.click(within(cabin).getByRole("button", { name: "Add member" }));

  await waitFor(() =>
    expect(vi.mocked(adminAddMember)).toHaveBeenCalledWith(CABIN.id, {
      address: "lee@cabin.test",
      person: "lee",
    }),
  );
  await waitFor(() => expect(vi.mocked(fetchAdminHouseholds)).toHaveBeenCalledTimes(2));
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
      'That email already belongs to the household "away", as kim. Remove it first.',
    ),
  );
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  const home = card("The test household");
  fireEvent.change(within(home).getByLabelText("Email"), { target: { value: "kim@away.test" } });
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
  const people = within(home).getByRole("list", {
    name: "People in The test household: alex and sam",
  });
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
      people: [
        { person: "alex", name: "Alex", standing: "in" },
        { person: "sam", name: "sam", standing: "in" },
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

// lg-34: an Edit beside each member's Remove opens the address in place; Save
// sends one request, and the list then shows the new address under the same person.
test("edits a member's address in one request, and lists the new address under the same person", async () => {
  vi.mocked(adminChangeAddress).mockResolvedValue({
    address: "sam.new@example.test",
    person: "sam",
    name: "sam",
  });
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const home = card("The test household");

  fireEvent.click(within(home).getByRole("button", { name: "Edit sam@example.test" }));
  // The Access policy note shows with the form, since the new address needs admitting too.
  expect(
    within(home).getAllByText(/must also be admitted on the ledger.s Access policy/u),
  ).toHaveLength(2);
  vi.mocked(fetchAdminHouseholds).mockResolvedValue([
    HOUSEHOLDS[0] as AdminHousehold,
    {
      id: "home",
      name: "The test household",
      members: [
        { address: "alex@example.test", person: "alex", name: "alex" },
        { address: "sam.new@example.test", person: "sam", name: "sam" },
      ],
      people: (HOUSEHOLDS[1] as AdminHousehold).people,
    },
  ]);
  fireEvent.change(within(home).getByLabelText("New email for sam@example.test"), {
    target: { value: " sam.new@example.test " },
  });
  fireEvent.click(within(home).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(
      within(card("The test household")).getByRole("button", {
        name: "Edit sam.new@example.test",
      }),
    ).toBeTruthy(),
  );
  expect(vi.mocked(adminChangeAddress)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(adminChangeAddress)).toHaveBeenCalledWith("home", {
    from: "sam@example.test",
    to: "sam.new@example.test",
  });
  // No remove and no add: one request did it.
  expect(vi.mocked(adminRemoveMember)).not.toHaveBeenCalled();
  expect(vi.mocked(adminAddMember)).not.toHaveBeenCalled();
  const after = card("The test household");
  const row = within(after).getByText("sam.new@example.test", { exact: false }).closest("li");
  expect(row?.querySelector("strong")?.textContent).toBe("sam");
  expect(after.textContent).not.toContain("sam@example.test");
});

test("puts the server's sentence in front of a refused new address, and keeps the old one listed", async () => {
  vi.mocked(adminChangeAddress).mockRejectedValue(
    new AppError(
      "ADDRESS_ALREADY_A_MEMBER",
      'That email already belongs to the household "away", as kim. Remove it first.',
    ),
  );
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const home = card("The test household");

  fireEvent.click(within(home).getByRole("button", { name: "Edit sam@example.test" }));
  fireEvent.change(within(home).getByLabelText("New email for sam@example.test"), {
    target: { value: "kim@away.test" },
  });
  fireEvent.click(within(home).getByRole("button", { name: "Save" }));

  expect((await within(home).findByRole("alert")).textContent).toContain('household "away"');
  // The form stays open on what was typed, and the old address is still the one listed.
  expect(
    (within(home).getByLabelText("New email for sam@example.test") as HTMLInputElement).value,
  ).toBe("kim@away.test");
  const listed = within(home)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
  expect(listed.some((text) => text.includes("sam@example.test"))).toBe(true);
  expect(vi.mocked(fetchAdminHouseholds)).toHaveBeenCalledTimes(1);
});

// lg-35: each person's standing beside their Rename, a member who has left
// included, and the one request that standing offers.
test("lists everyone the household has named with where they stand, and retires one from the next close", async () => {
  const withCasey = (standing: "in" | "retiring"): AdminHousehold[] => [
    HOUSEHOLDS[0] as AdminHousehold,
    {
      ...(HOUSEHOLDS[1] as AdminHousehold),
      people: [
        { person: "alex", name: "alex", standing: "in" },
        { person: "casey", name: "Casey", standing },
        { person: "sam", name: "sam", standing: "retired" },
      ],
    },
  ];
  vi.mocked(fetchAdminHouseholds).mockResolvedValue(withCasey("in"));
  vi.mocked(adminRetirePerson).mockResolvedValue({
    person: "casey",
    name: "Casey",
    standing: "retiring",
  });
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const people = within(card("The test household")).getByRole("list", {
    name: "People in The test household: alex, Casey, and sam",
  });
  // casey has no address and is still listed, under the shown name.
  expect([...people.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "alex in the booksRenameRetire",
    "Casey in the booksRenameRetire",
    "sam retiredRenameBring back",
  ]);

  vi.mocked(fetchAdminHouseholds).mockResolvedValue(withCasey("retiring"));
  fireEvent.click(within(people).getByRole("button", { name: "Retire Casey" }));

  await waitFor(() =>
    expect(within(card("The test household")).getByText("retiring at the next close")).toBeTruthy(),
  );
  expect(vi.mocked(adminRetirePerson)).toHaveBeenCalledWith("home", {
    person: "casey",
    action: "retire",
  });
  expect(
    within(card("The test household")).getByRole("button", { name: "Keep Casey in" }),
  ).toBeTruthy();
});

test("puts the server's sentence in front of a refused retirement", async () => {
  vi.mocked(adminRetirePerson).mockRejectedValue(
    new AppError(
      "BAD_REQUEST",
      "Remove every email under sam first: nobody who can sign in is retired.",
    ),
  );
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const home = card("The test household");

  fireEvent.click(within(home).getByRole("button", { name: "Retire sam" }));

  expect((await within(home).findByRole("alert")).textContent).toContain(
    "Remove every email under sam first",
  );
});

// lg-71: the New household form holds the first person's Email and Person, and
// nothing else; with no household yet it is the only form on the screen.
test("asks a new household for its first person's email and name, and for no id or name", async () => {
  vi.mocked(fetchAdminHouseholds).mockResolvedValue([]);
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  const forms = document.querySelectorAll("form");
  expect(forms).toHaveLength(1);
  const fresh = card("New household");
  expect(fresh.contains(forms[0] ?? null)).toBe(true);
  const labels = [...fresh.querySelectorAll("label")].map((label) => label.textContent);
  expect(labels).toEqual(["Email", "Person"]);
  expect(within(fresh).queryByLabelText("Id")).toBeNull();
  expect(within(fresh).queryByLabelText("Name")).toBeNull();
  expect(within(fresh).getByText(/There is no household yet/u)).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Emails to admit" })).toBeNull();

  fireEvent.click(within(fresh).getByRole("button", { name: "Create household" }));
  // lg-76: the email is asked for; the name may be left empty.
  expect(within(fresh).getByRole("alert").textContent).toBe(
    "Give the first person's email, and their name if you like.",
  );
  expect(vi.mocked(createHousehold)).not.toHaveBeenCalled();
});

test("puts the server's sentence in front of a refused first address, and adds no card", async () => {
  vi.mocked(createHousehold).mockRejectedValue(
    new AppError(
      "ADDRESS_ALREADY_A_MEMBER",
      'That email already belongs to the household "away", as kim. Remove it first.',
    ),
  );
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  const fresh = card("New household");

  fireEvent.change(within(fresh).getByLabelText("Email"), { target: { value: "kim@away.test" } });
  fireEvent.change(within(fresh).getByLabelText("Person"), { target: { value: "kim" } });
  fireEvent.click(within(fresh).getByRole("button", { name: "Create household" }));

  expect((await within(fresh).findByRole("alert")).textContent).toContain("That email");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "The other household: kim",
    "The test household: alex and sam",
    "New household",
    "Emails to admit",
  ]);
});

// lg-71, Build 6: every new household is "Home" and its id is a UUID, so a card
// is told apart by the people the household has named, under their shown names.
test("tells two Home cards apart by their people, and shows no id but for a household that has named nobody", async () => {
  const twoHomes: AdminHousehold[] = [
    CABIN,
    {
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      name: "Home",
      members: [{ address: "lee@lake.test", person: "lee", name: "Lee" }],
      // A member who has left still names the household.
      people: [
        { person: "lee", name: "Lee", standing: "in" },
        { person: "jo", name: "Jo", standing: "retired" },
      ],
    },
    { id: "empty", name: "Old", members: [], people: [] },
  ];
  vi.mocked(fetchAdminHouseholds).mockResolvedValue(twoHomes);
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });

  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Home: robin",
    "Home: Lee and Jo",
    "Old (empty)",
    "New household",
    "Emails to admit",
  ]);
  expect(
    within(card("Home: Lee and Jo")).getByRole("list", { name: "People in Home: Lee and Jo" }),
  ).toBeTruthy();
  expect(document.body.textContent).not.toContain(CABIN.id);
  expect(document.body.textContent).not.toContain("7c9e6679");
});

// lg-71, Build 7: every field that takes an address says Email. The fields on the
// admin's screen are the New household form's, each card's member form, and a
// member's address opened in place; all three are open here at once.
test("labels no address field Address, the change-address form included", async () => {
  render(<Admin />);
  await screen.findByRole("heading", { name: "Households" });
  fireEvent.click(screen.getByRole("button", { name: "Edit sam@example.test" }));

  const labels = [...document.querySelectorAll("label")].map((label) => label.textContent ?? "");
  expect(labels.filter((text) => /address/iu.test(text))).toEqual([]);
  expect(labels.filter((text) => text === "Email")).toHaveLength(3);
  expect(labels).toContain("New email for sam@example.test");
  expect(screen.queryAllByLabelText(/address/iu)).toEqual([]);
});
