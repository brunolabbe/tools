/**
 * The per-call half of the "never invoke a shell" scan (repo-83).
 *
 * `spawn-safety.test.ts` used to ask whether `shell: false` appeared anywhere in
 * a file that spawns. A file with nine `spawnSync` calls and one `shell: false`
 * string passed in full, and the other eight calls were never individually
 * asked. This asks each call.
 *
 * **What counts as a call saying `shell: false`.** Its own argument list carries
 * it, or the argument list names an identifier whose object literal, declared in
 * the same file, carries it — directly, or through a spread of another such
 * identifier (`const options = { ...GIT_EXEC_OPTIONS, stdio }`, with the
 * `shell: false` one binding further up).
 *
 * **What it cannot see, on purpose:** options built by a function call, held in
 * a destructured binding, imported from another file, or assigned after the
 * literal. A call like that reads as unsafe here, and the fix is to say
 * `shell: false` at the call — which is what the rule asks for anyway. The
 * association is a heuristic, a blunt one like the rest of the scan: a safe
 * identifier appearing anywhere in the argument list is accepted.
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

const CHILD_PROCESS_IMPORT = /from\s+["']node:child_process["']/u;
const SHELL_FALSE = /\bshell\s*:\s*false\b/u;

const blank = (match: string): string => match.replaceAll(/[^\n]/gu, " ");

/** Blanks comments to spaces, keeping every newline, so a line number survives. */
function blankComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//gu, blank)
    .replaceAll(
      /(^|[^:])(\/\/.*)$/gmu,
      (_, before: string, comment: string) => before + blank(comment),
    );
}

/**
 * The index of the bracket closing the one at `open`, or -1. Brackets inside a
 * string or template literal do not count; a regex literal is not understood,
 * and a template literal's `${}` is read as part of the string.
 */
function closing(text: string, open: number): number {
  const opener = text[open];
  const closer = opener === "(" ? ")" : "}";
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Identifiers whose object literal, in this file, says `shell: false` — transitively. */
function safeBindings(text: string): Set<string> {
  const bodies = new Map<string, string>();
  for (const match of text.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*\{/gu,
  )) {
    const open = match.index + match[0].length - 1;
    const end = closing(text, open);
    if (end !== -1) bodies.set(match[1] ?? "", text.slice(open, end + 1));
  }
  const safe = new Set<string>();
  // Fixpoint: a binding that spreads a safe one is safe, whatever order they are declared in.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, body] of bodies) {
      if (safe.has(name)) continue;
      const spread = [...body.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/gu)].some((m) =>
        safe.has(m[1] ?? ""),
      );
      if (SHELL_FALSE.test(body) || spread) {
        safe.add(name);
        changed = true;
      }
    }
  }
  return safe;
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
  const text = blankComments(source);
  if (!CHILD_PROCESS_IMPORT.test(text)) return [];
  const safe = safeBindings(text);
  const found: UnsafeCall[] = [];
  const pattern = new RegExp(`\\b(?:${calls.join("|")})\\s*\\(`, "gu");
  for (const match of text.matchAll(pattern)) {
    // A definition is not a call, and neither is a name inside a longer one.
    if (/function\s+$/u.test(text.slice(0, match.index))) continue;
    const open = match.index + match[0].length - 1;
    const end = closing(text, open);
    const args = text.slice(match.index, end === -1 ? text.length : end + 1);
    const named = args.match(/[A-Za-z_$][\w$]*/gu) ?? [];
    if (SHELL_FALSE.test(args) || named.some((name) => safe.has(name))) continue;
    found.push({
      line: text.slice(0, match.index).split("\n").length,
      call: args.replaceAll(/\s+/gu, " ").slice(0, 100),
    });
  }
  return found;
}
