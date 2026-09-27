/**
 * The "never invoke a shell" rule, enforced against the source itself.
 *
 * Other tests prove that a particular call is safe. This one proves that no
 * *new* call is unsafe, which is the property that actually decays: user-
 * supplied strings reach child-process argv, and a single `shell: true` added
 * later turns any of them into command injection.
 *
 * It lives in `packages/core` rather than in the tool whose ffmpeg calls
 * prompted it, because the rule is repo-wide. Scoped to one tool, a second tool
 * spawning a shell would be caught only if somebody remembered to look — and
 * the whole point is that nobody will. The scan therefore reads every source
 * file in the repository, including ones that do not exist yet.
 *
 * It used to read only workspaces' `src` — every `.ts` one level under
 * `packages/` and two under `tools/` — while `CLAUDE.md` called it repo-wide.
 * `scripts/`, which spawns `git`, `gh` and `npm` more than anything else here,
 * every `test/` and `e2e/`, and every `.mjs` sat outside it (repo-75).
 *
 * A source scan is a blunt instrument and it is the right one.
 */

import { describe, expect, test } from "vitest";
import { repoSources } from "./support/workspaces.ts";

/** Every source file in the repository, tracked or new — see `repoSources`. */
const SOURCES = await repoSources();

/** Strips comments, so a doc block explaining the rule is not a violation of it. */
function code(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/(^|[^:])\/\/.*$/gmu, "$1");
}

describe("no shell reaches a child process", () => {
  test("the scan actually found the source it is meant to check", () => {
    // A silently empty scan would pass every assertion below. Asserting that the
    // scan reached code which spawns at all is stronger than naming a file, and
    // unlike a hardcoded path it cannot rot the next time one moves.
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(
      SOURCES.filter((source) => /from\s+["']node:child_process["']/u.test(source.text)).length,
    ).toBeGreaterThan(0);
  });

  test("the scan reaches past the workspaces, into scripts/ and .mjs", () => {
    // What repo-75 found missing: a scan narrowed back to workspaces' `src`
    // would still pass the test above, so the two roots it had never reached
    // are asserted by their shape rather than by a file name that can move.
    const spawning = SOURCES.filter((source) =>
      /from\s+["']node:child_process["']/u.test(source.text),
    ).map((source) => source.file);
    expect(spawning.some((file) => file.startsWith("scripts/") && file.endsWith(".mjs"))).toBe(
      true,
    );
    expect(spawning.some((file) => /^(?:packages|tools)\/.*\/test\//u.test(file))).toBe(true);
  });

  test("no call site sets `shell` to anything truthy", () => {
    const offenders = SOURCES.filter((source) =>
      /\bshell\s*:\s*(?:true|1|["'`])/u.test(code(source.text)),
    ).map((source) => source.file);
    expect(offenders).toEqual([]);
  });

  test("the shell-running members of node:child_process are never imported", () => {
    // `execFile` and `spawn` take an argument array and are fine. `exec` and
    // `execSync` concatenate into a command string and hand it to /bin/sh.
    const offenders = SOURCES.filter((source) => {
      const text = code(source.text);
      if (!/from\s+["']node:child_process["']/u.test(text)) return false;
      return /\bimport\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s+["']node:child_process["']/u.test(
        text,
      );
    }).map((source) => source.file);
    expect(offenders).toEqual([]);
  });

  test("every file that spawns says `shell: false` explicitly", () => {
    // The default is already false, so this is about intent: a spawn without
    // the flag reads as one nobody thought about.
    const offenders = SOURCES.filter((source) => {
      const text = code(source.text);
      const spawns = /\bspawn\s*\(/u.test(text) && /from\s+["']node:child_process["']/u.test(text);
      return spawns && !/\bshell\s*:\s*false/u.test(text);
    }).map((source) => source.file);
    expect(offenders).toEqual([]);
  });
});
