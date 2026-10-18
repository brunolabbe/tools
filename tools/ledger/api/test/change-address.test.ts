/**
 * Changing a member's address from the app (lg-34): an admin swaps the address a
 * person signs in with in one step, under the same person, and the household's
 * books are not touched. Who may call the route at all is `authority.test.ts`,
 * and its limiter is `route-limits.test.ts`; the transaction itself is
 * `directory.test.ts`.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, HouseholdResponse } from "@ledger/contract";
import { ADMIN, ALEX, HOUSEHOLD, SAM } from "./helpers/access.ts";
import {
  KIM,
  booksSnapshot,
  directorySnapshot,
  send,
  startHouseholds,
} from "./helpers/households.ts";
import type { Harness } from "./helpers/households.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.shutdown();
  harness = undefined;
});

/** home holds alex and sam; away holds kim; the admin is in no household. */
async function start(): Promise<Harness> {
  harness = await startHouseholds();
  return harness;
}

const CHANGE = ROUTES.adminMemberAddress.replace(":id", HOUSEHOLD);
const NEW_ADDRESS = "sam.new@example.test";

describe("an admin changes a member's address", () => {
  test("in one request: the new address signs in as the same person, the old one no longer does", async () => {
    const { app, directory } = await start();
    const books = booksSnapshot(app);

    const changed = await send(app, ADMIN, "POST", CHANGE, { from: SAM, to: NEW_ADDRESS });

    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual({ address: NEW_ADDRESS, person: "sam", name: "sam" });
    expect((await send(app, NEW_ADDRESS, "GET", ROUTES.me)).json()).toMatchObject({
      person: { id: "sam" },
    });
    expect((await send(app, SAM, "GET", ROUTES.me)).statusCode).toBe(403);
    expect(directory.members(HOUSEHOLD).map((member) => member.address)).toEqual([
      ALEX,
      NEW_ADDRESS,
    ]);
    // The person id is the same, so nothing in either household's books moved.
    expect(booksSnapshot(app)).toBe(books);
    // The two records, remove then add, each signed by the admin.
    const own = (
      await send(app, ALEX, "GET", ROUTES.household.replace(":id", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(own.history.slice(-2)).toMatchObject([
      { action: "remove", address: SAM, person: "sam", by: ADMIN },
      { action: "add", address: NEW_ADDRESS, person: "sam", by: ADMIN },
    ]);
  });

  test("and the answer carries the name the person is shown under", async () => {
    const { app } = await start();
    await send(app, ADMIN, "POST", ROUTES.adminPersonRename.replace(":id", HOUSEHOLD), {
      person: "sam",
      name: "Samantha",
    });

    const changed = await send(app, ADMIN, "POST", CHANGE, { from: SAM, to: NEW_ADDRESS });

    expect(changed.json()).toEqual({ address: NEW_ADDRESS, person: "sam", name: "Samantha" });
  });
});

describe("a change of address is refused", () => {
  test("for a new address in another household, as ADDRESS_ALREADY_A_MEMBER, and the old one still signs in", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const response = await send(app, ADMIN, "POST", CHANGE, { from: SAM, to: KIM });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe("ADDRESS_ALREADY_A_MEMBER");
    expect(directorySnapshot(directory)).toBe(before);
    expect((await send(app, SAM, "GET", ROUTES.me)).statusCode).toBe(200);
  });

  test("for an old address not in this household, as MEMBER_NOT_FOUND", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const response = await send(app, ADMIN, "POST", CHANGE, { from: KIM, to: NEW_ADDRESS });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("MEMBER_NOT_FOUND");
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("for a household that is not there, as HOUSEHOLD_NOT_FOUND", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const response = await send(
      app,
      ADMIN,
      "POST",
      ROUTES.adminMemberAddress.replace(":id", "nowhere"),
      { from: SAM, to: NEW_ADDRESS },
    );

    expect(response.json<ErrorResponse>().error.code).toBe("HOUSEHOLD_NOT_FOUND");
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("for the same address (in other letters too), a body that is not two addresses, or one that is not an address, as BAD_REQUEST", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const payloads = [
      { from: SAM, to: SAM },
      { from: SAM, to: SAM.toUpperCase() },
      { from: SAM, to: "not an address" },
      { from: "not an address", to: NEW_ADDRESS },
      { from: SAM },
      { to: NEW_ADDRESS },
      { from: SAM, to: "" },
      { from: SAM, to: NEW_ADDRESS, extra: true },
      {},
    ];
    for (const payload of payloads) {
      const response = await send(app, ADMIN, "POST", CHANGE, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json<ErrorResponse>().error.code, JSON.stringify(payload)).toBe(
        "BAD_REQUEST",
      );
    }
    expect(directorySnapshot(directory)).toBe(before);
  });
});
