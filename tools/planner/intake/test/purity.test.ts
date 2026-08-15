/**
 * The package's one structural promise: no model, no network, no clock.
 *
 * A source scan rather than a line in a document, in the shape of
 * `packages/core/test/spawn-safety.test.ts` — the same blunt instrument, for
 * the same reason. Other tests prove a particular function is pure; this one
 * proves no *new* one is impure, which is the property that decays. The moment
 * a condition becomes "ask the model whether this applies", or reachability
 * reads today's date, the intake stops being deterministic in CI and §3's
 * amendment is undone by increments — and it happens one convenient import at
 * a time.
 *
 * It is scoped to this package rather than lifted to `packages/core`: purity is
 * this package's promise, not the repo's. The downloader's engine has every
 * right to a clock.
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

describe("the intake is pure", () => {
  test("the scan actually found the package", () => {
    // A silently empty scan passes every assertion below.
    expect(SOURCES.map((source) => source.file)).toContain("engine.ts");
    expect(SOURCES.length).toBeGreaterThan(4);
  });

  test("nothing imports anything but the contract and itself", () => {
    // Node builtins included: a pure engine has no file to read and no socket
    // to open, and `node:fs` is how a checked-in tree quietly becomes a loaded
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
    // `now` is an argument. A `Date.now()` in here is a test that fails at
    // midnight, and worse, an intake whose answers mean something different
    // depending on when they were given. Parsing a date the caller handed us is
    // fine; asking what today is, is not.
    expect(offenders(/Date\.now\(|new Date\(\s*\)|performance\.now\(/u)).toEqual([]);
  });

  test("nothing reaches the network", () => {
    expect(offenders(/\bfetch\(|XMLHttpRequest|WebSocket/u)).toEqual([]);
  });

  test("nothing reaches a model", () => {
    // The seam is `ModelProvider` and it lives in `@planner/agent`. An intake
    // that imports it has stopped being an authored tree.
    expect(offenders(/@planner\/(?:agent|api)|ModelProvider/u)).toEqual([]);
  });
});
