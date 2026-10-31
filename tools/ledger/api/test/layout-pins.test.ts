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
import { CSV_SHEET_NAME } from "@ledger/contract";
import { layoutOutputFormat } from "@ledger/receipts";
import { csvSheet } from "../src/csv.ts";
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

/**
 * lg-67, Build 3: what the import screen sends for each CSV fixture, its text
 * read by `api/src/csv.ts` as one sheet named `statement.csv` (Decision 5 (a)),
 * not under the fixture's own file name. Seven new pins beside the seven above
 * for the same fixtures, which stand: the two differ by the sheet's name
 * alone. What Haiku answers to the fixed name is unmeasured (lg-67, Done when
 * 13, the owner's).
 */
const CSV_UPLOAD_PINS: Readonly<Record<string, string>> = {
  "csv-balance": "012081995629a7878a7f03e97d9a944c1b61f6295f80c832088aa79bb9080bdb",
  "csv-no-balance": "9795452e657f5256b439ff0c1c7ab1386c43fb6776cedf5b95e9376c9469cb87",
  "empty-columns-csv": "4fecbbcfc90989bc76f261b2ec9e28abd7f1f8ba95f8d8f428579fd48acde507",
  "bank-preamble": "657e5c96bf91aaa0dcbceeeee9b8a52decc6fde61d6513f8d5505116de529409",
  "bank-two-dates": "0d762083380dc7841d561228331f6436f05701729a990a4fa8bf243ac9a6dbb7",
  "bank-footer": "5a25d7c8ea6efee02ead8e9a08a65c33a4963993a36599bad9f2d7993f89fceb",
  "bank-wide": "1df17b6b5f0c1ea041fd221e917e4f0feece7f22e9328d8ce8540e1e686afb56",
};

describe("what the model is sent for an uploaded CSV (lg-67)", () => {
  test("pins the seven CSV fixtures, the ones that carry a file's text", () => {
    expect(
      fixtures
        .filter((fixture) => fixture.text !== undefined)
        .map((fixture) => fixture.name)
        .toSorted(),
    ).toEqual(Object.keys(CSV_UPLOAD_PINS).toSorted());
  });

  test.each(Object.entries(CSV_UPLOAD_PINS))(
    "%s: the request under statement.csv is pinned, and differs from the measured one by the name alone",
    (name, pin) => {
      const fixture = fixtures.find((candidate) => candidate.name === name);
      const text = fixture?.text ?? "";
      const sent = layoutRequest([csvSheet(CSV_SHEET_NAME, text)]);
      expect(sha256(sent)).toBe(pin);
      const measured = layoutRequest(fixture?.sheets ?? []);
      const own = JSON.stringify(fixture?.sheets[0]?.name ?? "");
      expect(sent).toBe(measured.replace(`## Sheet ${own}:`, `## Sheet "${CSV_SHEET_NAME}":`));
    },
  );
});
