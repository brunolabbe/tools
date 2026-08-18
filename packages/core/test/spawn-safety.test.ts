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
 * the whole point is that nobody will. The scan therefore walks every workspace
 * under `packages/` and `tools/`, including ones that do not exist yet.
 *
 * A source scan is a blunt instrument and it is the right one.
 */

import { describe, expect, test } from "vitest";
import { sourcesUnder, workspaceDirs } from "./support/workspaces.ts";

/**
 * Every workspace's `src`, walked by the same helper the image-closure scan uses:
 * one level under `packages`, two under `tools`, including the workspaces that do
 * not exist yet.
 */
const SOURCES = (await Promise.all((await workspaceDirs()).map((dir) => sourcesUnder(dir)))).flat();

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
