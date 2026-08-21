/**
 * Each tool's `Dockerfile` lists its workspaces by hand, twice, and nothing
 * checked either list against what the API actually resolves at runtime.
 *
 * pl-16 is the worked example: adding `@planner/itinerary` to `@planner/api`
 * passed `npm run check`, passed every unit test, and produced an image that
 * would not boot. The failure surfaces in the image job as thirty seconds of
 * `curl: (7) Failed to connect` — which is what an infrastructure flake looks
 * like — and the real cause is one ERR_MODULE_NOT_FOUND at the bottom of a log
 * nobody opens first.
 *
 * The two lists fail differently, so both are checked. Miss the runtime
 * `package.json` + `dist` pair and the container starts, reports healthy, and
 * throws when the code path is first reached. Miss the build-stage manifest and
 * `npm ci` never created the workspace symlink, so there is nothing to copy
 * even if the runtime lines are right.
 *
 * It lives in `packages/core` rather than in the tool that needed it, for the
 * reason `spawn-safety.test.ts` does: the rule is repo-wide, and a second tool
 * getting it wrong should not depend on somebody remembering to look. Both
 * Dockerfiles are read as text; neither is assumed to look like the other, and
 * they must not be merged — the downloader's is built on Playwright's image and
 * carries Chromium and ffmpeg, and the comment at the top of either file says
 * so.
 *
 * **This does not replace the image gate.** A scan over text proves the list is
 * complete. It cannot prove the image boots, that the native `better-sqlite3`
 * binary meets its glibc, or that `/api/health` answers — `.github/workflows/`
 * still owns all three. What it buys is that the commonest failure is caught in
 * milliseconds by `npm test` rather than in minutes by a container that will
 * not start.
 *
 * A source scan is a blunt instrument and it is the right one. There is no
 * Dockerfile parser here on purpose.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** Anything a workspace in this repo can be called. */
const WORKSPACE_SCOPE = /^@(?:webtools|[a-z0-9-]+)\//u;

type Workspace = {
  /** Repo-relative, forward slashes: the path a `COPY` line spells. */
  dir: string;
  name: string;
  dependencies: string[];
  devDependencies: string[];
};

/** Every `<workspace>/package.json`: one level under `packages`, two under `tools`. */
async function workspaceDirs(): Promise<string[]> {
  const dirs: string[] = [];

  for (const pkg of await fs.readdir(path.join(REPO_ROOT, "packages")).catch(() => [])) {
    dirs.push(`packages/${pkg}`);
  }

  for (const tool of await fs.readdir(path.join(REPO_ROOT, "tools")).catch(() => [])) {
    // oxlint-disable-next-line no-await-in-loop
    for (const pkg of await fs.readdir(path.join(REPO_ROOT, "tools", tool)).catch(() => [])) {
      dirs.push(`tools/${tool}/${pkg}`);
    }
  }

  return dirs;
}

async function readWorkspaces(): Promise<Workspace[]> {
  const found: Workspace[] = [];

  for (const dir of await workspaceDirs()) {
    // A non-directory beside the workspaces — a `Dockerfile`, a
    // `playwright.config.ts` — simply has no manifest to read.
    // oxlint-disable-next-line no-await-in-loop
    const raw = await fs
      .readFile(path.join(REPO_ROOT, dir, "package.json"), "utf8")
      .catch(() => "");
    if (!raw) continue;

    const manifest = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (!manifest.name) continue;

    found.push({
      dir,
      name: manifest.name,
      dependencies: Object.keys(manifest.dependencies ?? {}),
      devDependencies: Object.keys(manifest.devDependencies ?? {}),
    });
  }

  return found;
}

const WORKSPACES = await readWorkspaces();
const BY_NAME = new Map(WORKSPACES.map((workspace) => [workspace.name, workspace]));

/**
 * A specifier names a package, not a file. `@webtools/core/rate-limit` resolves
 * through that package's `exports` map and ships inside its `dist`, so it is
 * `@webtools/core` that has to be in the image.
 */
function packageOf(specifier: string): string {
  const [scope, name] = specifier.split("/");
  return specifier.startsWith("@") ? `${scope}/${name}` : (scope ?? specifier);
}

/**
 * Every workspace Node has to resolve to run `entry`, following `dependencies`
 * only: the build stage ends with `npm prune --omit=dev`, so a devDependency is
 * gone by the time the runtime stage copies anything.
 */
function closureOf(entry: Workspace): Workspace[] {
  const reached = new Map<string, Workspace>();
  const pending = [entry];

  while (pending.length > 0) {
    const workspace = pending.pop();
    if (!workspace || reached.has(workspace.name)) continue;
    reached.set(workspace.name, workspace);

    for (const dependency of workspace.dependencies) {
      const next = BY_NAME.get(dependency);
      // A registry dependency is in `node_modules`, which is copied wholesale.
      if (next) pending.push(next);
    }
  }

  return [...reached.values()];
}

type Image = {
  tool: string;
  dockerfile: string;
  text: string;
  /** The workspace the image's `CMD` runs, read off the file rather than assumed. */
  entry: Workspace;
  /** The tool's `web`, if it has one — see `EXEMPT` below. */
  web: Workspace | undefined;
};

async function readImages(): Promise<Image[]> {
  const images: Image[] = [];

  for (const tool of await fs.readdir(path.join(REPO_ROOT, "tools")).catch(() => [])) {
    const dockerfile = `tools/${tool}/Dockerfile`;
    // oxlint-disable-next-line no-await-in-loop
    const text = await fs.readFile(path.join(REPO_ROOT, dockerfile), "utf8").catch(() => "");
    if (!text) continue;

    // `CMD ["node", "tools/<tool>/api/dist/main.js"]` — the entry is whatever
    // the image actually starts, so a tool that renames `api` is still checked.
    const started = /^CMD\s*\[\s*"node"\s*,\s*"([^"]+)"/mu.exec(text)?.[1] ?? "";
    const entryDir = started.replace(/\/dist\/.*$/u, "");
    const entry = WORKSPACES.find((workspace) => workspace.dir === entryDir);
    if (!entry) throw new Error(`${dockerfile}: its CMD does not start a workspace (${started})`);

    images.push({
      tool,
      dockerfile,
      text,
      entry,
      web: WORKSPACES.find((workspace) => workspace.dir === `tools/${tool}/web`),
    });
  }

  return images;
}

const IMAGES = await readImages();

/** Matches a whole `COPY` line, so a path inside a comment is not a `COPY`. */
function copies(text: string, pattern: string): boolean {
  return new RegExp(`^COPY\\s+${pattern}(?:\\s|$)`, "mu").test(text);
}

/** Every workspace a `COPY` line names, by directory. */
function copiedWorkspaces(text: string): Set<string> {
  const named = new Set<string>();

  for (const line of text.split("\n")) {
    if (!/^COPY\b/u.test(line)) continue;
    for (const workspace of WORKSPACES) {
      // The trailing slash is what keeps `COPY tools/planner tools/planner` —
      // the whole-tool source copy — from reading as every workspace under it.
      if (line.includes(`${workspace.dir}/`)) named.add(workspace.dir);
    }
  }

  return named;
}

describe("each image carries the workspaces its API resolves", () => {
  test("the scan found both images and walked a real graph", () => {
    // A silently empty scan passes every assertion below. Asserting on what the
    // scan reached is stronger than naming a file and cannot rot when one moves.
    expect(IMAGES.map((image) => image.tool).toSorted()).toEqual(["downloader", "planner"]);
    for (const image of IMAGES) {
      expect(closureOf(image.entry).length).toBeGreaterThan(3);
    }
  });

  test.each(IMAGES)("$dockerfile copies every workspace in the API's closure", (image) => {
    const missing: string[] = [];

    for (const workspace of closureOf(image.entry)) {
      // The build stage's manifest layer: without it `npm ci` never creates the
      // workspace symlink, so the runtime stage has nothing to copy.
      if (!copies(image.text, `${workspace.dir}/package\\.json`)) {
        missing.push(
          `${image.dockerfile}: build stage does not COPY ${workspace.dir}/package.json`,
        );
      }
      // The runtime pair. The manifest is how Node resolves the symlink; the
      // `dist` is the code behind it. Either one alone boots and then throws.
      if (!copies(image.text, `--from=build\\s+/app/${workspace.dir}/package\\.json`)) {
        missing.push(
          `${image.dockerfile}: runtime stage does not COPY ${workspace.dir}/package.json`,
        );
      }
      if (!copies(image.text, `--from=build\\s+/app/${workspace.dir}/dist`)) {
        missing.push(`${image.dockerfile}: runtime stage does not COPY ${workspace.dir}/dist`);
      }
    }

    expect(missing).toEqual([]);
  });

  test.each(IMAGES)("$dockerfile ships nothing outside it", (image) => {
    // `web` is the exception and it is not an oversight: Vite inlines every
    // import into `web/dist/app`, so the runtime resolves no `@<tool>/*`
    // specifier for it. Its two lines put a bundle where `WEB_DIR` points, which
    // is a different job from the resolution graph this test is about.
    const EXEMPT = image.web ? [image.web.dir] : [];
    const allowed = new Set([...closureOf(image.entry).map((w) => w.dir), ...EXEMPT]);

    const stale = [...copiedWorkspaces(image.text)].filter((dir) => !allowed.has(dir)).toSorted();

    expect(stale).toEqual([]);
  });
});

/**
 * The closure above is computed from `package.json` files, so it is only as
 * good as they are — and pl-16 found `@planner/api` importing both
 * `@planner/itinerary` and `@webtools/core` without declaring either. The graph
 * would have been wrong in exactly the case that matters, so this is what makes
 * the closure trustworthy rather than circular.
 */
type Import = { workspace: Workspace; file: string; specifier: string; typeOnly: boolean };

/** Every `.ts`/`.tsx` under `dir`; a directory that does not exist yields none. */
async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      // oxlint-disable-next-line no-await-in-loop
      found.push(...(await sourceFiles(full)));
      continue;
    }
    if (/\.(?:ts|tsx)$/u.test(entry.name)) found.push(full);
  }

  return found;
}

async function collectImports(): Promise<Import[]> {
  const found: Import[] = [];

  for (const workspace of WORKSPACES) {
    // oxlint-disable-next-line no-await-in-loop
    const files = await sourceFiles(path.join(REPO_ROOT, workspace.dir, "src"));

    for (const file of files) {
      // oxlint-disable-next-line no-await-in-loop
      const text = await fs.readFile(file, "utf8");
      const relative = path.relative(REPO_ROOT, file).replaceAll("\\", "/");

      // `import … from "x"`, `export … from "x"`, and the side-effect
      // `import "x"` — the three forms that make Node resolve a specifier.
      const statements = [
        ...text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s*["']([^"']+)["']/gmu),
        ...text.matchAll(/^\s*import\s+()["']([^"']+)["']/gmu),
      ];

      for (const [, typeOnly, specifier] of statements) {
        if (specifier === undefined || !WORKSPACE_SCOPE.test(specifier)) continue;
        const name = packageOf(specifier);
        if (!BY_NAME.has(name) || name === workspace.name) continue;
        found.push({ workspace, file: relative, specifier: name, typeOnly: Boolean(typeOnly) });
      }
    }
  }

  return found;
}

const IMPORTS = await collectImports();

describe("a workspace declares what its source imports", () => {
  test("the scan actually found the imports it is meant to check", () => {
    expect(IMPORTS.length).toBeGreaterThan(30);
    // The subpath case, which is the one that would report a package that does
    // not exist if `packageOf` stopped normalising.
    expect(IMPORTS.some((entry) => entry.specifier === "@webtools/core")).toBe(true);
  });

  test("every workspace specifier under `src` is declared somewhere", () => {
    const offenders = IMPORTS.filter(
      (entry) =>
        !entry.workspace.dependencies.includes(entry.specifier) &&
        !entry.workspace.devDependencies.includes(entry.specifier),
    ).map((entry) => `${entry.file} imports ${entry.specifier}, undeclared in its package.json`);

    expect(offenders).toEqual([]);
  });

  test("a specifier that survives compilation is a runtime `dependencies` entry", () => {
    // A `import type` is erased and never resolved, so it may sit in
    // devDependencies. Anything else has to be in the image, which is to say in
    // the closure the tests above walk.
    const offenders = IMPORTS.filter(
      (entry) => !entry.typeOnly && !entry.workspace.dependencies.includes(entry.specifier),
    ).map(
      (entry) => `${entry.file} imports ${entry.specifier}, not in its package.json dependencies`,
    );

    expect(offenders).toEqual([]);
  });
});
