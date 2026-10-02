/**
 * The per-call half of the "never invoke a shell" scan (repo-83).
 *
 * `spawn-safety.test.ts` used to ask whether `shell: false` appeared anywhere in
 * a file that spawns. A file with nine `spawnSync` calls and one `shell: false`
 * string passed in full, and the other eight calls were never individually
 * asked. This asks each call.
 *
 * **What counts as a call saying `shell: false`.** One of the call's arguments
 * after the first is an object literal whose own, top-level `shell` property
 * ends up `false` — the last one wins, so `{ ...BASE, shell: !0 }` is not — or
 * an identifier bound to such a literal in the same file. A literal may get its
 * `false` from a spread of another such identifier (`const options =
 * { ...GIT_EXEC_OPTIONS, stdio }`, with `shell: false` one binding further up).
 * A name counts only if *every* declaration of it in the file is such a literal
 * and nothing assigns to it afterwards, so two functions each declaring
 * `options` cannot lend each other their `shell: false`. A spread of a name the
 * file declares with a `shell` that is not `false`, or of an inline expression
 * whose object literal carries one, takes the `false` away again.
 *
 * **What it reads.** Source with comments blanked and, for everything but the
 * import test, string, template and regex literal contents blanked too (`mask`),
 * so a `/*` inside a string does not swallow the code up to the next `*\/`, and
 * `shell: false` in a string argument, a JSON payload or a nested `env` object
 * is not taken for the option.
 *
 * **Limits.** Each is a fixture row in `spawn-safety.test.ts`'s "every limit the
 * header names behaves as it says", so what follows is checked, not asserted.
 * Two occur in the tree and pass for the right reason: an injected parameter
 * named `spawn` in `review-record.mjs` is checked like the real function and
 * says `shell: false`, and four calls in the downloader spread an inline
 * conditional — `...(cwd ? { cwd } : {})` in three, `...(extraEnv === undefined
 * ? {} : { env })` in `ytdlp.ts` — which carries no `shell` and so changes
 * nothing.
 *
 * Reported when they are not, so the fix is to say `shell: false` at the call:
 * - a call is matched by name, so a parameter that happens to be called `spawn`
 *   is checked like the real one (`preflight.mjs`'s injected runner was renamed
 *   for it), and so is `cp.spawnSync(…)`; `{ spawnSync: run }` and
 *   `spawnSync as run` are followed;
 * - options built by a function call, destructured, imported or computed.
 *
 * **Passed without being looked at — a miss, not a check:**
 * - `const run = cp.spawnSync` is not followed, nor are `cp["spawnSync"](…)`,
 *   `promisify(execFile)` and `fork`; `exec` and `execSync` through a namespace
 *   or default import are not asked either — they are banned only as a named
 *   import, by `spawn-safety.test.ts`'s own test;
 * - a spread after a `shell: false` is trusted not to carry a `shell` unless
 *   the file declares the name as an object literal that does: `...options` for
 *   a parameter or an import, `...OTHER` for `const OTHER = make()`, or for an
 *   `OTHER` declared `{}` and later reassigned with a `shell`, and
 *   `...make()`, are all trusted;
 * - which argument is "the options" is not worked out: a later argument that is
 *   a safe literal or a safe name excuses the call, whatever the others say;
 * - a `/` after `}` is read as the start of a regex, which blanks the rest of
 *   its line, call included; a regex after `)` is read as division, so a quote
 *   in it opens a string that runs to the end of the line. A template's `${}`
 *   is code, a nested template included.
 *
 * Not a `src` module for the same reason `workspaces.ts` is not: it is
 * scaffolding for one test, and `tsconfig.tests.json` typechecks it with it.
 */

/**
 * Every member of `node:child_process` that takes an argument array and a
 * `shell` option. A guard test asserts this list against fixtures, so narrowing
 * it back to `spawn` alone fails loudly rather than passing every file, which
 * is what it did when repo-77 widened it and nothing else noticed.
 */
export const SPAWN_CALLS: readonly string[] = ["spawn", "spawnSync", "execFile", "execFileSync"];

export interface UnsafeCall {
  /** 1-based, in the text as given, so it matches what an editor shows. */
  readonly line: number;
  /** The call as written, whitespace collapsed and cut short for a failure message. */
  readonly call: string;
}

/** `from "node:child_process"`, the bare specifier, `require(…)` and `import(…)`. */
const CHILD_PROCESS_IMPORT =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(["'])(?:node:)?child_process\1/u;

/** After these a `/` starts a regex literal; after anything else it divides. */
const REGEX_AFTER_PUNCTUATION = /[(,=:[!&|?{};+\-*%<>~^]/u;
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "case",
  "delete",
  "void",
  "throw",
  "in",
  "of",
  "instanceof",
  "new",
  "else",
  "do",
]);

/**
 * `text` with its comments blanked to spaces — and, unless `keepLiterals`, its
 * string, template and regex literal contents too, the delimiters kept — with
 * every newline and every index unchanged, so a line number survives.
 *
 * A single pass that knows what a string is, which the regex pair it replaces
 * did not: `"docs/work/*.md"` opened a block comment that ran to the next `*\/`,
 * and four real calls in `citations-gate.test.ts` were never checked (repo-83,
 * gate 1). `spawn-safety.test.ts`'s `code()` is this too.
 */
export function mask(text: string, keepLiterals = false): string {
  const out = [...text];
  const { length } = text;
  const blankRange = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  const blankLiteral = (from: number, to: number): void => {
    if (!keepLiterals) blankRange(from, to);
  };

  /** Past the closing backtick of the template starting at `start`. */
  function template(start: number): number {
    let chunk = start + 1;
    let j = chunk;
    while (j < length) {
      const char = text[j];
      if (char === "\\") j += 2;
      else if (char === "`") {
        blankLiteral(chunk, j);
        return j + 1;
      } else if (char === "$" && text[j + 1] === "{") {
        blankLiteral(chunk, j);
        j = code(j + 2, true);
        chunk = j;
      } else j += 1;
    }
    blankLiteral(chunk, length);
    return length;
  }

  /** Code from `start`; inside a template's `${}` it stops after the matching `}`. */
  function code(start: number, inExpression: boolean): number {
    let depth = 0;
    let previous = "";
    let word = "";
    let previousWord = "";
    let i = start;
    while (i < length) {
      const char = text[i] ?? "";
      const next = text[i + 1];
      if (char === "/" && next === "/") {
        const end = text.indexOf("\n", i);
        const stop = end === -1 ? length : end;
        blankRange(i, stop);
        i = stop;
      } else if (char === "/" && next === "*") {
        const end = text.indexOf("*/", i + 2);
        const stop = end === -1 ? length : end + 2;
        blankRange(i, stop);
        i = stop;
      } else if (char === '"' || char === "'") {
        let j = i + 1;
        while (j < length && text[j] !== char && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
        blankLiteral(i + 1, j);
        i = j + 1;
        previous = char;
        previousWord = "";
      } else if (char === "`") {
        i = template(i);
        previous = char;
        previousWord = "";
      } else if (
        char === "/" &&
        (previous === "" ||
          REGEX_AFTER_PUNCTUATION.test(previous) ||
          REGEX_AFTER_WORD.has(previousWord))
      ) {
        let j = i + 1;
        let inClass = false;
        while (j < length && text[j] !== "\n") {
          const c = text[j];
          if (c === "\\") j += 1;
          else if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          j += 1;
        }
        blankLiteral(i + 1, j);
        i = j + 1;
        previous = "/";
        previousWord = "";
      } else {
        if (char === "{") depth += 1;
        else if (char === "}") {
          if (inExpression && depth === 0) return i + 1;
          depth -= 1;
        }
        if (/[\w$]/u.test(char)) {
          word = /[\w$]/u.test(text[i - 1] ?? "") ? word + char : char;
          previousWord = word;
          previous = char;
        } else if (!/\s/u.test(char)) {
          previousWord = "";
          previous = char;
        }
        i += 1;
      }
    }
    return length;
  }

  code(0, false);
  return out.join("");
}

/**
 * The index of the bracket closing the one at `open` in masked text, or -1.
 * Literals are already blanked, so only brackets are left to count.
 */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const opener = text[open] ?? "";
  const closer = pairs[opener];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === opener) depth += 1;
    else if (text[i] === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `text` split at its depth-0 commas. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** What a file's own object literals are known to say about `shell`. */
interface Bindings {
  /** Every declaration is a literal that ends with `shell: false`. */
  readonly safe: ReadonlySet<string>;
  /** Some declaration carries a `shell` that is not `false`, or spreads one that does. */
  readonly tainted: ReadonlySet<string>;
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/gu;

/** The outermost object literals in `expression`, as written. */
function literalsIn(expression: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < expression.length; i += 1) {
    if (expression[i] !== "{") continue;
    const end = closing(expression, i);
    if (end === -1) break;
    found.push(expression.slice(i, end + 1));
    i = end;
  }
  return found;
}

/**
 * What the object literal `literal` ends up saying about `shell`, its own
 * top-level properties and spreads read in order, the last word winning: `false`,
 * `other` (anything else, including a spread that brings one in), or `none`.
 *
 * A spread of a safe name says `false`; of a tainted one, or of an inline
 * expression holding a literal that carries a `shell` of its own, says `other`;
 * of anything else — an unknown name, or the usual `...(cwd ? { cwd } : {})` —
 * leaves what was said as it was.
 */
function shellOf(literal: string, bindings: Bindings): "false" | "other" | "none" {
  let state: "false" | "other" | "none" = "none";
  for (const raw of splitTopLevel(literal.slice(1, -1))) {
    const part = raw.trim();
    if (part.startsWith("...")) {
      const expression = part.slice(3).trim();
      const names = expression.match(IDENTIFIER) ?? [];
      if (/^[A-Za-z_$][\w$]*$/u.test(expression) && bindings.safe.has(expression)) {
        state = "false";
      } else if (
        names.some((name) => bindings.tainted.has(name)) ||
        literalsIn(expression).some((inner) => shellOf(inner, bindings) === "other")
      ) {
        state = "other";
      }
    } else if (/^shell\s*:/u.test(part))
      state = /^shell\s*:\s*false$/u.test(part) ? "false" : "other";
    else if (part === "shell") state = "other";
  }
  return state;
}

const escaped = (name: string): string => name.replaceAll("$", String.raw`\$`);

/** What this file's `const`/`let`/`var` object literals say about `shell`. */
function bindingsOf(text: string): Bindings {
  const literals = new Map<string, string[]>();
  for (const match of text.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*\{/gu,
  )) {
    const open = match.index + match[0].length - 1;
    const end = closing(text, open);
    const name = match[1] ?? "";
    if (end !== -1) literals.set(name, [...(literals.get(name) ?? []), text.slice(open, end + 1)]);
  }
  const eligible = [...literals].filter(([name, bodies]) => {
    const pattern = escaped(name);
    const declarations = text.match(
      new RegExp(String.raw`\b(?:const|let|var)\s+${pattern}(?![\w$])`, "gu"),
    );
    if (declarations?.length !== bodies.length) return false;
    // An assignment that is not the declaration's own `=`: a reassignment, or
    // a default parameter of the same name — either way the literal is not the
    // whole story.
    for (const assign of text.matchAll(
      new RegExp(String.raw`(?<![.\w$])${pattern}\s*=(?![=>])`, "gu"),
    )) {
      if (!/\b(?:const|let|var)\s+$/u.test(text.slice(0, assign.index))) return false;
    }
    return true;
  });
  let bindings: Bindings = { safe: new Set(), tainted: new Set() };
  // Fixpoint, whatever order the declarations come in: a literal that spreads a
  // safe name is safe, one that spreads a tainted name is tainted. Capped, since
  // a cycle of spreads is the one input that could keep it turning.
  for (let round = 0; round <= literals.size + 1; round += 1) {
    const current = bindings;
    const safe = new Set(
      eligible
        .filter(([, bodies]) => bodies.every((body) => shellOf(body, current) === "false"))
        .map(([name]) => name),
    );
    const tainted = new Set(
      [...literals]
        .filter(([, bodies]) => bodies.some((body) => shellOf(body, current) === "other"))
        .map(([name]) => name),
    );
    const same =
      safe.size === current.safe.size &&
      tainted.size === current.tainted.size &&
      [...safe].every((name) => current.safe.has(name)) &&
      [...tainted].every((name) => current.tainted.has(name));
    bindings = { safe, tainted };
    if (same) break;
  }
  return bindings;
}

/** Every name a file calls `calls` by: itself, plus `as` and destructured aliases. */
function namesFor(text: string, calls: readonly string[]): string[] {
  const names = new Set(calls);
  const members = calls.join("|");
  for (const match of text.matchAll(
    new RegExp(
      String.raw`\b(?:${members})\s+as\s+([A-Za-z_$][\w$]*)|\b(?:${members})\s*:\s*([A-Za-z_$][\w$]*)`,
      "gu",
    ),
  )) {
    names.add(match[1] ?? match[2] ?? "");
  }
  return [...names].filter((name) => name !== "");
}

/**
 * Every call to one of `calls`, in a file that imports `node:child_process`,
 * whose own options do not say `shell: false` — see the header for what "say"
 * means. `calls` defaults to `SPAWN_CALLS`; a test passes a narrower list to
 * prove the full one is what catches a call.
 */
export function callsWithoutShellFalse(
  source: string,
  calls: readonly string[] = SPAWN_CALLS,
): UnsafeCall[] {
  if (!CHILD_PROCESS_IMPORT.test(mask(source, true))) return [];
  const text = mask(source);
  const bindings = bindingsOf(text);
  const found: UnsafeCall[] = [];
  const pattern = new RegExp(
    String.raw`(?<![\w$])(?:${namesFor(text, calls).map(escaped).join("|")})\s*\(`,
    "gu",
  );
  for (const match of text.matchAll(pattern)) {
    // A definition is not a call.
    if (/function\s+$/u.test(text.slice(0, match.index))) continue;
    const open = match.index + match[0].length - 1;
    const end = closing(text, open);
    const args = splitTopLevel(text.slice(open + 1, end === -1 ? text.length : end));
    const says = args.slice(1).some((arg) => {
      const trimmed = arg.trim();
      if (trimmed.startsWith("{")) return shellOf(trimmed, bindings) === "false";
      return bindings.safe.has(trimmed);
    });
    if (says) continue;
    found.push({
      line: text.slice(0, match.index).split("\n").length,
      call: source
        .slice(match.index, end === -1 ? undefined : end + 1)
        .replaceAll(/\s+/gu, " ")
        .slice(0, 100),
    });
  }
  return found;
}
