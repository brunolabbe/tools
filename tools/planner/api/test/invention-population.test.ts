/**
 * pl-58's population argument for pl-57's harness (`live/invention.ts`).
 *
 * The harness is a script, not a suite, and makes no request; what a suite can
 * hold is the part that decides which records it counts and how it draws, because
 * those are what let pl-58 add a second run to `fixtures/live/` without moving
 * pl-57's 1,019 places. Every case here builds a small `live/` directory in a
 * temporary directory, except the one that counts the real tree.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildRecord,
  collectPlaces,
  layoutFor,
  parseInventionCli,
  populationFiles,
  runLabel,
  stratumOrder,
  stratumSpecialists,
  walkStratum,
  type Check,
  type ClassificationFile,
  type PlaceClass,
} from "./live/invention.ts";

const REAL_LIVE_DIR = fileURLToPath(new URL("./fixtures/live/", import.meta.url));

const temporaries: string[] = [];
afterEach(() => {
  for (const directory of temporaries.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function liveDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "invention-"));
  temporaries.push(directory);
  mkdirSync(path.join(directory, "invention"), { recursive: true });
  return directory;
}

/** A record file holding one accepted candidate per `[specialist, name, locality]`. */
function writeRecord(live: string, relative: string, places: [string, string, string][]): void {
  const file = path.join(live, ...relative.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      briefFixture: "road-trip",
      candidatesAccepted: places.map(([specialist, name, locality]) => ({
        specialist,
        location: { kind: "at", place: { name, locality, coordinates: null } },
      })),
    }),
  );
}

function writeManifest(live: string, files: string[]): void {
  writeFileSync(
    path.join(live, "invention", "population-pl57.json"),
    JSON.stringify({ ticket: "pl-57", written: "test", files }),
  );
}

function check(query: string, verdict: Check["verdict"] = "exists"): Check {
  return {
    verdict,
    queries: [query],
    evidence: [{ url: "https://example.test/", readOn: "2026-10-20", note: "" }],
    ...(verdict === "exists-elsewhere" ? { actualLocality: "elsewhere" } : {}),
  };
}

describe("the command line", () => {
  test("no argument is pl-57's population; --after takes a label in either form", () => {
    expect(parseInventionCli([])).toEqual({ run: undefined });
    expect(parseInventionCli(["--after", "pl58-2026-10-20"])).toEqual({ run: "pl58-2026-10-20" });
    expect(parseInventionCli(["--after=pl58-2026-10-20"])).toEqual({ run: "pl58-2026-10-20" });
  });

  test("a bare --after, or anything else, is refused", () => {
    expect(() => parseInventionCli(["--after"])).toThrow(/needs a run label/);
    expect(() => parseInventionCli(["--run", "x"])).toThrow(/unknown argument/);
  });

  test("the files follow the argument: pl-57's by default, the run's own three with it", () => {
    const live = "/live";
    const base = layoutFor(live, undefined);
    expect(base.recordFile).toBe(path.join(live, "invention", "2026-10-17.json"));
    expect(base.classificationFile).toBe(path.join(live, "invention", "classification.json"));
    expect(base.verdictsFile).toBe(path.join(live, "invention", "verdicts.json"));

    const after = layoutFor(live, "pl58-2026-10-20");
    const own = path.join(live, "invention", "pl58-2026-10-20");
    expect(after.recordFile).toBe(path.join(own, "2026-10-20.json"));
    expect(after.classificationFile).toBe(path.join(own, "classification.json"));
    expect(after.verdictsFile).toBe(path.join(own, "verdicts.json"));
    expect(after.recordFile).not.toBe(base.recordFile);
  });

  test("a label without the -pl<n>- shape is refused", () => {
    expect(() => layoutFor("/live", "2026-10-20")).toThrow(/like pl60-2026-10-24/);
  });
});

describe("which record files a population counts", () => {
  test("the default is the manifest alone: a planted or a new run's record is not read", () => {
    const live = liveDir();
    writeRecord(live, "claude-haiku-5-5-low/a.json", [["lodging", "Hotel A", "Percé"]]);
    writeRecord(live, "claude-haiku-5-5-low/planted.json", [["lodging", "Hotel P", "Percé"]]);
    writeRecord(live, "claude-haiku-5-5-low-pl58-2026-10-20/a.json", [
      ["lodging", "Hotel N", "Percé"],
    ]);
    writeManifest(live, ["claude-haiku-5-5-low/a.json"]);

    const files = populationFiles(layoutFor(live, undefined));
    expect(files).toEqual([path.join(live, "claude-haiku-5-5-low", "a.json")]);
    const { places, files: count } = collectPlaces(live, files);
    expect(count).toBe(1);
    expect(places.map((place) => place.key)).toEqual(["hotel a|percé"]);
  });

  test("a manifest line with no file behind it is an error, not a smaller count", () => {
    const live = liveDir();
    writeManifest(live, ["claude-haiku-5-5-low/gone.json"]);

    expect(() => populationFiles(layoutFor(live, undefined))).toThrow(/gone\.json/);
  });

  test("--after reads the run's directories alone, whatever the family and effort", () => {
    const live = liveDir();
    writeRecord(live, "claude-haiku-5-5-low/a.json", [["lodging", "Hotel A", "Percé"]]);
    writeRecord(live, "claude-haiku-5-5-low-pl58-2026-10-20/set-a-resort.json", [
      ["lodging", "Hotel N", "Percé"],
    ]);
    writeRecord(live, "claude-opus-5-5-low-pl58-2026-10-20/set-b-run-1.json", [
      ["food", "Bistro O", "Percé"],
    ]);
    writeRecord(live, "claude-opus-5-5-low-pl58-2026-10-21/set-b-run-1.json", [
      ["food", "Bistro Later", "Percé"],
    ]);
    writeManifest(live, ["claude-haiku-5-5-low/a.json"]);

    const files = populationFiles(layoutFor(live, "pl58-2026-10-20"));
    const { places } = collectPlaces(live, files);
    expect(places.map((place) => place.key).toSorted()).toEqual([
      "bistro o|percé",
      "hotel n|percé",
    ]);
    expect(places.find((place) => place.key === "bistro o|percé")?.families).toEqual({ opus: 1 });
  });

  test("--after with no such directory is an error", () => {
    expect(() => populationFiles(layoutFor(liveDir(), "pl58-2026-10-20"))).toThrow(
      /no claude-\*-pl58-2026-10-20 directory/,
    );
  });

  test("the real tree: the default is pl-57's 111 files and 1,019 places, whatever else is under live/", () => {
    const files = populationFiles(layoutFor(REAL_LIVE_DIR, undefined));
    const { places, files: count } = collectPlaces(REAL_LIVE_DIR, files);

    expect(count).toBe(111);
    expect(places).toHaveLength(1019);
  });
});

describe("the ordered-key walk", () => {
  const order = ["a", "b", "c", "d", "e"];

  test("stops at the target, counting objects and not keys", () => {
    const checks = {
      a: check("q1"),
      b: check("q1"),
      c: check("q2"),
      d: check("q3"),
      e: check("q4"),
    };
    const walk = walkStratum(order, checks, 3);

    expect(walk.stop).toBe("target");
    expect(walk.checked).toEqual(["a", "b", "c", "d"]);
    expect(walk.objects).toBe(3);
    expect(walk.objectOf).toEqual({ a: "q1", b: "q1", c: "q2", d: "q3" });
  });

  test("stops when the keys run out, and says so", () => {
    const checks = {
      a: check("q1"),
      b: check("q2"),
      c: check("q2"),
      d: check("q1"),
      e: check("q1"),
    };
    const walk = walkStratum(order, checks, 40);

    expect(walk.stop).toBe("exhausted");
    expect(walk.checked).toEqual(order);
    expect(walk.objects).toBe(2);
  });

  test("stops at the first key with no verdict, which is the next one to search", () => {
    const walk = walkStratum(order, { a: check("q1"), b: check("q2") }, 40);

    expect(walk.stop).toBe("incomplete");
    expect(walk.checked).toEqual(["a", "b"]);
  });
});

const named = (edge: string[] = []): { class: PlaceClass; edge: string[] } => ({
  class: "named-premises",
  edge,
});

describe("the record under --after", () => {
  const RUN = "pl58-2026-10-20";
  const rubric: ClassificationFile["rubric"] = {
    written: "test",
    classes: {
      "named-premises": { definition: "d", example: "e" },
      "kind-of-place": { definition: "d", example: "e" },
      "settlement-or-area": { definition: "d", example: "e" },
      "route-or-transit": { definition: "d", example: "e" },
    },
    edgeRules: { "park-visit": "a park visited" },
  };

  function fixture(): { live: string; classification: ClassificationFile } {
    const live = liveDir();
    writeRecord(live, `claude-sonnet-5-5-low-${RUN}/set-a.json`, [
      ["lodging", "Hotel One", "Percé"],
      ["lodging", "Hotel Two", "Percé"],
      ["food", "Bistro Three", "Gaspé"],
      ["food", "Parc Four", "Gaspé"],
      ["lodging", "Motel", "Percé"],
      ["activities", "Rock Five", "Percé"],
    ]);
    return {
      live,
      classification: {
        rubric,
        classes: {
          "hotel one|percé": named(),
          "hotel two|percé": named(),
          "bistro three|gaspé": named(),
          "parc four|gaspé": named(["park-visit"]),
          "motel|percé": { class: "kind-of-place", edge: [] },
          "rock five|percé": named(),
        },
      },
    };
  }

  function recordFor(
    inputs: ReturnType<typeof fixture>,
    checks: Record<string, Check>,
    target: number,
    run: string | undefined,
  ): ReturnType<typeof buildRecord> {
    const files = populationFiles(layoutFor(inputs.live, RUN));
    const { places, files: count } = collectPlaces(inputs.live, files);
    return buildRecord({
      places,
      files: count,
      classification: inputs.classification,
      verdicts: {
        runDate: "2026-10-20",
        budget: { written: "", queriesBeforeNotFound: [], osm: "" },
        checks,
      },
      hoursRows: [],
      run,
      target,
    });
  }

  test("draws the lodging-or-food named-premises keys only, in a seeded order", () => {
    const inputs = fixture();
    const { places } = collectPlaces(inputs.live, populationFiles(layoutFor(inputs.live, RUN)));
    const order = stratumOrder(places, inputs.classification, 1);

    expect(order.toSorted()).toEqual([
      "bistro three|gaspé",
      "hotel one|percé",
      "hotel two|percé",
      "parc four|gaspé",
    ]);
    expect(stratumOrder(places, inputs.classification, 1)).toEqual(order);
  });

  test("writes pl-58's record: the seed, the order, the keys taken, each key's object", () => {
    const inputs = fixture();
    const { places } = collectPlaces(inputs.live, populationFiles(layoutFor(inputs.live, RUN)));
    const order = stratumOrder(places, inputs.classification, 20261020);
    // The first two keys share a query, so four keys make three objects, the target.
    const checks = Object.fromEntries(
      order.map((key, index) => [key, check(index < 2 ? "shared" : `query ${key}`)]),
    );
    const record = recordFor(inputs, checks, 3, RUN);

    expect(record.ticket).toBe("pl-58");
    expect(record.samplePerFamily).toBeNull();
    expect(record.stratumDraw).toMatchObject({
      run: RUN,
      seed: 20261020,
      targetObjects: 3,
      stratumKeys: 4,
      order,
      keysTaken: 4,
      objects: 3,
      stop: "target",
    });
    expect(record.stratumDraw?.objectOf[order[0] as string]).toBe("shared");
    expect(record.unchecked).toEqual([]);
  });

  test("counts the parks apart: an object of park-visit keys only is set aside", () => {
    const inputs = fixture();
    const { places } = collectPlaces(inputs.live, populationFiles(layoutFor(inputs.live, RUN)));
    const order = stratumOrder(places, inputs.classification, 20261020);
    const checks = Object.fromEntries(
      order.map((key) => [
        key,
        key.startsWith("parc") ? check("parc", "exists-elsewhere") : check(`query ${key}`),
      ]),
    );
    const draw = recordFor(inputs, checks, 40, RUN).stratumDraw;

    expect(draw?.objects).toBe(4);
    expect(draw?.withoutParks.objects).toBe(3);
    expect(draw?.withoutParks.notConfirmed).toMatch(/^0 of 3, /);
  });

  test("a stratum key with no verdict leaves the rest of the order unchecked", () => {
    const inputs = fixture();
    const { places } = collectPlaces(inputs.live, populationFiles(layoutFor(inputs.live, RUN)));
    const order = stratumOrder(places, inputs.classification, 20261020);
    const record = recordFor(inputs, { [order[0] as string]: check("q") }, 40, RUN);

    expect(record.stratumDraw?.stop).toBe("incomplete");
    expect(record.unchecked).toEqual(order.slice(1));
  });

  test("a verdict for a key past the stopping point is refused", () => {
    const inputs = fixture();
    const { places } = collectPlaces(inputs.live, populationFiles(layoutFor(inputs.live, RUN)));
    const order = stratumOrder(places, inputs.classification, 20261020);
    const checks = Object.fromEntries(order.map((key) => [key, check(`query ${key}`)]));

    expect(() => recordFor(inputs, checks, 2, RUN)).toThrow(/the draw did not take/);
  });

  test("without --after the record is pl-57's: no stratum draw, 50 per family", () => {
    const inputs = fixture();
    const record = recordFor(inputs, {}, 40, undefined);

    expect(record.ticket).toBe("pl-57");
    expect(record.samplePerFamily).toBe(50);
    expect(record).not.toHaveProperty("stratumDraw");
    expect(Object.keys(record.sample)).toEqual(["haiku", "opus", "sonnet"]);
  });
});

describe("a label for any ticket's re-measure, pl-60's included (pl-60, Build 7)", () => {
  test("--after pl60-<date> is accepted, and its files are the run's own", () => {
    expect(parseInventionCli(["--after", "pl60-2026-10-24"])).toEqual({ run: "pl60-2026-10-24" });
    expect(runLabel("pl60-2026-10-24")).toEqual({ ticket: "pl-60", date: "2026-10-24" });
    // pl-58's label keeps meaning what it meant, so its committed record still regenerates.
    expect(runLabel("pl58-2026-10-21")).toEqual({ ticket: "pl-58", date: "2026-10-21" });

    const own = path.join("/live", "invention", "pl60-2026-10-24");
    const layout = layoutFor("/live", "pl60-2026-10-24");
    expect(layout.recordFile).toBe(path.join(own, "2026-10-24.json"));
    expect(layout.classificationFile).toBe(path.join(own, "classification.json"));
    expect(layout.verdictsFile).toBe(path.join(own, "verdicts.json"));
  });

  test.each([
    "pl-60-2026-10-24",
    "pl060-2026-10-24",
    "PL60-2026-10-24",
    "pl60-2026-1-24",
    "pl60-2026-10-24x",
    "pl60",
    "pl60-",
    "60-2026-10-24",
  ])("a malformed label, %s, is refused", (label) => {
    expect(() => layoutFor("/live", label)).toThrow(/--after takes a label like pl60-2026-10-24/);
  });

  test("the record names the label's own ticket, read from its directories alone", () => {
    const live = liveDir();
    writeRecord(live, "claude-opus-5-5-low-pl60-2026-10-24/set-b-run-1.json", [
      ["lodging", "motel", "Percé"],
    ]);
    writeRecord(live, "claude-opus-5-5-low-pl58-2026-10-21/set-b-run-1.json", [
      ["lodging", "Hotel One", "Percé"],
    ]);
    const layout = layoutFor(live, "pl60-2026-10-24");
    const files = populationFiles(layout);
    const { places, files: count } = collectPlaces(live, files);

    expect(files.map((file) => path.relative(live, file))).toEqual([
      path.join("claude-opus-5-5-low-pl60-2026-10-24", "set-b-run-1.json"),
    ]);
    const record = buildRecord({
      places,
      files: count,
      classification: {
        rubric: {
          written: "test",
          classes: {
            "named-premises": { definition: "d", example: "e" },
            "kind-of-place": { definition: "d", example: "e" },
            "settlement-or-area": { definition: "d", example: "e" },
            "route-or-transit": { definition: "d", example: "e" },
          },
          edgeRules: {},
        },
        classes: { "motel|percé": { class: "kind-of-place", edge: [] } },
      },
      verdicts: {
        runDate: "2026-10-24",
        budget: { written: "", queriesBeforeNotFound: [], osm: "" },
        checks: {},
      },
      hoursRows: [],
      run: "pl60-2026-10-24",
      target: 40,
    });

    expect(record.ticket).toBe("pl-60");
  });

  test("pl-60's stratum is lodging's named premises alone; pl-58's stays lodging's and food's", () => {
    expect(stratumSpecialists("pl58-2026-10-21")).toEqual(["lodging", "food"]);
    expect(stratumSpecialists("pl60-2026-10-24")).toEqual(["lodging"]);
    expect(() => stratumSpecialists("pl61-2026-10-24")).toThrow(/no stratum is defined for pl-61/);

    const live = liveDir();
    writeRecord(live, "claude-opus-5-5-low-pl60-2026-10-24/set-b-run-1.json", [
      ["lodging", "Hotel One", "Percé"],
      ["food", "Bistro Three", "Gaspé"],
      ["lodging", "Bistro Three", "Gaspé"],
      ["food", "Fumoir Four", "Gaspé"],
    ]);
    const { places } = collectPlaces(live, populationFiles(layoutFor(live, "pl60-2026-10-24")));
    const classification: ClassificationFile = {
      rubric: {
        written: "test",
        classes: {
          "named-premises": { definition: "d", example: "e" },
          "kind-of-place": { definition: "d", example: "e" },
          "settlement-or-area": { definition: "d", example: "e" },
          "route-or-transit": { definition: "d", example: "e" },
        },
        edgeRules: {},
      },
      classes: {
        "hotel one|percé": { class: "named-premises", edge: [] },
        "bistro three|gaspé": { class: "named-premises", edge: [] },
        "fumoir four|gaspé": { class: "named-premises", edge: [] },
      },
    };

    expect(
      stratumOrder(places, classification, 1, stratumSpecialists("pl60-2026-10-24")).toSorted(),
    ).toEqual(["bistro three|gaspé", "hotel one|percé"]);
    expect(stratumOrder(places, classification, 1).toSorted()).toEqual([
      "bistro three|gaspé",
      "fumoir four|gaspé",
      "hotel one|percé",
    ]);
  });
});
