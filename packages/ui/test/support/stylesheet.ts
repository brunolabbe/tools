/**
 * Reading just enough CSS to hold three tools to one vocabulary (repo-108).
 *
 * Not a parser: it strips comments, finds a block by its header and matches
 * braces. That is exactly the shape the tools' stylesheets use for their tokens,
 * and anything that stops fitting it fails the guard loudly (a block "not found")
 * rather than passing quietly.
 */

/**
 * The colour roles every tool sets, in its light `:root` and again in its dark
 * override. Keep in step with the header of `src/tokens.css`, which the guard
 * also reads, so the list a human sees and the list the test enforces cannot
 * part.
 */
export const COLOUR_ROLES = [
  "--bg",
  "--surface",
  "--surface-2",
  "--border",
  "--text",
  "--text-muted",
  "--accent",
  "--accent-text",
  "--ok",
  "--warn",
  "--danger",
] as const;

/** Names that were retired for the canonical ones: `--muted` is `--text-muted`, `--bad` is `--danger`. */
export const RETIRED_NAMES = ["--muted", "--bad"] as const;

export function stripComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

/**
 * The text between the braces of the first block whose header matches, or null.
 * The header must start a line at the margin: the light tokens are a top-level
 * `:root`, and the dark ones are indented inside their `@media`, so a bare
 * `:root` search cannot mistake the one for the other.
 */
export function blockAfter(css: string, header: RegExp): string | null {
  const match = header.exec(css);
  if (match === null) return null;
  const open = css.indexOf("{", match.index + match[0].length - 1);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

/** Custom properties declared directly in a block, nested rules excluded. */
export function declaredProperties(block: string): Set<string> {
  const names = new Set<string>();
  let depth = 0;
  let top = "";
  for (const char of block) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (depth === 0) top += char;
  }
  for (const match of top.matchAll(/(--[\w-]+)\s*:/gu)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return names;
}

export function lightRoot(css: string): string | null {
  return blockAfter(stripComments(css), /^:root\s*\{/mu);
}

export function darkRoot(css: string): string | null {
  const media = blockAfter(
    stripComments(css),
    /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/mu,
  );
  return media === null ? null : blockAfter(media, /:root\s*\{/u);
}

/** Every way a stylesheet departs from the shared vocabulary, as sentences. */
export function vocabularyProblems(css: string): string[] {
  const problems: string[] = [];
  for (const [label, block] of [
    ["light `:root`", lightRoot(css)],
    ["dark `:root` override", darkRoot(css)],
  ] as const) {
    if (block === null) {
      problems.push(`no ${label} block found`);
      continue;
    }
    const declared = declaredProperties(block);
    for (const role of COLOUR_ROLES) {
      if (!declared.has(role)) problems.push(`${label} does not set ${role}`);
    }
  }
  const body = stripComments(css);
  for (const name of RETIRED_NAMES) {
    // Not preceded by a word character or a hyphen, so `--text-muted` is not `--muted`.
    if (new RegExp(String.raw`(?<![\w-])${name}(?![\w-])`, "u").test(body)) {
      problems.push(`uses the retired name ${name}`);
    }
  }
  return problems;
}
