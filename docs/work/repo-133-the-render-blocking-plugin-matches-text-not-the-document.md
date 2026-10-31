---
id: repo-133
tool: repo
title: The render-blocking plugin matches text, not the document
kind: fix
status: needs-decision
milestone: null
depends_on: [repo-131]
difficulty: hard
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
5. If Decision 1 is answered "accept R1", the answer commit rewords Done when 1
   and 2 to what that option leaves. Done when 1 becomes: each row gives the
   landing verdict recorded in the table as accepted, with P9 and P15 as Decision
   2 records. Done when 2 becomes: the four
   existing cases still pass and P1 to P7 give their Expected in the probe, with no
   new case. Done when 3 and 4 stand. With both rewords, the ticket can reach `done`
   once Decision 2 is answered too.

## Decision — open

Two questions are open, and neither has a recommendation: the measurement that
would pick one has not been taken, and the costs are stated for each option. A
third, the form of option 3, is answered first.

**Option 3's form. Answered 2026-10-31 by the owner.** The options were: (a) keep
option 3 as a free-form note above `ENTRY_TAG`, saying plainly that it is not
adr/005's register; (b) drop option 3, leaving the two remedies. The owner chose
(a), the gate's recommendation.

**1. Which remedy for the matcher. Open.**

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

**2. Whether the guard passes on P9. Open.** P9's only same-origin module script
is Vite's own modulepreload helper, not the app's entry. Options:

- The guard counts only the app's entry, so P9 fails with BUILD-FAIL (guard), as
  P6 does. Costs: the plugin must tell Vite's helper from the app's entry, which
  is not measured for any of the three remedies.
- The guard counts any same-origin module script, as now, so P9 passes. Costs:
  the guard then means "some module script is there", not "the app's entry is
  marked".

**Difficulty.** `hard` is my proposal, rated for the scanner, the option that
needs the most judgement. Parse5 would be `standard`; accepting R1 would be
`mechanical`. The commit that records the answer re-rates it.

## Done when

1. Each row of the table gives its Expected verdict on a tree built with the
   fix: `repo-133-population.mts` writes P1 to P16 and D1 and D2 that way. P9 and
   P15 are as Decision 2 records.
2. `packages/ui/test/vite-plugin.test.ts` has one new case each for P8, P9, P10
   to P16, D1 and D2, the rows the fix changes, with P9 and P15 as Decision 2
   records. The four existing cases still pass, and P1 to P7 give their Expected
   in the probe. Run with `npm test -- --project core`.
3. R1: the median for the 352,000-character row in `repo-133-redos.mts`'s output
   is under 1,000,000 µs (one second). The landing's median is 37,336,885 µs, so it
   misses. A one-pass `indexOf` scan, timed the same way as a stand-in in round 1,
   has a median of about 4 µs at that size, so a linear scan meets it. The real
   remedies are unmeasured. Under Decision 1's
   accepted option, R1 is unchanged and the comment above `ENTRY_TAG` records it.
4. The default-setup `CodeQL` check is green on the pull request's head.
5. `npm run check` passes.

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
  reports no difference, and the file holds one `modulepreload` (`grep -c` 1).
- Claim: R1 is quadratic on the landing version. Round 1, `repo-133-redos.mts`
  on the same tree, median of five calls per size: 146,530.3 µs at 22,000
  characters, 2,323,721.8 µs at 88,000, 37,336,885.1 µs at 352,000. The last
  two sizes differ by 16.07 times for a fourfold step in length.
- Claim: a one-pass `indexOf` scan, timed by the same method, is a stand-in and
  not a remedy: medians of 1.3, 2.3 and 4.2 µs at the three sizes. Done when 3's
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
