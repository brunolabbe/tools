/**
 * The authority sweep (lg-22): who may manage the directory from the app.
 *
 * Every admin route is walked as a member who is no admin; every household
 * route as a member of the other household and as an admin in no household;
 * and every route the API answers as an address Access admits that is neither
 * member nor admin. Each must answer 403 and change nothing — not a directory
 * record, not a row of any household's books.
 *
 * Each request is one that would change something if it were let through: the
 * controls send the same requests as the right identity and see them succeed,
 * so a 403 here is the guard's and not a body the route could not read.
 *
 * The routes come from the contract and from the server: every path under
 * `/api/admin/` or `/api/households/`, with every method the server answers on
 * it, must have a request here, so a route added later is swept too.
 */

import { afterEach, describe, expect, test } from "vitest";
import { API_PREFIX, ROUTES } from "@ledger/contract";
import type { ErrorResponse } from "@ledger/contract";
import { ADMIN, ALEX, HOUSEHOLD, SAM, STRANGER } from "./helpers/access.ts";
import {
  KIM,
  booksSnapshot,
  directorySnapshot,
  send,
  startHouseholds,
} from "./helpers/households.ts";
import type { Harness, Method } from "./helpers/households.ts";
import { VERBS } from "./helpers/routes.ts";

type RouteName = keyof typeof ROUTES;

interface Probe {
  route: RouteName;
  method: Method;
  /** The path, aimed at home, the household whose records the sweep guards. */
  url: string;
  payload?: Record<string, unknown> | string;
}

const at = (route: RouteName): string => ROUTES[route].replace(":id", HOUSEHOLD);
const NEW_ADDRESS = "casey@example.test";

/** Every household route, each a request a member of home would see succeed. */
const HOUSEHOLD_PROBES: Probe[] = [
  { route: "household", method: "GET", url: at("household") },
  { route: "household", method: "HEAD", url: at("household") },
  {
    route: "householdMembers",
    method: "POST",
    url: at("householdMembers"),
    payload: { address: NEW_ADDRESS, person: "sam" },
  },
];

/** Every admin route, each a request an admin would see succeed. */
const ADMIN_PROBES: Probe[] = [
  { route: "adminHouseholds", method: "GET", url: at("adminHouseholds") },
  { route: "adminHouseholds", method: "HEAD", url: at("adminHouseholds") },
  {
    route: "adminHouseholds",
    method: "POST",
    url: at("adminHouseholds"),
    payload: { id: "third", name: "A third household" },
  },
  {
    route: "adminMembers",
    method: "POST",
    url: at("adminMembers"),
    payload: { address: NEW_ADDRESS, person: "sam" },
  },
  {
    route: "adminMemberRemove",
    method: "POST",
    url: at("adminMemberRemove"),
    payload: { address: SAM },
  },
];

/**
 * Each route again with a body that does not parse (lg-22's gate 1, F1): a guard
 * that ran in the handler, after the body is parsed, would answer these 400
 * rather than 403. No identity sees them succeed, so they have no control.
 */
const MALFORMED = "{ not json";
const malformed = (probes: readonly Probe[]): Probe[] =>
  probes
    .filter((probe) => probe.method !== "HEAD")
    .map((probe) => ({ ...probe, payload: MALFORMED }));
const HOUSEHOLD_MALFORMED = malformed(HOUSEHOLD_PROBES);
const ADMIN_MALFORMED = malformed(ADMIN_PROBES);

const isAdminRoute = (route: RouteName) => ROUTES[route].startsWith(`${API_PREFIX}/admin/`);
const isHouseholdRoute = (route: RouteName) =>
  ROUTES[route].startsWith(`${API_PREFIX}/households/`);

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.shutdown();
  harness = undefined;
});

async function start(): Promise<Harness> {
  harness = await startHouseholds();
  return harness;
}

/**
 * Sends every probe as `email` and returns what did not answer 403 `FORBIDDEN`,
 * with the directory and every household's books compared before and after.
 */
async function sweep({ app, directory }: Harness, email: string, probes: readonly Probe[]) {
  const before = { directory: directorySnapshot(directory), books: booksSnapshot(app) };
  const admitted: string[] = [];
  for (const probe of probes) {
    const response = await send(app, email, probe.method, probe.url, probe.payload);
    // A HEAD is answered with no body, so its status is all there is to read.
    const code =
      response.statusCode !== 403 || probe.method === "HEAD"
        ? "FORBIDDEN"
        : response.json<ErrorResponse>().error.code;
    if (response.statusCode !== 403 || code !== "FORBIDDEN") {
      admitted.push(
        `${probe.method} ${probe.url}: ${String(response.statusCode)} ${response.body}`,
      );
    }
  }
  return {
    admitted,
    directoryChanged: directorySnapshot(directory) !== before.directory,
    booksChanged: booksSnapshot(app) !== before.books,
  };
}

describe("the sweep", () => {
  test("has a request for every admin and household route, with every method the server answers", async () => {
    const { app } = await start();
    const probes = [...HOUSEHOLD_PROBES, ...ADMIN_PROBES];
    const routes = (Object.keys(ROUTES) as RouteName[]).filter(
      (route) => isAdminRoute(route) || isHouseholdRoute(route),
    );

    expect(routes.length).toBe(5);
    expect(new Set(probes.map((probe) => probe.route))).toEqual(new Set(routes));
    for (const route of routes) {
      for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const) {
        const answered = app.server.hasRoute({ method, url: ROUTES[route] });
        const probed = probes.some((probe) => probe.route === route && probe.method === method);
        expect(probed, `${method} ${ROUTES[route]}`).toBe(answered);
      }
    }
    expect(HOUSEHOLD_PROBES.every((probe) => isHouseholdRoute(probe.route))).toBe(true);
    expect(ADMIN_PROBES.every((probe) => isAdminRoute(probe.route))).toBe(true);
  });

  // The controls: the same requests, from the identity each route is for, go
  // through. Each on a fresh app, so one's change does not refuse the next.
  test.each(ADMIN_PROBES.map((probe) => [`${probe.method} ${probe.route}`, probe] as const))(
    "control: an admin in no household is answered by %s",
    async (_name, probe) => {
      const { app, directory } = await start();
      const before = directorySnapshot(directory);

      const response = await send(app, ADMIN, probe.method, probe.url, probe.payload);

      expect(response.statusCode, response.body).toBe(200);
      if (probe.method === "POST") expect(directorySnapshot(directory)).not.toBe(before);
    },
  );

  test.each(HOUSEHOLD_PROBES.map((probe) => [`${probe.method} ${probe.route}`, probe] as const))(
    "control: a member of home is answered by %s",
    async (_name, probe) => {
      const { app, directory } = await start();
      const before = directorySnapshot(directory);

      const response = await send(app, SAM, probe.method, probe.url, probe.payload);

      expect(response.statusCode, response.body).toBe(200);
      if (probe.method === "POST") expect(directorySnapshot(directory)).not.toBe(before);
    },
  );
});

describe("every admin route", () => {
  test("refuses a member who is no admin, and changes nothing", async () => {
    const target = await start();

    const result = await sweep(target, ALEX, [...ADMIN_PROBES, ...ADMIN_MALFORMED]);

    expect(result).toEqual({ admitted: [], directoryChanged: false, booksChanged: false });
  });
});

describe("every household route", () => {
  test("refuses a member of the other household, and changes nothing", async () => {
    const target = await start();

    const result = await sweep(target, KIM, [...HOUSEHOLD_PROBES, ...HOUSEHOLD_MALFORMED]);

    expect(result).toEqual({ admitted: [], directoryChanged: false, booksChanged: false });
  });

  test("refuses an admin in no household, and changes nothing", async () => {
    const target = await start();

    const result = await sweep(target, ADMIN, [...HOUSEHOLD_PROBES, ...HOUSEHOLD_MALFORMED]);

    expect(result).toEqual({ admitted: [], directoryChanged: false, booksChanged: false });
  });
});

describe("every route", () => {
  test("refuses an address Access admits that is neither member nor admin, and changes nothing", async () => {
    const target = await start();
    const everyRoute: Probe[] = [
      ...Object.entries(VERBS)
        .filter(([name]) => name !== "health")
        .map(([name, [method, url]]) => ({
          route: name as RouteName,
          method,
          url,
          payload: { address: SAM, person: "sam", id: "third", name: "Third", text: "x" },
        })),
      ...HOUSEHOLD_PROBES,
      ...ADMIN_PROBES,
      ...HOUSEHOLD_MALFORMED,
      ...ADMIN_MALFORMED,
    ];

    const result = await sweep(target, STRANGER, everyRoute);

    expect(result).toEqual({ admitted: [], directoryChanged: false, booksChanged: false });
    expect(everyRoute.length).toBeGreaterThan(40);
  });
});
