import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createTempDirs } from "./temp-dirs.ts";

/** repo-147: `status`, `next-id` and `hooks` left 166 directories in `TMPDIR` after one run. */

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
 * The registry only helps while the specs go through it. A bare `mkdtempSync`
 * in one of the three files is the leak coming back with a green suite, so it is
 * named here: `next-id.test.ts` keeps exactly one, the template it removes in
 * its own `afterAll`.
 */
test("the three specs that leaked make their directories through the registry", () => {
  const found: Record<string, number> = {};
  for (const name of ["status.test.ts", "next-id.test.ts", "hooks.test.ts"]) {
    const text = fs.readFileSync(path.join(import.meta.dirname, name), "utf8");
    found[name] = text.match(/\bmkdtemp(?:Sync)?\(/gu)?.length ?? 0;
    expect(text, name).toMatch(/\btempDirs\(\)/u);
  }
  expect(found).toEqual({ "status.test.ts": 0, "next-id.test.ts": 1, "hooks.test.ts": 0 });
});
