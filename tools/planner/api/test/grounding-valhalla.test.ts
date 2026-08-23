/**
 * The Valhalla adapter, over a payload a real Valhalla produced.
 *
 * ## Where `valhalla-sources-to-targets.json` came from, exactly
 *
 * pl-28 step 3 is emphatic and the reason is sharper than the repo's usual one:
 * **a hand-written fixture for a routing engine is a fixture that agrees with
 * your parser by construction.** The one thing about this payload nobody could
 * have guessed is what an unroutable pair looks like — omitted cell, zeroes, an
 * error, a present cell with nulls? — and it is the case the whole design of
 * the seam turns on. So it was not written.
 *
 * It was captured on 2026-08-23 from **Valhalla 3.7.0**, the official
 * `@valhallajs/valhallajs` build, through the `matrix` action — which is the
 * `/sources_to_targets` endpoint's own handler and its own serialiser. The only
 * thing done to it since is `oxfmt`'s indentation: every key, every value and
 * every numeric literal, `0.0` and `null` included, is as the engine wrote it.
 *
 * **The map under it is synthetic and that is disclosed rather than hidden.**
 * This environment has no Docker, no OSM extract and no route to geofabrik.de,
 * so a regional `.pbf` could not be downloaded. Instead a tiny `.osm.pbf` was
 * written by hand — a four-node loop plus one deliberately disconnected
 * fragment, at Null Island so that no reader mistakes the numbers for a real
 * road — and `valhalla_build_tiles` built a real graph from it. So the
 * *geometry* is invented and the *payload* is not: field names, nesting, units,
 * and the shape of an unroutable answer are Valhalla's own. Those are the four
 * things this parser can get wrong, and a fixture over a real extract would
 * settle exactly the same four.
 *
 * What it settles: an unroutable pair is a cell that is **present** with
 * `"time": null, "distance": null`; `time` is seconds; `distance` is in the
 * units the request asked for; and every cell carries its own
 * `from_index`/`to_index`.
 *
 * ## What is not covered here, and it is a real gap
 *
 * **There is no geocoder fixture.** Nominatim needs PostgreSQL, PostGIS and an
 * import of the same extract, none of which this environment has, and the
 * public instance is not reachable either. `locate`'s reply parsing is
 * therefore written against Nominatim's documented shape and asserted by
 * nothing. Only its transport behaviour is tested below. See pl-28's Log and
 * pl-30.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppError } from "@planner/contract";
import type { Place } from "@planner/contract";
import { travelCell } from "@planner/agent";
import type { TravelEstimate } from "@planner/agent";
import { ValhallaGroundingProvider } from "../src/grounding/valhalla.ts";

const CAPTURED: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/valhalla-sources-to-targets.json", import.meta.url)),
    "utf8",
  ),
);

const AT = new Date("2026-08-23T12:00:00.000Z");

/** The three places the captured matrix is about, in the order it was asked. */
function place(name: string, latitude: number, longitude: number): Place {
  return { name, locality: "Null Island", coordinates: { latitude, longitude } };
}

const LOOP_WEST = place("Loop West", 0, 0);
const LOOP_NORTH = place("Loop North", 0.01, 0.02);
const ISLAND = place("Island Track", 0.05, 0.05);

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A `fetch` that answers one body and records what it was asked. */
function answering(body: unknown, status = 200): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function provider(fetch: typeof globalThis.fetch, timeoutMs = 5_000): ValhallaGroundingProvider {
  return new ValhallaGroundingProvider({
    routingUrl: "http://valhalla.internal:8002/",
    geocoderUrl: "http://nominatim.internal:8080",
    timeoutMs,
    now: () => AT,
    fetch,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("travel, over a payload a real Valhalla wrote", () => {
  test("parses the measured cells into metres and minutes", async () => {
    const { fetch, calls } = answering(CAPTURED);
    const matrix = await provider(fetch).travel({
      origins: [LOOP_WEST, LOOP_NORTH, ISLAND],
      destinations: [LOOP_WEST, LOOP_NORTH, ISLAND],
      mode: "driving",
    });

    // `distance: 3.339` with `units: kilometers`, and `time: 200` seconds.
    // Both conversions are this file's, and both are the kind of thing a
    // fixture that agreed with the parser could never have caught.
    expect(travelCell(matrix, 0, 1)).toEqual({
      distanceMeters: 3_339,
      durationMinutes: 3,
      source: {
        url: "https://www.openstreetmap.org/copyright",
        title: "OpenStreetMap, routed by Valhalla",
        fetchedAt: AT.toISOString(),
      },
    });
    // The engine answers both directions of this pair alike over this graph;
    // the adapter still reads them as two cells, because a one-way system is
    // the case where they differ.
    expect(travelCell(matrix, 1, 0)?.distanceMeters).toBe(3_339);

    // A place measured from itself is a real zero, not an absent answer.
    expect(travelCell(matrix, 0, 0)).toMatchObject({ distanceMeters: 0, durationMinutes: 0 });

    // One request for the whole table — the reason the seam is matrix-shaped.
    expect(calls).toHaveLength(1);
    // The helper's `routingUrl` ends in a slash on purpose: this is also what
    // pins `trimSlash`, since leaving it on gives `//sources_to_targets`.
    expect(calls[0]?.url).toBe("http://valhalla.internal:8002/sources_to_targets");
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent["costing"]).toBe("auto");
    // Stated, never defaulted: `distance` is denominated in whatever this says.
    expect(sent["units"]).toBe("kilometers");
    expect(sent["sources"]).toEqual([
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0.02 },
      { lat: 0.05, lon: 0.05 },
    ]);
  });

  test("an unroutable pair is a null cell, not an error and not a zero", async () => {
    const { fetch } = answering(CAPTURED);
    const matrix = await provider(fetch).travel({
      origins: [LOOP_WEST, LOOP_NORTH, ISLAND],
      destinations: [LOOP_WEST, LOOP_NORTH, ISLAND],
      mode: "driving",
    });

    // The island is a disconnected fragment of the graph. Valhalla answered
    // with the cell present and both numbers null — it routed, and there is no
    // route. pl-27 turns this into a named gap on the plan.
    expect(travelCell(matrix, 0, 2)).toBeNull();
    expect(travelCell(matrix, 1, 2)).toBeNull();
    expect(travelCell(matrix, 2, 0)).toBeNull();
    expect(travelCell(matrix, 2, 1)).toBeNull();
    // ...and the island measured from itself is still a real zero.
    expect(travelCell(matrix, 2, 2)).toMatchObject({ distanceMeters: 0 });
  });

  test("hands back a fresh source per cell, so a caller cannot corrupt another", async () => {
    const { fetch } = answering(CAPTURED);
    const matrix = await provider(fetch).travel({
      origins: [LOOP_WEST, LOOP_NORTH],
      destinations: [LOOP_WEST, LOOP_NORTH],
      mode: "driving",
    });

    const first = travelCell(matrix, 0, 1);
    const second = travelCell(matrix, 1, 0);
    expect(first).not.toBe(second);
    expect(first?.source).not.toBe(second?.source);
  });

  test("a place with no coordinates is not sent, and its row and column are null", async () => {
    const { fetch, calls } = answering(CAPTURED);
    const nameless: Place = { name: "Somewhere nobody located", locality: null, coordinates: null };

    const matrix = await provider(fetch).travel({
      origins: [LOOP_WEST, nameless, LOOP_NORTH],
      destinations: [LOOP_WEST, nameless, LOOP_NORTH],
      mode: "driving",
    });

    // Valhalla routes between points and has nothing to snap a bare name onto,
    // so it is left out of the request entirely rather than sent as a guess.
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { sources: unknown[] };
    expect(sent.sources).toHaveLength(2);

    expect(travelCell(matrix, 1, 0)).toBeNull();
    expect(travelCell(matrix, 0, 1)).toBeNull();
    // The remaining pair still lands in its caller-side position, which is the
    // whole reason the reply is indexed rather than read off nesting order.
    expect(travelCell(matrix, 0, 2)?.distanceMeters).toBe(3_339);
  });

  test("asks nothing at all when neither side has a point", async () => {
    const { fetch, calls } = answering(CAPTURED);
    const nameless: Place = { name: "Nowhere", locality: null, coordinates: null };

    const matrix = await provider(fetch).travel({
      origins: [nameless],
      destinations: [nameless],
      mode: "driving",
    });

    expect(calls).toHaveLength(0);
    expect(travelCell(matrix, 0, 0)).toBeNull();
  });

  test("a body that is not a sources_to_targets reply is a failure, never a table of nulls", async () => {
    const { fetch } = answering({ error: "not valhalla" });

    // Answering "nobody could measure these legs" for a URL pointing at the
    // wrong service is the plan lying about what it checked.
    await expect(
      provider(fetch).travel({
        origins: [LOOP_WEST],
        destinations: [LOOP_NORTH],
        mode: "driving",
      }),
    ).rejects.toMatchObject({ code: "UNREACHABLE" });
  });
});

describe("failure, mapped to core's codes", () => {
  const ask = async (fetch: typeof globalThis.fetch, timeoutMs = 5_000): Promise<unknown> =>
    await provider(fetch, timeoutMs).travel({
      origins: [LOOP_WEST],
      destinations: [LOOP_NORTH],
      mode: "driving",
    });

  test("an unreachable instance is UNREACHABLE, and retryable", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    const error = await ask(fetch).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("UNREACHABLE");
    // Core's answer, not one this adapter re-decides: the instance may be
    // rebuilding its tiles and be back in a minute.
    expect((error as AppError).retryable).toBe(true);
  });

  test("a non-2xx is UNREACHABLE too, and keeps the code's own copy", async () => {
    const { fetch } = answering({ error_code: 154 }, 500);

    const error = (await ask(fetch).catch((thrown: unknown) => thrown)) as AppError;
    expect(error.code).toBe("UNREACHABLE");
    // The status goes in `details`, which is for a log. A code whose sentence
    // has to be rewritten where it is raised is the wrong code.
    expect(error.details).toEqual({ status: 500 });
  });

  test("a slow instance is TIMEOUT, and the deadline is ours rather than the caller's", async () => {
    // Never settles on its own; only the adapter's own deadline ends it.
    const fetch = vi.fn(
      async (_input: unknown, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    ) as unknown as typeof globalThis.fetch;

    const error = (await ask(fetch, 10).catch((thrown: unknown) => thrown)) as AppError;
    expect(error.code).toBe("TIMEOUT");
    expect(error.details).toEqual({ timeoutMs: 10 });
    expect(error.retryable).toBe(true);
  });

  test("a caller that stopped us is CANCELED, and is not retried", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      async (_input: unknown, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    ) as unknown as typeof globalThis.fetch;

    const pending = provider(fetch)
      .travel({
        origins: [LOOP_WEST],
        destinations: [LOOP_NORTH],
        mode: "driving",
        signal: controller.signal,
      })
      .catch((thrown: unknown) => thrown);
    controller.abort();

    const error = (await pending) as AppError;
    // Not `TIMEOUT`: `AbortSignal.any` gives an `AbortError` for either cause,
    // and only the caller's own signal separates "someone stopped this run"
    // from "the backend was too slow". Someone asked for it to stop, so
    // retrying is the opposite of what they said.
    expect(error.code).toBe("CANCELED");
    expect(error.retryable).toBe(false);
  });

  test("a caller's own reason is never reinterpreted as our deadline", async () => {
    // The caller's signal is asked *first*, and this is the case that makes the
    // order matter rather than tidy. A run bounded by its own
    // `AbortSignal.timeout` upstream aborts with a reason whose `name` is
    // `TimeoutError` — so a check that asked the error's name first would call
    // a stopped run a slow backend, and hand back a `TIMEOUT` that core says is
    // worth retrying. Someone asked for this to stop; retrying is the opposite
    // of what they said.
    //
    // pl-28's first gate found this ordering unasserted, and found the claim in
    // the Log that a mutation covered it to be wrong. This is that assertion.
    const controller = new AbortController();
    const fetch = vi.fn(
      async (_input: unknown, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    ) as unknown as typeof globalThis.fetch;

    const pending = provider(fetch)
      .travel({
        origins: [LOOP_WEST],
        destinations: [LOOP_NORTH],
        mode: "driving",
        signal: controller.signal,
      })
      .catch((thrown: unknown) => thrown);
    controller.abort(new DOMException("upstream deadline", "TimeoutError"));

    const error = (await pending) as AppError;
    expect(error.code).toBe("CANCELED");
    expect(error.retryable).toBe(false);
  });

  test("an already-aborted signal never reaches the socket", async () => {
    const { fetch, calls } = answering(CAPTURED);

    await expect(
      provider(fetch).travel({
        origins: [LOOP_WEST],
        destinations: [LOOP_NORTH],
        mode: "driving",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "CANCELED" });
    expect(calls).toHaveLength(0);
  });
});

describe("endpoint normalisation", () => {
  // `trimSlash` was a regex until CodeQL flagged `\/+$` as `js/polynomial-redos`
  // and it became a scan. The single-slash case is already pinned by the
  // request URL above; what a hand-rolled loop can get wrong and a regex could
  // not is the boundary — a run of slashes, and a value that is nothing else.
  test("an endpoint's trailing slashes are all removed, however many there are", async () => {
    const { fetch, calls } = answering([]);
    await new ValhallaGroundingProvider({
      routingUrl: "http://valhalla.internal:8002",
      geocoderUrl: "http://nominatim.internal:8080////",
      timeoutMs: 5_000,
      now: () => AT,
      fetch,
    }).locate({ place: { name: "Rimouski", locality: "Québec", coordinates: null } });

    const url = new URL(String(calls[0]?.url));
    expect(url.origin).toBe("http://nominatim.internal:8080");
    expect(url.pathname).toBe("/search");
  });
});

describe("locate", () => {
  const somewhere: Place = { name: "Rimouski", locality: "Québec", coordinates: null };

  test("asks the geocoder for the name and the locality together", async () => {
    // Not the reply — that has no captured payload and nothing here asserts one.
    // The *question* is this file's to get right, and dropping `locality` is
    // how Saint-Jean in Québec becomes Saint-Jean in New Brunswick.
    const { fetch, calls } = answering([]);
    await provider(fetch).locate({ place: somewhere });

    const url = new URL(String(calls[0]?.url));
    expect(url.origin).toBe("http://nominatim.internal:8080");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("Rimouski, Québec");
    expect(url.searchParams.get("limit")).toBe("1");

    // Nominatim's usage policy refuses a request with no identifying
    // `User-Agent`, and pointing `GEOCODER_URL` at the public instance is on
    // pl-28's table. A self-hosted one does not enforce it, so dropping this
    // header breaks nothing here and everything there — which is exactly the
    // kind of thing found in production rather than in a suite.
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["user-agent"]).toMatch(/\S/u);
  });

  test("a name nobody matched is null, not an error", async () => {
    const { fetch } = answering([]);
    await expect(provider(fetch).locate({ place: somewhere })).resolves.toBeNull();
  });

  test("an unreachable geocoder is UNREACHABLE", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    await expect(provider(fetch).locate({ place: somewhere })).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });

  test("a slow geocoder is TIMEOUT", async () => {
    const fetch = vi.fn(
      async (_input: unknown, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    ) as unknown as typeof globalThis.fetch;

    await expect(provider(fetch, 10).locate({ place: somewhere })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  test("a place with nothing to ask about is null without a request", async () => {
    const { fetch, calls } = answering([]);
    const blank: Place = { name: "   ", locality: null, coordinates: null };

    await expect(provider(fetch).locate({ place: blank })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

/**
 * Bodies that are **not** captures and never claim to be.
 *
 * Everything above parses what Valhalla actually wrote. This block asks the
 * opposite question — what happens to a reply Valhalla would never write — and
 * a hostile body is a legitimate thing to compose by hand precisely because it
 * makes no claim about the engine. The rule pl-28 step 3 protects is that a
 * fixture must not agree with the parser by construction; here the whole point
 * is that it disagrees.
 */
/** One origin, two destinations, and whatever cells the case is about. */
function reply(cells: readonly unknown[]): unknown {
  return { sources_to_targets: [cells] };
}

describe("a reply that is not what the engine writes", () => {
  async function measure(body: unknown): Promise<TravelEstimate | null> {
    const { fetch } = answering(body);
    const matrix = await provider(fetch).travel({
      origins: [LOOP_WEST],
      destinations: [LOOP_WEST, LOOP_NORTH],
      mode: "driving",
    });
    return travelCell(matrix, 0, 1);
  }

  test("an index that is a string cannot displace the cell it collides with", async () => {
    // `"0"` and `0` are one key the moment nothing checks the type, and the
    // later write wins — so a cell nobody validated would silently replace a
    // measured leg with whatever it liked. That is what `indexOf`'s integer
    // check buys, and it is why the reply is keyed by its own indices rather
    // than read off nesting order: an index that came from outside this process
    // reaches a lookup, and a lookup is where an unchecked key does its damage.
    await expect(
      measure(
        reply([
          { from_index: 0, to_index: 1, time: 200, distance: 3.339 },
          { from_index: "0", to_index: "1", time: 1, distance: 99_999 },
        ]),
      ),
    ).resolves.toMatchObject({ distanceMeters: 3_339, durationMinutes: 3 });
  });

  test("an index that is not a whole number is no index at all", async () => {
    // Neither a fraction nor a negative can name a row. Both are dropped, so
    // the pair they claimed to be about has no answer rather than a wrong one.
    await expect(
      measure(reply([{ from_index: 0.5, to_index: 1, time: 200, distance: 3.339 }])),
    ).resolves.toBeNull();
    await expect(
      measure(reply([{ from_index: 0, to_index: -1, time: 200, distance: 3.339 }])),
    ).resolves.toBeNull();
  });

  test("half a cell is no cell — a distance with no time, and the other way round", async () => {
    // `TravelEstimate` says both numbers or nothing. A guard that asked for
    // *either* would let the missing half through as `Math.round(null * 1000)`,
    // which is a confident zero: a leg the plan reports as measured, at no
    // distance, in no time.
    await expect(
      measure(reply([{ from_index: 0, to_index: 1, time: 200, distance: null }])),
    ).resolves.toBeNull();
    await expect(
      measure(reply([{ from_index: 0, to_index: 1, time: null, distance: 3.339 }])),
    ).resolves.toBeNull();
  });

  test("a negative time or distance is no answer, not a negative leg", async () => {
    // A packer handed a negative duration packs more into a day than the day
    // holds, and nothing downstream checks — `limits.ts` subtracts what it is
    // given. This is the one place that can refuse it.
    await expect(
      measure(reply([{ from_index: 0, to_index: 1, time: -60, distance: 3.339 }])),
    ).resolves.toBeNull();
    await expect(
      measure(reply([{ from_index: 0, to_index: 1, time: 200, distance: -3.339 }])),
    ).resolves.toBeNull();
  });
});
