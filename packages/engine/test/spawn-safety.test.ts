/**
 * The "never invoke a shell" rule, enforced against the source itself.
 *
 * Every other test here proves that a particular call is safe. This one proves
 * that no *new* call is unsafe, which is the property that actually decays:
 * user-supplied URLs and page titles reach ffmpeg's and yt-dlp's argv, and a
 * single `shell: true` added later turns any of them into command injection.
 *
 * A source scan is a blunt instrument and it is the right one — the alternative
 * is remembering, and the whole point is that nobody will.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SOURCE_ROOTS = [path.join(REPO_ROOT, "packages"), path.join(REPO_ROOT, "apps")] as const;

async function collectSources(): Promise<{ file: string; text: string }[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        // oxlint-disable-next-line no-await-in-loop
        await walk(full);
        continue;
      }
      if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(full);
    }
  }

  for (const root of SOURCE_ROOTS) {
    // oxlint-disable-next-line no-await-in-loop
    for (const workspace of await fs.readdir(root).catch(() => [])) {
      // oxlint-disable-next-line no-await-in-loop
      await walk(path.join(root, workspace, "src"));
    }
  }

  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(REPO_ROOT, file).replaceAll("\\", "/"),
      text: await fs.readFile(file, "utf8"),
    })),
  );
}

const SOURCES = await collectSources();

/** Strips comments, so a doc block explaining the rule is not a violation of it. */
function code(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/(^|[^:])\/\/.*$/gmu, "$1");
}

describe("no shell reaches a child process", () => {
  test("the scan actually found the source it is meant to check", () => {
    // A silently empty scan would pass every assertion below.
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(SOURCES.map((source) => source.file)).toContain("packages/engine/src/ffmpeg/runner.ts");
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
