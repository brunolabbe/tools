import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { missingRequiredSlots, SPECIALISTS, TRIP_SHAPES } from "../src/index.ts";
import { loadFixture } from "./fixtures.ts";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("the checked-in fixtures", () => {
  // The load itself validates against the real schemas, so a fixture that has
  // drifted out of the contract fails here rather than in whichever suite
  // happened to use it next.
  test.for(TRIP_SHAPES)("%s parses against the contract", (shape) => {
    const { brief, candidates } = loadFixture(shape);
    expect(brief.details?.shape).toBe(shape);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test.for(TRIP_SHAPES)("%s is draftable", (shape) => {
    // The property pl-5 actually depends on: a fixture that could not be
    // planned from would make every roster test assert against a brief the
    // orchestrator would have rejected.
    expect(missingRequiredSlots(loadFixture(shape).brief)).toEqual([]);
  });

  test("there is exactly one fixture per shape, and no others", () => {
    // Both directions. A shape with no fixture is a hole pl-5 discovers late;
    // a file for a shape that no longer exists is dead weight nothing loads.
    const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json"));
    expect(files.toSorted()).toEqual(TRIP_SHAPES.map((shape) => `${shape}.json`).toSorted());
  });

  test("every candidate names a specialist from the roster", () => {
    for (const shape of TRIP_SHAPES) {
      for (const candidate of loadFixture(shape).candidates) {
        expect(SPECIALISTS).toContain(candidate.specialist);
      }
    }
  });

  test("candidate ids are unique within a fixture", () => {
    // Items point at candidates by id, so a duplicate makes a plan built from
    // one of these fixtures ambiguous about what it scheduled.
    for (const shape of TRIP_SHAPES) {
      const ids = loadFixture(shape).candidates.map((candidate) => candidate.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("the set covers both provenance kinds", () => {
    // Grounding does not exist yet, so almost everything here is the model
    // talking — which is honest. But the UI has to render a grounded line too,
    // and a fixture set with no such line would let that path rot unnoticed.
    const provenances = TRIP_SHAPES.flatMap((shape) =>
      loadFixture(shape).candidates.map((candidate) => candidate.provenance.kind),
    );
    expect(provenances).toContain("model-asserted");
    expect(provenances).toContain("grounded");
  });
});
