/**
 * The "an image carries what its API imports" rule, enforced against the
 * Dockerfiles themselves.
 *
 * Each tool's `Dockerfile` lists its workspaces by hand, twice — the manifests
 * copied before `npm ci` in the build stage, and a `package.json` + `dist` pair
 * per workspace in the runtime stage. Both lists are prose, and nothing else
 * checks either against what the API actually has to resolve. Adding a workspace
 * dependency to an `api` package therefore costs two Dockerfile edits that no
 * compiler, linter or unit test asks for.
 *
 * It has already happened: pl-16 added `@planner/itinerary` to `@planner/api`,
 * `npm run check` passed, every test passed, and the container would not boot.
 *
 * The two lists fail differently, which is why both are asserted. Miss the
 * runtime pair and the image starts, looks healthy, and throws
 * ERR_MODULE_NOT_FOUND when the code path is first reached. Miss the build-stage
 * manifest and `npm ci` never created the workspace symlink, so there is nothing
 * to copy even if the runtime lines are right.
 *
 * This lives in `packages/core` rather than in the tool that needed it, for the
 * reason `spawn-safety.test.ts` does: the rule is repo-wide, and a scan scoped to
 * one tool catches a second tool only if somebody remembers to look. It follows
 * that file's bar in shape too — read the text, match plainly, name the file and
 * the missing line. A Dockerfile parser is a project; this is a scan.
 *
 * **It does not replace the image gate.** A scan over text proves the list is
 * complete. It cannot prove the image boots, that the native `better-sqlite3`
 * binary meets the glibc it was linked against, or that `/api/health` answers.
 * What it buys is that the commonest way that job fails is caught in seconds by
 * `npm test` rather than in minutes by a container that will not start — and
 * caught as itself, rather than as thirty seconds of `curl: (7)` that reads like
 * an infrastructure flake.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** A workspace scope this repo owns. Anything else is an ordinary npm package. */
const WORKSPACE_SCOPE = /^@(?:webtools|downloader|planner)\//u;

interface Workspace {
  /** Repo-relative, forward slashes — the form both Dockerfiles use. */
  readonly dir: string;
  /** Workspace members of `dependencies` only: `npm prune --omit=dev` drops the rest. */
  readonly dependencies: readonly string[];
}

async function readWorkspaces(): Promise<Map<string, Workspace>> {
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

  const workspaces = new Map<string, Workspace>();
  await Promise.all(
    dirs.map(async (dir) => {
      const text = await fs
        .readFile(path.join(REPO_ROOT, dir, "package.json"), "utf8")
        .catch(() => null);
      // A stray file beside the workspaces — `playwright.config.ts` — has no
      // manifest, and neither does a directory that is not a workspace.
      if (text === null) return;
      const manifest = JSON.parse(text) as { name?: string; dependencies?: Record<string, string> };
      if (manifest.name === undefined) return;
      workspaces.set(manifest.name, {
        dir,
        dependencies: Object.keys(manifest.dependencies ?? {}).filter((dep) =>
          WORKSPACE_SCOPE.test(dep),
        ),
      });
    }),
  );
  return workspaces;
}

const WORKSPACES = await readWorkspaces();

/**
 * Every workspace Node has to resolve at runtime, walked declaratively from the
 * API's own manifest — `api` → `agent` → `contract` → `@webtools/core`. It needs
 * no build and no Docker, and it is exactly the set the image must carry.
 *
 * A closure computed from `package.json` is only as good as those files, which is
 * what `declares every workspace it imports` below is for.
 */
function closureFrom(root: string): string[] {
  const seen = new Set<string>();
  const queue = [root];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(WORKSPACES.get(name)?.dependencies ?? []));
  }
  return [...seen].map((name) => {
    const workspace = WORKSPACES.get(name);
    if (workspace === undefined) throw new Error(`${name} is depended on but is not a workspace`);
    return workspace.dir;
  });
}

interface ToolImage {
  readonly tool: string;
  /** The directories the API's runtime resolution graph needs. */
  readonly closure: readonly string[];
  /**
   * Bundled, not resolved: Vite inlines every `@<tool>/*` import into
   * `web/dist/app`, so the runtime never resolves one for the UI. The two lines
   * each Dockerfile spends on `web` do a different job — shipping the bundle the
   * API serves same-origin — and are deliberately outside this scan.
   */
  readonly bundledOnly: string;
  readonly preInstall: string;
  readonly runtime: string;
}

/** Whitespace is not the subject; a line differing only in spacing is the same line. */
function copyLines(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.trim().replaceAll(/\s+/gu, " "))
    .filter((line) => line.startsWith("COPY "));
}

async function readImages(): Promise<ToolImage[]> {
  const tools = await fs.readdir(path.join(REPO_ROOT, "tools")).catch(() => []);
  const images = await Promise.all(
    tools.map(async (tool) => {
      const text = await fs
        .readFile(path.join(REPO_ROOT, "tools", tool, "Dockerfile"), "utf8")
        .catch(() => null);
      if (text === null) return null;

      // The build stage copies the whole tool directory further down, so the only
      // manifests that matter are the ones `npm ci` can see: the install is what
      // creates the workspace symlinks, and it runs before that copy.
      const install = text.search(/^\s*RUN npm ci\b/mu);
      // The two Dockerfiles are not the same file and must not become one — the
      // downloader's is built on Playwright's image and carries Chromium and
      // ffmpeg, the planner's is a plain Node base. Each is read rather than
      // assumed; what they share is naming their last stage.
      const runtime = text.search(/^FROM .* AS runtime$/mu);
      expect(install, `tools/${tool}/Dockerfile has no \`RUN npm ci\``).toBeGreaterThan(-1);
      expect(runtime, `tools/${tool}/Dockerfile has no runtime stage`).toBeGreaterThan(install);

      return {
        tool,
        closure: closureFrom(`@${tool}/api`),
        bundledOnly: `tools/${tool}/web`,
        preInstall: text.slice(0, install),
        runtime: text.slice(runtime),
      };
    }),
  );
  return images.filter((image) => image !== null);
}

const IMAGES = await readImages();

describe("each tool's image carries every workspace its API resolves", () => {
  test("the scan found the repo it is meant to check", () => {
    // A silently empty scan passes every assertion below. Both tools have an
    // image today; asserting the shape rather than the names keeps a third tool
    // from being quietly exempt.
    expect(IMAGES.length).toBeGreaterThanOrEqual(2);
    for (const image of IMAGES) {
      // At minimum `api`, its own contract, and `@webtools/core`.
      expect(image.closure.length, `${image.tool}'s closure`).toBeGreaterThanOrEqual(3);
      expect(image.closure, `${image.tool}'s closure`).toContain("packages/core");
    }
  });

  test("every workspace in the closure has its manifest copied before `npm ci`", () => {
    const missing: string[] = [];
    for (const image of IMAGES) {
      const lines = copyLines(image.preInstall);
      for (const dir of image.closure) {
        const line = `COPY ${dir}/package.json ${dir}/`;
        if (!lines.includes(line)) missing.push(`tools/${image.tool}/Dockerfile: ${line}`);
      }
    }
    // Miss one of these and the symlink is never created, so the runtime lines
    // have nothing to copy — the half that actually broke pl-16.
    expect(missing).toEqual([]);
  });

  test("every workspace in the closure has its manifest and `dist` in the runtime stage", () => {
    const missing: string[] = [];
    for (const image of IMAGES) {
      const lines = copyLines(image.runtime);
      for (const dir of image.closure) {
        for (const line of [
          `COPY --from=build /app/${dir}/package.json ${dir}/`,
          `COPY --from=build /app/${dir}/dist ${dir}/dist`,
        ]) {
          if (!lines.includes(line)) missing.push(`tools/${image.tool}/Dockerfile: ${line}`);
        }
      }
    }
    // Miss one of these and the image boots, reports nothing wrong, and throws
    // ERR_MODULE_NOT_FOUND the first time the code path is reached.
    expect(missing).toEqual([]);
  });

  test("neither list ships a workspace the API does not resolve", () => {
    const stale: string[] = [];
    for (const image of IMAGES) {
      const carried = new Set([...image.closure, image.bundledOnly]);
      for (const [stage, section] of [
        ["build", image.preInstall],
        ["runtime", image.runtime],
      ] as const) {
        for (const line of copyLines(section)) {
          for (const match of line.matchAll(
            /(?:^|[\s/])((?:packages|tools\/[^/\s]+)\/[^/\s]+)\//gu,
          )) {
            const dir = match[1];
            if (dir === undefined) continue;
            if (!carried.has(dir)) {
              stale.push(`tools/${image.tool}/Dockerfile (${stage}): ${dir} — ${line}`);
            }
          }
        }
      }
    }
    // So a workspace that stops being used stops being shipped, rather than
    // lingering as a line nobody dares delete.
    expect([...new Set(stale)]).toEqual([]);
  });
});

async function sourcesUnder(dir: string): Promise<{ file: string; text: string }[]> {
  const found: { file: string; text: string }[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
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

/**
 * A subpath is not a package. `@webtools/core/rate-limit` resolves through
 * `@webtools/core`'s `exports` map and ships inside that package's `dist`, so a
 * specifier is reduced to its package name before it is looked up — otherwise the
 * scan reports a workspace that does not exist and blocks on it.
 */
function packageNameOf(specifier: string): string {
  const [scope, name] = specifier.split("/");
  return `${scope}/${name}`;
}

async function readImports(): Promise<{ offenders: string[]; crossed: number }> {
  const offenders: string[] = [];
  let crossed = 0;
  await Promise.all(
    [...WORKSPACES].map(async ([name, workspace]) => {
      const declared = new Set(workspace.dependencies);
      for (const source of await sourcesUnder(workspace.dir)) {
        // Blunt on purpose: within these scopes a quoted string is an import
        // specifier, and matching the quotes rather than the import syntax covers
        // `import`, `import type`, `export … from` and `await import()` without
        // four patterns to keep in step.
        for (const match of source.text.matchAll(
          /["'](@(?:webtools|downloader|planner)\/[^"']+)["']/gu,
        )) {
          const specifier = match[1];
          if (specifier === undefined) continue;
          const dependency = packageNameOf(specifier);
          if (dependency === name) continue;
          crossed += 1;
          if (declared.has(dependency)) continue;
          offenders.push(`${source.file} imports ${dependency}, undeclared in ${name}`);
        }
      }
    }),
  );
  return { offenders: [...new Set(offenders)].toSorted(), crossed };
}

const IMPORTS = await readImports();

/**
 * The closure above is read off `package.json`, so it is worth exactly what those
 * files are worth. pl-16 found `@planner/api` importing both `@planner/itinerary`
 * and `@webtools/core` without declaring either, which is the case where a wrong
 * graph and a wrong Dockerfile agree with each other. This is what makes the walk
 * trustworthy rather than circular, and it is a hygiene rule worth having anyway.
 */
describe("every workspace declares the workspaces it imports", () => {
  test("the scan reached source that imports across workspaces at all", () => {
    // A walk that found nothing would report a clean repo. Every workspace but
    // `packages/core` imports at least a contract, so the real number is dozens.
    expect(IMPORTS.crossed).toBeGreaterThan(WORKSPACES.size);
  });

  test("a bare workspace specifier under `src` is in that package's `dependencies`", () => {
    // `dependencies`, not `devDependencies`: the runtime stage is built after
    // `npm prune --omit=dev`, so a dev-declared import resolves in the repo, in
    // CI and in the build stage, and is missing from the image alone.
    expect(IMPORTS.offenders).toEqual([]);
  });
});
