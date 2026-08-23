/**
 * The grounding provider that measures against a real routing engine.
 *
 * The backend is **Valhalla, self-hosted**, decided 2026-08-22 and argued in
 * pl-28: its graph is tiled and mmap'd, so resident memory tracks the tiles
 * actually touched rather than the size of the extract, which is what makes a
 * region-sized graph fit on a 16 GB mini-PC. The alternative, OSRM, is fine at
 * runtime and pinches at contraction, which would mean building the graph on a
 * second machine — and a pipeline with a second machine in it is a pipeline
 * nobody re-runs. Nothing about that choice is visible above this file:
 * `createGroundingProvider` in `server.ts` is still the only place in the tool
 * that names a backend.
 *
 * ## It is two services, and that is not an accident of deployment
 *
 * **Valhalla does not geocode.** It routes. `locate` — a place name in,
 * coordinates out — is a geocoder's job, so this file talks to two endpoints:
 * `/sources_to_targets` on Valhalla for `travel`, and `/search` on **Nominatim**
 * for `locate`. pl-28 listed three options for the second and recommended
 * Nominatim on the same regional extract, which is what this is: same data,
 * same box, one more container. It is a second *implementation* behind the same
 * seam, never a second seam.
 *
 * ## Why `/sources_to_targets` and not one route per pair
 *
 * Because the seam is matrix-shaped, and it is matrix-shaped because the
 * packer's problem is circular otherwise — see `GroundingProvider.travel`. One
 * request answers the whole table, and it is **one** call against
 * `MAX_GROUNDING_CALLS` rather than n².
 *
 * ## An unroutable pair is a `null` cell, never an error
 *
 * The backend answered; the answer is that there is no route. An island, a
 * seasonal road closed in the direction asked, a place that snapped onto a
 * disconnected fragment of the graph — Valhalla reports each of these as a cell
 * that is *present* with `"time": null, "distance": null`, and this file turns
 * it into the seam's `null`. pl-27's pass then names that leg unmeasured and
 * the plan ships with a gap rather than failing. **This shape is the one thing
 * about the payload that a hand-written fixture would have got wrong**, which
 * is why the checked-in one was captured from a running engine — see the header
 * of `api/test/grounding-valhalla.test.ts`.
 *
 * ## No SSRF guard here, deliberately
 *
 * pl-26 says why at length and pl-28 step 7 repeats it: these are addresses
 * *this deployment wrote down*, not addresses a stranger handed us. Running
 * them through a guard whose entire job is refusing what a stranger picked
 * would be the guard doing nothing while looking like it is doing something —
 * and the way that goes wrong is that the LAN address gets refused, somebody
 * reaches for `allowPrivateAddresses`, and the check is then off for the URLs
 * it actually exists for. The guard belongs on §5's item 3, where a search
 * result hands us a link.
 *
 * ## Every request carries a short timeout
 *
 * A run holds a queue slot while it grounds, `MAX_CONCURRENT_RUNS` is 2, and an
 * instance rebuilding its tiles will hang rather than refuse — so two hung
 * requests are the whole service. `GROUNDING_TIMEOUT_MS` is deliberately short
 * and the failure is `TIMEOUT`, which is retryable in core.
 */

import type {
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  TravelEstimate,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import { AppError, coordinatesSchema } from "@planner/contract";
import type { Coordinates, Place, Source } from "@planner/contract";
import type { AppLogger } from "../logger.ts";
import { KEY_SEPARATOR } from "./place-key.ts";

/** The name `/api/health` reports and the config's `GROUNDING_PROVIDER` selects. */
export const VALHALLA_PROVIDER_NAME = "valhalla";

/**
 * What every answer from this provider cites.
 *
 * **Not the endpoint.** A `Source.url` is stored on the plan and rendered to
 * the user as a link they read as "we checked this", so a private routing URL
 * there would be a dead link that publishes the deployment's own topology into
 * the plan document — the same argument `/api/health` makes about not naming an
 * endpoint, one layer along. What is actually behind the number is
 * OpenStreetMap's data, and this is the attribution page the ODbL requires be
 * shown for anything derived from it. It resolves, it is true, and it says
 * nothing about where this instance lives.
 */
const OSM_ATTRIBUTION = "https://www.openstreetmap.org/copyright";

const ROUTED_BY = "OpenStreetMap, routed by Valhalla";
const GEOCODED_BY = "OpenStreetMap, geocoded by Nominatim";

/**
 * Sent on every geocoder request.
 *
 * Nominatim's usage policy asks for an identifying `User-Agent` and refuses
 * requests without one. A self-hosted instance does not enforce it, but the
 * option of pointing `GEOCODER_URL` at the public instance is on pl-28's table
 * and a header that only works on one of the two would be found the hard way.
 */
const USER_AGENT = "webtools-planner/1.0 (+https://github.com/webtools)";

export interface ValhallaProviderOptions {
  /** Base URL of the Valhalla instance. Operator configuration; no default. */
  routingUrl: string;
  /** Base URL of the Nominatim instance. Operator configuration; no default. */
  geocoderUrl: string;
  /** Per-request ceiling. Short on purpose — see the header. */
  timeoutMs: number;
  /**
   * Injected so a test drives the parser over a checked-in payload with no
   * socket anywhere, and so the boot wiring can hand this the same clock the
   * cache computes `expires_at` against — `createGroundingProvider` explains
   * what a second clock costs.
   */
  now?: (() => Date) | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  logger?: AppLogger | undefined;
}

export class ValhallaGroundingProvider implements GroundingProvider {
  readonly name = VALHALLA_PROVIDER_NAME;

  readonly #routingUrl: string;
  readonly #geocoderUrl: string;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #fetch: typeof globalThis.fetch;
  readonly #logger: AppLogger | undefined;

  constructor(options: ValhallaProviderOptions) {
    this.#routingUrl = trimSlash(options.routingUrl);
    this.#geocoderUrl = trimSlash(options.geocoderUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? ((): Date => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#logger = options.logger;
  }

  /**
   * Where a place is, via the geocoder.
   *
   * `null` for a name nobody matched, which is an answer and not an error —
   * pl-27's pass then leaves that place without coordinates, its legs
   * unmeasured, and the plan says so.
   *
   * **The query carries the locality as well as the name**, because
   * `LocateRequest` carries the whole `Place` for exactly that reason:
   * Sainte-Anne-des-Monts in Québec is not the other one, and a backend handed
   * a bare name has to guess.
   */
  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    const query = placeQuery(request.place);
    if (query === "") return null;

    const url = new URL(`${this.#geocoderUrl}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const body = await this.#json(
      url,
      { method: "GET", headers: { "user-agent": USER_AGENT, accept: "application/json" } },
      request.signal,
    );
    const coordinates = firstCoordinates(body);
    if (coordinates === null) return null;

    // A fresh object, never one held anywhere in this provider. `Object.freeze`
    // is shallow and a caller that rounds or converts coordinates in place
    // would otherwise rewrite whatever it was handed a reference to — pl-24's
    // gazetteer learned this the expensive way and the rule carried here.
    return { coordinates: { ...coordinates }, source: this.#source(GEOCODED_BY) };
  }

  /**
   * The whole matrix, in one request.
   *
   * A place with no coordinates is **not sent**: Valhalla routes between points
   * and has nothing to snap a bare name onto. Its row and its column come back
   * all `null`, which is the truthful answer — nothing measured those legs —
   * and it costs no part of the request. In practice pl-27's pass locates
   * everything it can first, so this is the residue rather than the norm.
   */
  async travel(request: TravelRequest): Promise<TravelMatrix> {
    const origins = pointsOf(request.origins);
    const destinations = pointsOf(request.destinations);

    // Nothing on either side has a point, so there is no request to make and
    // the honest matrix is all `null`. Sending it anyway would spend a call to
    // be told what we already know.
    if (origins.sent.length === 0 || destinations.sent.length === 0) {
      return emptyMatrix(request.origins.length, request.destinations.length);
    }

    const body = await this.#json(
      new URL(`${this.#routingUrl}/sources_to_targets`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: origins.sent.map(({ point }) => point),
          targets: destinations.sent.map(({ point }) => point),
          costing: costingFor(request.mode),
          // Stated rather than defaulted. `distance` is denominated in whatever
          // `units` says, and a backend whose default changed would silently
          // start reporting miles as kilometres.
          units: "kilometers",
        }),
      },
      request.signal,
    );

    const cells = indexCells(body, this.#logger);
    const at = this.#now();

    return request.origins.map((_origin, row) =>
      request.destinations.map((_destination, column) => {
        const from = origins.position.get(row);
        const to = destinations.position.get(column);
        if (from === undefined || to === undefined) return null;
        return estimate(cells.get(cellKey(from, to)), () => this.#source(ROUTED_BY, at));
      }),
    );
  }

  /** One `Source`, stamped with the moment the answer was read. */
  #source(title: string, at: Date = this.#now()): Source {
    return { url: OSM_ATTRIBUTION, title, fetchedAt: at.toISOString() };
  }

  /**
   * One request, with the timeout and the failure mapping that every call here
   * shares.
   *
   * The three outcomes are deliberately distinct, and pl-28 step 5 names each:
   * a caller that stopped us is `CANCELED`, a backend that took too long is
   * `TIMEOUT`, and anything else — DNS, connection refused, TLS, a non-2xx, a
   * body that is not the shape this endpoint promises — is `UNREACHABLE`. The
   * first is not retryable and the other two are, which is core's answer and
   * not one this file re-decides.
   *
   * **The copy is never replaced at these call sites.** A code whose default
   * sentence has to be re-worded where it is raised is the wrong code, so what
   * varies goes in `details`, which is for logs rather than for a user.
   */
  async #json(url: URL, init: RequestInit, signal: AbortSignal | undefined): Promise<unknown> {
    if (signal?.aborted === true) throw new AppError("CANCELED");

    // `AbortSignal.any` so the caller's cancellation and our own deadline are
    // one signal on the wire. Without the deadline an instance rebuilding its
    // tiles holds a queue slot until something else gives up.
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);

    let response: Response;
    try {
      response = await this.#fetch(url, { ...init, signal: combined });
    } catch (error: unknown) {
      throw this.#reachFailure(error, signal);
    }

    if (!response.ok) {
      throw new AppError("UNREACHABLE", undefined, {
        details: { status: response.status },
      });
    }

    try {
      return await response.json();
    } catch (error: unknown) {
      throw this.#reachFailure(error, signal);
    }
  }

  /**
   * Which of the three a thrown fetch was.
   *
   * The caller's signal is asked **first**, and the reason is narrower than an
   * earlier version of this comment claimed. `AbortSignal.any` propagates the
   * *aborting* signal's own reason, so in the ordinary case the deadline
   * arrives as a `TimeoutError` and a plain `controller.abort()` as an
   * `AbortError` — already told apart by name, whichever order these two lines
   * are in.
   *
   * What the order settles is the case where **the caller's own reason is
   * itself a `TimeoutError`**: a run bounded upstream by its own
   * `AbortSignal.timeout`, which is exactly how a caller would bound one. The
   * caller's reason is not ours to reinterpret — someone stopped this run, so
   * it is `CANCELED` and not a retryable `TIMEOUT`. Reversing these two lines
   * fails a test that says so.
   */
  #reachFailure(error: unknown, signal: AbortSignal | undefined): AppError {
    if (signal?.aborted === true) return new AppError("CANCELED", undefined, { cause: error });
    if (error instanceof Error && error.name === "TimeoutError") {
      return new AppError("TIMEOUT", undefined, {
        cause: error,
        details: { timeoutMs: this.#timeoutMs },
      });
    }
    return new AppError("UNREACHABLE", undefined, { cause: error });
  }
}

// ---------------------------------------------------------------------------
// Building the request
// ---------------------------------------------------------------------------

/**
 * The configured endpoint without its trailing slashes, so that
 * `${url}/search` is one slash whatever the operator wrote.
 *
 * Written as a scan rather than the obvious `url.replace(/\/+$/u, "")`, which
 * CodeQL flags as `js/polynomial-redos`: `\/+$` has to retry from every
 * position in a run of slashes, so a value that is mostly slashes costs
 * quadratic time. The input is an operator's own configuration and reaches
 * this once at construction, so the attack is an operator against themselves —
 * but the loop is O(n), no harder to read, and leaves nothing to argue with.
 */
function trimSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/**
 * What the geocoder is asked, out of the whole `Place`.
 *
 * Name and locality, comma-joined, which is the free-form query Nominatim
 * documents. Nothing is parsed *out* of `locality` — the contract's rule — it
 * is passed along as the prose it is.
 */
function placeQuery(place: Place): string {
  return [place.name, place.locality]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");
}

/** Which costing model a `TravelMode` means. One member today, by design. */
function costingFor(mode: TravelRequest["mode"]): string {
  switch (mode) {
    case "driving":
      return "auto";
  }
}

interface SentPlace {
  point: { lat: number; lon: number };
}

/**
 * The places that can actually be sent, and where each one sits in the request.
 *
 * `position` maps a caller's index to its index in the request, so a place that
 * was dropped for having no coordinates simply has no entry — and the matrix
 * builder reads a `null` for it without any index arithmetic that could slip by
 * one.
 */
function pointsOf(places: readonly Place[]): {
  sent: SentPlace[];
  position: ReadonlyMap<number, number>;
} {
  const sent: SentPlace[] = [];
  const position = new Map<number, number>();
  places.forEach((place, index) => {
    if (place.coordinates === null) return;
    position.set(index, sent.length);
    sent.push({ point: { lat: place.coordinates.latitude, lon: place.coordinates.longitude } });
  });
  return { sent, position };
}

function emptyMatrix(rows: number, columns: number): TravelMatrix {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));
}

// ---------------------------------------------------------------------------
// Reading the reply
// ---------------------------------------------------------------------------

/**
 * Every cell of the reply, keyed by the pair it claims to be about.
 *
 * **A `Map`, and the key is built from validated integers.** pl-28 step 4 and
 * pl-24's review before it: anything keyed by something that came from outside
 * this process wants a `Map`, because a plain object answers for
 * `constructor`, `__proto__` and `toString`. The reply is not a model's, but it
 * is not ours either — and the indices below reach an array subscript, where a
 * `from_index` of `"constructor"` would find `Array.prototype.constructor`
 * rather than nothing. So indices are checked to be integers in range before
 * they are used at all, and the answer is keyed by position rather than read
 * off nesting order.
 *
 * Keying by the reply's own `from_index`/`to_index` rather than trusting the
 * nesting is the cheaper half of the same caution: the two agree today, and a
 * caller that assumed the order would have no way to notice the day they do
 * not.
 */
function indexCells(body: unknown, logger: AppLogger | undefined): ReadonlyMap<string, unknown> {
  const rows = (body as { sources_to_targets?: unknown } | null)?.sources_to_targets;
  if (!Array.isArray(rows)) {
    // Not a `sources_to_targets` reply at all. Answering with a table of nulls
    // would report "nobody could measure these legs" for a misconfigured URL,
    // which is the plan quietly lying about what it checked.
    throw new AppError("UNREACHABLE", undefined, { details: { reason: "unexpected-body" } });
  }

  const cells = new Map<string, unknown>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const from = indexOf(cell, "from_index");
      const to = indexOf(cell, "to_index");
      if (from === null || to === null) continue;
      cells.set(cellKey(from, to), cell);
    }
  }
  if (cells.size === 0) logger?.warn("the routing backend answered with no usable cells");
  return cells;
}

/**
 * The key one cell is indexed by.
 *
 * `KEY_SEPARATOR` rather than a literal, and rather than a space: it is the
 * separator `place-key.ts` already owns and documents, and writing it as an
 * escape keeps this file plain text. It was a raw NUL byte until pl-28's second
 * gate, which made the whole module **binary to `grep`** — every pattern
 * silently matching nothing unless you thought to pass `-a`. That cost two
 * people time before anyone worked out why, and neither of them was looking for
 * a separator.
 */
function cellKey(from: number, to: number): string {
  return `${String(from)}${KEY_SEPARATOR}${String(to)}`;
}

function indexOf(cell: unknown, field: "from_index" | "to_index"): number | null {
  if (typeof cell !== "object" || cell === null) return null;
  const value = (cell as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * One cell, in the seam's units.
 *
 * Valhalla answers `time` in **seconds** and `distance` in the units the
 * request asked for — kilometres, stated explicitly above. The seam wants
 * metres and minutes, which is `Candidate.durationMinutes`'s unit and therefore
 * the tool's one unit for time.
 *
 * **Both numbers or nothing.** `TravelEstimate` says a cell is never half a
 * fact, and an unroutable pair comes back as `"time": null, "distance": null` —
 * present, and empty. Half a cell would be a backend behaving in a way nothing
 * here has seen; it is treated as no answer rather than as a licence to invent
 * the other half.
 */
function estimate(cell: unknown, source: () => Source): TravelEstimate | null {
  if (typeof cell !== "object" || cell === null) return null;
  const { time, distance } = cell as Record<string, unknown>;
  if (!isFiniteNumber(time) || !isFiniteNumber(distance)) return null;
  if (time < 0 || distance < 0) return null;

  return {
    distanceMeters: Math.round(distance * 1000),
    // Rounded to the minute, which is the unit the rest of the tool packs in.
    // A day's budget is minutes of activity and minutes of road; carrying
    // seconds here would mean a packer summing a precision nothing else has.
    durationMinutes: Math.round(time / 60),
    source: source(),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The first result's coordinates, or `null`.
 *
 * Nominatim answers `lat` and `lon` as **strings** in its JSON, which is the
 * one thing about this reply worth writing down; numbers are accepted too so
 * that pointing `GEOCODER_URL` at something else does not fail on a detail
 * neither side promised. `coordinatesSchema` is what decides the pair is a
 * point on Earth, so a `lat` of 900 is no answer rather than a place.
 */
function firstCoordinates(body: unknown): Coordinates | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first: unknown = body[0];
  if (typeof first !== "object" || first === null) return null;

  const { lat, lon } = first as Record<string, unknown>;
  const parsed = coordinatesSchema.safeParse({
    latitude: asNumber(lat),
    longitude: asNumber(lon),
  });
  return parsed.success ? parsed.data : null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
