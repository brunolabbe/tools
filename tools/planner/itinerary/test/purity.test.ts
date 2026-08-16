/**
 * The package's one structural promise: no model, no network, no clock.
 *
 * The same blunt source scan `intake/test/purity.test.ts` runs, and
 * deliberately a copy rather than a shared helper — the two packages make the
 * same promise for different reasons, and a lifted scanner would be one
 * abstraction serving two rules that are free to diverge. `packages/` earns a
 * copy of this on the third consumer, not the second.
 *
 * The reason here is determinism of the *output*: the same brief and the same
 * candidates must compose the same plan twice, in CI, without a key. A
 * `Date.now()` in the packer is a booking deadline that changes answer at
 * midnight; a `Math.random()` in a tie-break is a plan that cannot be
 * re-derived from its own inputs and a diff between two revisions that shows
 * changes nobody made.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const SRC = path.join(import.meta.dirname, "..", "src");

async function collectSources(): Promise<{ file: string; text: string }[]> {
  const entries = await fs.readdir(SRC, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));

  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(SRC, file).replaceAll("\\", "/"),
      text: await fs.readFile(file, "utf8"),
    })),
  );
}

const SOURCES = await collectSources();

/** Strips comments, so a doc block explaining the rule is not a violation of it. */
function code(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/(^|[^:])\/\/.*$/gmu, "$1");
}

function offenders(pattern: RegExp): string[] {
  return SOURCES.filter((source) => pattern.test(code(source.text))).map((source) => source.file);
}

describe("the itinerary package is pure", () => {
  test("the scan actually found the package", () => {
    // A silently empty scan passes every assertion below.
    expect(SOURCES.map((source) => source.file)).toContain("compose.ts");
    expect(SOURCES.length).toBeGreaterThan(4);
  });

  test("nothing imports anything but the contract and itself", () => {
    // Node builtins included: nothing here has a file to read or a socket to
    // open, and `node:fs` is how a checked-in fixture quietly becomes a loaded
    // one.
    const strays = SOURCES.flatMap((source) =>
      [...code(source.text).matchAll(/from\s+"([^"]+)"/gu)]
        .map(([, specifier]) => specifier ?? "")
        .filter((specifier) => specifier !== "@planner/contract" && !specifier.startsWith("./"))
        .map((specifier) => `${source.file}: ${specifier}`),
    );

    expect(strays).toEqual([]);
  });

  test("nothing reads the clock", () => {
    // `now` is an argument. `new Date(epochMillis)` is fine and is how a date
    // is formatted back out; asking what today is, is not — hence the empty
    // parentheses in the pattern.
    expect(offenders(/Date\.now\(|new Date\(\s*\)|performance\.now\(/u)).toEqual([]);
  });

  test("nothing is random", () => {
    // A tie-break that is not deterministic makes the diff between two
    // revisions show moves nobody asked for.
    expect(offenders(/Math\.random\(|crypto\.randomUUID\(|randomBytes\(/u)).toEqual([]);
  });

  test("nothing reaches the network", () => {
    expect(offenders(/\bfetch\(|XMLHttpRequest|WebSocket/u)).toEqual([]);
  });

  test("nothing reaches a model", () => {
    // The seam is `ModelProvider` and it lives in `@planner/agent`. §2's whole
    // point is that nothing in here asks a model to do arithmetic.
    expect(offenders(/@planner\/(?:agent|api)|ModelProvider/u)).toEqual([]);
  });

  test("nothing reads the environment", () => {
    // `api` is the only package in this tool that reads `process.env`. A limit
    // that varies by deployment arrives as an argument.
    expect(offenders(/process\.env/u)).toEqual([]);
  });
});
