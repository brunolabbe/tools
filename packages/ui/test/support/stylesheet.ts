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
 * override. The header of `src/tokens.css` lists the same set for a human, and
 * `tokens.test.ts` asserts the two are equal in both directions, so a role added
 * to one and not the other fails there.
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

/**
 * The role names `tokens.css`'s header lists. A line is a role entry when its
 * first token after the comment margin starts with `--`, whatever the
 * whitespace around it (any indent, tabs, a long name that leaves one space, no
 * description, CRLF), and every `--name` on an entry line counts as listed, so
 * a second role squeezed onto one line is read rather than skipped. Reading
 * generously is the point: a layout this does not recognise would be listed for
 * a human and enforced by nothing. A role named inside a prose sentence is not
 * an entry, by design: only a line that starts with the name is.
 */
export function headerRoles(tokensCss: string): string[] {
  const header = tokensCss.slice(0, tokensCss.indexOf("*/"));
  const roles = new Set<string>();
  for (const line of header.split(/\r?\n/u)) {
    if (!/^\s*\*[ \t]+--/u.test(line)) continue;
    for (const match of line.matchAll(/--[\w-]+/gu)) roles.add(match[0]);
  }
  return [...roles];
}

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
