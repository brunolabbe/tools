import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createTempDirs, tempDirs } from "./temp-dirs.ts";

/**
 * repo-147: `status`, `next-id` and `hooks` left 166 directories in `TMPDIR`
 * after one run, and `status-gate-record` 17 more.
 */

test("a directory made through the registry is under the temp directory and removed by cleanup", () => {
  const dirs = createTempDirs();
  const made = dirs.make("repo-147-probe-");
  try {
    expect(path.dirname(made)).toBe(os.tmpdir());
    expect(path.basename(made).startsWith("repo-147-probe-")).toBe(true);
    // Content and a nested directory, because the leak was whole fixture trees.
    fs.mkdirSync(path.join(made, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(made, "a", "b", "file"), "x");
    expect(fs.existsSync(made)).toBe(true);
  } finally {
    dirs.cleanup();
  }
  expect(fs.existsSync(made)).toBe(false);
});

test("cleanup removes every directory made, tolerates one already gone, and forgets them", () => {
  const dirs = createTempDirs();
  const first = dirs.make("repo-147-probe-");
  const second = dirs.make("repo-147-probe-");
  fs.rmSync(first, { recursive: true });
  dirs.cleanup();
  expect(fs.existsSync(second)).toBe(false);
  // A second call has nothing left to remove and must not throw.
  expect(() => dirs.cleanup()).not.toThrow();
});

/**
 * One removal that throws must not keep the others on disk. `rmSync` is made to
 * throw for one directory by a spy rather than by a read-only child, so the case
 * holds as root and on Windows, where `chmod` removes nothing.
 */
test("cleanup attempts every removal when one throws, then throws the failures together", () => {
  const dirs = createTempDirs();
  const first = dirs.make("repo-147-probe-");
  const second = dirs.make("repo-147-probe-");
  const third = dirs.make("repo-147-probe-");
  const real = fs.rmSync.bind(fs);
  const spy = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (target === first || target === third) throw new Error(`cannot remove ${String(target)}`);
    real(target, options);
  });
  let caught: unknown;
  try {
    dirs.cleanup();
  } catch (error) {
    caught = error;
  } finally {
    spy.mockRestore();
  }
  try {
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(2);
    // The one that could be removed was, though it came between two failures.
    expect(fs.existsSync(second)).toBe(false);
    // The failures are not retried by the next case's cleanup.
    expect(() => dirs.cleanup()).not.toThrow();
  } finally {
    for (const dir of [first, second, third]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `tempDirs()` is the registry plus an `afterEach`, and only a second case can
 * see whether the hook ran after the first. The pair therefore depends on its
 * order, which is why it sits in its own `describe` with shuffling off: plain
 * `--sequence.shuffle` reorders cases, and a pair run backwards reads as a leak.
 * Deleting the `afterEach` line in `temp-dirs.ts` turns the second case red.
 */
describe("tempDirs registers its afterEach", { shuffle: false }, () => {
  const temp = tempDirs();
  let made = "";

  test("a case makes a directory", () => {
    made = temp.make("repo-147-hook-");
    fs.writeFileSync(path.join(made, "file"), "x");
    expect(fs.existsSync(made)).toBe(true);
  });

  test("the next case finds it gone", () => {
    expect(made, "the first case of this pair did not run before this one").not.toBe("");
    expect(fs.existsSync(made)).toBe(false);
  });
});

/**
 * The registry only helps while the specs go through it. A direct call in one of
 * the four files is the leak coming back with a green suite, so each file is held
 * at the number of times it reaches for a temp directory without the registry:
 * `next-id.test.ts` keeps exactly one, the template it removes in its own
 * `afterAll`, which is a `mkdtemp` and an `os.tmpdir()` on one line.
 *
 * What counts is every spelling that makes a directory under the temp root:
 * `mkdtemp`, `mkdtempSync`, `mkdtempDisposableSync` and the promise form, and any
 * mention of `tmpdir`, which is how a `mkdirSync` under it has to name the root.
 */
const SPECS = {
  "status.test.ts": 0,
  "next-id.test.ts": 2,
  "hooks.test.ts": 0,
  "status-gate-record.test.ts": 0,
} as const;

const directTempUses = (text: string): number =>
  text.match(/\bmkdtemp\w*\s*\(|\btmpdir\b/gu)?.length ?? 0;

test("the specs that leaked make their directories through the registry", () => {
  const found: Record<string, number> = {};
  for (const name of Object.keys(SPECS)) {
    const text = fs.readFileSync(path.join(import.meta.dirname, name), "utf8");
    found[name] = directTempUses(text);
    expect(text, name).toMatch(/\btempDirs\(\)/u);
  }
  expect(found).toEqual(SPECS);
});

test.each([
  ["mkdtempSync", 'fs.mkdtempSync(path.join(base, "x-"))'],
  ["mkdtemp, promise form", 'await fs.promises.mkdtemp(path.join(base, "x-"))'],
  ["mkdtempDisposableSync", 'using dir = fs.mkdtempDisposableSync(path.join(base, "x-"))'],
  ["mkdirSync under os.tmpdir()", 'fs.mkdirSync(path.join(os.tmpdir(), "x"), { recursive: true })'],
  ["a destructured tmpdir", 'const { tmpdir } = os; fs.mkdirSync(path.join(tmpdir(), "x"))'],
])("the scan sees a planted %s", (_name, line) => {
  expect(directTempUses(line)).toBeGreaterThan(0);
});

test("the scan does not count the registry's own call or a backticked mkdtemp with no open parenthesis", () => {
  expect(directTempUses('const dir = temp.make("status-")')).toBe(0);
  expect(directTempUses("// a `mkdtemp` under the temp root, made once")).toBe(0);
});
