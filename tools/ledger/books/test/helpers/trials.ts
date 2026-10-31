/**
 * Collects what a loop of thousands of random trials finds wrong, so the spec
 * asserts once at the end (lg-69).
 *
 * A vitest `expect` costs a matcher object, a stack and a message per call:
 * three thousand trials with several calls each spent 1.15-1.44 s per size on
 * CI, against 123-144 ms for the same trials without them. The trial counts are
 * what makes the draw reach every branch, so they stay; the assertions move out
 * of the loop. Nothing is lost: the first failing trial is named with its inputs.
 */

import { isDeepStrictEqual } from "node:util";
import { expect } from "vitest";

/** JSON that survives the bigints a settlement's nets are made of. */
export function show(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? `${String(item)}n` : item,
  );
}

export interface Trials {
  /**
   * Starts a trial. `inputs` is only called if the trial fails, so a passing
   * run formats nothing.
   */
  begin(label: string, inputs: () => unknown): void;
  /** Records the current trial as failing with `what` unless `ok`. */
  holds(ok: boolean, what: () => string): void;
  /** Records the current trial as failing unless the two are deeply, strictly equal. */
  equal(actual: unknown, expected: unknown, what?: string): void;
  /** Fails the test naming the first failing trial and its inputs, and how many failed. */
  assertNone(): void;
}

export function trials(): Trials {
  const failures: string[] = [];
  let label = "";
  let inputs: () => unknown = () => undefined;
  const fail = (what: string): void => {
    failures.push(`${label}${what === "" ? "" : `, ${what}`}\n  inputs: ${show(inputs())}`);
  };
  return {
    begin(next, nextInputs) {
      label = next;
      inputs = nextInputs;
    },
    holds(ok, what) {
      if (!ok) fail(what());
    },
    equal(actual, expected, what = "") {
      if (!isDeepStrictEqual(actual, expected)) {
        fail(`${what}${what === "" ? "" : ": "}expected ${show(expected)}, got ${show(actual)}`);
      }
    },
    assertNone() {
      if (failures.length === 0) return;
      expect.fail(`${String(failures.length)} trials failed; the first was ${failures[0] ?? ""}`);
    },
  };
}
