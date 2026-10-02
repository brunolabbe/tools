/**
 * The "never invoke a shell" rule, enforced against the source itself.
 *
 * Other tests prove that a particular call is safe. This one proves that no
 * *new* call is unsafe, which is the property that actually decays: user-
 * supplied strings reach child-process argv, and a single `shell: true` added
 * later turns any of them into command injection.
 *
 * It lives in `packages/core` rather than in the tool whose ffmpeg calls
 * prompted it, because the rule is repo-wide. Scoped to one tool, a second tool
 * spawning a shell would be caught only if somebody remembered to look — and
 * the whole point is that nobody will. The scan therefore reads every source
 * file in the repository, including ones that do not exist yet.
 *
 * It used to read only workspaces' `src` while `CLAUDE.md` called it repo-wide:
 * `scripts/`, which spawns `git`, `gh` and `npm` more than anything else here,
 * every `test/` and `e2e/`, and every `.mjs` sat outside it (repo-75).
 *
 * A source scan is a blunt instrument and it is the right one.
 */

import { describe, expect, test } from "vitest";
import { SPAWN_CALLS, callsWithoutShellFalse, mask } from "./support/spawn-calls.ts";
import { repoSources } from "./support/workspaces.ts";

/** Every source file in the repository, tracked or new — see `repoSources`. */
const SOURCES = await repoSources();

/** Strips comments, so a doc block explaining the rule is not a violation of it. */
function code(text: string): string {
  return mask(text, true);
}

describe("no shell reaches a child process", () => {
  test("the scan actually found the source it is meant to check", () => {
    // A silently empty scan would pass every assertion below. Asserting that the
    // scan reached code which spawns at all is stronger than naming a file, and
    // unlike a hardcoded path it cannot rot the next time one moves.
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(
      SOURCES.filter((source) => /from\s+["']node:child_process["']/u.test(source.text)).length,
    ).toBeGreaterThan(0);
  });

  test("the scan reaches past the workspaces, into scripts/ and .mjs", () => {
    // What repo-75 found missing: a scan narrowed back to workspaces' `src`
    // would still pass the test above, so the two roots it had never reached
    // are asserted by their shape rather than by a file name that can move.
    const spawning = SOURCES.filter((source) =>
      /from\s+["']node:child_process["']/u.test(source.text),
    ).map((source) => source.file);
    expect(spawning.some((file) => file.startsWith("scripts/") && file.endsWith(".mjs"))).toBe(
      true,
    );
    expect(spawning.some((file) => /^(?:packages|tools)\/.*\/test\//u.test(file))).toBe(true);
  });

  test("no call site sets `shell` to anything truthy", () => {
    // Read through `code()`, so a `/*` inside a string cannot hide a `shell: true`
    // from it: `setsTruthyShell`, at the foot of this file, is shared with the
    // fixture that proves exactly that.
    const offenders = SOURCES.filter((source) => setsTruthyShell(source.text)).map(
      (source) => source.file,
    );
    expect(offenders).toEqual([]);
  });

  test("the shell-running members of node:child_process are never imported", () => {
    // `execFile` and `spawn` take an argument array and are fine. `exec` and
    // `execSync` concatenate into a command string and hand it to /bin/sh.
    // `importsShellRunner`, at the foot of this file, reads through `code()` too.
    const offenders = SOURCES.filter((source) => importsShellRunner(source.text)).map(
      (source) => source.file,
    );
    expect(offenders).toEqual([]);
  });

  test("every file that spawns says `shell: false` at each of its calls", () => {
    // The default is already false, so this is about intent: a spawn without
    // the flag reads as one nobody thought about. Asked of each call, not of the
    // file: one `shell: false` string used to excuse every other call in its
    // file, and a file of nine `spawnSync` calls passed on it (repo-83).
    // `spawnSync`, `execFile` and `execFileSync` take the same option `spawn`
    // does and are asked the same question — a pattern narrowed to `spawn(`
    // alone saw none of them (repo-77), which is why `SPAWN_CALLS` is asserted
    // member by member below. What carrying the flag means is in `spawn-calls.ts`.
    const offenders = SOURCES.flatMap((source) =>
      callsWithoutShellFalse(source.text).map((call) => `${source.file}:${call.line} ${call.call}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the per-call check can fail (repo-83)", () => {
  // The fixtures are source text, and this file is itself scanned. The import
  // line is assembled so that the scan does not take a fixture for a spawning
  // file, and every call below sits in a string, where `callsWithoutShellFalse`
  // would read it only if this file imported `node:child_process` — which it
  // does not, and must not start to.
  const IMPORT = `import { spawn, spawnSync } from "node:child${"_"}process";\n`;
  const fixture = (body: string): string => IMPORT + body;

  test("a call lacking its own `shell: false` fails beside one that has it", () => {
    // The shape the file-level test passed: one `shell: false` string
    // somewhere, and every other call excused by it.
    const text = fixture(
      [
        `spawnSync("git", ["a"], { encoding: "utf8", shell: false });`,
        `spawnSync("git", ["b"], { encoding: "utf8" });`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(text)).toEqual([
      { line: 3, call: `spawnSync("git", ["b"], { encoding: "utf8" })` },
    ]);
  });

  test("a call reaches `shell: false` through a named literal or a spread of one", () => {
    const text = fixture(
      [
        `const BASE = { encoding: "utf8", shell: false };`,
        `const WITH_STDIO = { ...BASE, stdio: "pipe" };`,
        `spawnSync("git", ["a"], BASE);`,
        `spawnSync("git", ["b"], WITH_STDIO);`,
        `spawnSync("git", ["c"], { ...WITH_STDIO, cwd: "." });`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(text)).toEqual([]);
  });

  test("a literal that does not say it, or options built elsewhere, do not excuse a call", () => {
    const text = fixture(
      [
        `const PLAIN = { encoding: "utf8" };`,
        `spawnSync("git", ["a"], PLAIN);`,
        `spawnSync("git", ["b"], makeOptions());`,
        `spawnSync("git", ["c"]);`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(text).map((call) => call.line)).toEqual([3, 4, 5]);
  });

  test("a comment, a definition and a file that does not import child_process are not calls", () => {
    expect(
      callsWithoutShellFalse(fixture(`// spawnSync("git", [])\nfunction spawn(command) {}\n`)),
    ).toEqual([]);
    expect(callsWithoutShellFalse(`spawnSync("git", ["a"]);\n`)).toEqual([]);
  });

  test("every member of SPAWN_CALLS is asked, and a pattern narrowed to `spawn(` misses them", () => {
    // What repo-83 found unguarded: narrowing the call pattern back to `spawn(`
    // alone left the whole scan green, because every file that called the others
    // also said `shell: false` somewhere. Here each member is a fixture of its
    // own, so dropping one from `SPAWN_CALLS` fails on that member by name.
    for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
      const text = fixture(`${name}("git", ["a"], { encoding: "utf8" });\n`);
      expect(SPAWN_CALLS, name).toContain(name);
      expect(callsWithoutShellFalse(text), name).toHaveLength(1);
      expect(callsWithoutShellFalse(text, ["spawn"]), name).toHaveLength(name === "spawn" ? 1 : 0);
    }
  });

  test("a `/*` inside a string does not hide the code up to the next `*/`", () => {
    // gate 1: `"docs/work/*.md"` opened a block comment that ran to the next
    // `*/`, and four calls in citations-gate.test.ts were never checked. The
    // glob and the closer are assembled so this file does not hold either.
    const open = `"docs/work/*${".md"}"`;
    const close = `"*${"/"}"`;
    const truthy = ["tr", "ue"].join("");
    const text = fixture(
      `const A = ${open};\nspawnSync("git", ["a"], { encoding: "utf8" });\nconst B = ${close};\n`,
    );
    expect(callsWithoutShellFalse(text).map((call) => call.line)).toEqual([3]);
    // and the truthy-`shell` test reads through `code()`, which is `mask` too
    expect(mask(`const A = ${open};\nshell: ${truthy};\nconst B = ${close};\n`, true)).toContain(
      `shell: ${truthy}`,
    );
    // a regex literal holding a quote is not a string either
    const regex = fixture(`const R = /["']/u;\nspawnSync("git", ["a"], { encoding: "utf8" });\n`);
    expect(callsWithoutShellFalse(regex).map((call) => call.line)).toEqual([3]);
  });

  test("an assignment, or a second declaration of the name, withdraws its `shell: false`", () => {
    const reassigned = fixture(
      [
        `let o = { shell: false };`,
        `o = { encoding: "utf8" };`,
        `spawnSync("git", ["a"], o);`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(reassigned).map((call) => call.line)).toEqual([4]);
    const twice = fixture(
      [
        `function a() { const o = { shell: false }; return spawnSync("git", ["a"], o); }`,
        `function b() { const o = { encoding: "utf8" }; return spawnSync("git", ["b"], o); }`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(twice).map((call) => call.line)).toEqual([2, 3]);
  });

  test("only a top-level `shell: false` that is the last word on `shell` counts", () => {
    const text = fixture(
      [
        `const BASE = { shell: false };`,
        `spawnSync("git", ["a"], { env: { shell: false } });`,
        `spawnSync("git", ["b"], { ...BASE, shell: !0 });`,
        `spawnSync("git", ["c"], { ...BASE, shell: process.env.X });`,
        `spawnSync("git", ["d", "shell: false"]);`,
        `spawnSync("git", ["e"], { ...BASE, ...(cwd ? { cwd } : {}) });`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(text).map((call) => call.line)).toEqual([3, 4, 5, 6]);
  });

  test("an aliased call, and every way of importing child_process, are seen", () => {
    const call = `run("git", ["a"], { encoding: "utf8" });\n`;
    const specifier = `"node:child${"_"}process"`;
    for (const head of [
      `import { spawnSync as run } from ${specifier};\n`,
      `import { spawnSync as run } from "child${"_"}process";\n`,
      `const { spawnSync: run } = require(${specifier});\n`,
      `const { spawnSync: run } = await import(${specifier});\n`,
    ]) {
      expect(callsWithoutShellFalse(head + call), head).toHaveLength(1);
    }
    expect(callsWithoutShellFalse(`import { run } from "./elsewhere.ts";\n${call}`)).toEqual([]);
  });

  test("a spread cannot bring back a `shell` the file itself declares", () => {
    const text = fixture(
      [
        `const OTHER = { shell: process.env.X };`,
        `const VIA = { ...OTHER };`,
        `spawnSync("git", ["a"], { shell: false, ...OTHER });`,
        `spawnSync("git", ["b"], { shell: false, ...VIA });`,
        `spawnSync("git", ["c"], { shell: false, ...(c ? { shell: process.env.X } : {}) });`,
        `spawnSync("git", ["d"], { shell: false, ...(c ? { cwd } : {}) });`,
        `spawnSync("git", ["e"], { shell: false, ...{ cwd: "." } });`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(text).map((call) => call.line)).toEqual([4, 5, 6]);
  });

  test("a name declared twice, once as a literal and once not, is not safe", () => {
    // Removing the declaration count lets the second function borrow the first's
    // `shell: false`: the literal alone would have been enough to excuse both.
    const text = fixture(
      [
        `function a() { const o = { shell: false }; return spawnSync("git", ["a"], o); }`,
        `function b() { const o = make(); return spawnSync("git", ["b"], o); }`,
      ].join("\n"),
    );
    expect(callsWithoutShellFalse(text).map((call) => call.line)).toEqual([2, 3]);
  });

  test("`code()` reads through a `/*` string, so the other two tests do", () => {
    // `code()` is what the truthy-`shell` test and the banned-import test read
    // through. Reverted to a comment-stripping regex pair it kept every test but
    // this one green, and a `shell: true` planted after a glob went unseen.
    const glob = `"docs/work/*${".md"}"`;
    const closer = `"*${"/"}"`;
    const truthy = ["tr", "ue"].join("");
    const planted = `const A = ${glob};\nspawnSync("git", [], { shell: ${truthy} });\nconst B = ${closer};\n`;
    expect(setsTruthyShell(planted)).toBe(true);
    const banned = `const A = ${glob};\nimport { exec } from ${`"node:child${"_"}process"`};\nconst B = ${closer};\n`;
    expect(importsShellRunner(banned)).toBe(true);
    // and a comment still is not code
    expect(setsTruthyShell(`// shell: ${truthy}\n/* shell: ${truthy} */\n`)).toBe(false);
  });

  test("every limit the header names behaves as it says", () => {
    // Held here so the header is a claim a test can fail, not prose: each row is
    // a source, the lines `callsWithoutShellFalse` flags in it, and what the
    // header says about it. `pass` rows are misses — the call is not reported.
    const spec = `"node:child${"_"}process"`;
    const ns = `import * as cp from ${spec};\n`;
    const tick = "`";
    const truthy = ["tr", "ue"].join("");
    const rows: [string, string, number[]][] = [
      // a call is matched by name: a parameter called `spawn` is checked like the real one…
      ["a parameter named spawn", `function f(spawn) { spawn("git", ["a"], {}); }`, [2]],
      // …and so is a member call through a namespace import
      ["a member call", `${ns}cp.spawnSync("git", ["a"], {});`, [3]],
      // `as` and destructured aliases are followed; an assignment of the member is not
      ["an assigned alias", `${ns}const run = cp.spawnSync;\nrun("git", ["a"]);`, []],
      // not seen at all
      ["a bracket access", `${ns}cp["spawnSync"]("git", ["a"]);`, []],
      ["promisify", `promisify(execFile)("git", ["a"]);`, []],
      ["fork", `fork("child.js");`, []],
      ["exec through a namespace", `${ns}cp.execSync("ls");\ncp.exec("ls");`, []],
      // a spread of something the file does not declare is trusted
      ["an unknown spread", `spawnSync("git", ["a"], { shell: false, ...options });`, []],
      // options built elsewhere read as unsafe
      ["options from a call", `spawnSync("git", ["a"], makeOptions());`, [2]],
      ["destructured options", `const { o } = x;\nspawnSync("git", ["a"], o);`, [3]],
      // any later argument will do
      [
        "a later argument excusing one that does not",
        `spawnSync("git", { shell: false }, { shell: ${truthy} });`,
        [],
      ],
      // a `/` after `}` is read as a regex, blanking the rest of its line
      ["a division after a brace", `const n = {} / 2; spawnSync("git", ["a"]);`, []],
      ["the same on the next line", `const n = {} / 2;\nspawnSync("git", ["a"]);`, [3]],
      // a regex after `)` is read as division, so its quote opens a string
      ["a regex after a paren", `if (x) /"/.test(y); spawnSync("git", ["a"]);`, []],
      // a template's `${}` is code, a nested template included
      [
        "a nested template",
        `const s = ${tick}a \${ ${tick}b \${x}${tick} } c${tick};\nspawnSync("git", ["a"]);`,
        [3],
      ],
      // Appended below, so the rows above keep their lines: the rest of what the
      // header says, each of which fails here if it stops being true.
      // a call inside a template's `${}`, or a nested one, is code and is asked
      [
        "a call inside a template interpolation",
        `const s = ${tick}a \${ spawnSync("git", ["a"]) } c${tick};`,
        [2],
      ],
      [
        "a call inside a nested template interpolation",
        `const s = ${tick}a \${ ${tick}b \${ spawnSync("git", ["a"]) }${tick} } c${tick};`,
        [2],
      ],
      // …and the text of a template is not
      [
        "a call written in a template's text",
        `const s = ${tick}spawnSync("git", ["a"])${tick};`,
        [],
      ],
      [
        "a call written in a nested template's text",
        `const s = ${tick}a \${ ${tick}spawnSync("git", ["a"])${tick} } c${tick};`,
        [],
      ],
      // options imported or computed read as unsafe
      ["imported options", `import { OPTS } from "./o.ts";\nspawnSync("git", ["a"], OPTS);`, [3]],
      ["a computed key", `spawnSync("git", ["a"], { ["shell"]: false });`, [2]],
      // `exec` through a default import is not asked, as through a namespace
      [
        "exec through a default import",
        `import cp from ${spec};\ncp.execSync("ls");\ncp.exec("ls");`,
        [],
      ],
      // a spread after `shell: false` is trusted unless the file declares the name
      // as a literal that carries a `shell`
      [
        "a spread of a parameter",
        `function f(options) { spawnSync("git", ["a"], { shell: false, ...options }); }`,
        [],
      ],
      [
        "a spread of a name declared by a call",
        `const OTHER = make();\nspawnSync("git", ["a"], { shell: false, ...OTHER });`,
        [],
      ],
      [
        "a spread of a name reassigned with a shell",
        `let OTHER = {};\nOTHER = { shell: process.env.X };\nspawnSync("git", ["a"], { shell: false, ...OTHER });`,
        [],
      ],
      ["a spread of a call", `spawnSync("git", ["a"], { shell: false, ...make() });`, []],
      // any argument after the first will do, the unsafe one first as well as last
      [
        "a later argument that says it after one that does not",
        `spawnSync("git", { shell: ${truthy} }, { shell: false });`,
        [],
      ],
      // the last word wins in both directions: a later spread of a safe name counts
      [
        "a safe spread after a truthy shell",
        `const BASE = { shell: false };\nspawnSync("git", ["a"], { shell: ${truthy}, ...BASE });`,
        [],
      ],
    ];
    for (const [label, body, lines] of rows) {
      expect(
        callsWithoutShellFalse(fixture(body)).map((call) => call.line),
        label,
      ).toEqual(lines);
    }
  });
});

// Declared last, and hoisted, so the tests above keep the lines other records cite.

/** Whether `source`, comments blanked by `code()`, has a `shell` set to something truthy. */
function setsTruthyShell(source: string): boolean {
  return /\bshell\s*:\s*(?:true|1|["'`])/u.test(code(source));
}

/** Whether `source`, comments blanked by `code()`, imports `exec` or `execSync`. */
function importsShellRunner(source: string): boolean {
  const text = code(source);
  if (!/from\s+["']node:child_process["']/u.test(text)) return false;
  return /\bimport\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s+["']node:child_process["']/u.test(
    text,
  );
}
