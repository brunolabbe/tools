/**
 * The in-process API behind the web's own `fetch` (lg-108), and the reads that
 * show what a write changed.
 *
 * The web's `api/*.ts` functions send relative URLs, which the real `fetch`
 * refuses (`Failed to parse URL from /api/me`). `injectFetch` answers them from
 * the app `createApp` built, through `app.server.inject`, with no socket: the
 * request is the one the screen sends, method, headers and body as the caller
 * gave them. It writes no request of its own and names no write method.
 *
 * `answered` and `readAll` are the 2xx checks: a refused write changes nothing,
 * and two refused reads serialise alike, so either would read as "unchanged".
 * Both throw naming the route and the status.
 */

import { Buffer } from "node:buffer";
import { ROUTES } from "@ledger/contract";
import type { App } from "../../src/server.ts";

/** One request `injectFetch` answered: what was asked, and how it was answered. */
export interface Exchange {
  method: string;
  url: string;
  status: number;
  body: string;
}

export interface Injected {
  /** A `fetch` that answers from `app`, for `vi.stubGlobal`. */
  fetch: typeof globalThis.fetch;
  /** Every request it answered, in order. */
  exchanges: Exchange[];
  /**
   * Runs `call`, which sends through `fetch`, and throws naming the route and the
   * status of the first request it made that was not answered 2xx, or if it made
   * none. The web's `requestJson` turns a refusal into an `AppError` that names
   * neither, which is why the check is here and not in the caller's catch.
   */
  answered<T>(what: string, call: () => Promise<T>): Promise<T>;
}

const ok = (status: number): boolean => status >= 200 && status < 300;

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  return input.url;
}

/** The body as `inject` takes it: a photo's bytes as a `Buffer`, as Node hands them to the route. */
async function payloadOf(body: RequestInit["body"]): Promise<string | Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new TypeError(`injectFetch cannot send a ${Object.prototype.toString.call(body)} body`);
}

export function injectFetch(app: App): Injected {
  const exchanges: Exchange[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const payload = await payloadOf(init?.body);
    const response = await app.server.inject({
      method: method as "GET",
      url,
      headers,
      ...(payload === undefined ? {} : { payload }),
    });
    exchanges.push({ method, url, status: response.statusCode, body: response.body });
    const answer = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      answer.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
    return new Response(response.statusCode === 204 ? null : response.rawPayload, {
      status: response.statusCode,
      headers: answer,
    });
  };
  return {
    fetch,
    exchanges,
    async answered<T>(what: string, call: () => Promise<T>): Promise<T> {
      const from = exchanges.length;
      let failure: { error: unknown } | undefined;
      let result: T | undefined;
      try {
        result = await call();
      } catch (error: unknown) {
        failure = { error };
      }
      const sent = exchanges.slice(from);
      const refused = sent.find((exchange) => !ok(exchange.status));
      if (refused !== undefined) {
        throw new Error(
          `${what}: ${refused.method} ${refused.url} answered ${String(refused.status)}: ${refused.body}`,
        );
      }
      if (failure !== undefined) throw failure.error;
      if (sent.length === 0) throw new Error(`${what}: sent no request`);
      return result as T;
    },
  };
}

/** One `GET`: its route as `ROUTES` names it, and the URL it is sent to. */
export interface Read {
  route: string;
  url: string;
}

/** `GET url`, answered 2xx, as JSON. Throws naming the route and the status otherwise. */
export async function readJson<T>(app: App, read: Read): Promise<T> {
  const response = await app.server.inject({ method: "GET", url: read.url });
  if (!ok(response.statusCode)) {
    throw new Error(
      `GET ${read.route} (${read.url}) answered ${String(response.statusCode)}: ${response.body}`,
    );
  }
  return response.json<T>();
}

/**
 * Every route the API registers for `GET`, by its `ROUTES` key: asked of Fastify,
 * not listed here, so a read added to the API is read the day it is added.
 */
export function getRoutes(app: App): (keyof typeof ROUTES)[] {
  return (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).filter((key) =>
    app.server.hasRoute({ method: "GET", url: ROUTES[key] }),
  );
}

/** What fills a read's `:id` or required query, from the case's seed. */
export interface ReadValues {
  /** The caller's household, from `GET /api/me`. */
  household: string;
  /** A receipt the seed uploaded, with the amount and date it states; none, and `receiptMatches` is not read. */
  receipt?: { id: number; amountCents: number; date: string };
  /** The open period's start; `null` is from the beginning, and `periodLines` is read whole. */
  periodStart: string | null;
}

/**
 * The reads a case makes, before and after its write: each `GET` route once, and
 * `rows` again for the uncategorised (the Spending tab's list). A route with an
 * `:id` takes it from `values`; a stats route is read with no range.
 */
export function readsFor(app: App, values: ReadValues): Read[] {
  const reads: Read[] = [];
  for (const key of getRoutes(app)) {
    const route = ROUTES[key];
    switch (key) {
      case "household":
        reads.push({ route, url: route.replace(":id", encodeURIComponent(values.household)) });
        break;
      case "receiptMatches": {
        const receipt = values.receipt;
        if (receipt === undefined) break;
        const query = new URLSearchParams({
          amountCents: String(receipt.amountCents),
          date: receipt.date,
        });
        reads.push({
          route,
          url: `${route.replace(":id", String(receipt.id))}?${query.toString()}`,
        });
        break;
      }
      case "rows":
        reads.push({ route, url: route }, { route, url: `${route}?spendingCategory=none` });
        break;
      case "periodLines":
        reads.push({
          route,
          url: values.periodStart === null ? route : `${route}?from=${values.periodStart}`,
        });
        break;
      default:
        if (route.includes(":")) throw new Error(`no value for the read ${key} (${route})`);
        reads.push({ route, url: route });
    }
  }
  return reads;
}

/** `value` as JSON with every object's keys sorted, so two equal answers read alike. */
export function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).toSorted(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

/** Every read's answer, by route; a route read twice holds both answers. */
export async function readAll(app: App, reads: readonly Read[]): Promise<Map<string, string[]>> {
  const answers = new Map<string, string[]>();
  for (const read of reads) {
    // One after another: the answers are compared in order.
    // oxlint-disable-next-line no-await-in-loop
    const answer = sortedJson(await readJson<unknown>(app, read));
    answers.set(read.route, [...(answers.get(read.route) ?? []), answer]);
  }
  return answers;
}

/** The routes whose answers differ between two `readAll`s of the same reads. */
export function changedRoutes(
  before: ReadonlyMap<string, readonly string[]>,
  after: ReadonlyMap<string, readonly string[]>,
): string[] {
  const routes = new Set([...before.keys(), ...after.keys()]);
  return [...routes].filter(
    (route) => sortedJson(before.get(route) ?? null) !== sortedJson(after.get(route) ?? null),
  );
}
