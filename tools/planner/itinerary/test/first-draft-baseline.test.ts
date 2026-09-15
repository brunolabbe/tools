/**
 * `compose`'s first drafts are byte-identical to the ones it produced before
 * pl-43 (step 0).
 *
 * The baseline was written by the unmodified package and committed on its own,
 * before the refactor commit; the ticket's Log names both commits. This suite
 * only ever reads it. See `first-draft-cases.ts` for why nothing here writes.
 *
 * Compared as serialised JSON, per case, rather than with `toEqual`: `toEqual`
 * treats a property set to `undefined` as absent and does not see key order, and
 * a stored revision is JSON.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { composeEveryCase } from "./first-draft-cases.ts";

const BASELINE: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/first-draft-baseline.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const RESULTS = composeEveryCase();

describe("compose's first drafts match the pre-pl-43 baseline", () => {
  test("the baseline and the cases name the same thirteen inputs", () => {
    // Six shapes under two tables, plus the transition case. A case dropped
    // from either side would otherwise pass by not being compared.
    expect(Object.keys(RESULTS).toSorted()).toEqual(Object.keys(BASELINE).toSorted());
    expect(Object.keys(RESULTS)).toHaveLength(13);
  });

  test.each(Object.keys(RESULTS))("%s", (name) => {
    expect(JSON.stringify(RESULTS[name], null, 2)).toBe(JSON.stringify(BASELINE[name], null, 2));
  });
});
