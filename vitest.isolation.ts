import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";

// The same test scripts/test-gate.mjs applies to `env.CI`, so the two never
// disagree about whether a run is CI.
export const isCi = (value: string | undefined): boolean =>
  value !== undefined && value !== "" && value !== "false" && value !== "0";

/**
 * What puts a test file in the isolated half of a split project (repo-129).
 *
 * `isolate: false` keeps one module graph per worker for every file the worker
 * runs, so a file that rewrites that graph or the process around it would hand
 * its changes to whichever file runs next. These are the vitest calls that do:
 * a module mock or a module reset, a stubbed global or a stubbed environment
 * variable. The file is found by reading it, not by its name, so a new file
 * that mocks a module lands in the isolated half the day it is written, with
 * nobody having to remember a list.
 */
export const NEEDS_ISOLATION =
  /\bvi\.(?:mock|doMock|unmock|doUnmock|stubGlobal|stubEnv|resetModules)\b/u;

const repoRoot = dirname(fileURLToPath(import.meta.url));

/** Every `*.test.ts(x)` under `dir`, as repo-relative posix paths. */
function testFilesUnder(dir: string): string[] {
  return readdirSync(join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .filter(
      (entry) => /\.test\.tsx?$/u.test(entry) && !entry.split(/[\\/]/u).includes("node_modules"),
    )
    .map((entry) => `${dir}/${entry.split("\\").join("/")}`);
}

export interface SplitOptions {
  /** The name `vitest --project <name>` selects: both halves answer to it. */
  name: string;
  /**
   * The directory whose children each hold a `test/`, repo-relative:
   * `tools/<tool>` for a tool, `packages` for the shared packages. The same
   * set the root config's `<parent>/*\/test/**` include matched.
   */
  parent: string;
  /**
   * Files that stay isolated for a reason no pattern can see, each with the
   * reason. A key is a repo-relative file, or a directory when it ends in `/`.
   * A key that matches no test file is an error, so a rename cannot leave the
   * entry guarding nothing.
   */
  stayIsolated?: Record<string, string>;
  /** Everything else the project needs, applied to both halves. */
  test?: NonNullable<ViteUserConfig["test"]>;
}

/**
 * One tool's tests as two vitest projects under one container (repo-129).
 *
 * A container is a config file that declares `projects`: its children are
 * named `<name> (shared)` and `<name> (isolated)`, and `--project <name>`
 * matches the container, so it runs both. That is why the split is a file per
 * tool and not two inline projects in the root config: an inline project is
 * matched by its own name only, and `--project planner` would have run half of
 * the planner's files with nothing saying so. The count of files is the same
 * before and after; `scripts/test/preflight.test.ts` holds it.
 *
 * The shared half runs with `isolate: false`, so a worker evaluates Fastify,
 * zod and each workspace's `dist/` once for all the files it is handed rather
 * than once per file. The isolated half is today's behaviour.
 */
export function splitProject(options: SplitOptions): ViteUserConfig {
  const testDirs = readdirSync(join(repoRoot, options.parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${options.parent}/${entry.name}/test`)
    .filter((dir) => existsSync(join(repoRoot, dir)));
  const all = testDirs.flatMap(testFilesUnder).toSorted();
  const stay = Object.keys(options.stayIsolated ?? {});
  const named = (file: string, key: string): boolean =>
    key.endsWith("/") ? file.startsWith(key) : file === key;
  for (const key of stay) {
    if (!all.some((file) => named(file, key))) {
      throw new Error(
        `${options.name}: stayIsolated names ${key}, which matches none of its test files`,
      );
    }
  }
  const isolated = all.filter(
    (file) =>
      stay.some((key) => named(file, key)) ||
      NEEDS_ISOLATION.test(readFileSync(join(repoRoot, file), "utf8")),
  );
  const inIsolated = new Set(isolated);
  const shared = all.filter((file) => !inIsolated.has(file));
  return {
    // The workspace root, not the config's own directory: the include lists and
    // `setupFiles` are repo-relative, as they were in the root config.
    root: repoRoot,
    test: {
      name: options.name,
      // Repo-99's worker count, which a file project does not inherit from the
      // root config (see vitest.config.ts for why it is set at all).
      ...(isCi(process.env.CI) ? { maxWorkers: 4 } : {}),
      environment: "node",
      globals: false,
      ...options.test,
      projects: [
        {
          extends: true,
          test: {
            name: "shared",
            isolate: false,
            include: shared,
            exclude: configDefaults.exclude,
          },
        },
        {
          extends: true,
          test: {
            name: "isolated",
            include: isolated,
            exclude: configDefaults.exclude,
          },
        },
      ],
    },
  };
}
