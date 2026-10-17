/**
 * pl-56's measurement: how often does OpenStreetMap know when a place a
 * specialist proposed is open?
 *
 * **This is not a vitest suite.** It is a script —
 * `node --import tsx tools/planner/api/test/live/hours-coverage.ts` — and the
 * three constraints pl-40's `run.ts` holds hold here for the same reasons:
 *
 * - It lives under `test/`, so `tsconfig.tests.json` typechecks it.
 * - It is not named `*.test.ts`, so no vitest project collects it.
 * - `assertHoursRunConsent` refuses **before anything else runs** unless
 *   `PLANNER_LIVE_RUN=1` is set. It spends no money. It gates anyway, because
 *   it makes about a thousand requests to a public service whose usage policy
 *   is the constraint, and a stray run is what that policy is about.
 *
 * ## What it does
 *
 * 1. Reads every `candidatesAccepted` under `api/test/fixtures/live/` and
 *    dedupes the `Place`s they name on lower-cased `name|locality`.
 * 2. Asks `nominatim.openstreetmap.org` for each one with the query
 *    `ValhallaGroundingProvider.locate` builds (`placeQuery`, the same
 *    `format` and `limit`) plus `extratags=1`, and picks a row with the same
 *    `chooseGeocoderResult` production picks with, handing it the brief's own
 *    `TripContext`. The deployed Nominatim drops the tag at import, which is
 *    why the public instance is the one asked.
 * 3. Writes the raw replies to `PLANNER_HOURS_SCRATCH/raw/` as they arrive, so
 *    an interrupted run resumes from disk instead of re-asking. A second run
 *    with every reply on disk makes no request at all.
 * 4. Writes one record, the per-place rows, and prints the tables.
 *
 * Policy (https://operations.osmfoundation.org/policies/nominatim/): one
 * request per second at most, a `User-Agent` that names the project, no
 * parallelism. The pause below is longer than a second on purpose.
 *
 * ## The record's home
 *
 * The record sits under `api/test/fixtures/live/hours-coverage/` because the
 * ticket named that path. It is **not a live-run record**: its rows have no
 * `briefFixture` or `candidatesAccepted`. `live-records.test.ts` walks every
 * string leaf of every JSON file there whatever its shape, which is what is
 * wanted of it. **Any other walker over `fixtures/live/**` that expects
 * live-run records must skip `hours-coverage/`**, as `recordFiles` below does by
 * name prefix.
 *
 * ## Environment
 *
 * - `PLANNER_LIVE_RUN=1` — consent.
 * - `PLANNER_HOURS_SCRATCH` — required: where raw replies, the request log and
 *   the pid file go. Never the checked-in fixtures.
 * - `PLANNER_HOURS_SAMPLE=<n>` — locate only the `n` most-named places, and
 *   write the record to the scratch directory instead of the fixtures.
 * - `PLANNER_HOURS_COUNT_ONLY=1` — count the places and stop, with no request.
 * - `PLANNER_HOURS_OFFLINE=1` — never make a request; fail if a reply is
 *   missing. How the record is regenerated from the replies on disk.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Candidate, Place, TripBrief, TripShape } from "@planner/contract";
import type { TripContext } from "@planner/agent";
import { loadFixture } from "../../../contract/test/fixtures.ts";
import {
  chooseGeocoderResult,
  GEOCODER_RESULT_LIMIT,
  geocoderResults,
  placeQuery,
} from "../../src/grounding/valhalla.ts";
import type { GeocoderResult } from "../../src/grounding/valhalla.ts";
import { tripContextFor } from "../../src/runs/discovery.ts";

// ---------------------------------------------------------------------------
// The consent gate
// ---------------------------------------------------------------------------

export function assertHoursRunConsent(env: NodeJS.ProcessEnv): void {
  if (env["PLANNER_LIVE_RUN"] !== "1") {
    throw new Error(
      "Refusing: PLANNER_LIVE_RUN=1 is not set. This harness makes about a thousand " +
        "requests to a public service — set PLANNER_LIVE_RUN=1 to run it.",
    );
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const LIVE_DIR = fileURLToPath(new URL("../fixtures/live/", import.meta.url));
const RECORD_DIR = path.join(LIVE_DIR, "hours-coverage");

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "webtools-planner/1.0 (+https://github.com/webtools; pl-56 opening-hours coverage measurement)";
/** Longer than the policy's second, so clock jitter never makes two requests one. */
const PAUSE_MS = 1100;
const RETRY_WAIT_MS = 30_000;
const MAX_ATTEMPTS = 4;

/** One place, once, with everything that named it. */
export interface NamedPlace {
  /** Lower-cased `name|locality` — the dedupe key the filing's figures used. */
  key: string;
  place: Place;
  /** Brief fixture → how many accepted candidates named this place under it. */
  briefs: Map<string, number>;
  specialists: Set<string>;
  candidates: number;
}

/** Every `.json` under `dir`, recursively, `hours-coverage/` excluded — that is this harness's own output. */
function recordFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((name) => name.endsWith(".json") && !name.startsWith("hours-coverage"))
    .toSorted()
    .map((name) => path.join(dir, name));
}

function placesOf(candidate: Candidate): Place[] {
  return candidate.location.kind === "at"
    ? [candidate.location.place]
    : [candidate.location.from, candidate.location.to];
}

export function keyOf(place: Place): string {
  return `${place.name.trim().toLowerCase()}|${(place.locality ?? "").trim().toLowerCase()}`;
}

interface LiveRecordShape {
  briefFixture: string;
  candidatesAccepted: Candidate[];
}

export function collectPlaces(dir: string): { places: NamedPlace[]; files: number } {
  const byKey = new Map<string, NamedPlace>();
  const files = recordFiles(dir);
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8")) as LiveRecordShape;
    for (const candidate of record.candidatesAccepted) {
      for (const place of placesOf(candidate)) {
        const key = keyOf(place);
        let named = byKey.get(key);
        if (named === undefined) {
          named = { key, place, briefs: new Map(), specialists: new Set(), candidates: 0 };
          byKey.set(key, named);
        }
        named.briefs.set(record.briefFixture, (named.briefs.get(record.briefFixture) ?? 0) + 1);
        named.specialists.add(candidate.specialist);
        named.candidates += 1;
      }
    }
  }
  return { places: [...byKey.values()], files: files.length };
}

/** The brief a place is judged under: the one that named it most, ties alphabetical. */
export function primaryBrief(named: NamedPlace): string {
  const ranked = [...named.briefs.entries()].toSorted(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const first = ranked[0];
  if (first === undefined) throw new Error(`place ${named.key} was named by no brief`);
  return first[0];
}

const tripContexts = new Map<string, TripContext | undefined>();
function tripContextOf(briefFixture: string): TripContext | undefined {
  if (!tripContexts.has(briefFixture)) {
    const brief: TripBrief = loadFixture(briefFixture as TripShape).brief;
    tripContexts.set(briefFixture, tripContextFor(brief));
  }
  return tripContexts.get(briefFixture);
}

// ---------------------------------------------------------------------------
// The kinds that never keep hours — the denominator, argued
// ---------------------------------------------------------------------------

/**
 * `category=type` (or `category=*`) → why a place of this kind has no opening
 * hours to record. Chosen from what each kind is, not from its rate; the first
 * full run printed rates beside kinds, so that is argued, not proved — the only
 * excluded kind that had a place with hours is `tourism=viewpoint`, and the
 * ticket names that one itself. A kind that is merely unlikely to have hours
 * (an aerodrome, a station, a lighthouse) stays in. The record carries this list.
 */
export const EXCLUDED_KINDS: Readonly<Record<string, string>> = {
  "boundary=*":
    "an administrative, park or protected-area boundary is an area with no door; the premises inside it are separate objects",
  "place=*": "a city, village, island or square is a settlement or a landform, not a premises",
  "natural=*": "a cape, beach or cave mouth is a landform; nobody opens or closes it",
  "highway=*": "a bus stop, a road and a rest-area strip are road furniture or a road",
  "landuse=*": "land cover (railway land, cemetery, recreation ground); not a premises",
  "water=*": "a lake is a water body",
  "leisure=nature_reserve":
    "an area, like the boundary kinds; its visitor facilities are other objects",
  "tourism=viewpoint": "the ticket's own example of a kind with nothing to open",
};

export function exclusionReason(kind: string): string | null {
  const [category = ""] = kind.split("=");
  return EXCLUDED_KINDS[kind] ?? EXCLUDED_KINDS[`${category}=*`] ?? null;
}

// ---------------------------------------------------------------------------
// What the chosen row actually is — a reading, not a computation
// ---------------------------------------------------------------------------

/**
 * Whether the row `chooseGeocoderResult` picked is the place the specialist
 * proposed. **Read by hand** from each row's `display_name` against the query,
 * for the 74 located rows of a kind that keeps hours. The first gate's
 * classification came first and this map equals it on all 74 rows; that is
 * agreement with it, not a second independent read. It is data,
 * keyed by the query sent, because it cannot be computed: a string match would
 * be a second chooser. A located row of a kind that keeps hours whose query is
 * missing here reads `unread`, which the report shows rather than hides.
 *
 * - `named-premises` — the proposed name is the returned object's own name.
 * - `kind-of-place` — "Motel in Percé", "Hotel near Via Veneto": a kind of place
 *   resolved to one arbitrary instance of it.
 * - `settlement-to-premises` — a town named, a station, church, university or
 *   brasserie inside it returned. Fine as a point for distance; the wrong object
 *   for hours.
 * - `wrong-continent` — a generic name ("Resort shallow pool") matched on
 *   another continent.
 * - `neighbourhood-to-premises` — a district named, a hotel in it returned.
 * - `arguable-landmark` — "Cap-des-Rosiers", the lighthouse: plausible, not
 *   what was written.
 */
export type Reading =
  | "named-premises"
  | "kind-of-place"
  | "settlement-to-premises"
  | "wrong-continent"
  | "neighbourhood-to-premises"
  | "arguable-landmark"
  | "unread";

const READING_OF_KEPT_ROWS: Readonly<Record<string, Reading>> = {
  "Jardins de Métis, Grand-Métis": "named-premises",
  "Cap-des-Rosiers lighthouse, Gaspé, Québec": "named-premises",
  "Exploramer, Sainte-Anne-des-Monts": "named-premises",
  "Ljubljana Castle, Ljubljana": "named-premises",
  "Graz Hauptbahnhof, Graz": "named-premises",
  "Jardins de Métis, Grand-Métis, Québec": "named-premises",
  "Miramare Castle, Trieste": "named-premises",
  "Caffè San Marco, Trieste": "named-premises",
  "Cap-des-Rosiers lighthouse, Cap-des-Rosiers, Québec": "named-premises",
  "Musée de la Gaspésie, Gaspé": "named-premises",
  "Cap-des-Rosiers lighthouse, Cap-des-Rosiers": "named-premises",
  "Cap-des-Rosiers lighthouse, Gaspé": "named-premises",
  "Mercato di Testaccio, Testaccio, Rome": "named-premises",
  "Mercato Testaccio, Testaccio, Rome": "named-premises",
  "Buffet da Pepi, Trieste": "named-premises",
  "Camping de Carleton-sur-Mer, Carleton-sur-Mer, Québec": "named-premises",
  "Cancún International Airport, Cancún": "named-premises",
  "Castello di Miramare, Trieste": "named-premises",
  "Exploramer, Sainte-Anne-des-Monts, Québec": "named-premises",
  "Flavio al Velavevodetto, Testaccio, Rome": "named-premises",
  "Géoparc mondial UNESCO de Percé, Percé": "named-premises",
  "Halifax Stanfield International Airport, Halifax": "named-premises",
  "Halifax Stanfield International Airport, Halifax, Nova Scotia": "named-premises",
  "Hotel Savoia Excelsior Palace, Trieste, Italy": "named-premises",
  "Hotel Slon, Ljubljana, Slovenia": "named-premises",
  "Leonardo da Vinci–Fiumicino Airport, Fiumicino": "named-premises",
  "Microbrasserie Le Naufrageur, Carleton-sur-Mer": "named-premises",
  "Musée de la Gaspésie, Gaspé, Québec": "named-premises",
  "Ottawa Macdonald-Cartier International Airport, Ottawa": "named-premises",
  "Ottawa Macdonald-Cartier International Airport, Ottawa, Ontario": "named-premises",
  "Pit Caribou pub, Percé, Québec": "named-premises",
  "Porte Saint-Louis, Québec, Québec": "named-premises",
  "Rivière-du-Loup ferry terminal, Rivière-du-Loup, Québec": "named-premises",
  "Saint-Siméon ferry terminal, Saint-Siméon, Québec": "named-premises",
  "Vienna International Airport, Schwechat, Austria": "named-premises",
  "Gaspé motel, Gaspé, Québec": "kind-of-place",
  "Gaspé fish shop, Gaspé": "kind-of-place",
  "Gaspé motel, Gaspé": "kind-of-place",
  "Gaspé motel, Gaspé, Gaspésie": "kind-of-place",
  "Gaspé motels, Gaspé, Québec": "kind-of-place",
  "Hotel in Prati, Rome, Prati": "kind-of-place",
  "Hotel near Piazza Unità d'Italia, Trieste": "kind-of-place",
  "Hotel near Trieste Centrale, Trieste": "kind-of-place",
  "Hotel near Via Veneto, Rome, Ludovisi": "kind-of-place",
  "Hotel near Wien Hauptbahnhof, Vienna": "kind-of-place",
  "Matane motels, Matane, Québec": "kind-of-place",
  "Motel in Bonaventure, Bonaventure": "kind-of-place",
  "Motel in Bonaventure, Bonaventure, Québec": "kind-of-place",
  "Motel in Matane, Matane, Québec": "kind-of-place",
  "Motel in Percé, Percé": "kind-of-place",
  "Motel in Sainte-Anne-des-Monts, Sainte-Anne-des-Monts": "kind-of-place",
  "Motel in Sainte-Anne-des-Monts, Sainte-Anne-des-Monts, Québec": "kind-of-place",
  "Percé motel, Percé": "kind-of-place",
  "Percé motel, Percé, Québec": "kind-of-place",
  "Rimouski, Rimouski, Québec": "settlement-to-premises",
  "Sainte-Flavie, Sainte-Flavie, Québec": "settlement-to-premises",
  "Carleton-sur-Mer, Carleton-sur-Mer, Québec": "settlement-to-premises",
  "Amqui, Amqui, Québec": "settlement-to-premises",
  "Matapédia, Matapédia, Québec": "settlement-to-premises",
  "Québec City, Québec City, Québec": "settlement-to-premises",
  "Rimouski, Rimouski, QC": "settlement-to-premises",
  "Gaspé, Gaspé, Gaspésie": "settlement-to-premises",
  "Grand-Métis, Grand-Métis, Québec": "settlement-to-premises",
  "Percé, Percé, Gaspésie": "settlement-to-premises",
  "Québec City, Québec City, QC": "settlement-to-premises",
  "Saint-Félicien, Lac-Saint-Jean, Saint-Félicien": "settlement-to-premises",
  "Saint-Félicien, Lac-Saint-Jean": "settlement-to-premises",
  "Toronto, Ontario, Toronto": "settlement-to-premises",
  "Resort kids' club": "wrong-continent",
  "Resort shallow pool": "wrong-continent",
  "Trailside lodge": "wrong-continent",
  "Salario / Pinciano, Rome": "neighbourhood-to-premises",
  "Cap-des-Rosiers, Cap-des-Rosiers, Québec": "arguable-landmark",
  "Cap-des-Rosiers, Gaspé, Québec": "arguable-landmark",
};

/**
 * The extract `docs/02-DEPLOYMENT.md` names, `quebec-latest.osm.pbf`, holds a
 * row only if its `display_name` ends in Québec's Canada. The public instance
 * this harness asks holds the planet, so rows outside it are rows the deployed
 * stack would not have under that extract. The owner has not said which
 * extract is deployed (2026-10-17).
 */
export function insideQuebecExtract(displayName: string): boolean {
  return /Québec, (G\d\w \d\w\d, )?Canada$/.test(displayName);
}

// ---------------------------------------------------------------------------
// Nominatim, politely
// ---------------------------------------------------------------------------

function rawPath(scratch: string, query: string): string {
  const digest = createHash("sha1").update(query).digest("hex").slice(0, 16);
  return path.join(scratch, "raw", `${digest}.json`);
}

function stamp(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RawReply {
  query: string;
  requestedAt: string;
  status: number;
  body: unknown;
}

let lastRequestStartedAt = 0;

async function fetchReply(scratch: string, query: string): Promise<void> {
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(GEOCODER_RESULT_LIMIT));
  url.searchParams.set("extratags", "1");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const wait = lastRequestStartedAt + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestStartedAt = Date.now();
    const requestedAt = stamp();

    let status = 0;
    let body: unknown = null;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      status = response.status;
      if (status === 200) body = await response.json();
    } catch (error: unknown) {
      appendFileSync(
        path.join(scratch, "run.log"),
        `${requestedAt} ERROR ${error instanceof Error ? error.message : String(error)} q=${query}\n`,
      );
    }
    appendFileSync(path.join(scratch, "run.log"), `${requestedAt} ${status} q=${query}\n`);

    if (status === 200 && Array.isArray(body)) {
      const reply: RawReply = { query, requestedAt, status, body };
      writeFileSync(rawPath(scratch, query), JSON.stringify(reply));
      return;
    }
    // 403 and 429 mean the policy has been tripped: asking harder is the wrong answer.
    if (status === 403 || status === 429 || attempt === MAX_ATTEMPTS) {
      throw new Error(`Nominatim answered ${status} for ${JSON.stringify(query)}; stopping.`);
    }
    await sleep(RETRY_WAIT_MS);
  }
}

function readReply(scratch: string, query: string): RawReply | null {
  const file = rawPath(scratch, query);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RawReply) : null;
}

// ---------------------------------------------------------------------------
// Reading a chosen row
// ---------------------------------------------------------------------------

/** A month name or an explicit date in an OSM opening_hours value — a season, not a weekly pattern. */
const SEASON_PATTERN =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b(19|20)\d{2}-\d{2}-\d{2}\b|\beaster\b/;

export function carriesSeason(openingHours: string): boolean {
  return SEASON_PATTERN.test(openingHours);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` as a date, or `null` when it is none of them. */
export function parseCheckDate(value: string): Date | null {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (match === null) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2] ?? "1") - 1, Number(match[3] ?? "1")),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface HoursRow {
  key: string;
  name: string;
  locality: string | null;
  query: string;
  briefs: Record<string, number>;
  primaryBrief: string;
  /** Other briefs whose trip context would have chosen a different row for the same reply. */
  briefsThatChooseDifferently: string[];
  specialists: string[];
  candidates: number;
  resultsInReply: number;
  located: boolean;
  osmType: string | null;
  osmId: number | null;
  category: string | null;
  type: string | null;
  /** `category=type`, or `null` when nothing was located. */
  kind: string | null;
  /** Why this kind keeps no hours, or `null` when it is one that does. */
  excludedBecause: string | null;
  /** The chosen row's `display_name`, so the extract question can be asked of the record alone. */
  displayName: string | null;
  /** Whether that row is inside the documented Québec extract; `null` when nothing was located. */
  insideQuebecExtract: boolean | null;
  /** Whether the chosen row is what was proposed; `null` unless located and of a kind that keeps hours. */
  reading: Reading | null;
  hasOpeningHours: boolean;
  openingHours: string | null;
  hasSeason: boolean;
  checkDateOpeningHours: string | null;
  /** Within two years of the run date. `null` when no (parseable) check date. */
  checkDateWithinTwoYears: boolean | null;
}

function sameResult(a: GeocoderResult | null, b: GeocoderResult | null): boolean {
  if (a === null || b === null) return a === b;
  return a.raw["osm_type"] === b.raw["osm_type"] && a.raw["osm_id"] === b.raw["osm_id"];
}

export function rowFor(named: NamedPlace, reply: RawReply, runDate: Date): HoursRow {
  const results = geocoderResults(reply.body);
  const primary = primaryBrief(named);
  const chosen = chooseGeocoderResult(results, named.place, tripContextOf(primary));
  const differing = [...named.briefs.keys()]
    .filter((brief) => brief !== primary)
    .filter(
      (brief) =>
        !sameResult(chosen, chooseGeocoderResult(results, named.place, tripContextOf(brief))),
    )
    .toSorted();

  const raw = chosen?.raw ?? {};
  const extratags =
    typeof raw["extratags"] === "object" && raw["extratags"] !== null
      ? (raw["extratags"] as Record<string, unknown>)
      : {};
  const category = str(raw["category"]);
  const type = str(raw["type"]);
  const kind = chosen === null ? null : `${category ?? "?"}=${type ?? "?"}`;
  const openingHours = str(extratags["opening_hours"]);
  const checkDate = str(extratags["check_date:opening_hours"]);
  const checked = checkDate === null ? null : parseCheckDate(checkDate);
  const twoYearsAgo = new Date(runDate);
  twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);

  return {
    key: named.key,
    name: named.place.name,
    locality: named.place.locality ?? null,
    query: reply.query,
    briefs: Object.fromEntries([...named.briefs.entries()].toSorted()),
    primaryBrief: primary,
    briefsThatChooseDifferently: differing,
    specialists: [...named.specialists].toSorted(),
    candidates: named.candidates,
    resultsInReply: results.length,
    located: chosen !== null,
    osmType: str(raw["osm_type"]),
    osmId: typeof raw["osm_id"] === "number" ? raw["osm_id"] : null,
    category,
    type,
    kind,
    excludedBecause: kind === null ? null : exclusionReason(kind),
    displayName: chosen?.displayName ?? null,
    insideQuebecExtract: chosen === null ? null : insideQuebecExtract(chosen.displayName),
    reading:
      kind === null || exclusionReason(kind) !== null
        ? null
        : (READING_OF_KEPT_ROWS[reply.query] ?? "unread"),
    hasOpeningHours: openingHours !== null,
    openingHours,
    hasSeason: openingHours !== null && carriesSeason(openingHours),
    checkDateOpeningHours: checkDate,
    checkDateWithinTwoYears: checked === null ? null : checked >= twoYearsAgo,
  };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}

function line(cells: (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}

function table(header: string[], rows: (string | number)[][]): string {
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

interface Group {
  name: string;
  rows: HoursRow[];
}

function summarise(groups: Group[], total: HoursRow[]): string {
  const cells = (rows: HoursRow[]): (string | number)[] => {
    const located = rows.filter((row) => row.located);
    const kept = located.filter((row) => row.excludedBecause === null);
    const withHours = located.filter((row) => row.hasOpeningHours);
    const keptWithHours = kept.filter((row) => row.hasOpeningHours);
    return [
      rows.length,
      located.length,
      withHours.length,
      pct(withHours.length, located.length),
      kept.length,
      keptWithHours.length,
      pct(keptWithHours.length, kept.length),
    ];
  };
  const header = [
    "",
    "places",
    "located",
    "with hours",
    "of located",
    "kinds that keep hours",
    "of those with hours",
    "of those",
  ];
  return table(header, [
    ...groups.map((group) => [group.name, ...cells(group.rows)]),
    ["**all (distinct)**", ...cells(total)],
  ]);
}

function groupBy(rows: HoursRow[], keys: (row: HoursRow) => string[]): Group[] {
  const groups = new Map<string, HoursRow[]>();
  for (const row of rows) {
    for (const key of keys(row)) {
      const bucket = groups.get(key);
      if (bucket === undefined) groups.set(key, [row]);
      else bucket.push(row);
    }
  }
  return [...groups.entries()]
    .toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, grouped]) => ({ name, rows: grouped }));
}

function objectsOf(rows: HoursRow[]): number {
  return new Set(rows.filter((row) => row.located).map((row) => `${row.osmType}/${row.osmId}`))
    .size;
}

const PARK_KINDS: ReadonlySet<string> = new Set([
  "boundary=national_park",
  "boundary=protected_area",
  "leisure=nature_reserve",
]);

/** The same hours count against each denominator the Log argues about, places and objects. */
function denominators(rows: HoursRow[], includeUnlocated = true): string {
  const located = rows.filter((row) => row.located);
  const kept = located.filter((row) => row.excludedBecause === null);
  const keptAndParks = located.filter(
    (row) => row.excludedBecause === null || PARK_KINDS.has(row.kind ?? ""),
  );
  const named = kept.filter((row) => row.reading === "named-premises");
  const city = kept.filter((row) =>
    Object.keys(row.briefs).some((brief) => brief === "city-and-culture" || brief === "multi-city"),
  );
  const cells = (label: string, set: HoursRow[]): (string | number)[] => {
    const hits = set.filter((row) => row.hasOpeningHours);
    return [
      label,
      set.length,
      hits.length,
      pct(hits.length, set.length),
      objectsOf(set),
      objectsOf(hits),
    ];
  };
  return table(
    ["denominator", "places", "with hours", "rate", "objects", "objects with hours"],
    [
      ...(includeUnlocated ? [cells("all places named", rows)] : []),
      cells("all located", located),
      cells("located, park kinds restored to the denominator", keptAndParks),
      cells("located, kinds that keep hours", kept),
      cells("  of those, city briefs (multi-city, city-and-culture)", city),
      cells("  of those, the chosen row is the named premises", named),
    ],
  );
}

function readingTable(kept: HoursRow[]): string {
  const labels = [...new Set(kept.map((row) => row.reading ?? "unread"))].toSorted();
  return table(
    ["reading", "rows", "with hours", "objects", "objects with hours"],
    labels.map((label) => {
      const set = kept.filter((row) => (row.reading ?? "unread") === label);
      const hits = set.filter((row) => row.hasOpeningHours);
      return [label, set.length, hits.length, objectsOf(set), objectsOf(hits)];
    }),
  );
}

export function renderReport(rows: HoursRow[]): string {
  const located = rows.filter((row) => row.located);
  const withHours = located.filter((row) => row.hasOpeningHours);
  const kept = located.filter((row) => row.excludedBecause === null);

  const kinds = new Map<string, HoursRow[]>();
  for (const row of located) {
    const kind = row.kind ?? "?";
    kinds.set(kind, [...(kinds.get(kind) ?? []), row]);
  }
  const kindRows = [...kinds.entries()]
    .toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([kind, group]) => [
      kind,
      group.length,
      group.filter((row) => row.hasOpeningHours).length,
      pct(group.filter((row) => row.hasOpeningHours).length, group.length),
      exclusionReason(kind) === null ? "keeps hours" : "excluded",
    ]);

  const withSeason = withHours.filter((row) => row.hasSeason);
  const dated = withHours.filter((row) => row.checkDateOpeningHours !== null);
  const recent = withHours.filter((row) => row.checkDateWithinTwoYears === true);

  const parts = [
    `## Located / not located, with hours, by brief\n`,
    `A place named under more than one brief counts under each.\n`,
    summarise(
      groupBy(rows, (row) => Object.keys(row.briefs)),
      rows,
    ),
    `\n## By \`category=type\`, located places\n`,
    table(["kind", "located", "with hours", "rate", "denominator"], kindRows),
    `\n## By proposing specialist\n`,
    `A place named by more than one specialist counts under each.\n`,
    summarise(
      groupBy(rows, (row) => row.specialists),
      rows,
    ),
    `\n## Of the ${withHours.length} located places with hours\n`,
    table(
      ["", "count"],
      [
        ["carry a season (month name or dated range)", withSeason.length],
        ["carry `check_date:opening_hours`", dated.length],
        ["`check_date:opening_hours` within two years of the run", recent.length],
      ],
    ),
    `\n## Denominators\n`,
    `"Objects" counts each OSM object once: the same museum comes back under several spellings.\n`,
    denominators(rows),
    `\n## Kept-kind rows by what the chosen row is\n`,
    readingTable(kept),
    `\n## If the deployed extract is the documented \`quebec-latest.osm.pbf\`\n`,
    `Rows whose chosen \`display_name\` ends in Québec, Canada. Unmeasured: whether the owner runs it.\n`,
    denominators(
      rows.filter((row) => row.insideQuebecExtract === true),
      false,
    ),
  ];
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertHoursRunConsent(process.env);

  const { places, files } = collectPlaces(LIVE_DIR);
  const briefs = new Set(places.flatMap((place) => [...place.briefs.keys()]));
  console.log(
    `${files} records, ${places.reduce((sum, place) => sum + place.candidates, 0)} place mentions, ` +
      `${places.length} distinct places, ${briefs.size} briefs`,
  );
  if (process.env["PLANNER_HOURS_COUNT_ONLY"] === "1") return;

  const scratch = process.env["PLANNER_HOURS_SCRATCH"];
  if (scratch === undefined || scratch === "") {
    throw new Error(
      "Refusing: PLANNER_HOURS_SCRATCH is not set; replies need a home outside the repo.",
    );
  }
  mkdirSync(path.join(scratch, "raw"), { recursive: true });
  writeFileSync(path.join(scratch, "pid"), `${process.pid}\n`);

  const sampleSize = Number(process.env["PLANNER_HOURS_SAMPLE"] ?? "0");
  const offline = process.env["PLANNER_HOURS_OFFLINE"] === "1";
  // Most-named first, so a sample is the places a plan is likeliest to hold.
  const ordered = [...places].toSorted(
    (a, b) => b.candidates - a.candidates || a.key.localeCompare(b.key),
  );
  const selected = sampleSize > 0 ? ordered.slice(0, sampleSize) : ordered;

  // One request per distinct query, whatever key it serves.
  const queries = [...new Set(selected.map((named) => placeQuery(named.place)))];
  const missing = queries.filter((query) => readReply(scratch, query) === null);
  console.log(
    `${queries.length} queries, ${queries.length - missing.length} on disk, ${missing.length} to ask`,
  );
  if (offline && missing.length > 0) {
    throw new Error(`PLANNER_HOURS_OFFLINE=1 and ${missing.length} replies are missing.`);
  }

  let done = 0;
  for (const query of missing) {
    if (query === "") continue;
    await fetchReply(scratch, query);
    done += 1;
    if (done % 25 === 0 || done === missing.length) {
      console.log(`${stamp()} ${done}/${missing.length}`);
    }
  }

  const runDate = new Date();
  const rows: HoursRow[] = [];
  for (const named of selected) {
    const reply = readReply(scratch, placeQuery(named.place));
    if (reply === null) {
      // An empty query is never sent: nothing to ask. Not located.
      continue;
    }
    rows.push(rowFor(named, reply, runDate));
  }

  const log = existsSync(path.join(scratch, "run.log"))
    ? readFileSync(path.join(scratch, "run.log"), "utf8").trim().split("\n")
    : [];
  const record = {
    ticket: "pl-56",
    runDate: runDate.toISOString().slice(0, 10),
    firstRequestAt: log[0]?.split(" ")[0] ?? null,
    lastRequestAt: log[log.length - 1]?.split(" ")[0] ?? null,
    source: "nominatim.openstreetmap.org",
    query: `q=placeQuery(place) format=jsonv2 limit=${GEOCODER_RESULT_LIMIT} extratags=1`,
    places: rows.length,
    liveRecords: files,
    exclusions: EXCLUDED_KINDS,
    rows,
  };
  const outDir = sampleSize > 0 ? scratch : RECORD_DIR;
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    sampleSize > 0 ? "sample-record.json" : `${record.runDate}.json`,
  );
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
  const report = renderReport(rows);
  writeFileSync(path.join(scratch, "report.md"), `${report}\n`);
  console.log(report);
  console.log(`\nrecord: ${outFile}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
