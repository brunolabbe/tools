// @vitest-environment jsdom

/**
 * The cache's promises (lg-98), measured where the edge counts them: the shell is
 * rendered over the real `api/` modules and a stubbed `fetch`, and every request
 * it sends is recorded. lg-97 counted 2 to 11 `/api/` requests per tab switch this
 * way, against an edge rule that allows 20 in 10 seconds.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { App } from "../src/App.tsx";
import { STALE_MS } from "../src/query.ts";
import { LIVE } from "./mortgage-fixtures.ts";
import { renderWithClient } from "./render-with-client.tsx";

const NONE = { from: null, to: null };

/** What each GET route answers: enough for every screen to draw itself empty. */
const ANSWERS: Record<string, unknown> = {
  "/api/me": {
    person: { id: "alex", email: "alex@example.test", household: "home" },
    admin: true,
  },
  "/api/people": { people: ["alex", "sam"], retired: [], names: { alex: "Alex", sam: "Sam" } },
  "/api/inbox": { rows: [] },
  "/api/inbox/auto-filed": { rows: [] },
  "/api/buckets": {
    asOf: "2026-10-03",
    mortgage: { balanceCents: 0, own: [], lead: null },
    buffer: { balanceCents: 0, contributions: [] },
    unclassified: 0,
  },
  "/api/mortgage": LIVE,
  "/api/mortgage-splits": { asOf: "2026-10-03", splits: [], inEffect: null },
  "/api/salaries": { salaries: [] },
  "/api/ratios": { asOf: "2026-10-03", ratios: [], inEffect: null },
  "/api/rules": { rules: [] },
  "/api/periods": { periods: [] },
  "/api/periods/open": {
    start: null,
    end: "2026-10-03",
    first: true,
    lines: [],
    settlement: null,
  },
  "/api/recurring": { items: [] },
  "/api/rows": { rows: [], total: 0 },
  "/api/spending-categories": { categories: [] },
  "/api/spending-category-map": { entries: [] },
  "/api/households/home": {
    household: { id: "home", name: "The test household" },
    members: [{ address: "alex@example.test", person: "alex", name: "Alex" }],
    history: [],
  },
  "/api/admin/households": { households: [] },
  "/api/stats/mortgage-payments": { range: NONE, payments: [] },
  "/api/stats/mortgage-own": {
    range: NONE,
    people: [],
    points: [],
    split: { mode: "equal", effectiveFrom: null, noRatio: false, parts: [] },
  },
  "/api/stats/contributions": { range: NONE, people: [], series: [] },
  "/api/stats/buffer": { range: NONE, minDropCents: 50000, points: [], drops: [] },
  "/api/stats/salaries": { range: NONE, people: [], years: [] },
  "/api/stats/spending": { range: NONE, categories: [], periods: [] },
  "/api/stats/fixed-items": { range: NONE, months: [], series: [] },
  "/api/stats/settlements": { range: NONE, periods: [] },
};

/** Every request the shell sent, as `METHOD path?query`. */
let sent: string[] = [];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://ledger.test");
      sent.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      const answer = ANSWERS[url.pathname];
      if (answer === undefined) {
        const error = { code: "NOT_FOUND", message: "No such route.", retryable: false };
        return new Response(JSON.stringify({ error }), { status: 404 });
      }
      return new Response(JSON.stringify(answer), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Every tab, in the order the shell lists them. */
const TABS = [
  "Home",
  "Stats",
  "Period",
  "History",
  "Receipt",
  "Paste",
  "Inbox",
  "Rules",
  "Categories",
  "Salaries",
  "Import",
  "Household",
  "Admin",
] as const;

/** Opens `tab` and waits until nothing the cache asked for is still in flight. */
async function open(client: QueryClient, tab: string): Promise<void> {
  const nav = screen.getByRole("navigation", { name: "Screens" });
  fireEvent.click(within(nav).getByRole("button", { name: new RegExp(`^${tab}`, "u") }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

/** The shell, opened on Home with its first reads answered. */
async function shell(): Promise<QueryClient> {
  const { client } = renderWithClient(<App />);
  // The admin tab is drawn once /api/me has said so: the last of the shell's own reads.
  await screen.findByRole("button", { name: "Admin" });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return client;
}

/** How many times each request was sent. */
function counted(requests: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const request of requests) counts.set(request, (counts.get(request) ?? 0) + 1);
  return counts;
}

test("opening every tab once, in order, from a cold start sends each distinct GET once (lg-98)", async () => {
  const client = await shell();
  for (const tab of TABS) await open(client, tab);

  const gets = sent.filter((request) => request.startsWith("GET "));
  const twice = [...counted(gets)].filter(([, times]) => times > 1);
  expect(twice).toEqual([]);
  // The two lg-98 was filed over: asked from six call sites on five tabs, and from six tabs.
  expect(gets.filter((request) => request === "GET /api/people")).toHaveLength(1);
  expect(gets.filter((request) => request === "GET /api/spending-categories")).toHaveLength(1);
  // Every screen read something: a tab that drew nothing would pass the line above.
  expect(new Set(gets.map((request) => request.split("?")[0])).size).toBeGreaterThanOrEqual(25);
  expect(sent.every((request) => request.startsWith("GET "))).toBe(true);
});

test("a tab switch back to a screen opened within staleTime sends no request (lg-98)", async () => {
  const client = await shell();
  for (const tab of TABS) await open(client, tab);
  const before = sent.length;

  // Back and forth across every tab, as a person looking for something does.
  for (const tab of [...TABS].toReversed()) await open(client, tab);
  for (const tab of ["Rules", "Home", "Rules", "Stats", "Period", "Stats"]) await open(client, tab);

  expect(sent.slice(before)).toEqual([]);
});

test("a screen opened again after staleTime asks again, for its own reads only (lg-98)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const client = await shell();
  await open(client, "Rules");
  await open(client, "Home");
  const before = sent.length;

  vi.setSystemTime(Date.now() + STALE_MS + 1_000);
  await open(client, "Rules");

  // The rules screen's three reads; the shell's own reads stay mounted and are not asked again.
  expect(sent.slice(before).toSorted()).toEqual([
    "GET /api/people",
    "GET /api/rules",
    "GET /api/spending-categories",
  ]);
});
