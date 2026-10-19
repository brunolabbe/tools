/**
 * The guard for repo-108: three web UIs share token *names* and keep their own
 * palettes, and without this the names drift apart again within a few tickets
 * (planner and ledger had already copied `--bad` by hand, hex for hex, and
 * spelled "muted" and "danger" differently from the downloader).
 *
 * It reads the real stylesheets, found by glob so a fourth tool is held to the
 * same list the day its `web` has one. The synthetic cases at the end pin that
 * the checker itself fails — without them a regex that matched nothing would
 * pass every real stylesheet.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  COLOUR_ROLES,
  RETIRED_NAMES,
  stripComments,
  vocabularyProblems,
} from "./support/stylesheet.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const TOKENS = path.join(REPO_ROOT, "packages", "ui", "src", "tokens.css");

/** `tools/<tool>/web`, for every tool that has a web package. */
function webDirs(): string[] {
  const tools = path.join(REPO_ROOT, "tools");
  return fs
    .readdirSync(tools, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tools, entry.name, "web"))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .toSorted();
}

const WEBS = webDirs();
const rel = (file: string): string => path.relative(REPO_ROOT, file).replaceAll("\\", "/");

/** Every `.css`, `.ts` and `.tsx` under a web package's `src`. */
function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(dir, "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:css|tsx?)$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("the web UIs share one colour vocabulary", () => {
  test("the scan found the three web packages it is meant to guard", () => {
    // A glob that matched nothing would pass everything below.
    expect(WEBS.map((dir) => path.basename(path.dirname(dir)))).toEqual(
      expect.arrayContaining(["downloader", "ledger", "planner"]),
    );
  });

  test("every stylesheet sets every canonical colour role, in light and in dark", () => {
    const problems = WEBS.flatMap((dir) => {
      const file = path.join(dir, "src", "styles.css");
      return vocabularyProblems(fs.readFileSync(file, "utf8")).map(
        (problem) => `${rel(file)}: ${problem}`,
      );
    });
    expect(problems).toEqual([]);
  });

  test("no web source uses a retired name", () => {
    const offenders: string[] = [];
    for (const dir of WEBS) {
      for (const file of sourceFiles(dir)) {
        const text = stripComments(fs.readFileSync(file, "utf8"));
        for (const name of RETIRED_NAMES) {
          if (new RegExp(String.raw`(?<![\w-])${name}(?![\w-])`, "u").test(text)) {
            offenders.push(`${rel(file)} uses ${name}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("each web package adopts the shared tokens", () => {
  test("declares @webtools/ui in dependencies", () => {
    const missing = WEBS.filter((dir) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      return manifest.dependencies?.["@webtools/ui"] === undefined;
    }).map(rel);
    expect(missing).toEqual([]);
  });

  test("main.tsx imports tokens.css before its own stylesheet", () => {
    const problems: string[] = [];
    for (const dir of WEBS) {
      const text = fs.readFileSync(path.join(dir, "src", "main.tsx"), "utf8");
      const tokens = text.indexOf('import "@webtools/ui/tokens.css"');
      const own = text.indexOf('import "./styles.css"');
      if (tokens === -1) problems.push(`${rel(dir)}/src/main.tsx does not import tokens.css`);
      else if (own !== -1 && tokens > own) {
        problems.push(`${rel(dir)}/src/main.tsx imports tokens.css after ./styles.css`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("tokens.css", () => {
  const css = fs.readFileSync(TOKENS, "utf8");

  test("holds no colour value: the palette belongs to each tool", () => {
    const body = stripComments(css);
    expect(body.match(/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/giu)).toBeNull();
  });

  test("names every canonical colour role in its header, so the doc and the guard agree", () => {
    const header = css.slice(0, css.indexOf("*/"));
    const missing = COLOUR_ROLES.filter(
      (role) => !new RegExp(`${role}(?![\\w-])`, "u").test(header),
    );
    expect(missing).toEqual([]);
  });

  test("declares the non-colour names the tools read", () => {
    const body = stripComments(css);
    const missing = [
      "--radius",
      "--gap",
      "--page-width",
      "--space-1",
      "--font-sans",
      "--font-mono",
      "--font-size-base",
    ].filter((name) => !new RegExp(`${name}\\s*:`, "u").test(body));
    expect(missing).toEqual([]);
  });
});

const full = (names: readonly string[]): string =>
  names.map((name) => `${name}: #000;`).join("\n  ");

describe("the checker itself", () => {
  const sheet = (light: readonly string[], dark: readonly string[], rest = ""): string => `
:root {
  ${full(light)}
}

@media (prefers-color-scheme: dark) {
  :root {
    ${full(dark)}
  }
}
${rest}`;

  test("accepts a stylesheet that sets every role in both themes", () => {
    expect(vocabularyProblems(sheet(COLOUR_ROLES, COLOUR_ROLES))).toEqual([]);
  });

  test("fails when a canonical role is missing from the dark override only", () => {
    const dark = COLOUR_ROLES.filter((role) => role !== "--ok");
    expect(vocabularyProblems(sheet(COLOUR_ROLES, dark))).toEqual([
      "dark `:root` override does not set --ok",
    ]);
  });

  test("fails when a canonical role is missing from the light root only", () => {
    const light = COLOUR_ROLES.filter((role) => role !== "--surface-2");
    expect(vocabularyProblems(sheet(light, COLOUR_ROLES))).toEqual([
      "light `:root` does not set --surface-2",
    ]);
  });

  test("fails on a retired name, but not on the name that contains it", () => {
    const withMuted = sheet(COLOUR_ROLES, COLOUR_ROLES, ".x { color: var(--muted); }");
    expect(vocabularyProblems(withMuted)).toEqual(["uses the retired name --muted"]);
    const withBad = sheet(COLOUR_ROLES, COLOUR_ROLES, ".x { color: var(--bad); }");
    expect(vocabularyProblems(withBad)).toEqual(["uses the retired name --bad"]);
    // `--text-muted` ends in `-muted`; a retired-name match must not claim it.
    const clean = sheet(COLOUR_ROLES, COLOUR_ROLES, ".x { color: var(--text-muted); }");
    expect(vocabularyProblems(clean)).toEqual([]);
  });

  test("a role named only in a comment is not set", () => {
    const light = `/* ${COLOUR_ROLES.join(": 0; ")}: 0; */`;
    const css = `:root {\n  ${light}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    ${full(COLOUR_ROLES)}\n  }\n}\n`;
    expect(vocabularyProblems(css)).toContain("light `:root` does not set --bg");
  });

  test("a stylesheet with no dark override says so", () => {
    expect(vocabularyProblems(`:root {\n  ${full(COLOUR_ROLES)}\n}\n`)).toEqual([
      "no dark `:root` override block found",
    ]);
  });
});
