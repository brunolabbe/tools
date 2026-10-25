/**
 * "A tool never imports from another tool", enforced against the source.
 *
 * `CLAUDE.md` has stated the rule since the second tool arrived, and until
 * repo-127 nothing checked it. `image-closure.test.ts` comes closest and does
 * not: it asks that an import be *declared*, so a `tools/planner` package that
 * imported `@downloader/contract` and listed it in `dependencies` passed, and a
 * relative `../../../downloader/...` import was never looked at at all.
 *
 * The rule matters more since repo-127, because pull requests now run only the
 * vitest projects their paths reach: a planner change runs `planner`, `repo`
 * and `core`, never `downloader`. If the planner could import the downloader,
 * a change to `tools/downloader/contract` would break the planner's suite with
 * nothing in the pull request's CI running it. This scan is what makes that
 * filter sound, and it lives in `core` because `core` is in every list.
 *
 * It reads what `spawn-safety.test.ts` reads — every source file git tracks or
 * would track (`repoSources`), comments blanked (`mask`) — plus every workspace
 * manifest. Off limits to a file is any tool's package scope other than its
 * own tool's, and any relative specifier that lands inside another tool's
 * directory; outside `tools/` (`packages/`, `scripts/`, `.claude/`), every
 * tool's. Which scopes belong to which tool is read off the manifests, so a
 * new tool is covered the day it has one.
 *
 * A source scan, and blunt on purpose, like its two neighbours: it matches the
 * specifier positions — `from`, a bare `import`, `import()`, `require()`,
 * `vi.mock()` and `importActual()` — rather than parsing modules.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { mask } from "./support/spawn-calls.ts";
import { REPO_ROOT, type SourceFile, repoSources, workspaceDirs } from "./support/workspaces.ts";

/** The tool a repo-relative path belongs to, or `null` outside `tools/`. */
function toolOf(file: string): string | null {
  const match = /^tools\/([^/]+)\//u.exec(file);
  return match?.[1] ?? null;
}

/** `@downloader/contract/sub` → `@downloader`; anything unscoped → `null`. */
function scopeOf(specifier: string): string | null {
  return specifier.startsWith("@") ? (specifier.split("/")[0] ?? null) : null;
}

interface Manifest {
  /** The `package.json`'s path, repo-relative with forward slashes. */
  readonly file: string;
  readonly name: string | undefined;
  /** Every key of `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`. */
  readonly dependencies: readonly string[];
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function readManifest(file: string): Manifest | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    return null;
  }
  const json = JSON.parse(text) as { name?: string } & Partial<
    Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>
  >;
  return {
    file,
    name: json.name,
    dependencies: DEPENDENCY_FIELDS.flatMap((field) => Object.keys(json[field] ?? {})),
  };
}

/**
 * Package scope → the tool that owns it, read off every manifest under
 * `tools/`. A scope two tools both claim is a problem in itself, reported
 * rather than silently given to whichever was read last.
 */
function scopeOwners(manifests: readonly Manifest[]): {
  owners: ReadonlyMap<string, string>;
  problems: readonly string[];
} {
  const owners = new Map<string, string>();
  const problems: string[] = [];
  for (const manifest of manifests) {
    const tool = toolOf(manifest.file);
    const scope = manifest.name === undefined ? null : scopeOf(manifest.name);
    if (tool === null || scope === null) continue;
    const first = owners.get(scope);
    if (first !== undefined && first !== tool) {
      problems.push(`${scope} is claimed by both tools/${first} and tools/${tool}`);
      continue;
    }
    owners.set(scope, tool);
  }
  return { owners, problems };
}

/** The positions a module specifier sits in. The quote is captured so it must close the same way. */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\s*\.\s*(?:do)?[mM]ock\s*\(\s*|\bimportActual\s*(?:<[^>()]*>)?\s*\(\s*)(["'`])([^"'`\n]+)\1/gu;

interface Scan {
  readonly offenders: readonly string[];
  /** Specifiers in a tool-owned scope that the file's own tool owns: proof the scan reads real imports. */
  readonly ownScope: number;
}

/** Every import, in `sources` and `manifests`, that crosses from one tool into another. */
function crossToolImports(
  sources: readonly SourceFile[],
  manifests: readonly Manifest[],
  owners: ReadonlyMap<string, string>,
): Scan {
  const offenders: string[] = [];
  let ownScope = 0;

  for (const source of sources) {
    const home = toolOf(source.file);
    const code = mask(source.text, true);
    for (const match of code.matchAll(SPECIFIER)) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      const line = code.slice(0, match.index).split("\n").length;
      const scope = scopeOf(specifier);
      if (scope !== null) {
        const owner = owners.get(scope);
        if (owner === undefined) continue;
        if (owner === home) {
          ownScope += 1;
          continue;
        }
        offenders.push(`${source.file}:${line} imports ${specifier}, which is tools/${owner}'s`);
        continue;
      }
      if (!specifier.startsWith(".")) continue;
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(source.file), specifier),
      );
      const owner = toolOf(target);
      if (owner !== null && owner !== home) {
        offenders.push(
          `${source.file}:${line} imports ${specifier}, which is inside tools/${owner}`,
        );
      }
    }
  }

  for (const manifest of manifests) {
    const home = toolOf(manifest.file);
    for (const dependency of manifest.dependencies) {
      const scope = scopeOf(dependency);
      const owner = scope === null ? undefined : owners.get(scope);
      if (owner !== undefined && owner !== home) {
        offenders.push(`${manifest.file} depends on ${dependency}, which is tools/${owner}'s`);
      }
    }
  }

  return { offenders: [...new Set(offenders)].toSorted(), ownScope };
}

const MANIFESTS = ["package.json", ...(await workspaceDirs()).map((dir) => `${dir}/package.json`)]
  .map(readManifest)
  .filter((manifest) => manifest !== null);
const { owners: OWNERS, problems: OWNER_PROBLEMS } = scopeOwners(MANIFESTS);
const SOURCES = await repoSources();
const SCAN = crossToolImports(SOURCES, MANIFESTS, OWNERS);

describe("no tool imports another tool", () => {
  test("the scan read every tool's scope and the imports inside them", () => {
    // An empty owner map or a regex that matched nothing would pass the
    // assertion below on any tree. Every tool's packages import their own
    // contract, so the real count of own-scope specifiers is in the hundreds.
    expect(OWNER_PROBLEMS).toEqual([]);
    const tools = fs
      .readdirSync(path.join(REPO_ROOT, "tools"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    expect([...new Set(OWNERS.values())].toSorted()).toEqual(tools);
    expect(SCAN.ownScope).toBeGreaterThan(OWNERS.size * 10);
  });

  test("no source file or manifest reaches into a tool it is not part of", () => {
    expect(SCAN.offenders).toEqual([]);
  });
});

/**
 * A scope built at run time, so this file's own text carries no cross-tool
 * specifier for the scan above to find.
 */
function at(name: string): string {
  return `@${name}`;
}

describe("the scan itself", () => {
  const owners = new Map([
    [at("downloader"), "downloader"],
    [at("planner"), "planner"],
  ]);
  const scan = (file: string, text: string): readonly string[] =>
    crossToolImports([{ file, text }], [], owners).offenders;
  const plannerFile = "tools/planner/api/src/a.ts";
  const contract = `${at("downloader")}/contract`;

  test("fails a static, type-only, side-effect, dynamic or mocked import of another tool's package", () => {
    for (const text of [
      `import { AppError } from "${contract}";`,
      `import type { Job } from '${contract}';`,
      `export * from "${contract}/sub";`,
      `import "${contract}";`,
      `const m = await import("${contract}");`,
      `const m = require("${contract}");`,
      `vi.mock("${contract}", () => ({}));`,
      `const real = await vi.importActual<typeof X>("${contract}");`,
    ]) {
      expect(scan(plannerFile, text), text).toHaveLength(1);
    }
  });

  test("fails a relative import that lands in another tool's directory", () => {
    expect(
      scan(plannerFile, `import { x } from "../../../downloader/contract/src/index.ts";`),
    ).toEqual([
      `${plannerFile}:1 imports ../../../downloader/contract/src/index.ts, which is inside tools/downloader`,
    ]);
  });

  test("passes the tool's own scope, a shared package and a relative import inside the tool", () => {
    const text = [
      `import { plan } from "${at("planner")}/contract";`,
      `import { AppError } from "${at("webtools")}/core";`,
      `import { b } from "../../contract/src/b.ts";`,
      `import fs from "node:fs";`,
    ].join("\n");
    expect(scan(plannerFile, text)).toEqual([]);
    expect(crossToolImports([{ file: plannerFile, text }], [], owners).ownScope).toBe(1);
  });

  test("fails any tool's import from outside tools/: packages, scripts, the repo's own tooling", () => {
    expect(
      scan("packages/core/src/a.ts", `import { x } from "${at("planner")}/contract";`),
    ).toHaveLength(1);
    expect(scan("scripts/x.mjs", `import { x } from "${contract}";`)).toHaveLength(1);
    expect(scan(".claude/scripts/x.mjs", `const m = await import("${contract}");`)).toHaveLength(1);
  });

  test("ignores a specifier inside a comment", () => {
    expect(scan(plannerFile, `// once: import { x } from "${contract}";\n`)).toEqual([]);
  });

  test("fails a manifest that depends on another tool's package, in any dependency field", () => {
    const manifests: Manifest[] = [
      {
        file: "tools/planner/api/package.json",
        name: `${at("planner")}/api`,
        dependencies: [contract],
      },
      {
        file: "packages/ui/package.json",
        name: `${at("webtools")}/ui`,
        dependencies: [`${at("planner")}/web`],
      },
      {
        file: "tools/downloader/api/package.json",
        name: `${at("downloader")}/api`,
        dependencies: [contract],
      },
    ];
    expect(crossToolImports([], manifests, owners).offenders).toEqual([
      `packages/ui/package.json depends on ${at("planner")}/web, which is tools/planner's`,
      `tools/planner/api/package.json depends on ${contract}, which is tools/downloader's`,
    ]);
  });

  test("reports a scope two tools both claim", () => {
    const { problems } = scopeOwners([
      { file: "tools/a/api/package.json", name: `${at("shared")}/api`, dependencies: [] },
      { file: "tools/b/api/package.json", name: `${at("shared")}/web`, dependencies: [] },
    ]);
    expect(problems).toEqual([`${at("shared")} is claimed by both tools/a and tools/b`]);
  });
});
