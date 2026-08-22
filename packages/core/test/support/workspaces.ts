/**
 * The tree both repo-wide source scans walk.
 *
 * `spawn-safety.test.ts` and `image-closure.test.ts` enforce different rules and
 * ask the same two questions to do it: which directories are workspaces, and
 * what TypeScript sits under one. Each answered them itself until the second
 * arrived and the answers were the same code twice — the same two-level readdir,
 * the same `node_modules`/`dist` skip, the same relative-path normalisation. A
 * third scan would have made it three, and the layout they encode (one level
 * under `packages`, two under `tools`) is the sort of thing that gets changed in
 * one copy.
 *
 * This is deliberately not a `src` module: it is scaffolding for two tests, not
 * a primitive `@webtools/core` offers anyone. `vitest` collects `*.test.ts`, so
 * it is never mistaken for a suite of its own, and `tsconfig.tests.json`'s glob
 * typechecks it along with the tests that import it.
 */

import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/**
 * A directory that is not there is an answer: a young tool has no `web`, and a
 * stray `playwright.config.ts` beside the workspaces has no `src`. Any other
 * failure is not, and must not read as an empty directory — a scan that reports
 * a clean repo because it could not open it is worse than one that fails.
 */
async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

/** The same discipline for a file: absent is an answer, unreadable is not. */
export async function readFileOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * Every workspace directory, repo-relative with forward slashes — the form both
 * Dockerfiles use. One level under `packages`, two under `tools`, which is the
 * shape the root `package.json`'s `workspaces` globs declare.
 */
export async function workspaceDirs(): Promise<string[]> {
  const dirs: string[] = [];

  for (const pkg of await entriesOf(path.join(REPO_ROOT, "packages"))) {
    if (pkg.isDirectory()) dirs.push(`packages/${pkg.name}`);
  }

  for (const tool of await entriesOf(path.join(REPO_ROOT, "tools"))) {
    if (!tool.isDirectory()) continue;
    // oxlint-disable-next-line no-await-in-loop
    for (const pkg of await entriesOf(path.join(REPO_ROOT, "tools", tool.name))) {
      if (pkg.isDirectory()) dirs.push(`tools/${tool.name}/${pkg.name}`);
    }
  }

  return dirs;
}

export interface SourceFile {
  /** Repo-relative, forward slashes, so a failure message reads the same on Windows. */
  readonly file: string;
  readonly text: string;
}

/** Every `.ts`/`.tsx` under one workspace's `src`, built output and installs skipped. */
export async function sourcesUnder(dir: string): Promise<SourceFile[]> {
  const found: SourceFile[] = [];

  async function walk(current: string): Promise<void> {
    for (const entry of await entriesOf(current)) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        // oxlint-disable-next-line no-await-in-loop
        await walk(full);
        continue;
      }
      if (!/\.(?:ts|tsx)$/u.test(entry.name)) continue;
      found.push({
        file: path.relative(REPO_ROOT, full).replaceAll("\\", "/"),
        // oxlint-disable-next-line no-await-in-loop
        text: await fs.readFile(full, "utf8"),
      });
    }
  }

  await walk(path.join(REPO_ROOT, dir, "src"));
  return found;
}
