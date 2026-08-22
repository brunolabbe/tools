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
 * Which is why nothing here throws or asserts while the module is loading. A
 * scan that cannot read what it was pointed at has found something, and that
 * something deserves a named failing test like anything else it finds: an
 * `expect` at module scope takes the whole file down at collection instead, so
 * every test below vanishes from the report together and the run reads as a
 * broken suite rather than as a Dockerfile this scan did not understand — the
 * same mistaken-for-something-else failure the rule itself exists to stop.
 * Reading therefore only gathers, and what it could not read is asserted like
 * everything else.
 *
 * **It does not replace the image gate.** A scan over text proves the list is
 * complete. It cannot prove the image boots, that the native `better-sqlite3`
 * binary meets the glibc it was linked against, or that `/api/health` answers.
 * What it buys is that the commonest way that job fails is caught in seconds by
 * `npm test` rather than in minutes by a container that will not start — and
 * caught as itself, rather than as thirty seconds of `curl: (7)` that reads like
 * an infrastructure flake.
 */

import path from "node:path";
import { describe, expect, test } from "vitest";
import { readFileOrNull, REPO_ROOT, sourcesUnder, workspaceDirs } from "./support/workspaces.ts";

interface Workspace {
  /** Repo-relative, forward slashes — the form both Dockerfiles use. */
  readonly dir: string;
  /** Workspace members of `dependencies` only: `npm prune --omit=dev` drops the rest. */
  readonly dependencies: readonly string[];
}

interface WorkspaceScan {
  readonly workspaces: ReadonlyMap<string, Workspace>;
  /** The scopes this repo owns, read off the workspaces rather than listed here twice. */
  readonly scopes: ReadonlySet<string>;
  readonly problems: readonly string[];
}

/** `@webtools/core/rate-limit` and `@webtools/core` share a scope: `@webtools`. */
function scopeOf(specifier: string): string {
  return specifier.split("/")[0] ?? specifier;
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

async function readWorkspaces(): Promise<WorkspaceScan> {
  const found = await Promise.all(
    (await workspaceDirs()).map(async (dir) => {
      const text = await readFileOrNull(path.join(REPO_ROOT, dir, "package.json"));
      // A directory beside the workspaces that is not one has no manifest.
      if (text === null) return null;
      const manifest = JSON.parse(text) as { name?: string; dependencies?: Record<string, string> };
      if (manifest.name === undefined) return null;
      return { dir, name: manifest.name, dependencies: Object.keys(manifest.dependencies ?? {}) };
    }),
  );

  // Sorted, so which of two colliding directories is reported as the intruder
  // does not depend on which read happened to finish first.
  const manifests = found
    .filter((manifest) => manifest !== null)
    .toSorted((a, b) => a.dir.localeCompare(b.dir));
  const scopes = new Set(manifests.map((manifest) => scopeOf(manifest.name)));

  const workspaces = new Map<string, Workspace>();
  const problems: string[] = [];
  for (const { dir, name, dependencies } of manifests) {
    const first = workspaces.get(name);
    // Two directories claiming one name shadow each other, and the loser is then
    // never checked against either Dockerfile list — a gate that passes because
    // it quietly stopped looking at one of the things it was pointed at.
    if (first !== undefined) {
      problems.push(
        `${dir}/package.json and ${first.dir}/package.json both call themselves ${name}`,
      );
      continue;
    }
    workspaces.set(name, {
      dir,
      dependencies: dependencies.filter((dep) => scopes.has(scopeOf(dep))),
    });
  }
  return { workspaces, scopes, problems };
}

const {
  workspaces: WORKSPACES,
  scopes: SCOPES,
  problems: WORKSPACE_PROBLEMS,
} = await readWorkspaces();

interface Closure {
  readonly dirs: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Every workspace Node has to resolve at runtime, walked declaratively from the
 * API's own manifest — `api` → `agent` → `contract` → `@webtools/core`. It needs
 * no build and no Docker, and it is exactly the set the image must carry.
 *
 * A closure computed from `package.json` is only as good as those files, which is
 * what `declares every workspace it imports` below is for.
 */
function closureFrom(root: string): Closure {
  // The root is named by convention — `tools/<tool>/api` is where every tool
  // here puts its service — and a tool that puts it somewhere else should be
  // told that, rather than told its own API is a dependency it never declared.
  if (!WORKSPACES.has(root)) {
    return {
      dirs: [],
      problems: [
        `${root} is not a workspace: this scan finds a tool's service by name, so a tool whose ` +
          `API package is called something else needs that convention taught to closureFrom`,
      ],
    };
  }

  const seen = new Set<string>();
  // Order is irrelevant — the answer is a set of directories — so this pops from
  // the end, which makes it depth-first rather than the queue it reads like.
  const pending = [root];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (seen.has(name)) continue;
    seen.add(name);
    pending.push(...(WORKSPACES.get(name)?.dependencies ?? []));
  }

  const dirs: string[] = [];
  const problems: string[] = [];
  for (const name of seen) {
    const workspace = WORKSPACES.get(name);
    if (workspace === undefined) {
      problems.push(`${name} is depended on by a workspace in this repo but is not one`);
      continue;
    }
    dirs.push(workspace.dir);
  }
  return { dirs, problems };
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

interface ImageScan {
  readonly images: readonly ToolImage[];
  readonly problems: readonly string[];
}

/** Whitespace is not the subject; a line differing only in spacing is the same line. */
function copyLines(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.trim().replaceAll(/\s+/gu, " "))
    .filter((line) => line.startsWith("COPY "));
}

/**
 * Where a named stage begins. Docker stage names are case-insensitive and the
 * line may carry a trailing comment, so both are tolerated — neither is this
 * scan's business to legislate. The name still has to end the line, because
 * `AS runtime-arm64` is a different stage rather than a spelling of this one.
 */
function stageStart(text: string, stage: string): number {
  return text.search(new RegExp(String.raw`^FROM\b.+\bAS\s+${stage}\s*(?:#.*)?$`, "imu"));
}

async function readImages(): Promise<ImageScan> {
  const tools = [
    ...new Set(
      (await workspaceDirs())
        .filter((dir) => dir.startsWith("tools/"))
        .map((dir) => dir.split("/")[1] ?? ""),
    ),
  ].toSorted();

  const problems: string[] = [];
  const images: ToolImage[] = [];

  for (const tool of tools) {
    // oxlint-disable-next-line no-await-in-loop
    const text = await readFileOrNull(path.join(REPO_ROOT, "tools", tool, "Dockerfile"));
    // A tool with no image is not releasable yet; that is step 7 of adding one
    // rather than something for this scan to fail over.
    if (text === null) continue;

    const where = `tools/${tool}/Dockerfile`;
    // The two Dockerfiles are not the same file and must not become one — the
    // downloader's is built on Playwright's image and carries Chromium and
    // ffmpeg, the planner's is a plain Node base. Each is read rather than
    // assumed; what they share is naming their two stages.
    const build = stageStart(text, "build");
    const runtime = stageStart(text, "runtime");
    if (build === -1) {
      problems.push(`${where}: no \`AS build\` stage, so this scan cannot find its manifest list`);
      continue;
    }
    if (runtime <= build) {
      problems.push(`${where}: no \`AS runtime\` stage after the build stage`);
      continue;
    }

    // The build stage copies the whole tool directory further down, so the only
    // manifests that matter are the ones `npm ci` can see: the install is what
    // creates the workspace symlinks, and it runs before that copy. Searched
    // from the build stage rather than from the top of the file, so an install
    // in some earlier stage cannot silently truncate the section — and tolerant
    // of `npm ci` sharing its `RUN` with something else, which is a layer-count
    // decision rather than anything this rule has an opinion about.
    const offset = text.slice(build).search(/^\s*RUN\b[^\n]*\bnpm ci\b/mu);
    const install = offset === -1 ? -1 : build + offset;
    if (install === -1 || install > runtime) {
      problems.push(`${where}: no \`npm ci\` in the build stage`);
      continue;
    }

    const closure = closureFrom(`@${tool}/api`);
    if (closure.problems.length > 0) {
      problems.push(...closure.problems.map((problem) => `${where}: ${problem}`));
      continue;
    }

    images.push({
      tool,
      closure: closure.dirs,
      bundledOnly: `tools/${tool}/web`,
      preInstall: text.slice(build, install),
      runtime: text.slice(runtime),
    });
  }

  return { images, problems };
}

const { images: IMAGES, problems: IMAGE_PROBLEMS } = await readImages();

describe("each tool's image carries every workspace its API resolves", () => {
  test("the scan could read every workspace and every Dockerfile it found", () => {
    // First, because each of these is a way for the lists below to be checked
    // against less than they were meant to be — and a Dockerfile this scan does
    // not understand should say so in those words rather than as a suite that
    // would not load.
    expect([...WORKSPACE_PROBLEMS, ...IMAGE_PROBLEMS]).toEqual([]);
  });

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
        // four patterns to keep in step. Which scopes those are comes from the
        // workspaces themselves, so a new tool is in scope the day it has a
        // manifest rather than the day somebody remembers this line.
        for (const match of source.text.matchAll(/["'](@[^"'/]+\/[^"']+)["']/gu)) {
          const specifier = match[1];
          if (specifier === undefined) continue;
          if (!SCOPES.has(scopeOf(specifier))) continue;
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
