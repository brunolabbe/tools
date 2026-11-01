/**
 * Reading the selectors of a stylesheet, for the base layer's guard (repo-130).
 *
 * Like `stylesheet.ts` it is not a parser: it strips comments and walks braces,
 * treats a prelude that starts with `@` (a `@media`) as a wrapper to look
 * inside, and leaves declarations alone because they end in `;` or `}` before
 * any `{`. A shape that stops fitting it fails the guard loudly rather than
 * passing quietly: the guard's own cases pin that.
 */

import { stripComments } from "./stylesheet.ts";

/** The text before each `{` that opens a style rule, in order: no at-rules, no declarations. */
function preludes(css: string): string[] {
  const found: string[] = [];
  let buffer = "";
  for (const char of stripComments(css)) {
    if (char === "{") {
      const prelude = buffer.trim();
      if (!prelude.startsWith("@")) found.push(prelude);
      buffer = "";
    } else if (char === "}" || char === ";") {
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return found;
}

/** The top-level, comma-separated pieces of a selector list: a comma inside parentheses or brackets is not one. */
function splitTopLevel(list: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      pieces.push(list.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(list.slice(start));
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== "");
}

/** A selector that is one `:where(...)` is its inner list; any other selector is itself. */
function unwrapWhere(selector: string): string[] {
  const open = ":where(";
  if (!selector.startsWith(open)) return [selector];
  let depth = 0;
  for (let i = open.length - 1; i < selector.length; i += 1) {
    if (selector[i] === "(") depth += 1;
    if (selector[i] === ")") depth -= 1;
    if (depth === 0) {
      // A `:where(...)` followed by more (`:where(a):hover`) is not one wrapper.
      return i === selector.length - 1 ? splitTopLevel(selector.slice(open.length, i)) : [selector];
    }
  }
  return [selector];
}

const squash = (selector: string): string => selector.replaceAll(/\s+/gu, " ").trim();

/**
 * Every selector a stylesheet's rules are written against, with a wrapping
 * `:where(...)` removed and its list split, and whitespace collapsed: so
 * `:where(button, .button)` in the base and `button,\n.button` in a tool both
 * read as `button` and `.button`.
 */
export function ruleSelectors(css: string): string[] {
  return preludes(css)
    .flatMap((prelude) => splitTopLevel(prelude))
    .flatMap((selector) => unwrapWhere(selector))
    .map((selector) => squash(selector));
}

/** The selectors of `base` that `own` declares again, however each spells its whitespace and grouping. */
export function redeclaredSelectors(base: string, own: string): string[] {
  const shared = new Set(ruleSelectors(base));
  return [...new Set(ruleSelectors(own).filter((selector) => shared.has(selector)))];
}

/** The selectors in `base` that are not wrapped in `:where()`, so carry specificity a tool's class would have to beat. */
export function selectorsWithSpecificity(base: string): string[] {
  return preludes(base)
    .flatMap((prelude) => splitTopLevel(prelude))
    .filter(
      (selector) => unwrapWhere(selector).length === 1 && unwrapWhere(selector)[0] === selector,
    )
    .map((selector) => squash(selector));
}
