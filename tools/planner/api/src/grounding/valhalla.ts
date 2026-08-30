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

import { MAX_FIND_NAME_CHARS, MAX_FIND_TAGS, MAX_FIND_TAG_CHARS } from "@planner/agent";
import type {
  Corridor,
  DiscoveryKind,
  Find,
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  NearbyArticle,
  NearbyRequest,
  NotabilityRequest,
  TravelEstimate,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import { AppError, coordinatesSchema } from "@planner/contract";
import type { Coordinates, Place, Source } from "@planner/contract";
import { distanceToCorridorMetres } from "./geometry.ts";
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
  /**
   * Base URL of an Overpass API instance, for `nearby` (pl-29). Optional and
   * with no default, unlike the two above: a deployment can measure and
   * geocode without discovering anything, and requiring a third endpoint at
   * boot would break every `valhalla` deployment pl-28 already describes. When
   * absent, `nearby` answers an empty list and says so once, in the log — the
   * same shape §5's amendment gives every other "the ground was thin" case.
   */
  overpassUrl?: string | undefined;
  /** Per-request ceiling for routing and geocoding. Short on purpose — see the header. */
  timeoutMs: number;
  /**
   * Per-request ceiling for discovery, which is a different backend doing a
   * different kind of work and does not belong on the same clock.
   *
   * A Valhalla matrix over a warm regional graph is milliseconds, so
   * `timeoutMs` is deliberately impatient — anything near it is an instance in
   * trouble. An Overpass corridor search is not that: pl-33 measured 28.7 s
   * for Montréal→Québec City and **149 s** for Montréal→Percé against the
   * public instance, with the query this adapter really sends. Sharing one
   * 5 s ceiling meant `nearby` aborted every real corridor it was ever asked
   * about, and no test caught it because none of them crossed a wire.
   *
   * Defaults to `timeoutMs` when a caller states only one, so existing
   * constructions keep their present behaviour rather than silently gaining a
   * longer one.
   */
  discoveryTimeoutMs?: number | undefined;
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
  readonly #overpassUrl: string | undefined;
  readonly #timeoutMs: number;
  readonly #discoveryTimeoutMs: number;
  readonly #now: () => Date;
  readonly #fetch: typeof globalThis.fetch;
  readonly #logger: AppLogger | undefined;

  constructor(options: ValhallaProviderOptions) {
    this.#routingUrl = trimSlash(options.routingUrl);
    this.#geocoderUrl = trimSlash(options.geocoderUrl);
    this.#overpassUrl =
      options.overpassUrl === undefined ? undefined : trimSlash(options.overpassUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#discoveryTimeoutMs = options.discoveryTimeoutMs ?? options.timeoutMs;
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

  /**
   * What OpenStreetMap knows near this corridor — pl-29, and the one method on
   * this class that proposes rather than checks (see the header of
   * `agent/src/grounding.ts`).
   *
   * **This is Overpass, not Valhalla**, the same way `locate` above is
   * Nominatim and not Valhalla: a third service on the same regional extract,
   * behind the one seam this file already implements two of. `overpassUrl` is
   * optional — see `ValhallaProviderOptions` — and a deployment that has not
   * stood one up gets an empty list here, logged once, rather than a boot-time
   * refusal: measuring and geocoding do not need discovery to work.
   *
   * The query asks Overpass's own `around:` filter to restrict the reply to
   * the corridor's exact radius server-side — see `overpassQuery`'s own
   * comment for why this is not a bounding box. `distanceToCorridorMetres`
   * (`geometry.ts`) still re-filters every result against the same radius
   * afterwards: this seam does not trust the far side of a network call to
   * enforce its own contract, and a captured payload — which this ticket does
   * not have — could only ever prove the server got it right for the one
   * query that produced it.
   */
  async nearby(request: NearbyRequest): Promise<Find[]> {
    if (request.signal?.aborted === true) throw new AppError("CANCELED");

    if (this.#overpassUrl === undefined) {
      this.#logger?.warn("nearby: no OVERPASS_URL configured, discovering nothing");
      return [];
    }

    // The server's own ceiling, kept just under this process's, so a corridor
    // too big to answer comes back as Overpass's `remark` — which
    // `assertAnswered` turns into a loud `TIMEOUT` — rather than as this side
    // aborting mid-flight with less to say. See `overpassQuery`.
    const query = overpassQuery(
      request.corridor,
      request.radiusMetres,
      request.kinds,
      serverTimeoutSeconds(this.#discoveryTimeoutMs),
    );

    const body = await this.#overpassJson(query, request.signal);
    const at = this.#now();

    assertAnswered(body);

    return elementsOf(body)
      .map((element) => findFrom(element, at))
      .filter((find): find is Find => find !== null)
      .filter(
        (find) =>
          distanceToCorridorMetres(find.coordinates, request.corridor) <= request.radiusMetres,
      );
  }

  /**
   * Articles Wikipedia has near one point — pl-33.
   *
   * `list=geosearch` is free, unkeyed and needs no account. It is capped at a
   * 10 km radius and refuses a corridor-sized bounding box outright
   * (`toobig`), which is why this takes a point and the tiling lives a layer
   * up where the call budget is.
   *
   * The language reaches a **hostname**, and it is derived from OSM tag text —
   * data this deployment did not write. `WIKI_LANGUAGE` is therefore a strict
   * allow-shape rather than a sanitiser: anything that is not a plain language
   * code is refused before a url is built, so no tag can steer this request at
   * a host of its choosing.
   */
  async articlesNear(request: NotabilityRequest): Promise<NearbyArticle[]> {
    if (request.signal?.aborted === true) throw new AppError("CANCELED");

    if (!WIKI_LANGUAGE.test(request.language)) {
      throw new AppError("INVALID_URL", undefined, {
        details: { reason: "language", language: request.language },
      });
    }

    const url = new URL(`https://${request.language.toLowerCase()}.wikipedia.org/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("list", "geosearch");
    url.searchParams.set(
      "gscoord",
      `${String(request.coordinates.latitude)}|${String(request.coordinates.longitude)}`,
    );
    url.searchParams.set("gsradius", String(Math.min(request.radiusMetres, MAX_GEOSEARCH_METRES)));
    url.searchParams.set("gslimit", String(MAX_GEOSEARCH_RESULTS));

    const body = await this.#json(url, { headers: { accept: "application/json" } }, request.signal);
    const at = this.#now();

    return geosearchOf(body).flatMap((entry) => {
      const coordinates = coordinatesSchema.safeParse({
        latitude: entry.lat,
        longitude: entry.lon,
      });
      if (!coordinates.success || entry.title.trim() === "") return [];
      return [
        {
          source: {
            url: wikipediaUrl(request.language, entry.title),
            title: entry.title,
            fetchedAt: at.toISOString(),
          },
          coordinates: coordinates.data,
        },
      ];
    });
  }

  /**
   * One Overpass request, with the same timeout and failure mapping `#json`
   * gives the other two endpoints — duplicated rather than shared because
   * Overpass is a `POST` with a raw QL body and no JSON to send, where `#json`
   * assumes a `RequestInit` its two other callers already agree on.
   */
  async #overpassJson(query: string, signal: AbortSignal | undefined): Promise<unknown> {
    const deadline = AbortSignal.timeout(this.#discoveryTimeoutMs);
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#overpassUrl}/interpreter`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: query,
        signal: combined,
      });
    } catch (error: unknown) {
      throw this.#reachFailure(error, signal);
    }

    if (!response.ok) {
      throw new AppError("UNREACHABLE", undefined, { details: { status: response.status } });
    }

    try {
      return await response.json();
    } catch (error: unknown) {
      throw this.#reachFailure(error, signal);
    }
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

// ---------------------------------------------------------------------------
// Discovery — building the Overpass query and reading its reply (pl-29)
// ---------------------------------------------------------------------------

/**
 * The one OSM tag filter each `DiscoveryKind` means.
 *
 * A 1:1 mapping, deliberately narrow rather than a list of near-synonyms per
 * kind: each entry is one Overpass clause, this list is what the capture
 * script at the bottom of pl-29's ticket log builds its query from, and a
 * kind whose filter is not obvious from reading this table is a kind that
 * will not survive contact with the person capturing the fixture. Widening a
 * kind to catch more tags is a one-line change here, not a signature change
 * anywhere above it.
 */
const KIND_FILTERS: Record<DiscoveryKind, string> = {
  viewpoint: '"tourism"="viewpoint"',
  waterfall: '"natural"="waterfall"',
  attraction: '"tourism"="attraction"',
  "historic-site": '"historic"',
};

/**
 * The Overpass QL text this adapter sends: one `around:` filter per requested
 * kind, over the corridor's own points — not a bounding box.
 *
 * **This was a bounding box until gate B, 2026-08-29.** A box is cheap to
 * write but is the *enclosing rectangle* of the corridor's points, and a
 * diagonal corridor's rectangle is mostly not the corridor: measured at
 * 26–27x the corridor's own area for Montréal→Percé, this ticket's own
 * motivating example (`geometry.ts`'s header carries the number and the
 * measurement). `around:radius,lat1,lon1,lat2,lon2,...` is Overpass's own
 * polyline filter — the feature pl-29's Build step 2 names as the reason to
 * prefer Overpass at all — and it restricts the *server's* reply to the
 * radius exactly, rather than to a rectangle `distanceToCorridorMetres` then
 * has to shrink back down on this side of the wire. Switched before any
 * payload was captured, so nothing downstream had to change to follow it.
 *
 * `[out:json]` is load-bearing: Overpass's default output is XML, and this
 * file has no XML parser and does not want one.
 *
 * **The server ceiling is now derived from `GROUNDING_TIMEOUT_MS`, and this
 * paragraph used to say it should not be** — that the two are different clocks
 * on different machines and matching them would be a coincidence, not a rule.
 * They are still different clocks, but they are not independent, and pl-33
 * measured what the independence cost. The literal was `[timeout:25]` against
 * a `GROUNDING_TIMEOUT_MS` of 5 000: the client gave up at 5 s on work that
 * takes 28.7 s for Montréal→Québec City and 149 s for Montréal→Percé, this
 * tool's own motivating example, against the public instance. `nearby` could
 * not once have succeeded on a real corridor.
 *
 * The rule that replaces the coincidence: **the server's ceiling sits just
 * under this process's**, so a corridor too large to answer comes back as
 * Overpass's own `remark` — which `assertAnswered` raises as `TIMEOUT` — in
 * preference to this side aborting mid-flight, which knows only that nothing
 * arrived. Ordering the two clocks is what makes the failure legible; setting
 * them equal would race.
 *
 * Exported so the capture script quoted in pl-29's Log can build the *exact*
 * query this adapter sends rather than a hand-written approximation of it —
 * the whole argument this repo makes against a hand-written fixture applies
 * exactly as hard to a hand-written query nobody ran.
 */
export function overpassQuery(
  corridor: Corridor,
  radiusMetres: number,
  kinds: readonly DiscoveryKind[],
  timeoutSeconds: number = DEFAULT_SERVER_TIMEOUT_SECONDS,
): string {
  const points = corridor
    .map((point) => `${String(point.latitude)},${String(point.longitude)}`)
    .join(",");
  const around = `around:${String(radiusMetres)},${points}`;
  const clauses = kinds.map((kind) => `  node[${KIND_FILTERS[kind]}](${around});`).join("\n");
  return `[out:json][timeout:${String(timeoutSeconds)}];\n(\n${clauses}\n);\nout body;`;
}

/**
 * Overpass's server-side ceiling when no caller states one, in seconds.
 *
 * Only reached by `overpassQuery`'s exported form, which the capture procedure
 * in pl-33's Log calls directly; `nearby` always derives it from the process
 * timeout instead.
 */
const DEFAULT_SERVER_TIMEOUT_SECONDS = 25;

/** How far the server's ceiling sits under this process's, in milliseconds. */
const SERVER_TIMEOUT_MARGIN_MS = 2_000;

/**
 * The `[timeout:]` to ask Overpass for, given how long this process will wait.
 *
 * Under, never over: a server that gives up first says *why* in a `remark`,
 * and `assertAnswered` turns that into a `TIMEOUT` naming the backend. A
 * client that gives up first produces an abort that cannot distinguish a slow
 * corridor from an unplugged cable.
 */
function serverTimeoutSeconds(processTimeoutMs: number): number {
  return Math.max(1, Math.floor((processTimeoutMs - SERVER_TIMEOUT_MARGIN_MS) / 1_000));
}

/**
 * Throw if the reply is Overpass reporting a failure rather than an answer.
 *
 * **A timed-out Overpass query is HTTP 200.** The body carries `elements: []`
 * beside a `remark`, and before pl-33 this file read only `elements` — so a
 * corridor the server could not finish searching returned no finds, cleanly,
 * and the planner said there was nothing worth stopping for. That is a silent
 * wrong answer where the code one layer up would have raised a loud one, and
 * it is strictly the worse failure: the reproduction is in
 * `test/fixtures/overpass-timed-out.json`, captured from the public instance
 * with the query this adapter really sends.
 *
 * `remark` is Overpass's channel for runtime trouble generally, not only
 * timeouts, so the text decides the code: a timeout is core's `TIMEOUT`,
 * anything else is `UNREACHABLE` with the remark kept in `details`. Neither is
 * invented here — both already describe a backend that did not answer.
 */
function assertAnswered(body: unknown): void {
  const remark = (body as { remark?: unknown } | null)?.remark;
  if (typeof remark !== "string" || remark.trim() === "") return;

  const timedOut = /timed out/i.test(remark);
  throw new AppError(timedOut ? "TIMEOUT" : "UNREACHABLE", undefined, {
    details: { backend: "overpass", remark },
  });
}

interface OverpassElement {
  type: unknown;
  id: unknown;
  lat: unknown;
  lon: unknown;
  tags: unknown;
}

/**
 * The reply's `elements`, narrowed to the shape this file reads.
 *
 * Anything that is not an object with the fields below is dropped rather than
 * thrown on — a node with no `tags` at all is a real thing Overpass can
 * return, and the caller's own filtering (no name, wrong kind) already has to
 * handle "nothing usable here" for exactly that reason.
 */
function elementsOf(body: unknown): OverpassElement[] {
  const elements = (body as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) {
    throw new AppError("UNREACHABLE", undefined, { details: { reason: "unexpected-body" } });
  }
  return elements.filter((element): element is OverpassElement => {
    return typeof element === "object" && element !== null;
  });
}

/**
 * A wiki language code, and nothing else — this value becomes a hostname.
 *
 * Plain subdomain-safe codes only: `fr`, `en`, `pt-br`, `zh-yue`. No dots, no
 * slashes, no userinfo, so `evil.example.com` and `a@b` are refused rather
 * than escaped.
 */
const WIKI_LANGUAGE = /^[a-z]{2,12}(-[a-z0-9]{2,8})?$/i;

/** Wikipedia's own geosearch ceilings. Asking for more is an error, not more. */
const MAX_GEOSEARCH_METRES = 10_000;
const MAX_GEOSEARCH_RESULTS = 500;

interface GeosearchEntry {
  title: string;
  lat: number;
  lon: number;
}

/**
 * `query.geosearch`, narrowed to the three fields this file reads.
 *
 * Shaped like `elementsOf`: anything that is not the expected object is
 * dropped rather than thrown on, because a page with no coordinates is a real
 * thing the API can return and the caller already handles a short list.
 */
function geosearchOf(body: unknown): GeosearchEntry[] {
  const rows = (body as { query?: { geosearch?: unknown } } | null)?.query?.geosearch;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is GeosearchEntry => {
    if (typeof row !== "object" || row === null) return false;
    const entry = row as Record<string, unknown>;
    return (
      typeof entry["title"] === "string" &&
      typeof entry["lat"] === "number" &&
      typeof entry["lon"] === "number"
    );
  });
}

/**
 * Editorial backing the map itself already carries, at no call cost.
 *
 * OSM mappers record `wikipedia=<lang>:<Title>`, `wikipedia:<lang>=<Title>`
 * and `wikidata=Q…` on the objects they know are written about. pl-33 measured
 * this against a real corridor: 34 of 276 finds (12%) carry one, so this is a
 * floor and not a substitute for a geosearch tier — but it is free, it is
 * per-find, and it needs no language guessed at, because a `wikipedia` tag
 * states its own language. 16 of the 18 wikipedia tags in that capture are
 * `fr:`, chosen by mappers who know the place, which is the same answer the
 * geosearch counts give (426 fr articles to 189 en over one 10 km radius) and
 * arrived at independently.
 *
 * Title-cased `Source.title` is the article title as written; the url is
 * percent-encoded because these titles carry accents and spaces routinely
 * (`Percé`, `Chute Montmorency`) and a raw one is not a valid url.
 */
function notabilityFrom(tags: ReadonlyMap<string, string>, at: Date): Source[] {
  const found: Source[] = [];
  const seen = new Set<string>();
  const push = (url: string, title: string | null): void => {
    if (seen.has(url)) return;
    seen.add(url);
    found.push({ url, title, fetchedAt: at.toISOString() });
  };

  for (const [key, value] of tags) {
    const text = value.trim();
    if (text === "") continue;

    if (key === "wikipedia") {
      // `<lang>:<Title>`. Split once: titles contain colons of their own.
      const separator = text.indexOf(":");
      if (separator <= 0) continue;
      const language = text.slice(0, separator);
      const title = text.slice(separator + 1).trim();
      if (title === "" || !/^[a-z-]{2,12}$/i.test(language)) continue;
      push(wikipediaUrl(language, title), title);
      continue;
    }

    if (key.startsWith("wikipedia:")) {
      const language = key.slice("wikipedia:".length);
      if (!/^[a-z-]{2,12}$/i.test(language)) continue;
      push(wikipediaUrl(language, text), text);
      continue;
    }

    if (key === "wikidata" && /^Q[1-9][0-9]*$/.test(text)) {
      push(`https://www.wikidata.org/wiki/${text}`, text);
    }
  }

  return found;
}

/** One article url, with the title encoded — these carry accents and spaces. */
function wikipediaUrl(language: string, title: string): string {
  return `https://${language.toLowerCase()}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

/** Which `DiscoveryKind` a node's tags mean, or `null` for none of the ones we asked about. */
function kindOf(tags: ReadonlyMap<string, string>): DiscoveryKind | null {
  if (tags.get("tourism") === "viewpoint") return "viewpoint";
  if (tags.get("natural") === "waterfall") return "waterfall";
  if (tags.get("tourism") === "attraction") return "attraction";
  if (tags.has("historic")) return "historic-site";
  return null;
}

/**
 * One element's tags, as a `Map` and bounded.
 *
 * A `Map` for the reason every other lookup in this file is one (pl-28 step
 * 4): every key and value is a string a stranger typed into OpenStreetMap, and
 * a plain object answers for `constructor`, `__proto__` and `toString`.
 * Bounded by count and by length because an OSM node can in principle carry
 * an unbounded number of tags of unbounded length, and a find is meant to be a
 * short reference a specialist reads — not a payload to smuggle a prompt
 * through by exhausting `MAX_CANDIDATE_SUMMARY_CHARS` on the way there.
 */
function tagsOf(raw: unknown): ReadonlyMap<string, string> {
  const tags = new Map<string, string>();
  if (typeof raw !== "object" || raw === null) return tags;

  for (const [key, value] of Object.entries(raw)) {
    if (tags.size >= MAX_FIND_TAGS) break;
    if (typeof value !== "string") continue;
    tags.set(key.slice(0, MAX_FIND_TAG_CHARS), value.slice(0, MAX_FIND_TAG_CHARS));
  }
  return tags;
}

/**
 * One element, as a `Find` — or `null` for one this adapter will not surface.
 *
 * Two reasons to refuse, and both are "nothing to show", not errors: no
 * `name` tag, because a nameless thing is not a "here is what to call it" a
 * specialist can write about, and no kind this file recognises, which the
 * query should not produce but a caller of `elementsOf` is not the parser's
 * business to trust blindly (§5: this is hostile text before it is anything
 * else).
 *
 * **`name` is hostile text and is passed through as data, never interpreted.**
 * It is bounded to `MAX_FIND_NAME_CHARS` and nothing else is done to it — no
 * stripping, no escaping — because the defence against an injected instruction
 * is that nothing here ever treats a find's text as anything but an opaque
 * string (see `agent/src/prompt.ts`'s discovery block), not that this parser
 * tries to sanitise a natural-language attack out of a name field.
 */
function findFrom(element: OverpassElement, at: Date): Find | null {
  const latitude = asNumber(element.lat);
  const longitude = asNumber(element.lon);
  if (latitude === undefined || longitude === undefined) return null;

  const coordinates = coordinatesSchema.safeParse({ latitude, longitude });
  if (!coordinates.success) return null;

  const tags = tagsOf(element.tags);
  const rawName = tags.get("name");
  const name = rawName?.trim().slice(0, MAX_FIND_NAME_CHARS) ?? "";
  if (name === "") return null;

  const kind = kindOf(tags);
  if (kind === null) return null;

  const id = typeof element.id === "number" ? element.id : null;
  const url =
    id === null
      ? "https://www.openstreetmap.org/copyright"
      : `https://www.openstreetmap.org/node/${String(id)}`;

  return {
    name,
    coordinates: coordinates.data,
    kind,
    tags,
    sources: [{ url, title: "OpenStreetMap", fetchedAt: at.toISOString() }],
    // Whatever the map already states, and nothing bought with a call — see
    // `notabilityFrom`. Still `[]` for most finds, and that keeps meaning
    // "nothing checked" rather than "checked and found nothing": a geosearch
    // tier that would justify the stronger reading does not exist yet.
    notability: notabilityFrom(tags, at),
    // Filled in later, by the discovery pass, for the finds that survive the
    // geometric filter — see `api/src/runs/discovery.ts`. Never this adapter's
    // job: measuring a detour spends a `travel` call, and `nearby` itself must
    // stay one call regardless of how many finds it returns.
    detourMinutes: null,
  };
}
