// @vitest-environment jsdom

/**
 * A member's household screen (lg-22): the members and the history, adding a
 * member with the Access policy named, and no way to remove anyone. The fakes
 * are the API client module; the addresses are invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { HouseholdResponse } from "@ledger/contract";
import { addHouseholdMember, fetchHousehold, renameHousehold } from "../src/api/households.ts";
import { fetchMortgage } from "../src/api/mortgage.ts";
import { Household } from "../src/household/Household.tsx";
import { LIVE } from "./mortgage-fixtures.ts";

vi.mock("../src/api/mortgage.ts", () => ({ fetchMortgage: vi.fn(), saveMortgage: vi.fn() }));
vi.mock("../src/api/households.ts", () => ({
  fetchHousehold: vi.fn(),
  addHouseholdMember: vi.fn(),
  renameHousehold: vi.fn(),
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

  expect(await screen.findByRole("heading", { name: "The test household" })).toBeTruthy();
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
  await screen.findByRole("heading", { name: "The test household" });
  expect(screen.getByText(/must also be admitted on the ledger.s Access policy/u)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Email"), {
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
  await screen.findByRole("heading", { name: "The test household" });

  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "kim@away.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "That email cannot be added to this household.",
  );
});

test("offers no way to remove anyone", async () => {
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household" });
  await screen.findByRole("heading", { name: "Mortgage" });

  expect(screen.queryByRole("button", { name: /remove/iu })).toBeNull();
  // The first renames the household (lg-77), the last is the mortgage setting
  // (lg-55); none removes anyone.
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Rename",
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
  await screen.findByRole("heading", { name: "The test household" });

  const [members, history] = screen.getAllByRole("list");
  expect(members?.textContent).toContain("Alex alex@example.test");
  const changes = history?.querySelectorAll("li") ?? [];
  expect(changes[0]?.textContent).toBe("2026-10-17 alex renamed Alex, by admin@example.test");
  expect(changes[2]?.textContent).toBe(
    "2026-10-01 alex@example.test added as Alex, by the operator",
  );

  // The form offers Alex and sends the name as typed, which the API resolves to
  // the person shown under it (lg-76; it sent the id before).
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "alex.phone@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "Alex" } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  await waitFor(() =>
    expect(vi.mocked(addHouseholdMember)).toHaveBeenCalledWith("home", {
      address: "alex.phone@example.test",
      person: "Alex",
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "Added alex.phone@example.test as Alex.",
  );
});

// lg-71, Build 7: the member form's address field says Email, and no field on the
// household page is labelled with the word address.
test("labels no address field Address", async () => {
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household" });

  const labels = [...document.querySelectorAll("label")].map((label) => label.textContent ?? "");
  expect(labels).toContain("Email");
  expect(labels.filter((text) => /address/iu.test(text))).toEqual([]);
  expect(screen.queryAllByLabelText(/address/iu)).toEqual([]);
});

// lg-74: a person who has no email and never signs in.
const ROBIN = "00000000-0000-4000-8000-000000000001";

test("lists a person without an email by name with no email, and their add as a line of the history", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue({
    ...HOME,
    members: [...HOME.members, { address: null, person: ROBIN, name: "Robin" }],
    history: [
      ...HOME.history,
      {
        action: "add-person",
        person: ROBIN,
        at: "2026-10-03T00:00:00.000Z",
        by: "sam@example.test",
      },
      {
        action: "name",
        person: ROBIN,
        name: "Robin",
        at: "2026-10-03T00:00:00.000Z",
        by: "sam@example.test",
      },
    ],
  });
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household" });

  const [members, history] = screen.getAllByRole("list");
  const rows = [...(members?.querySelectorAll("li") ?? [])].map((row) => row.textContent);
  expect(rows).toEqual(["alex alex@example.test", "Robin no email", "sam sam@example.test"]);
  expect(members?.textContent).not.toContain(ROBIN);
  expect(history?.querySelector("li")?.textContent).toBe(
    "2026-10-03 Robin added without an email, by sam@example.test",
  );
});

test("the Email field may be left empty: a name alone adds a person who cannot sign in", async () => {
  vi.mocked(addHouseholdMember).mockResolvedValue({ address: null, person: ROBIN, name: "Robin" });
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household" });
  expect(
    screen.getByText(
      /Email may be left empty: a person without one counts in the books but cannot sign in/u,
    ),
  ).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "Robin" } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  expect((await screen.findByRole("status")).textContent).toBe(
    "Added Robin, who counts in the books and cannot sign in.",
  );
  expect(screen.getByRole("status").textContent).not.toContain("Access");
  expect(vi.mocked(addHouseholdMember)).toHaveBeenCalledWith("home", { person: "Robin" });
});

test("with neither an email nor a name, nothing is sent", async () => {
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household" });

  fireEvent.change(screen.getByLabelText("Person"), { target: { value: " " } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Give an email, the person's name, or both.",
  );
  expect(vi.mocked(addHouseholdMember)).not.toHaveBeenCalled();
});

/** The rename form the Rename opened, read through its field: the mortgage form has a Save too. */
function renameForm(): { field: HTMLInputElement; form: HTMLFormElement } {
  const field = screen.getByLabelText("New name for The test household");
  if (!(field instanceof HTMLInputElement) || field.form === null)
    throw new Error("no rename form");
  return { field, form: field.form };
}

// lg-77: the household's name is the page's heading, with a Rename beside it.
test("titles the page by the household's name, and a member renames it there", async () => {
  vi.mocked(renameHousehold).mockResolvedValue({ id: "home", name: "Our place" });
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household", level: 2 });
  expect(screen.queryByRole("heading", { name: "Household" })).toBeNull();

  vi.mocked(fetchHousehold).mockResolvedValue({
    ...HOME,
    household: { id: "home", name: "Our place" },
    history: [
      ...HOME.history,
      {
        action: "rename-household",
        name: "Our place",
        at: "2026-10-31T00:00:00.000Z",
        by: "sam@example.test",
      },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "Rename The test household" }));
  const { field, form } = renameForm();
  expect(field.value).toBe("The test household");
  fireEvent.change(field, { target: { value: "  Our place " } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("heading", { name: "Our place", level: 2 })).toBeTruthy();
  expect(vi.mocked(renameHousehold)).toHaveBeenCalledWith("home", { name: "Our place" });
  await waitFor(() => expect(screen.queryByLabelText(/New name for/u)).toBeNull());
  const [, history] = screen.getAllByRole("list");
  expect(history?.querySelector("li")?.textContent).toBe(
    "2026-10-31 Household renamed Our place, by sam@example.test",
  );
});

test("a refused rename keeps the field open with the server's sentence, and an empty one sends nothing", async () => {
  vi.mocked(renameHousehold).mockRejectedValue(
    new AppError("BAD_REQUEST", "Send the name to call the household by, 1 to 80 characters."),
  );
  render(<Household id="home" />);
  await screen.findByRole("heading", { name: "The test household" });

  fireEvent.click(screen.getByRole("button", { name: "Rename The test household" }));
  const { field, form } = renameForm();
  fireEvent.change(field, { target: { value: "   " } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect(within(form).getByRole("alert").textContent).toBe(
    "Give the name to call the household by.",
  );
  expect(vi.mocked(renameHousehold)).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: "Ours" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(within(form).getByRole("alert").textContent).toBe(
      "Send the name to call the household by, 1 to 80 characters.",
    ),
  );
  expect(renameForm().field.value).toBe("Ours");
  expect(screen.getByRole("heading", { name: "The test household" })).toBeTruthy();
});
