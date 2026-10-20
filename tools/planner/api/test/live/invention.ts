/**
 * pl-57's measurement: how often does a specialist name a place that does not
 * exist, is closed, or is in another town?
 *
 * **This is not a vitest suite.** It is a script —
 * `node --import tsx tools/planner/api/test/live/invention.ts` — and the three
 * constraints pl-40's `run.ts` and pl-56's `hours-coverage.ts` hold hold here for
 * the same reasons:
 *
 * - It lives under `test/`, so `tsconfig.tests.json` typechecks it.
 * - It is not named `*.test.ts`, so no vitest project collects it.
 * - `assertInventionConsent` refuses **before anything else runs** unless one of
 *   the two flags below is set.
 *
 * ## What it does, and what it does not
 *
 * It makes **no request**. The two things pl-57 needs from the web — a search
 * tool for each sampled place — are used by the person or agent running the
 * ticket, and what they found is committed as data (`verdicts.json`). The
 * harness is the part that can be re-run by anyone with the repo: it recounts the
 * places, applies the hand classification, draws the sample, joins the verdicts,
 * and prints and writes every table the ticket's Log quotes.
 *
 * 1. Reads every `candidatesAccepted` in the record files the population names
 *    (below), and dedupes the `Place`s on lower-cased `name|locality` — pl-56's
 *    key, so the 1,019 places are the same 1,019. It keeps the model family that
 *    named each one, from the record's directory, `claude-<family>-5-5-<effort>`.
 * 2. Reads `invention/classification.json`: the rubric, and one hand-assigned
 *    class per place. A place with no class, or a class the rubric does not
 *    define, is an error; nothing is defaulted.
 * 3. Draws 50 `named-premises` places per family with a seeded shuffle.
 * 4. Joins `invention/verdicts.json`, the by-hand web checks, to the sample.
 * 5. Reconciles the classification with pl-56's `reading` column.
 * 6. Writes `invention/2026-10-17.json`, the record, and prints the tables.
 *
 * ## The population, and `--after <run>` (pl-58)
 *
 * pl-58 re-measures after changing the `lodging` and `food` prompts, on a new
 * live run whose records sit in the same `live/` directory. Four things are
 * therefore selected by one argument, and the default is fixed by a file so
 * that adding records cannot move it:
 *
 * - **Population.** With no argument: the 111 record files listed in
 *   `invention/population-pl57.json`, the manifest, and nothing else — a record
 *   planted under any other `claude-*` directory is not read. With
 *   `--after pl58-<date>`: every `.json` under the `claude-*-pl58-<date>`
 *   directories, which are the new run's, and nothing in the manifest.
 * - **Files.** With no argument: pl-57's `invention/classification.json`,
 *   `verdicts.json` and `2026-10-17.json`. With the argument: the same three
 *   names under `invention/pl58-<date>/`, the record being `<date>.json`, and
 *   the record says `ticket: "pl-58"`. `--after` never writes pl-57's record.
 * - **Draw.** With no argument: pl-57's 50 per family. With the argument:
 *   a seeded order over the new run's `lodging`-or-`food` named-premises keys,
 *   taken in that order until 40 distinct objects (first queries) have a
 *   verdict or the keys run out; the record holds the seed, the order, the
 *   keys it took and each key's object.
 * - **Reconciliation** with pl-56 runs over the places pl-56 also read; pl-56
 *   never saw the new run's other places.
 *
 * ## Environment
 *
 * - `PLANNER_LIVE_RUN=1` — consent to the live phase. Prints the worksheet: each
 *   sampled place with no verdict yet, and the search budget it must exhaust. It
 *   still makes no request itself.
 * - `PLANNER_INVENTION_OFFLINE=1` — no live phase. Regenerates the record and
 *   the tables from what is committed.
 * - `PLANNER_INVENTION_CHECK=1` — with the offline flag: write nothing, and
 *   exit non-zero unless the committed record equals the regeneration and every
 *   sampled place has a verdict. How a gate re-derives the Log's numbers.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Candidate, Place } from "@planner/contract";

// ---------------------------------------------------------------------------
// The consent gate
// ---------------------------------------------------------------------------

export function assertInventionConsent(env: NodeJS.ProcessEnv): "live" | "offline" {
  if (env["PLANNER_LIVE_RUN"] === "1") return "live";
  if (env["PLANNER_INVENTION_OFFLINE"] === "1") return "offline";
  throw new Error(
    "Refusing: neither PLANNER_LIVE_RUN=1 nor PLANNER_INVENTION_OFFLINE=1 is set. " +
      "The live phase checks places on the web — set PLANNER_LIVE_RUN=1 to start it, " +
      "or PLANNER_INVENTION_OFFLINE=1 to regenerate the record from what is committed.",
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const FAMILIES = ["haiku", "opus", "sonnet"] as const;
export type Family = (typeof FAMILIES)[number];

export const CLASSES = [
  "named-premises",
  "kind-of-place",
  "settlement-or-area",
  "route-or-transit",
] as const;
export type PlaceClass = (typeof CLASSES)[number];

export const VERDICTS = ["exists", "exists-elsewhere", "closed", "not-found"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Every sampled family draws this many `named-premises` places, or all it has. */
export const SAMPLE_PER_FAMILY = 50;
/** The recorded seed of the sample's shuffle. */
export const SAMPLE_SEED = 20261017;
/** The fewest queries a `not-found` verdict may rest on. */
export const MIN_QUERIES_FOR_NOT_FOUND = 3;
/** pl-58: the recorded seed of the stratum's key order. */
export const STRATUM_SEED = 20261020;
/** pl-58: distinct objects (first queries) the ordered stratum keys are checked to. */
export const STRATUM_TARGET_OBJECTS = 40;
/** The name every pl-58 run directory ends in: `claude-<family>-5-5-<effort>-pl58-<date>`. */
export const RUN_PATTERN = /^pl58-\d{4}-\d{2}-\d{2}$/;

export interface NamedPlace {
  key: string;
  name: string;
  locality: string | null;
  /** Family → how many accepted candidates of that family named it. */
  families: Record<string, number>;
  briefs: Record<string, number>;
  specialists: Record<string, number>;
  mentions: number;
}

export interface RubricClass {
  definition: string;
  example: string;
}

export interface Rubric {
  written: string;
  classes: Record<string, RubricClass>;
  edgeRules: Record<string, string>;
}

export interface ClassifiedPlace {
  class: PlaceClass;
  edge: string[];
}

export interface ClassificationFile {
  rubric: Rubric;
  classes: Record<string, ClassifiedPlace>;
}

export interface Evidence {
  url: string;
  readOn: string;
  note: string;
}

export interface Check {
  verdict: Verdict;
  /** Every query run, in order, as typed. A `not-found` carries at least three. */
  queries: string[];
  evidence: Evidence[];
  closedYear?: number;
  /** Where the place actually is, for `exists-elsewhere`. */
  actualLocality?: string;
  note?: string;
}

export interface VerdictsFile {
  runDate: string;
  budget: {
    written: string;
    queriesBeforeNotFound: string[];
    osm: string;
  };
  checks: Record<string, Check>;
}

interface PlHoursRow {
  key: string;
  reading: string | null;
  located: boolean;
  displayName: string | null;
  kind: string | null;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const LIVE_DIR = fileURLToPath(new URL("../fixtures/live/", import.meta.url));

/** The files one invocation reads and writes, and the live directory it reads from. */
export interface Layout {
  liveDir: string;
  /** `undefined` is pl-57's population; a `pl58-<date>` label is the new run. */
  run: string | undefined;
  recordFile: string;
  classificationFile: string;
  verdictsFile: string;
  hoursRecord: string;
}

export function layoutFor(liveDir: string, run: string | undefined): Layout {
  const recordDir = path.join(liveDir, "invention");
  const hoursRecord = path.join(liveDir, "hours-coverage", "2026-10-17.json");
  if (run === undefined) {
    return {
      liveDir,
      run,
      recordFile: path.join(recordDir, "2026-10-17.json"),
      classificationFile: path.join(recordDir, "classification.json"),
      verdictsFile: path.join(recordDir, "verdicts.json"),
      hoursRecord,
    };
  }
  if (!RUN_PATTERN.test(run)) {
    throw new Error(`--after takes a label like pl58-2026-10-20, got ${run}`);
  }
  const own = path.join(recordDir, run);
  return {
    liveDir,
    run,
    recordFile: path.join(own, `${run.slice("pl58-".length)}.json`),
    classificationFile: path.join(own, "classification.json"),
    verdictsFile: path.join(own, "verdicts.json"),
    hoursRecord,
  };
}

/** `--after <run>` or `--after=<run>`; nothing else is accepted. */
export function parseInventionCli(argv: readonly string[]): { run: string | undefined } {
  let run: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--after") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error("--after needs a run label");
      run = value;
      index += 1;
    } else if (token.startsWith("--after=")) {
      run = token.slice("--after=".length);
    } else {
      throw new Error(`unknown argument ${token}. Usage: invention.ts [--after pl58-<date>]`);
    }
  }
  return { run };
}

/**
 * The record files the population names, as absolute paths.
 *
 * The default reads the manifest and never walks `live/`, so a record added
 * there cannot join pl-57's 111. The new run is the opposite: it is found by
 * its directory marker, because its files are not known until it has run.
 */
export function populationFiles(layout: Layout): string[] {
  const { liveDir, run } = layout;
  if (run === undefined) {
    const manifest = JSON.parse(
      readFileSync(path.join(liveDir, "invention", "population-pl57.json"), "utf8"),
    ) as {
      files: string[];
    };
    return manifest.files.map((relative) => {
      const file = path.join(liveDir, ...relative.split("/"));
      if (!existsSync(file))
        throw new Error(`the manifest names ${relative}, which is not on disk`);
      return file;
    });
  }
  const suffix = `-${run}`;
  const directories = readdirSync(liveDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && /^claude-[a-z]+-/.test(entry.name) && entry.name.endsWith(suffix),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (directories.length === 0) throw new Error(`no claude-*${suffix} directory under ${liveDir}`);
  return directories.flatMap((directory) =>
    (readdirSync(path.join(liveDir, directory), { recursive: true }) as string[])
      .filter((name) => name.endsWith(".json"))
      .toSorted()
      .map((name) => path.join(liveDir, directory, name)),
  );
}

function placesOf(candidate: Candidate): Place[] {
  return candidate.location.kind === "at"
    ? [candidate.location.place]
    : [candidate.location.from, candidate.location.to];
}

export function keyOf(place: Place): string {
  return `${place.name.trim().toLowerCase()}|${(place.locality ?? "").trim().toLowerCase()}`;
}

/** `claude-haiku-5-5-low/set-b-run-1.json` → `haiku`. */
export function familyOf(relativePath: string): string {
  const first = relativePath.split(path.sep)[0] ?? "";
  const match = /^claude-([a-z]+)-/.exec(first);
  if (match?.[1] === undefined) throw new Error(`no model family in the path ${relativePath}`);
  return match[1];
}

interface LiveRecordShape {
  briefFixture: string;
  candidatesAccepted: Candidate[];
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function collectPlaces(
  dir: string,
  files: string[],
): { places: NamedPlace[]; files: number } {
  const byKey = new Map<string, NamedPlace>();
  for (const file of files) {
    const family = familyOf(path.relative(dir, file));
    const record = JSON.parse(readFileSync(file, "utf8")) as LiveRecordShape;
    for (const candidate of record.candidatesAccepted) {
      for (const place of placesOf(candidate)) {
        const key = keyOf(place);
        let named = byKey.get(key);
        if (named === undefined) {
          named = {
            key,
            name: place.name,
            locality: place.locality ?? null,
            families: {},
            briefs: {},
            specialists: {},
            mentions: 0,
          };
          byKey.set(key, named);
        }
        bump(named.families, family);
        bump(named.briefs, record.briefFixture);
        bump(named.specialists, candidate.specialist);
        named.mentions += 1;
      }
    }
  }
  return { places: [...byKey.values()], files: files.length };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function readClassification(file: string): ClassificationFile {
  return JSON.parse(readFileSync(file, "utf8")) as ClassificationFile;
}

/** Throws unless every place has exactly one defined class and no class names a stranger. */
export function assertClassified(places: NamedPlace[], file: ClassificationFile): void {
  const keys = new Set(places.map((place) => place.key));
  for (const place of places) {
    const row = file.classes[place.key];
    if (row === undefined) throw new Error(`no class for ${place.key}`);
    if (!(CLASSES as readonly string[]).includes(row.class)) {
      throw new Error(`${place.key}: ${row.class} is not a class`);
    }
    if (file.rubric.classes[row.class] === undefined) {
      throw new Error(`${place.key}: the rubric does not define ${row.class}`);
    }
    for (const tag of row.edge) {
      if (file.rubric.edgeRules[tag] === undefined) {
        throw new Error(`${place.key}: the rubric has no edge rule ${tag}`);
      }
    }
  }
  for (const key of Object.keys(file.classes)) {
    if (!keys.has(key)) throw new Error(`classification names ${key}, which no record names`);
  }
}

// ---------------------------------------------------------------------------
// The sample
// ---------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so the draw is the same on every machine. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `size` keys drawn from `eligible` by a seeded Fisher-Yates over the keys in
 * sorted order, so the draw depends on the seed and the eligible set and on
 * nothing else — not on the order the fixtures were walked.
 */
export function draw(eligible: string[], size: number, seed: number): string[] {
  return seededOrder(eligible, seed).slice(0, size).toSorted();
}

/** The whole seeded shuffle, in the order it came out: `draw` takes a prefix of it. */
export function seededOrder(eligible: string[], seed: number): string[] {
  const pool = [...eligible].toSorted();
  const random = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) throw new Error("shuffle out of range");
    pool[i] = b;
    pool[j] = a;
  }
  return pool;
}

/** pl-58: the new run's `lodging` or `food` named-premises keys, in one seeded order. */
export function stratumOrder(
  places: NamedPlace[],
  classification: ClassificationFile,
  seed: number,
): string[] {
  const eligible = places
    .filter(
      (place) =>
        classification.classes[place.key]?.class === "named-premises" &&
        ("lodging" in place.specialists || "food" in place.specialists),
    )
    .map((place) => place.key);
  return seededOrder(eligible, seed);
}

export interface StratumWalk {
  /** The keys taken, in order: a prefix of the order. */
  checked: string[];
  /** Key → its object, the first query of its check. */
  objectOf: Record<string, string>;
  objects: number;
  /** `target`: enough objects. `exhausted`: the keys ran out. `incomplete`: the next key has no verdict yet. */
  stop: "target" | "exhausted" | "incomplete";
}

/**
 * Takes the ordered keys one by one until `target` distinct objects have a
 * verdict, or the keys run out. A key whose first query equals one already
 * taken adds a key and no object, so the key count and the object count differ.
 */
export function walkStratum(
  order: string[],
  checks: Record<string, Check>,
  target: number,
): StratumWalk {
  const checked: string[] = [];
  const objectOf: Record<string, string> = {};
  const objects = new Set<string>();
  for (const key of order) {
    const check = checks[key];
    if (check === undefined)
      return { checked, objectOf, objects: objects.size, stop: "incomplete" };
    checked.push(key);
    const id = check.queries[0] ?? key;
    objectOf[key] = id;
    objects.add(id);
    if (objects.size >= target) return { checked, objectOf, objects: objects.size, stop: "target" };
  }
  return { checked, objectOf, objects: objects.size, stop: "exhausted" };
}

export function sampleByFamily(
  places: NamedPlace[],
  classification: ClassificationFile,
): Record<string, string[]> {
  const sample: Record<string, string[]> = {};
  for (const [index, family] of FAMILIES.entries()) {
    const eligible = places
      .filter(
        (place) =>
          classification.classes[place.key]?.class === "named-premises" &&
          (place.families[family] ?? 0) > 0,
      )
      .map((place) => place.key);
    // One seed per family, derived, so adding a family never moves another's draw.
    sample[family] = draw(eligible, SAMPLE_PER_FAMILY, SAMPLE_SEED + index);
  }
  return sample;
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

/** The Wilson score interval for `successes` of `n` at 95%, as fractions. */
export function wilson(successes: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.959964;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function rate(successes: number, n: number): string {
  if (n === 0) return "n/a";
  const interval = wilson(successes, n);
  return `${pct(successes / n)} (${pct(interval.low)}–${pct(interval.high)})`;
}

// ---------------------------------------------------------------------------
// Reconciliation with pl-56
// ---------------------------------------------------------------------------

/** What each of pl-56's readings should be, in this rubric's terms. `null` means "either". */
const PL56_EXPECTED: Record<string, PlaceClass | null> = {
  "named-premises": "named-premises",
  "kind-of-place": "kind-of-place",
  "settlement-to-premises": "settlement-or-area",
  "neighbourhood-to-premises": "settlement-or-area",
  "wrong-continent": null,
  "arguable-landmark": null,
};

export interface Reconciliation {
  rows: number;
  crossTab: Record<string, Record<string, number>>;
  namedPremisesRows: number;
  namedPremisesAgreeing: number;
  disagreements: { key: string; pl56: string; mine: string; displayName: string | null }[];
  unexpectedReadings: string[];
}

export function reconcile(
  hoursRows: PlHoursRow[],
  classification: ClassificationFile,
): Reconciliation {
  const crossTab: Record<string, Record<string, number>> = {};
  const disagreements: Reconciliation["disagreements"] = [];
  const unexpected = new Set<string>();
  let rows = 0;
  let named = 0;
  let agreeing = 0;
  for (const row of hoursRows) {
    if (row.reading === null) continue;
    rows += 1;
    const mine = classification.classes[row.key]?.class;
    if (mine === undefined) throw new Error(`pl-56 row ${row.key} is not a place here`);
    crossTab[row.reading] ??= {};
    bump(crossTab[row.reading] as Record<string, number>, mine);
    if (!(row.reading in PL56_EXPECTED)) unexpected.add(row.reading);
    const expected = PL56_EXPECTED[row.reading];
    if (row.reading === "named-premises") {
      named += 1;
      if (mine === "named-premises") agreeing += 1;
    }
    if (expected !== undefined && expected !== null && expected !== mine) {
      disagreements.push({
        key: row.key,
        pl56: row.reading,
        mine,
        displayName: row.displayName,
      });
    }
  }
  return {
    rows,
    crossTab,
    namedPremisesRows: named,
    namedPremisesAgreeing: agreeing,
    disagreements,
    unexpectedReadings: [...unexpected].toSorted(),
  };
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

type Counts = Record<string, number>;

function tally<T>(items: T[], keysOf: (item: T) => string[]): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const item of items) {
    for (const key of keysOf(item)) {
      out[key] ??= {};
    }
  }
  return out;
}

export interface Tables {
  /** Distinct places per class. */
  byClass: Counts;
  /** Place mentions (accepted candidates naming one) per class. */
  mentionsByClass: Counts;
  /** A place counts under each family that named it. */
  byFamily: Record<string, Counts>;
  byBrief: Record<string, Counts>;
  /** Distinct places per specialist, a place counting under each that proposed it. */
  bySpecialist: Record<string, Counts>;
  /** The same by mention: how many times a specialist named a place of the class. */
  mentionsBySpecialist: Record<string, Counts>;
  edgeTags: Counts;
}

export function buildTables(places: NamedPlace[], classification: ClassificationFile): Tables {
  const classOf = (place: NamedPlace): PlaceClass => {
    const row = classification.classes[place.key];
    if (row === undefined) throw new Error(`no class for ${place.key}`);
    return row.class;
  };
  const byClass: Counts = {};
  const mentionsByClass: Counts = {};
  const edgeTags: Counts = {};
  const byFamily = tally(places, (place) => Object.keys(place.families));
  const byBrief = tally(places, (place) => Object.keys(place.briefs));
  const bySpecialist = tally(places, (place) => Object.keys(place.specialists));
  const mentionsBySpecialist = tally(places, (place) => Object.keys(place.specialists));
  for (const place of places) {
    const cls = classOf(place);
    bump(byClass, cls);
    mentionsByClass[cls] = (mentionsByClass[cls] ?? 0) + place.mentions;
    for (const tag of classification.classes[place.key]?.edge ?? [])
      bump(edgeTags, `${cls}: ${tag}`);
    for (const family of Object.keys(place.families)) bump(byFamily[family] as Counts, cls);
    for (const brief of Object.keys(place.briefs)) bump(byBrief[brief] as Counts, cls);
    for (const [specialist, n] of Object.entries(place.specialists)) {
      bump(bySpecialist[specialist] as Counts, cls);
      const target = mentionsBySpecialist[specialist] as Counts;
      target[cls] = (target[cls] ?? 0) + n;
    }
  }
  return {
    byClass,
    mentionsByClass,
    byFamily,
    byBrief,
    bySpecialist,
    mentionsBySpecialist,
    edgeTags,
  };
}

export interface VerdictTable {
  drawn: number;
  checked: number;
  counts: Record<string, number>;
  /** Each verdict's rate with its 95% Wilson interval, over the places checked. */
  rates: Record<string, string>;
  /** closed + exists-elsewhere + not-found. */
  notConfirmed: string;
}

export function buildVerdictTables(
  sample: Record<string, string[]>,
  checks: Record<string, Check>,
): Record<string, VerdictTable> {
  const out: Record<string, VerdictTable> = {};
  for (const [family, keys] of Object.entries(sample)) {
    const counts: Record<string, number> = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
    let checked = 0;
    for (const key of keys) {
      const check = checks[key];
      if (check === undefined) continue;
      checked += 1;
      bump(counts, check.verdict);
    }
    const rates = Object.fromEntries(
      VERDICTS.map((verdict) => [verdict, rate(counts[verdict] ?? 0, checked)]),
    );
    const bad = checked - (counts["exists"] ?? 0);
    out[family] = {
      drawn: keys.length,
      checked,
      counts,
      rates,
      notConfirmed: rate(bad, checked),
    };
  }
  return out;
}

/** Throws on a verdict the ticket's rules do not allow. */
export function assertChecks(checks: Record<string, Check>, sampled: Set<string>): void {
  for (const [key, check] of Object.entries(checks)) {
    if (!sampled.has(key)) throw new Error(`a verdict for ${key}, which the draw did not take`);
    if (!(VERDICTS as readonly string[]).includes(check.verdict)) {
      throw new Error(`${key}: ${check.verdict} is not a verdict`);
    }
    if (check.queries.length === 0) throw new Error(`${key}: no query is shown`);
    if (check.verdict === "not-found" && check.queries.length < MIN_QUERIES_FOR_NOT_FOUND) {
      throw new Error(`${key}: not-found on ${check.queries.length} queries; the budget is 3`);
    }
    if (check.verdict !== "not-found" && check.evidence.length === 0) {
      throw new Error(`${key}: ${check.verdict} with no evidence url`);
    }
    if (check.verdict === "exists-elsewhere" && check.actualLocality === undefined) {
      throw new Error(`${key}: exists-elsewhere without the locality it is really in`);
    }
  }
}

export interface InventionRecord {
  ticket: "pl-57" | "pl-58";
  runDate: string;
  seed: number;
  /** `null` under `--after`: the new run is drawn as one stratum, not per family. */
  samplePerFamily: number | null;
  rubric: Rubric;
  liveRecords: number;
  places: number;
  mentions: number;
  placesByFamily: Counts;
  tables: Tables;
  reconciliation: Reconciliation;
  sample: Record<string, string[]>;
  budget: VerdictsFile["budget"];
  verdictTables: Record<string, VerdictTable>;
  /**
   * The distinct sampled places split by whether `lodging` or `food` proposed
   * them: the two specialists whose proposals were emptiest in pl-56.
   */
  sampleBySpecialistGroup: Record<
    string,
    { places: number; counts: Record<string, number>; notConfirmed: string }
  >;
  /**
   * The same sample counted per real-world object. An object is the set of keys
   * whose verdicts were reached by the same first query, since the search was run
   * once for them; it is "not confirmed" if any of its keys is not `exists`, and
   * in the lodging-or-food stratum if any of its keys was proposed by one.
   */
  sampleByObject: {
    objects: number;
    notConfirmed: string;
    lodgingOrFood: { objects: number; notConfirmed: string };
  };
  /** pl-56's OSM `located` against this record's classes and verdicts. */
  osmCrossTabs: {
    locatedByClass: Record<string, { located: number; total: number }>;
    /** Over the distinct sampled places: verdict → located / not located by OSM. */
    sampleByVerdict: Record<string, { located: number; notLocated: number }>;
  };
  unchecked: string[];
  /** Present under `--after` only, so pl-57's record keeps its exact shape. */
  stratumDraw?: StratumDraw;
  rows: unknown[];
}

/** pl-58's ordered-key draw over the new run's `lodging`-or-`food` named-premises keys. */
export interface StratumDraw {
  run: string;
  seed: number;
  targetObjects: number;
  stratumKeys: number;
  /** Every stratum key, in the seeded order the checks follow. */
  order: string[];
  /** How many keys the walk took: to the target, or all of them when they ran out. */
  keysTaken: number;
  objects: number;
  stop: StratumWalk["stop"];
  /** Key → the object (first query) it belongs to, for the keys taken. */
  objectOf: Record<string, string>;
  /** The same objects with every object whose keys are all `park-visit` set aside. */
  withoutParks: { objects: number; notConfirmed: string };
}

const badCount = (cells: { bad: boolean }[]): number => cells.filter((cell) => cell.bad).length;

export function buildObjects(
  places: NamedPlace[],
  checks: Record<string, Check>,
  sampled: Set<string>,
): InventionRecord["sampleByObject"] {
  const objects = new Map<string, { bad: boolean; stratum: boolean }>();
  for (const place of places) {
    const check = checks[place.key];
    if (!sampled.has(place.key) || check === undefined) continue;
    const id = check.queries[0] ?? place.key;
    const cell = objects.get(id) ?? { bad: false, stratum: false };
    cell.bad ||= check.verdict !== "exists";
    cell.stratum ||= "lodging" in place.specialists || "food" in place.specialists;
    objects.set(id, cell);
  }
  const all = [...objects.values()];
  const stratum = all.filter((cell) => cell.stratum);
  return {
    objects: all.length,
    notConfirmed: `${badCount(all)} of ${all.length}, ${rate(badCount(all), all.length)}`,
    lodgingOrFood: {
      objects: stratum.length,
      notConfirmed: `${badCount(stratum)} of ${stratum.length}, ${rate(badCount(stratum), stratum.length)}`,
    },
  };
}

export function buildSpecialistGroups(
  places: NamedPlace[],
  checks: Record<string, Check>,
  sampled: Set<string>,
): InventionRecord["sampleBySpecialistGroup"] {
  const out: InventionRecord["sampleBySpecialistGroup"] = {
    "lodging or food proposed it": { places: 0, counts: {}, notConfirmed: "" },
    "only other specialists": { places: 0, counts: {}, notConfirmed: "" },
  };
  for (const place of places) {
    const check = checks[place.key];
    if (!sampled.has(place.key) || check === undefined) continue;
    const group =
      out[
        "lodging" in place.specialists || "food" in place.specialists
          ? "lodging or food proposed it"
          : "only other specialists"
      ];
    if (group === undefined) continue;
    group.places += 1;
    bump(group.counts, check.verdict);
  }
  for (const group of Object.values(out)) {
    group.notConfirmed = rate(group.places - (group.counts["exists"] ?? 0), group.places);
  }
  return out;
}

export function buildOsmCrossTabs(
  places: NamedPlace[],
  classification: ClassificationFile,
  checks: Record<string, Check>,
  sampled: Set<string>,
  hoursByKey: Map<string, PlHoursRow>,
): InventionRecord["osmCrossTabs"] {
  const locatedByClass: Record<string, { located: number; total: number }> = {};
  for (const place of places) {
    const cls = classification.classes[place.key]?.class ?? "?";
    const cell = (locatedByClass[cls] ??= { located: 0, total: 0 });
    cell.total += 1;
    if (hoursByKey.get(place.key)?.located === true) cell.located += 1;
  }
  const sampleByVerdict: Record<string, { located: number; notLocated: number }> = {};
  for (const key of [...sampled].toSorted()) {
    const check = checks[key];
    if (check === undefined) continue;
    const cell = (sampleByVerdict[check.verdict] ??= { located: 0, notLocated: 0 });
    if (hoursByKey.get(key)?.located === true) cell.located += 1;
    else cell.notLocated += 1;
  }
  return { locatedByClass, sampleByVerdict };
}

export function buildRecord(inputs: {
  places: NamedPlace[];
  files: number;
  classification: ClassificationFile;
  verdicts: VerdictsFile;
  hoursRows: PlHoursRow[];
  /** `undefined` is pl-57's population and draw; a `pl58-<date>` label is the new run. */
  run?: string | undefined;
  /** Objects the ordered stratum is taken to; only `--after` reads it. */
  target?: number;
}): InventionRecord {
  const { places, files, classification, verdicts, hoursRows, run } = inputs;
  const target = inputs.target ?? STRATUM_TARGET_OBJECTS;
  assertClassified(places, classification);
  const order = run === undefined ? [] : stratumOrder(places, classification, STRATUM_SEED);
  const walk = run === undefined ? undefined : walkStratum(order, verdicts.checks, target);
  const sample: Record<string, string[]> =
    walk === undefined ? sampleByFamily(places, classification) : { stratum: walk.checked };
  const sampled = new Set(Object.values(sample).flat());
  assertChecks(verdicts.checks, sampled);
  const hoursByKey = new Map(hoursRows.map((row) => [row.key, row]));
  // The walk stops at the first key with no verdict, so the keys still to check
  // are the rest of the order; once the target or the end is reached, none are.
  const unchecked =
    walk === undefined
      ? [...sampled].filter((key) => verdicts.checks[key] === undefined).toSorted()
      : walk.stop === "incomplete"
        ? order.slice(walk.checked.length)
        : [];
  const rows = places
    .toSorted((a, b) => a.key.localeCompare(b.key))
    .map((place) => {
      const classified = classification.classes[place.key] as ClassifiedPlace;
      const hours = hoursByKey.get(place.key);
      const drawnUnder = Object.keys(sample).filter((name) => sample[name]?.includes(place.key));
      const check = verdicts.checks[place.key];
      return {
        key: place.key,
        name: place.name,
        locality: place.locality,
        class: classified.class,
        edge: classified.edge,
        families: place.families,
        briefs: place.briefs,
        specialists: place.specialists,
        mentions: place.mentions,
        pl56Reading: hours?.reading ?? null,
        drawnUnder,
        osm:
          check === undefined || hours === undefined
            ? null
            : { located: hours.located, displayName: hours.displayName, kind: hours.kind },
        check: check ?? null,
      };
    });
  const placesByFamily: Counts = {};
  for (const place of places)
    for (const family of Object.keys(place.families)) bump(placesByFamily, family);
  // pl-56 read the old 1,019 places only; the new run's other places are not in
  // its rows, and `reconcile` rejects the reverse, a pl-56 row this run lacks.
  const reconcilable =
    run === undefined
      ? hoursRows
      : hoursRows.filter((row) => classification.classes[row.key] !== undefined);
  return {
    ticket: run === undefined ? "pl-57" : "pl-58",
    runDate: verdicts.runDate,
    seed: run === undefined ? SAMPLE_SEED : STRATUM_SEED,
    samplePerFamily: run === undefined ? SAMPLE_PER_FAMILY : null,
    rubric: classification.rubric,
    liveRecords: files,
    places: places.length,
    mentions: places.reduce((sum, place) => sum + place.mentions, 0),
    placesByFamily,
    tables: buildTables(places, classification),
    reconciliation: reconcile(reconcilable, classification),
    sample,
    budget: verdicts.budget,
    verdictTables: buildVerdictTables(sample, verdicts.checks),
    sampleBySpecialistGroup: buildSpecialistGroups(places, verdicts.checks, sampled),
    sampleByObject: buildObjects(places, verdicts.checks, sampled),
    osmCrossTabs: buildOsmCrossTabs(places, classification, verdicts.checks, sampled, hoursByKey),
    unchecked,
    ...(run === undefined || walk === undefined
      ? {}
      : {
          stratumDraw: buildStratumDraw({
            run,
            target,
            order,
            walk,
            classification,
            checks: verdicts.checks,
          }),
        }),
    rows,
  };
}

function buildStratumDraw(inputs: {
  run: string;
  target: number;
  order: string[];
  walk: StratumWalk;
  classification: ClassificationFile;
  checks: Record<string, Check>;
}): StratumDraw {
  const { run, target, order, walk, classification, checks } = inputs;
  // An object is set aside as a park only when every key that reached it is a
  // `park-visit`: a premises that shares a first query with a park stays in.
  const keysOf = new Map<string, string[]>();
  for (const key of walk.checked) {
    const id = walk.objectOf[key] as string;
    keysOf.set(id, [...(keysOf.get(id) ?? []), key]);
  }
  const rest: { bad: boolean }[] = [];
  for (const keys of keysOf.values()) {
    const allParks = keys.every((key) => classification.classes[key]?.edge.includes("park-visit"));
    if (!allParks) rest.push({ bad: keys.some((key) => checks[key]?.verdict !== "exists") });
  }
  return {
    run,
    seed: STRATUM_SEED,
    targetObjects: target,
    stratumKeys: order.length,
    order,
    keysTaken: walk.checked.length,
    objects: walk.objects,
    stop: walk.stop,
    objectOf: walk.objectOf,
    withoutParks: {
      objects: rest.length,
      notConfirmed: `${badCount(rest)} of ${rest.length}, ${rate(badCount(rest), rest.length)}`,
    },
  };
}

export function serialise(record: InventionRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function markdownTable(header: string[], body: (string | number)[][]): string {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of body) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function classTable(title: string, groups: Record<string, Counts>): string {
  const names = Object.keys(groups).toSorted();
  const body = names.map((name) => {
    const counts = groups[name] as Counts;
    const total = CLASSES.reduce((sum, cls) => sum + (counts[cls] ?? 0), 0);
    return [name, ...CLASSES.map((cls) => counts[cls] ?? 0), total];
  });
  return `${title}\n\n${markdownTable(["", ...CLASSES, "total"], body)}`;
}

export function render(record: InventionRecord): string {
  const t = record.tables;
  const out: string[] = [];
  out.push(
    `${record.liveRecords} live records, ${record.mentions} place mentions, ${record.places} distinct places`,
  );
  out.push(
    `places by family (a place counts under each family that named it): ${JSON.stringify(record.placesByFamily)}`,
  );
  out.push(
    markdownTable(
      ["class", "places", "mentions"],
      CLASSES.map((cls) => [cls, t.byClass[cls] ?? 0, t.mentionsByClass[cls] ?? 0]),
    ),
  );
  out.push(classTable("by model family", t.byFamily));
  out.push(classTable("by brief", t.byBrief));
  out.push(classTable("by specialist, distinct places", t.bySpecialist));
  out.push(classTable("by specialist, mentions", t.mentionsBySpecialist));
  // pl-58's headline: the named-premises share of lodging's and food's proposals,
  // on mentions first and on distinct places beside it.
  for (const specialist of ["lodging", "food"]) {
    const share = (counts: Counts | undefined): string => {
      const total = CLASSES.reduce((sum, cls) => sum + (counts?.[cls] ?? 0), 0);
      const named = counts?.["named-premises"] ?? 0;
      return `${named} of ${total} (${total === 0 ? "n/a" : pct(named / total)})`;
    };
    out.push(
      `${specialist}, named-premises share: mentions ${share(t.mentionsBySpecialist[specialist])}; ` +
        `places ${share(t.bySpecialist[specialist])}`,
    );
  }
  out.push(
    `edge tags:\n${Object.entries(t.edgeTags)
      .toSorted()
      .map(([tag, n]) => `  ${tag}: ${n}`)
      .join("\n")}`,
  );
  const r = record.reconciliation;
  out.push(
    `pl-56 reconciliation: ${r.rows} readings; ${r.namedPremisesAgreeing} of ${r.namedPremisesRows} named-premises agree`,
  );
  out.push(
    markdownTable(
      ["pl-56 reading", ...CLASSES],
      Object.keys(r.crossTab)
        .toSorted()
        .map((reading) => [reading, ...CLASSES.map((cls) => r.crossTab[reading]?.[cls] ?? 0)]),
    ),
  );
  for (const d of r.disagreements)
    out.push(`  disagrees: ${d.key} — pl-56 ${d.pl56}, here ${d.mine}`);
  out.push(
    markdownTable(
      ["family", "drawn", "checked", ...VERDICTS, "not confirmed"],
      Object.entries(record.verdictTables).map(([family, v]) => [
        family,
        v.drawn,
        v.checked,
        ...VERDICTS.map((verdict) => `${v.counts[verdict] ?? 0} — ${v.rates[verdict] ?? ""}`),
        v.notConfirmed,
      ]),
    ),
  );
  out.push(
    markdownTable(
      ["class", "located by OSM (pl-56)", "places"],
      CLASSES.map((cls) => [
        cls,
        record.osmCrossTabs.locatedByClass[cls]?.located ?? 0,
        record.osmCrossTabs.locatedByClass[cls]?.total ?? 0,
      ]),
    ),
  );
  out.push(
    markdownTable(
      ["verdict, distinct sampled places", "located by OSM", "not located by OSM"],
      Object.entries(record.osmCrossTabs.sampleByVerdict).map(([verdict, cell]) => [
        verdict,
        cell.located,
        cell.notLocated,
      ]),
    ),
  );
  out.push(
    markdownTable(
      ["distinct sampled places", "n", ...VERDICTS, "not confirmed"],
      Object.entries(record.sampleBySpecialistGroup).map(([group, cell]) => [
        group,
        cell.places,
        ...VERDICTS.map((verdict) => cell.counts[verdict] ?? 0),
        cell.notConfirmed,
      ]),
    ),
  );
  out.push(
    `per object (first query as the id): ${record.sampleByObject.objects} objects, not confirmed ` +
      `${record.sampleByObject.notConfirmed}; lodging or food stratum ` +
      `${record.sampleByObject.lodgingOrFood.objects} objects, not confirmed ` +
      record.sampleByObject.lodgingOrFood.notConfirmed,
  );
  const stratum = record.stratumDraw;
  if (stratum !== undefined) {
    out.push(
      `stratum draw (${stratum.run}, seed ${stratum.seed}): ${stratum.stratumKeys} lodging-or-food ` +
        `named-premises keys; ${stratum.keysTaken} keys taken for ${stratum.objects} of ` +
        `${stratum.targetObjects} objects (${stratum.stop}); without the park-visit objects: ` +
        `${stratum.withoutParks.objects} objects, not confirmed ${stratum.withoutParks.notConfirmed}`,
    );
  }
  out.push(`sampled places with no verdict: ${record.unchecked.length}`);
  return out.join("\n\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function load(layout: Layout): InventionRecord {
  const { places, files } = collectPlaces(layout.liveDir, populationFiles(layout));
  const classification = readClassification(layout.classificationFile);
  const verdicts = existsSync(layout.verdictsFile)
    ? (JSON.parse(readFileSync(layout.verdictsFile, "utf8")) as VerdictsFile)
    : { runDate: "", budget: { written: "", queriesBeforeNotFound: [], osm: "" }, checks: {} };
  const hoursRows = (JSON.parse(readFileSync(layout.hoursRecord, "utf8")) as { rows: PlHoursRow[] })
    .rows;
  return buildRecord({ places, files, classification, verdicts, hoursRows, run: layout.run });
}

function main(): void {
  const mode = assertInventionConsent(process.env);
  const layout = layoutFor(LIVE_DIR, parseInventionCli(process.argv.slice(2)).run);
  const record = load(layout);
  console.log(render(record));
  if (mode === "live") {
    console.log("\nworksheet: sampled places with no verdict yet");
    for (const key of record.unchecked) console.log(`  ${key}`);
    console.log(
      `\nbudget before not-found:\n${record.budget.queriesBeforeNotFound.map((q) => `  - ${q}`).join("\n")}`,
    );
    return;
  }
  if (process.env["PLANNER_INVENTION_CHECK"] === "1") {
    const committed = existsSync(layout.recordFile) ? readFileSync(layout.recordFile, "utf8") : "";
    if (committed !== serialise(record)) {
      throw new Error("the committed record is not what the inputs regenerate");
    }
    if (record.unchecked.length > 0) {
      throw new Error(`${record.unchecked.length} sampled places have no verdict`);
    }
    console.log(
      "\ncheck: the committed record equals its regeneration; every sampled place has a verdict",
    );
    return;
  }
  // Only the file the argument selected: `--after` can never reach pl-57's record.
  mkdirSync(path.dirname(layout.recordFile), { recursive: true });
  writeFileSync(layout.recordFile, serialise(record));
  console.log(`\nwrote ${path.relative(process.cwd(), layout.recordFile)}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
