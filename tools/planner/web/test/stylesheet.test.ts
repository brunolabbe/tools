/**
 * What the stylesheet says, since jsdom cannot show it (pl-59).
 *
 * jsdom draws no CSS, so two defects that arrived with pl-10 failed no test for
 * two months: `.plans li` read `var(--line)`, a name nothing defines, so its
 * border never rendered; and the provenance marks were coloured for a light page
 * and drawn unchanged on a dark one. A `var()` that resolves to nothing is silent
 * in CSS, in jsdom and in every other test this tool has, so this reads the
 * stylesheet text, and the shared tokens file it imports, and checks the two
 * things that text can settle: that every name a rule reads is defined, and that
 * the mark colours clear the WCAG bar on the surfaces they are drawn on.
 *
 * It is a reading of the text, not of rendered pixels: it cannot see a cascade
 * override, a forced-colors mode or a screenshot. The synthetic cases at the end
 * pin that the checkers fail on a bad stylesheet; without them a regex that
 * matched nothing would pass the real one.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const WEB = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB, "..", "..", "..");
const STYLES = path.join(WEB, "src", "styles.css");
const TOKENS = path.join(REPO_ROOT, "packages", "ui", "src", "tokens.css");

/** WCAG 2.x AA for text below "large": the marks are 0.7rem bold, which is not. */
const AA_NORMAL_TEXT = 4.5;

const stripComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

/** Every `--name` declared as a property (`--name:`), anywhere in the text. */
function definedNames(css: string): Set<string> {
  return new Set(
    [...stripComments(css).matchAll(/(?<![\w-])(--[\w-]+)\s*:/gu)].map((m) => m[1] ?? ""),
  );
}

/**
 * Every `var(--name)` with no fallback. One with a fallback survives an
 * undefined name by design, so it is not this check's business. The `i` flag is
 * because CSS function names are case-insensitive: `VAR(--x)` is a read.
 */
function varsWithoutFallback(css: string): string[] {
  return [...stripComments(css).matchAll(/var\(\s*(--[\w-]+)\s*\)/giu)].map((m) => m[1] ?? "");
}

/** The `color` a rule with exactly this selector declares, or undefined. */
function ruleColour(css: string, selector: string): string | undefined {
  const escaped = selector.replaceAll(/[.\\^$*+?()[\]{}|]/gu, String.raw`\$&`);
  const rule = new RegExp(String.raw`(?<![\w.#-])${escaped}\s*\{([^}]*)\}`, "u").exec(
    stripComments(css),
  );
  return /(?<![\w-])color\s*:\s*([^;]+);/u.exec(rule?.[1] ?? "")?.[1]?.trim();
}

/** The names a stylesheet reads with no fallback and that nothing in `files` defines. */
function undefinedVars(css: string, ...definedIn: string[]): string[] {
  const defined = definedNames([css, ...definedIn].join("\n"));
  return [...new Set(varsWithoutFallback(css))].filter((name) => !defined.has(name)).toSorted();
}

type Theme = "light" | "dark";

/**
 * The `--name: value` pairs of a theme's `:root`: the first bare `:root` block is
 * light, the one inside `@media (prefers-color-scheme: dark)` is dark.
 */
function themeValues(css: string, theme: Theme): Map<string, string> {
  const text = stripComments(css);
  const block =
    theme === "dark"
      ? /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/u.exec(text)
      : /(?:^|\})\s*:root\s*\{([^}]*)\}/u.exec(text);
  if (!block?.[1]) throw new Error(`no ${theme} :root block found`);
  return new Map(
    [...block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map((m) => [
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ]),
  );
}

function themeColour(css: string, theme: Theme, name: string): string {
  const value = themeValues(css, theme).get(name);
  if (!value || !/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new Error(`${theme} ${name} is ${JSON.stringify(value)}, not a #rrggbb colour`);
  }
  return value.toLowerCase();
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const styles = fs.readFileSync(STYLES, "utf8");
const tokens = fs.readFileSync(TOKENS, "utf8");

describe("every name the stylesheet reads is defined", () => {
  test("a var() with no fallback names a custom property someone declares", () => {
    // `--line` was this list's one member until pl-59: the plans-list border read
    // it, nothing defined it, and the border never drew.
    expect(undefinedVars(styles, tokens)).toEqual([]);
  });

  test("the shared tokens file's own no-fallback reads are defined too", () => {
    // `tokens.css` reads `--bg` and `--text` on `body`; the tool's stylesheet
    // defines them, so it is passed as a place a name may be defined.
    expect(varsWithoutFallback(tokens)).toEqual(expect.arrayContaining(["--bg", "--text"]));
    expect(undefinedVars(tokens, styles)).toEqual([]);
  });

  test("the scan found the names it is meant to read", () => {
    // A regex that matched nothing would pass the test above.
    const read = varsWithoutFallback(styles);
    expect(read.length).toBeGreaterThan(30);
    expect(read).toEqual(expect.arrayContaining(["--border", "--surface", "--gap", "--radius"]));
    // Shared names come from the tokens file, not the tool's own stylesheet.
    expect(definedNames(styles).has("--gap")).toBe(false);
    expect(definedNames(tokens).has("--gap")).toBe(true);
  });
});

describe("the provenance marks are readable on the surface they sit on", () => {
  const marks = ["--ok", "--warn"] as const;
  // `ProvenanceNote` renders inside `section.panel.plan`, whose background is
  // `--surface`; `--bg` is the page behind it.
  const backgrounds = ["--surface", "--bg"] as const;

  for (const theme of ["light", "dark"] as const) {
    for (const mark of marks) {
      for (const background of backgrounds) {
        test(`${theme} ${mark} on ${background} clears ${AA_NORMAL_TEXT}:1`, () => {
          const ratio = contrast(
            themeColour(styles, theme, mark),
            themeColour(styles, theme, background),
          );
          expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });
      }
    }
  }

  test("each mark rule is coloured by the token the contrast tests measure", () => {
    // The tests above read the tokens, so a mark recoloured with a literal or
    // another token would leave them green with the marks unmeasured.
    expect(ruleColour(styles, ".provenance.grounded .mark")).toBe("var(--ok)");
    expect(ruleColour(styles, ".provenance.asserted .mark")).toBe("var(--warn)");
  });

  test("the two marks stay apart from each other and from the accent and the danger colour", () => {
    // Telling a sourced line from an unverified one is the marks' only job.
    for (const theme of ["light", "dark"] as const) {
      const colours = ["--ok", "--warn", "--accent", "--danger"].map((name) =>
        themeColour(styles, theme, name),
      );
      expect(new Set(colours).size, `${theme}: ${colours.join(" ")}`).toBe(colours.length);
    }
  });
});

describe("the checkers fail on a bad stylesheet", () => {
  test("an undefined var() with no fallback is named", () => {
    const css = ".a { border: 1px solid var(--line); color: var(--text); } :root { --text: #000; }";
    expect(undefinedVars(css)).toEqual(["--line"]);
  });

  test("an upper-case VAR() is still a read", () => {
    expect(undefinedVars(".a { color: VAR(--nonexistent); }")).toEqual(["--nonexistent"]);
  });

  test("a rule's colour is read by its exact selector", () => {
    const css = ".a .mark { color: red; } .a.b .mark { color: var(--ok); }";
    expect(ruleColour(css, ".a.b .mark")).toBe("var(--ok)");
    expect(ruleColour(css, ".b .mark")).toBeUndefined();
  });

  test("a name defined only in a comment is not defined", () => {
    expect(undefinedVars("/* --line: red; */ .a { color: var(--line); }")).toEqual(["--line"]);
  });

  test("a name the shared file defines counts, and one with a fallback is not read", () => {
    expect(
      undefinedVars(".a { gap: var(--gap); color: var(--nope, red); }", ":root { --gap: 1rem; }"),
    ).toEqual([]);
  });

  test("the contrast formula returns the known extremes and a known pair", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    // The pre-pl-59 dark mark on the dark surface, from the filing's measurement.
    expect(contrast("#2f6f4f", "#201d16")).toBeCloseTo(2.81, 2);
    expect(contrast("#8a6d1f", "#201d16")).toBeCloseTo(3.43, 2);
  });

  test("a dark theme that reuses a light-page colour fails the bar", () => {
    const css =
      ":root { --ok: #2f6f4f; --surface: #ffffff; } @media (prefers-color-scheme: dark) { :root { --ok: #2f6f4f; --surface: #201d16; } }";
    expect(
      contrast(themeColour(css, "light", "--ok"), themeColour(css, "light", "--surface")),
    ).toBeGreaterThan(AA_NORMAL_TEXT);
    expect(
      contrast(themeColour(css, "dark", "--ok"), themeColour(css, "dark", "--surface")),
    ).toBeLessThan(AA_NORMAL_TEXT);
  });
});
