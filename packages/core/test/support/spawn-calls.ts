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
 * `options` cannot lend each other their `shell: false`.
 *
 * **What it reads.** Source with comments blanked and, for everything but the
 * import test, string, template and regex literal contents blanked too (`mask`),
 * so a `/*` inside a string does not swallow the code up to the next `*\/`, and
 * `shell: false` in a string argument, a JSON payload or a nested `env` object
 * is not taken for the option.
 *
 * **Limits, none of which occur in the tree and all of which read as a miss
 * rather than a pass-by-accident:**
 * - a call is matched by name, so a parameter that happens to be called `spawn`
 *   is checked like the real one (`preflight.mjs`'s injected runner was renamed
 *   for it), and so is `cp.spawnSync(…)`; a `{ spawnSync: run }` destructure and
 *   `spawnSync as run` are followed, `const run = cp.spawnSync` is not;
 * - not seen at all: `cp["spawnSync"](…)`, `promisify(execFile)`, `fork`, and
 *   `exec`/`execSync` through a namespace or default import — those two are
 *   banned only as a named import, by `spawn-safety.test.ts`'s own test;
 * - a spread of anything that is not a safe name, such as `...options` after a
 *   `shell: false`, is trusted not to carry a `shell` of its own;
 * - options built by a function call, destructured, imported or computed read as
 *   unsafe, and the fix is to say `shell: false` at the call;
 * - which argument is "the options" is not worked out: any later argument that
 *   is a safe literal or a safe name will do;
 * - a regex literal after `)` or `}` is read as division, and a backtick inside a
 *   template's `${}` is not understood.
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

/**
 * Whether the object literal `literal` ends with `shell: false`: its own
 * top-level properties and spreads in order, the last word on `shell` winning,
 * and a spread of anything but a safe name leaving what was said as it was — a
 * conditional `...(cwd ? { cwd } : {})` is the usual one, and is not a `shell`.
 */
function saysShellFalse(literal: string, safe: ReadonlySet<string>): boolean {
  let says = false;
  for (const raw of splitTopLevel(literal.slice(1, -1))) {
    const part = raw.trim();
    const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)$/u.exec(part);
    if (spread !== null && safe.has(spread[1] ?? "")) says = true;
    else if (part.startsWith("...")) continue;
    else if (/^shell\s*:/u.test(part)) says = /^shell\s*:\s*false$/u.test(part);
    else if (part === "shell") says = false;
  }
  return says;
}

const escaped = (name: string): string => name.replaceAll("$", String.raw`\$`);

/** Names every declaration of which, in this file, is a literal that says `shell: false`. */
function safeBindings(text: string): Set<string> {
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
  const safe = new Set<string>();
  // Fixpoint: a literal that spreads a safe name is safe, whatever order they are declared in.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, bodies] of eligible) {
      if (!safe.has(name) && bodies.every((body) => saysShellFalse(body, safe))) {
        safe.add(name);
        changed = true;
      }
    }
  }
  return safe;
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
  const safe = safeBindings(text);
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
      if (trimmed.startsWith("{")) return saysShellFalse(trimmed, safe);
      return safe.has(trimmed);
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
