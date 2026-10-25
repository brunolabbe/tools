/**
 * What the model is sent, pinned (lg-66, Build 1): the sha256 of
 * `layoutRequest` for each of the 13 measured fixtures, and of the answer's
 * schema as the structured output's format. lg-38's and lg-56's 300 runs were
 * taken with exactly these, so a change to what is sent is a change to what was
 * measured, and has to be a deliberate edit of a pin here, with its reason in
 * lg-66's Log.
 *
 * The 13 request pins are the values at lg-66's base, `53bb5d0f`, taken before
 * the view moved into `src`; they have not moved since. The schema's pin moved
 * once, on purpose: Decision 3 (a) corrected `ignored`'s `.describe()` text, and
 * the base's value is kept beside the new one so the move reads here.
 */

import { createHash } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { layoutOutputFormat } from "@ledger/receipts";
import { layoutRequest } from "../src/layout-view.ts";
import { layoutFixtures } from "./layout/fixtures.ts";
import type { LayoutFixture } from "./layout/fixtures.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** At `53bb5d0f`: each fixture's request, as lg-38's harness built it. */
const REQUEST_PINS: Readonly<Record<string, string>> = {
  lg7: "57c9385c3f7fc1a27cb68a54b58d928d318ac3202befb017ef313b40dc4d260b",
  lg37: "79dc3826e8f2576897fa8b7989ac523aacce22cb2b6e9fad93414f295e007d2e",
  moved: "502035573fdbc86af43eb93b924c7bde8d8993b9b94eb51af696d12bb216b885",
  english: "e95f911fc6a89d97024dad1bb341809112a7b5b789cc4a99d224626251b69524",
  "csv-balance": "4b6d2fdb139ba08018cd3840c711b1ad43f095392d839e0cef2aa037710ba2fe",
  "csv-no-balance": "2e711e2626d3326d7d75af5d0902a912d583cfdf7338369bb78b5982a2b7d220",
  "swapped-labels": "e21a2ad77293b92abfe8bcd6102934ec9ca4d1eac60107208c5f4e7e51bbb139",
  "empty-columns-carry": "13ab93b615909dee2384ef90b9357024b18762687d29b2da6a587752d12b24ea",
  "empty-columns-csv": "9dd3898b7b7fe83a77817df4416f256f36dbc856e086b517dfc071d1daa3e8b7",
  "bank-preamble": "bb09bba739c1a40cb0eed108469d7f92b59d3c47b664b1ff04ac10a26cc4d858",
  "bank-two-dates": "e12bac7945aa5c645a9257b65ff1b4311fe30bf1d8367a083c99f12eb8e09c27",
  "bank-footer": "f68253f5f453bff2395865016b207649610b3d2ed987e5f61885c77338769921",
  "bank-wide": "6bc675ba868b27bbc853a3c56efa8265d84c59cf6e032c525ae78b878f3b54a8",
};

/** At `53bb5d0f`, 5,842 characters: the schema all 300 runs were sent. */
const SCHEMA_PIN_AT_BASE = "cbf85552e814c2f9aed91a6678ff87ff3f043c7212331edca255ebebc07ad1b6";

/**
 * The schema sent now, 5,963 characters: `ignored`'s `.describe()` says the list
 * is advisory and not read (lg-66, Decision 3 (a)), where it said "read as none
 * of the above". Unmeasured against a model: the 300 runs had the base's.
 */
const SCHEMA_PIN = "e5c31565db17908aed3654c0d3e44f2eaaf0ff10124d84568ff462b76add6eb7";

test("the schema's pin moved from the base's, once and on purpose", () => {
  expect(SCHEMA_PIN).not.toBe(SCHEMA_PIN_AT_BASE);
});

let fixtures: LayoutFixture[];

beforeAll(async () => {
  fixtures = await layoutFixtures();
});

describe("what the model is sent", () => {
  test("pins all thirteen fixtures, and only them", () => {
    expect(fixtures.map((fixture) => fixture.name).toSorted()).toEqual(
      Object.keys(REQUEST_PINS).toSorted(),
    );
  });

  test.each(Object.entries(REQUEST_PINS))(
    "%s: the request is the one lg-66's base sent",
    (name, pin) => {
      const fixture = fixtures.find((candidate) => candidate.name === name);
      expect(fixture, name).toBeDefined();
      expect(sha256(layoutRequest(fixture?.sheets ?? []))).toBe(pin);
    },
  );

  test("the answer's schema, as the structured output's format, is the pinned one", () => {
    expect(sha256(JSON.stringify(layoutOutputFormat().schema))).toBe(SCHEMA_PIN);
  });
});
