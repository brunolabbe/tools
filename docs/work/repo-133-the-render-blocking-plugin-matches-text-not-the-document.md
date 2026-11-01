---
id: repo-133
tool: repo
title: The render-blocking plugin matches text, not the document
kind: fix
status: done
milestone: null
depends_on: [repo-131]
difficulty: standard
---

# repo-133 — The render-blocking plugin matches text, not the document

## Why

repo-131 (PR #692, branch `repo-131-shared-header-footer`, not merged) adds
`renderBlockingEntry` to `packages/ui/src/vite.ts`, exported as
`@webtools/ui/vite`. It is a Vite plugin that writes `blocking="render"` onto a
tool's built module entry, so that the stored dark theme applied by `/theme.js`
is on the page before the browser paints it. Chromium's measurement of that is
the downloader's `e2e/csp.spec.ts` on the repo-131 branch.

The plugin finds the entry with a regular expression over the built HTML string.
A regular expression is not an HTML parser. It reads comments, `<title>`,
`<textarea>`, a script's string and an entity-encoded `src` as markup, and its
guard, which fails the build when no entry is marked, passes on the same text.
repo-131's Review on branch `repo-131-shared-header-footer` records this as N1 at
gate 2. At gate 3 the rewrite that tried to fix it (`222b5048`) was recorded as
leaving two clauses open and as drawing a CodeQL alert on its pattern; the owner
reverted it.

The owner chose on 2026-10-31 to land repo-131 on the version at `3eb342af` and
to file the matcher here. On the branch head `bf187b8e`,
`packages/ui/src/vite.ts` and `packages/ui/test/vite-plugin.test.ts` are
byte-identical to `3eb342af`, so that version is the one that lands.

No tool is reached today. Each tool's `index.html` has one same-origin module
entry, and the downloader's CSP names no other module origin. The rows below
measure reach, not a shipped defect; gate 2 graded the finding `low`.

## Reproduction

The probe is the reproduction. It runs `vite build` over sixteen small pages
and two direct calls, and a timing row, against a tree you name. Two scripts,
both kept in this ticket and run from any worktree root that has `node_modules`:

```bash
node --import tsx <repo-133-population.mts> <tree> <outdir>
node --import tsx <repo-133-redos.mts> <tree> <outdir>
```

Make the tree first: `git worktree add --detach <path> 3eb342af`, then, from
a script that changes into the tree, `bash .claude/scripts/worktree-farm.sh` and
`npm run build`. The farm is never `npm install`.

`repo-133-population.mts`:

```ts
// Run from a worktree root that has node_modules:
//   node --import tsx <this file> <tree> <outdir>
// For each row, a real `vite build` with renderBlockingEntry(), then what it marked.
const [tree, out] = process.argv.slice(2);
if (!tree || !out) throw new Error("usage: repo-133-population.mts <tree> <outdir>");
const fs = await import("node:fs");
const path = await import("node:path");
const { build } = await import(`${tree}/node_modules/vite/dist/node/index.js`);
const { renderBlockingEntry, addRenderBlocking } = await import(`${tree}/packages/ui/src/vite.ts`);

const doc = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;
const entry = '<script type="module" src="/main.js"></script>';
const rows: Array<[string, string]> = [
  ["P1 one module script", doc(entry)],
  ["P2 two module scripts", doc(entry + '<script type="module" src="/other.js"></script>')],
  [
    "P3 inline module script importing main",
    doc('<script type="module">import "/main.js";</script>'),
  ],
  ["P4 upper-case SCRIPT", doc('<SCRIPT type="module" src="/main.js"></SCRIPT>')],
  ["P5 empty inline module script beside entry", doc('<script type="module"></script>' + entry)],
  ["P6 no script at all", doc("")],
  ["P7 classic script only", doc('<script src="/main.js"></script>')],
  [
    "P8 remote module script beside entry",
    doc('<script type="module" src="https://cdn.example.test/x.js"></script>' + entry),
  ],
  [
    "P9 remote module script only",
    doc('<script type="module" src="https://cdn.example.test/x.js"></script>'),
  ],
  [
    "P10 entry inside an HTML comment only",
    doc('<!-- <script type="module" src="/main.js"></script> -->'),
  ],
  [
    "P11 entry inside an unterminated comment",
    doc('<!-- <script type="module" src="/main.js"></script>'),
  ],
  [
    "P12 entry text inside <title>",
    doc('<title><script type="module" src="/main.js"></script></title>'),
  ],
  [
    "P13 entry text inside <textarea>",
    doc('<textarea><script type="module" src="/main.js"></script></textarea>'),
  ],
  [
    "P14 entry text in an inline script's string",
    doc('<script>var s = \'<script type="module" src="/main.js"></script>\';</script>'),
  ],
  [
    "P15 entity-encoded remote src",
    doc('<script type="module" src="&#47;&#47;cdn.example.test/x.js"></script>'),
  ],
  [
    "P16 entry in a comment, a blocking link",
    doc(
      '<!-- <script type="module" src="/main.js"></script> --><link rel="stylesheet" href="/a.css" blocking="render">',
    ),
  ],
];

const lines: string[] = [];
let n = 0;
for (const [name, html] of rows) {
  n += 1;
  const root = path.join(out, `p${String(n)}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), html);
  for (const f of ["main.js", "other.js"])
    fs.writeFileSync(path.join(root, f), 'document.title = "t";\n');
  fs.writeFileSync(path.join(root, "a.css"), "body{margin:0}\n");
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [renderBlockingEntry()],
      build: {
        outDir: path.join(root, "dist"),
        emptyOutDir: true,
        rollupOptions: { external: [/^https?:/u, /^\/\//u, /cdn\.example/u] },
      },
    });
    const built = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
    const tags = [...built.matchAll(/<script\b[^>]*>/giu)].map((m) => m[0]);
    const marked = tags
      .filter((t) => /blocking="render"/iu.test(t))
      .map((t) => /\ssrc="([^"]*)"/u.exec(t)?.[1] ?? "(inline)");
    lines.push(
      `${name.padEnd(44)} BUILD-OK scripts=${String(tags.length)} marked=${String(marked.length)} ${marked.join(" ")}`,
    );
  } catch (error) {
    const msg = String((error as Error).message).replace(/\s+/gu, " ");
    lines.push(
      `${name.padEnd(44)} ${msg.includes("render-blocking-entry") ? "BUILD-FAIL (guard)" : "BUILD-FAIL (other)"}`,
    );
  }
}

// Direct calls: no real build hands the matcher these, but the exported function accepts them.
for (const d of [
  '<script type="module" data-src="/x.js">inline()</script>',
  '<script-x type="module" src="/x.js"></script-x>',
]) {
  lines.push(`D direct tagged=${String(addRenderBlocking(d).tagged)}  ${d}`);
}

fs.writeFileSync(path.join(out, "population.txt"), lines.join("\n") + "\n");
process.stdout.write(lines.join("\n") + "\n");
```

`repo-133-redos.mts`:

```ts
// Run from a worktree root that has node_modules:
//   node --import tsx <this file> <tree> <outdir>
// Time addRenderBlocking on a repeated opener with no '>' to close it: the median of five
// calls per size, in microseconds, unrounded.
const [tree, out] = process.argv.slice(2);
if (!tree || !out) throw new Error("usage: repo-133-redos.mts <tree> <outdir>");
const fs = await import("node:fs");
const { addRenderBlocking } = await import(`${tree}/packages/ui/src/vite.ts`);

const lines: string[] = [];
for (const reps of [1000, 4000, 16000]) {
  const input = '<script type="module" '.repeat(reps);
  const samples: number[] = [];
  for (let k = 0; k < 5; k += 1) {
    const start = performance.now();
    addRenderBlocking(input);
    samples.push((performance.now() - start) * 1000);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  lines.push(
    `R1 ${String(input.length)} chars  median ${String(sorted[2])} us  samples ${samples.map(String).join(" ")}`,
  );
}
fs.writeFileSync(`${out}/redos.txt`, lines.join("\n") + "\n");
process.stdout.write(lines.join("\n") + "\n");
```

R1's probe takes about 3m45s on the landing (five calls of about 37 s at 352,000
characters), so run it in the background.

Measured at `3eb342af` on 2026-10-31 (the Landing column). In rows P9 and P15 the
second marked tag is Vite's own modulepreload helper, `/assets/index-…js`, not
the app's entry. Its body is the `modulepreload` polyfill. In P9 it is the page's
only same-origin module script.

| Row     | Input                                                                                             | Landing, measured                                                                                                       | Expected                                        |
| ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| P1–P4   | a plain, two, inline or upper-case module entry                                                   | BUILD-OK, 1 marked (Vite's entry)                                                                                       | the same                                        |
| P5      | an empty inline module script beside the entry                                                    | BUILD-OK, 2 scripts, 1 marked (the entry)                                                                               | the same                                        |
| P6, P7  | no script; a classic script only                                                                  | BUILD-FAIL (guard)                                                                                                      | the same                                        |
| P8      | a remote module script beside the entry                                                           | BUILD-OK, 2 marked: the remote and the entry                                                                            | BUILD-OK, 1 marked (the entry); remote unmarked |
| P9      | a remote module script only                                                                       | BUILD-OK, 2 marked: the remote and Vite's helper                                                                        | remote unmarked; as Decision 2 records          |
| P10–P14 | the entry as text: a comment, an unterminated comment, `<title>`, `<textarea>`, a script's string | BUILD-OK, 1 marked, no live entry                                                                                       | BUILD-FAIL (guard)                              |
| P15     | `src="&#47;&#47;cdn.example.test/x.js"`                                                           | BUILD-OK, 2 marked: the remote, decoded by a browser to `//cdn…`, and Vite's helper                                     | remote unmarked; as Decision 2 records          |
| P16     | the entry in a comment, beside `<link blocking="render">`                                         | BUILD-OK, 1 marked, in the comment                                                                                      | BUILD-FAIL (guard)                              |
| D1, D2  | direct call: `data-src` on a module script; a `<script-x>` tag                                    | tagged 1 each                                                                                                           | tagged 0 each                                   |
| R1      | direct call on `'<script type="module" '` repeated, 22,000 / 88,000 / 352,000 characters          | median 146,530 / 2,323,722 / 37,336,885 µs in round 1 (gate 3 read 159.7 ms / 2,695 ms / 38,229 ms on PR #692's thread) | Done when 3                                     |

## Build

Nothing here is built until the questions in the Decision are answered. When
they are, the first commit records each answer on this ticket and sets `status`
to `ready`. Then:

1. Run both probes on the tree the answer names, and keep the Landing column as
   the before.
2. Implement the chosen remedy in `packages/ui/src/vite.ts`. Keep the
   `@webtools/ui/vite` export and `renderBlockingEntry`'s name: the downloader's
   `web/vite.config.ts` imports it.
3. Add the cases named in Done when 2 to `packages/ui/test/vite-plugin.test.ts`.
   Each must fail on the landing version and pass after the fix, shown in the Log.
4. Rebuild, run the probes again, and check Done when 1 against the Expected
   column.
5. **Superseded by Decision 1's answer (parse5 with source locations); this step does not apply.** If Decision 1 is answered "accept R1", the answer commit rewords Done when 1
   and 2 and 3 to what that option leaves. Done when 1 becomes: each row gives the
   landing verdict recorded in the table as accepted, with P9 and P15 as Decision
   2 records. Done when 2 becomes: the four
   existing cases still pass and P1 to P7 give their Expected in the probe, with no
   new case unless Decision 2 answers its first option, which needs P9's and P15's.
   Done when 3 becomes: R1 is unchanged and the comment above `ENTRY_TAG` records
   it. Done when 4 stands. With these rewords, the ticket can reach `done` once
   Decision 2 is answered too.

## Decision — answered 2026-11-01 by the owner

Two questions were open when this was filed, and neither had a recommendation:
the measurement that would pick one had not been taken, and the costs were stated
for each option. A third, the form of option 3, was answered first. Both are
answered below, each on its own line.

**Option 3's form. Answered 2026-10-31 by the owner.** The options were: (a) keep
option 3 as a free-form note above `ENTRY_TAG`, saying plainly that it is not
adr/005's register; (b) drop option 3, leaving the two remedies. The owner chose
(a), the gate's recommendation.

**1. Which remedy for the matcher. Answered 2026-11-01 by the owner.**

The options were the three bullets below: parse5 with source locations; an
`indexOf` scanner with raw-text elements; accept R1. The owner chose **parse5
with source locations**, the orchestrator's recommendation; the ticket made none.

- **parse5 with source locations.** Parse the built HTML with parse5 (8.0.1
  has `sourceCodeLocationInfo`) and mark the start tag of each same-origin module
  script by its source offsets; the guard counts the parsed entries. Comments,
  raw-text elements and character references are then read as the HTML standard
  reads them. Not measured: whether the parser gives the Expected column on
  P1–P16. The probe measures it once built. Costs: `@webtools/ui` would declare
  `parse5` (`^8.0.1`), which it does not declare now. Today it reaches parse5
  only through `jsdom`, a devDependency, and the lockfile marks parse5
  `dev: true`. The version does not move, so the seven-day rule in
  `.claude/rules/dependency-updates.md` is not engaged. Whether the lock's `dev`
  flag changes depends on whether `packages/ui` lists parse5 under
  `dependencies` or `devDependencies`; not measured. The shape is the one N2's
  `vite` took: listed under both `devDependencies` and `peerDependencies`.
- **An `indexOf` scanner with raw-text elements.** A hand-written reader:
  a comment ends at `-->`, or runs to the end of the input when it is
  unterminated; the contents of `script`, `style`, `title` and `textarea` are
  skipped; character references in `src` are decoded before the same-origin test;
  every search for a closer is an `indexOf`, so a missing closer costs one pass
  and R1 is linear. Costs: the most code of the three. repo-131's Review on
  branch `repo-131-shared-header-footer` gives this as a direction at gate 3, not
  a built remedy, and records that the regexp rewrite before it (`222b5048`) left
  open the clauses that are P11 to P15 here. That is why this option is rated
  `hard`. No new dependency, so no seven-day rule.
- **Accept R1.** Keep the landing's matcher, and put a comment above `ENTRY_TAG`
  stating that the input is the tool's own built HTML. It is a free-form note,
  not adr/005's register: adr/005 needs a query id and a test that goes red on
  regression, and covers only structurally permanent findings; the comment has
  neither, and no `codeql[…]` line goes with it. The landing version has no
  CodeQL alert to dismiss. Costs: this option closes R1 and nothing else. P8 to
  P16 and D1 and D2 keep their landing verdicts, so under it Done when 1 and 2 are
  reworded by the answer commit (Build step 5). The claim that the input is the
  tool's own built HTML is not measured on the landing version. On PR #692's
  thread, gate 3 measured one well-formed tag of 16,000 attributes, 176,044
  characters, at 5.0 ms, on the rewrite; that is one tag, not a page.

**2. Whether the guard passes on P9. Answered 2026-11-01 by the owner.** P9's
only same-origin module script is Vite's own modulepreload helper, not the app's
entry. The options were the two bullets below. The owner chose **the guard counts
any same-origin module script**, the orchestrator's recommendation; the ticket
made none.

Under that answer, P9 and P15 pass: BUILD-OK, with one marked same-origin script
(Vite's helper) and the remote unmarked. That is what the Expected column's
"remote unmarked; as Decision 2 records" means here. It is the expected verdict,
not a measured one; Done when 1 is where it is measured. The two bullets as
filed:

- The guard counts only the app's entry, so P9 fails with BUILD-FAIL (guard), as
  P6 does. Costs: the plugin must tell Vite's helper from the app's entry, which
  is not measured for any of the three remedies.
- The guard counts any same-origin module script, as now, so P9 passes. Costs:
  the guard then means "some module script is there", not "the app's entry is
  marked".

**Difficulty.** `hard` is my proposal, rated for the scanner, the option that
needs the most judgement. Parse5 would be `standard`; accepting R1 would be
`mechanical`. The commit that records the answer re-rates it. Re-rated
`standard` for the chosen parse5 option, as the ticket states; see the Log.

## Done when

1. Each row of the table gives its Expected verdict on a tree built with the
   fix: `repo-133-population.mts` writes P1 to P16 and D1 and D2 that way. P9 and
   P15 are as Decision 2 records.
2. `packages/ui/test/vite-plugin.test.ts` has one new case each for P8, P9, P10
   to P16, D1 and D2, the rows the fix changes, with P9 and P15 as Decision 2
   records. The four existing cases still pass, and P1 to P7 give their Expected
   in the probe. Run with `npm test -- --project core`.
3. R1: the median for the 352,000-character row in `repo-133-redos.mts`'s output
   is under 1,000,000 µs (one second), and the 352,000-character median is under
   eight times the 88,000-character median. The landing's median is 37,336,885 µs,
   so it misses the bound. A one-pass `indexOf` scan, timed the same way as a
   stand-in, sits five orders of magnitude under the bound, so a linear scan meets
   it. The eight-times threshold rests on gate 2's single run of four subjects, for
   the ratio between the last two sizes: a one-pass scan 1.8, parse5 with
   `sourceCodeLocationInfo` 3.2, an `indexOf` scan that forgets a missing closer
   (quadratic) 15.1, and the landing 16.9. One run each, so eight is a direction to
   re-run on the real remedy. The real remedies are unmeasured.
4. The default-setup `CodeQL` check is green on the pull request's head.
5. `npm run check` passes.

## Review

**Gate: PASS** — 2026-11-01 · `84135dbf..bf83402e` · Opus 5.5, depth full

| Done when                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Each row gives its Expected verdict on a tree built with the fix; P9 and P15 as Decision 2 records                                     | **verified** — the gate ran `repo-133-population.mts` on its own tree built at the head: 18 of 18 rows match the Expected column. P8 marks only the entry. P9 and P15 are BUILD-OK, marking only Vite's helper and leaving the remote unmarked. P10–P14 and P16 are BUILD-FAIL (guard). D1 and D2 are `tagged=0`                                                                                                                                                                                                                                                               |
| 2. One new case each for P8, P9, P10–P16, D1, D2; the four existing cases pass; P1–P7 Expected in the probe; `npm test -- --project core` | **proven** — `packages/ui/test/vite-plugin.test.ts` › "P8: a remote module script beside the entry stays unmarked; the entry is marked", "P9: a remote module script only: …", "%s: the entry as text in %s fails the guard" (P10–P14, P16; asserts both the guard throw and `tagged` 0), "P15: an entity-encoded remote src …", "D1: …", "D2: …" ✓. 18 of 18 pass on the head. With `vite.ts` from the base, 13 fail and 5 pass, and every named row is among the 13. `npm test -- --project core`: 137 of 137 in 14 files. P1–P7 give their Expected in the gate's probe run |
| 3. R1: 352,000-char median under 1,000,000 µs and under 8× the 88,000-char median                                                         | **verified** — the gate's `repo-133-redos.mts` run, median of five: 1,621.2 / 2,996.7 / 10,850.2 µs. 10,850.2 µs is under the 1,000,000 µs bound, and the ratio is 3.62, under 8                                                                                                                                                                                                                                                                                                                                                                                               |
| 4. Default-setup `CodeQL` check green on the pull request's head                                                                          | **proven** — `CodeQL` COMPLETED SUCCESS on `bf83402e` (`gh pr view 703`), with "No new alerts in code changed by this pull request" on its details page                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5. `npm run check` passes                                                                                                                 | **verified** — `npm run check` exits 0 on the gate's tree at `bf83402e`. CI `check` passes on the same sha                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

- **low** · `nfr:reliability` · no `Done when` line depends on it. `entries` in `packages/ui/src/vite.ts` calls `stack.push(...node.childNodes)`, which throws `RangeError: Maximum call stack size exceeded` on a document with 300,000 sibling elements. Parse5 alone parses that input in 225 ms. The build fails as a non-guard error, so it fails closed, and no tool's page has this shape. Pushing the children one at a time in a loop was tried: 300,000 siblings took 292 ms, 1,000,000 took 1,184 ms, and the spec passed 18 of 18. The comment about the explicit stack is true for depth, and this is the width case beside it.
- **low** · `nfr:security` · no `Done when` line depends on it. `sameOrigin` resolves against a fixed `http://webtools.invalid/` and ignores any `<base href>` in the document. Three inputs that a browser on the https deployment reads as another origin are therefore marked and counted by the guard:
  - `<base href="https://cdn.example.test/">` before `/main.js`;
  - `src="http:/cdn.example.test/x.js"`;
  - `src="http:cdn.example.test/x.js"`.

  On an https page the last two are mixed content and are blocked. The `PAGE` comment ("keeps this origin only if a browser would fetch it from the page's own origin") is false for these inputs, and it errs in the direction that marks a remote. The result is a stall in painting, not an exposure. No tool's `index.html` has a `<base>`, and Vite rewrites the entry to `/assets/`.

- **low** · `nfr:performance` · no `Done when` line depends on it. Parse5 is quadratic on nested open elements. Parsing 6,250 / 12,500 / 25,000 nested `<div>` took 260 / 991 / 3,877 ms with parse5 alone, and the plugin adds nothing on top. This is not R1, and Done when 3 is met. The input is the tool's own build output. Recorded only.
- **low** · open decision · no `Done when` line depends on it. `parse5` is declared under `dependencies`, which makes `parse5` and `entities` production packages. They now survive each Dockerfile's `npm prune --omit=dev` and ship in all three runtime images, where nothing imports them. Their on-disk size is 444K + 488K in the shared `node_modules`; the size inside an image was not measured. Options:
  - (a) keep `dependencies`, because the package's `src` imports it (recommended);
  - (b) list it under `devDependencies` and `peerDependencies`, as `vite` is, which keeps `dev: true` and leaves it out of the images but relies on the consumer's hoist.
- **low** · no `Done when` line depends on it. A tag with `type=" module "` (surrounding whitespace) is not treated as a module script: it is left unmarked, and the guard fails if it is the page's only one. That is the fail-closed direction, and no tool reaches it. Whether a browser strips that whitespace was not verified: the spec fetch was refused.
- **dropped** · a whitespace-only `src` (`" "`, `"\t\n"`) is marked and counted. It resolves to the page's own URL, which is same-origin, so the result is what Decision 2 literally says. Its recorded cost ("some module script is there") covers it.
- **dropped** · `src` on the plugin's own `webtools.invalid` origin, including a `blob:` URL there, is read as same-origin. `.invalid` is reserved, so it can never be a page's origin.
- **dropped** · duplicate `type` (the first one wins), an `<svg>` script left unmarked, and `<noscript>` content read as text. In each case parse5 reads the input as the HTML standard does, so none is a defect.
- **dropped** · the +1 offset plant is caught only by "offsets stay right past CRLF, astral characters and an earlier tag". The real-build cases use `/\sblocking="render"/`, which accepts `<script  blocking="render"type=…`. One case catches the plant, so this is not a gap in proof.
- **findings** · the hunt returned 9: 5 carried, 4 dropped.
- NFR:
  - security: low, above (remote origins in a `<base>` or `http:` spelling);
  - performance ✓ (R1 at 10.9 ms; parse5's nesting cost, low, above);
  - reliability: low, above (wide input);
  - maintainability ✓ (every row in the brief has a case, and two positive controls go red).

## Log

- 2026-10-31 — Filed by a maintenance dispatch (repo-133 builder, Haiku 5.5).
  No source change; this branch is markdown only, so it did not run the farm
  against itself. The probe tree is a detached worktree at `3eb342af`, farmed
  (`farm built: 381 top-level entries`, exit 0) and built (`build exit 0`), and it
  is removed after the runs.
- Claim: the plugin at the landing sha is the one on the branch head.
  `git diff --stat 3eb342af origin/repo-131-shared-header-footer -- packages/ui/src/vite.ts packages/ui/test/vite-plugin.test.ts`
  prints nothing, and `git rev-parse 3eb342af:packages/ui/src/vite.ts` and
  `git rev-parse origin/repo-131-shared-header-footer:packages/ui/src/vite.ts`
  both print `bede8abf408ac7fa6390475f19e7ea79b1e28194`.
- Claim: the Landing column is the output of `repo-133-population.mts` run
  against a tree built at `3eb342af`, in round 1 (below). The output is the same
  row for row as the filing's; only P9's and P15's labels changed.
- Claim: P15's second marked tag is the same file as P9's. `cmp` on
  `p15/dist/assets/index-P2Xu9kJm.js` and `p9/dist/assets/index-P2Xu9kJm.js`
  reports no difference, and `grep -o modulepreload <file> | wc -l` prints 3; the
  helper is the polyfill either way.
- Claim: R1 is quadratic on the landing version. Round 1, `repo-133-redos.mts`
  on the same tree, median of five calls per size: 146,530.3 µs at 22,000
  characters, 2,323,721.8 µs at 88,000, 37,336,885.1 µs at 352,000. The last
  two sizes differ by 16.07 times for a fourfold step in length.
- Claim: a one-pass `indexOf` scan, timed by the same method, is a stand-in and
  not a remedy, five orders of magnitude under Done when 3's bound; gate 2's
  `standins.mts` run read 1.9, 3.2 and 5.8 µs at the three sizes. Done when 3's
  bound is met by it and missed by the landing.
- Round 1, from gate 1's findings F1 to F7 (`0733ca91`). The owner's answer on
  option 3 is its own commit, `8b58b3ee`, before the rest. F1: P9 and P15 are
  labelled as Vite's helper and follow Decision 2. F2: the R1 probe prints
  medians in microseconds, unrounded, and Done when 3 is a bound. F3: the
  landing has four test cases in `packages/ui/test/vite-plugin.test.ts` (lines 48,
  71, 81 and 89 at `3eb342af`), not P1 to P7. F5: the R1 figures of 159.7 ms,
  2,695 ms and 38,229 ms are gate 3's, on PR #692's thread, and the 5.0 ms is one
  tag of 16,000 attributes. F6: the filing's comparisons to other gates' scratch
  output are withdrawn; every landing verdict above comes from this ticket's
  probe. F7: Build step 5 rewords Done when 1 and 2 under option 3.
- CodeQL read green at `3eb342af` on PR #692 (repo-131's Review, gate 2, F2).
  The alert gate 3 read named the rewrite's comment pattern, not the landing's
  `ENTRY_TAG`. R1 on the landing is measured, not flagged.
- The three remedies are the owner's, from repo-131's Log entry of 2026-10-31
  that names this ticket. Decision 2 is new: P9's helper shows only in a real
  build, so the direct-call measurements did not reach it.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, F2 — "keep the bound
  and add: the 352,000-character median is under eight times the 88,000-character
  median". Done when 3 now says so and records that the threshold rests on gate
  2's single run of four subjects (linear 1.8, parse5 3.2, a quadratic scanner
  15.1, the landing 16.9). The unsourced stand-in digits are dropped from Done
  when 3 and attributed to gate 2's run in the Log claim above.
  `git diff ddedc6dc HEAD -- <ticket> | grep -c '^-.*has a median of about 4'`
  gives 1, and `grep -c '^-.*medians of 1.3, 2.3 and 4.2'` on the same diff gives 1.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, F7 — "Build step 5
  says no new case unless Decision 2 answers its first option". Step 5 now says
  so and rewords Done when 3 itself under "accept R1", and Done when 3 points to
  step 5. `git diff ddedc6dc HEAD -- <ticket> | grep -c '^-.*new case. Done when 3 and 4 stand'`
  gives 1.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, the second low — "the
  file holds one modulepreload (grep -c 1)". The Log now says `grep -o modulepreload <file> | wc -l`
  prints 3 and the helper is the polyfill either way.
  `git diff ddedc6dc HEAD -- <ticket> | grep -c '^-.*the file holds one'` gives 1.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, the third low — "the R1
  probe now takes 3 minutes 43 seconds on the landing". One sentence added above
  the Landing column: about 3m45s, five calls of about 37 s, so run it in the
  background. `git diff ddedc6dc HEAD -- <ticket> | grep -c '^+.*probe takes about 3m45s'`
  gives 1.
- 2026-10-31 — Gates 1 and 2 are CONCERNS, narrow; their full reports are on PR
  #696's thread, and the ticket stays `needs-decision`, so there is no `--land`.
- 2026-11-01 — The owner's answers are recorded and the ticket is `ready`, with
  `difficulty` re-rated from `hard` to `standard`. Decision 1: parse5 with source
  locations, from the three options (parse5; an `indexOf` scanner with raw-text
  elements; accept R1), the orchestrator's recommendation, which the ticket did
  not make. Decision 2: the guard counts any same-origin module script, from the
  two options (the app's entry only, so P9 fails; any same-origin module script,
  so P9 passes), the orchestrator's recommendation, which the ticket did not make.
  The re-rating follows the ticket's own stated rating for the chosen option:
  "Parse5 would be `standard`".
- Build step 5 (the "accept R1" branch) is marked superseded by Decision 1's
  answer and is not deleted. Done when 1 and 2 are unchanged. Under Decision 2 as
  answered, P9 and P15 are expected to pass as BUILD-OK with one marked
  same-origin script (Vite's helper) and the remote unmarked. That matches the
  table's Expected cells, which say "remote unmarked; as Decision 2 records", so
  no cell was edited. This is the expected verdict only; no tree was built or
  probed in this commit.
- 2026-11-01 — Owner's answer at intake, recorded before any source change.
  Question: "repo-133's Done when 3 still carries the clause 'Under the option
  named "Accept R1", Build step 5 rewords this item', although you chose parse5.
  Its bound ('eight is a direction to re-run on the real remedy') was never
  measured on parse5. How should this be handled?" Options: (1) strike the
  clause and measure parse5: the builder deletes the dead R1 clause and runs the
  probe on the parse5 remedy, and the gate grades the bound against that
  measurement; (2) leave the line as written: the gate grades the line as it
  stands. The owner chose (1), the orchestrator's recommendation. Done when 3
  loses exactly one clause, the sentence `Under the option named "Accept R1",
  Build step 5 rewords this item.`; nothing else in the line changed. The figure
  the bound is graded against is recorded in the round's Log entry below.
- 2026-11-01 — Built (builder, Sonnet 5.5), branch `repo-133-render-blocking-parse5`
  off `84135dbf`. Remedy: `packages/ui/src/vite.ts` parses the built HTML with
  parse5 8.0.1 (`sourceCodeLocationInfo`), collects each `script` element in the
  HTML namespace with `type=module` (case-insensitive) and a non-empty `src` that
  resolves to the page's own origin (`new URL(src, "http://webtools.invalid/")`,
  so `//host`, `\\host`, `data:` and a character-reference-encoded host are all
  read as a browser reads them), and inserts ` blocking="render"` at the start
  tag's offset plus 7. The guard counts every same-origin module script, tagged
  now or already carrying a `blocking` attribute (Decision 2). `addRenderBlocking`
  keeps its `{ html, tagged }` shape, so the four existing cases are untouched.
  A `<template>`'s content is not walked. The traversal is an explicit stack.
- Claim: the before is the Landing column. `vite.ts` at `84135dbf` and at
  `3eb342af` both hash to `bede8abf408ac7fa6390475f19e7ea79b1e28194`, so the
  base is the landing version. Both probes, run on a copy of that file, printed
  the Landing column row for row (P1-P5 1 marked; P6, P7 guard; P8 2 marked; P9
  2 marked; P10-P14 and P16 BUILD-OK with 1 marked in the text; P15 2 marked; D1
  and D2 tagged 1), and R1 read 150,340.9 / 2,334,391.0 / 38,205,922.4 µs at
  22,000 / 88,000 / 352,000 characters (ratio 352,000 to 88,000: 16.4).
- Claim: Done when 1 holds. On the fixed tree `repo-133-population.mts` prints
  P1-P5 BUILD-OK with 1 marked, P6 and P7 BUILD-FAIL (guard), P8 BUILD-OK with 1
  marked (the entry), P9 and P15 BUILD-OK with 1 marked (Vite's helper
  `/assets/index-P2Xu9kJm.js`) and the remote unmarked, P10-P14 and P16
  BUILD-FAIL (guard), D1 and D2 `tagged=0`. That is the Expected column on all 18
  rows.
- Claim: Done when 3 holds, and this is the measurement its bound is graded
  against (the owner's answer above). On the fixed tree, median of five, no other
  job running: 1,484.7 µs at 22,000 characters, 3,409.4 µs at 88,000,
  11,970.5 µs at 352,000. 11,970.5 µs is 12 ms against the 1,000,000 µs bound,
  and the ratio 352,000 to 88,000 is 3.51 against the bound of 8 (a first run
  with the before-probe still running on the machine read 13,642.2 µs and 3.87).
  So the bound of eight sits above parse5's measured 3.5 and below the landing's
  16.4, as gate 2's single-run 3.2 and 16.9 had it: eight is a direction that
  separates the two, and has not been tuned to either.
- Claim: Done when 2 holds. `npx vitest run packages/ui/test/vite-plugin.test.ts`
  gives 18 of 18 passed on the fix; the same file with `vite.ts` restored from
  `9de83197` (the landing's) gives 13 failed | 5 passed: P8, P9, P10, P11, P12,
  P13, P14, P16, P15, D1, D2, and two the probe has no row for (a remote origin
  in `//`, `\\`, leading-whitespace and `data:` spellings; a `<template>`'s
  script). The five that pass on both are the four existing cases and one new
  regression guard (offsets past CRLF and an astral character), which the
  landing's regexp could not get wrong. `npm test -- --project core` was not
  run as a whole; the narrower file and `npm run check` (exit 0) were.
- Claim: the real consumers still build. `cd tools/downloader/web && npx vite
  build` writes `dist/app/index.html` with
  `<script blocking="render" type="module" crossorigin src="/assets/index-CDFfo_Lk.js">`,
  and `npx vitest run tools/downloader/web/test/vite-config.test.ts packages/ui`
  gives 74 of 74.
- Dependency: `parse5` `^8.0.1` is declared under `dependencies` in
  `packages/ui/package.json` (the plugin runs in Node inside every tool's Vite
  config, so it is a runtime dependency of the package, not a dev one). The
  version does not move from the lockfile's 8.0.1, so the seven-day rule is not
  engaged. No `npm install` was run: the `packages/ui` entry in `package-lock.json`
  was edited by hand to add the dependency, and `node scripts/check-lockfile-sync.mjs`
  then printed a diff of exactly two lines, `"dev": true` on `node_modules/parse5`
  and `node_modules/entities`, which were removed by hand; it now prints
  `up to date` and nothing else. `entities` 8.1.0 is parse5's only dependency.
- What the brief had wrong or left open. (1) "Whether the lock's `dev` flag
  changes" is answered: it does, on parse5 and on its dependency `entities`,
  because `dependencies` makes both production. (2) The vite.ts message changed
  from "no external module script" to "no external module script on the same
  origin"; the existing case's regexp still matches. (3) A tag with a `blocking`
  attribute that lacks `render` is left alone and counts as an entry, as the
  landing's `(?![^>]*\bblocking=)` also left it alone; Vite writes none, so no
  tool reaches it. (4) A tool built with an absolute `base` on another origin
  would have its entry read as remote and the guard would fail the build. The
  landing marked it. No tool does this (each CSP names one origin); it is
  stated here so the next reader does not rediscover it.
- Fold-in: none. Nothing else small and already specified came free.
- 2026-11-01 — Owner answers after gate 1 (asked by the orchestrator,
  2026-11-01). The first low, the RangeError on wide documents: fix it at
  landing and record the rest. The second, third and fifth lows (`<base href>`
  and the `http:` spellings, parse5 nesting cost, the padded `type`) stay
  recorded and are not fixed. The fourth low, where parse5 is declared: keep
  it in `dependencies`; nothing changes.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the first low
  ("a document with 300,000 sibling elements"). The children are pushed one at
  a time, in the same order. Before the fix, `addRenderBlocking` on 300,000
  sibling `<br>` elements and one module script printed
  `wide 300000 threw RangeError: Maximum call stack size exceeded`; after it,
  `wide 300000 tagged 1 419 ms`. `npx vitest run packages/ui/test/vite-plugin.test.ts`
  passes 18 of 18.
