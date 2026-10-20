---
id: repo-107
tool: repo
title: CLAUDE.md and the toolchain rule say oxfmt honours only ignorePatterns, and a parent config wraps markdown at 0.62.0
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-107 — oxfmt honours more than `ignorePatterns`, and the pages say it does not

## Why

Two pages state that `oxfmt` at the pinned version honours one setting only:

- `CLAUDE.md`, lines 78–79. Line 78: "Both config files are **JSONC despite the
  `.json` extension**, and `oxfmt` honours". Line 79: "only `ignorePatterns` at the
  pinned version — do not argue with its output, run".
- `.claude/rules/toolchain-config.md`, lines 18–19. Line 18: "`oxfmt` is
  opinionated in the gofmt sense — **at the pinned version the only". Line 19:
  "setting it honours is `ignorePatterns`.** Style keys like `quoteStyle` and".

Those two claims are the reason a reader does not look at `printWidth` or
`proseWrap`. The reproduction below says the claim is wrong for both keys at
oxfmt `0.62.0`, the version `package.json` pins (`"oxfmt": "^0.62.0"`).

The owner decided on 2026-10-18 to file this so a later batch isolates the key
and corrects both pages. Filed from repo-100's gate reproduction: a parent
`.oxfmtrc.json` above the temp directory with `printWidth: 10, proseWrap:
"always"` wrapped one markdown bullet over ten lines or more, and a parent with
`ignorePatterns` made `oxfmt` exit 2 (the exit-2 case is the gate's and is not
reproduced here).

**Reproduced by the filer, 2026-10-18,** under the scratch directory, with
`npx oxfmt <absolute path to sub/a.md>` run from the repository root. Each row
puts one `.oxfmtrc.json` in the directory above `sub/`, and `sub/a.md` holds one
long bullet. The control row has no config:

| Parent `.oxfmtrc.json`                      | Exit | Lines after `oxfmt` | Shape of the output                           |
| ------------------------------------------- | ---- | ------------------- | --------------------------------------------- |
| none (control)                              | 0    | 1                   | unchanged                                     |
| `{"printWidth": 10, "proseWrap": "always"}` | 0    | 19                  | one word per line                             |
| `{"printWidth": 10}`                        | 0    | 1                   | unchanged                                     |
| `{"proseWrap": "always"}`                   | 0    | 2                   | wrapped at 100 columns, oxfmt's default width |

The combined-config run, as the filer ran it:

```
$ npx oxfmt <scratch>/repro/sub/a.md   # <scratch>: the absolute path to the fixture directory
Finished in 289ms on 1 files using 12 threads.
```

The file it then held, one word per line from the first `-` (middle lines elided):

```
- This is
  a long
  markdown
  ...
  lines.
```

So `proseWrap` is the key that switches wrapping on, and `printWidth` sets the
width it wraps to. `printWidth` alone changes nothing, and `proseWrap` alone wraps
at oxfmt's default width of 100, not at ten; together they wrap at ten. Both are
honoured from a parent config, so both sentences on the pages are wrong. The
repo's own `.oxfmtrc.json` sets only `ignorePatterns`, which matches nothing in
the scratch path, and the control row shows no wrap, so the repo's file adds
nothing to these rows. Whether the repo's own file would honour `proseWrap` for a
file inside the repo is not tested here.

## Build

1. **Measure the key set first, in the scratch directory.** Run the same fixture
   for each key the two pages name or imply: `printWidth`, `proseWrap`,
   `lineWidth`, `quoteStyle`. Use one parent config per key, with the key set to a
   value that changes output, and the control with none. Record the exit code and
   the line count of each. A key that changes nothing is named as ignored; a key
   that changes the output is named as honoured. Run `npx oxfmt` by absolute path
   from the repository root, as the reproduction did, and say in the Log whether
   the repo's `.oxfmtrc.json` was in the path.
2. **Reproduce the gate's `ignorePatterns` exit 2.** A parent with
   `ignorePatterns` made `oxfmt` exit 2 on the gate's run. Reproduce it or record
   that it did not reproduce, with the command and output.
3. **Correct the pages. Only in a batch the owner selects.** `CLAUDE.md` lines
   78–79 and `.claude/rules/toolchain-config.md` lines 18–19 are the two
   sentences. Replace each with the key set step 1 measured, and the version it was
   measured at. Editing `CLAUDE.md` and a path-scoped rule page is outside a
   single builder's dispatch unless the owner names it; a builder dispatched
   without that selection stops after step 2 and records the measured key set in
   the Log.
4. Run `npx oxfmt` on the two edited markdown files, then `npm run check`.

## Done when

1. The Log holds the command and output for each key in step 1, the control, and
   the exit code and line count of each, from runs made by the builder.
2. The Log holds the step 2 result for the `ignorePatterns` exit 2, reproduced
   or not, with its command and output.
3. `CLAUDE.md` lines 78–79 and `.claude/rules/toolchain-config.md` lines 18–19 no
   longer say that `ignorePatterns` is the only key honoured, and name the keys
   step 1 measured, with the version. `npm run check` passes after the edit.
4. The edit is in a batch the owner selected, and the Log names that batch.

## Log

- **2026-10-18** — Filed by a maintenance dispatch on `origin/main` `140bd78a`
  (the page read at `960f4b26` is unchanged there).
  Line numbers from `grep -n`: `CLAUDE.md` 78–79 and
  `.claude/rules/toolchain-config.md` 18–19. The reproduction table was run by the
  filer in a scratch directory outside the repository, with `oxfmt` 0.62.0 from
  the farm. The combined row is the gate's reproduction; the three rows beside it
  isolate the key. The `ignorePatterns` exit 2 (step 2) was not run by the filer.
  Step 1 is the Build's, not the filing's: the key set beyond these four runs is
  unmeasured.

- **2026-10-19** — Built on `origin/main` `f7436872`, oxfmt `0.62.0`
  (`npx oxfmt --version` printed `Version: 0.62.0`). **Owner selection (Done when
  4):** the owner selected this ticket on 2026-10-19 in the batch "tools-13,
  2026-10-19: repo-108, repo-107, repo-106", chosen from four batch options; that
  selection names the edits to `CLAUDE.md` and `.claude/rules/toolchain-config.md`,
  so step 3 is done here.

  **Step 1, the key set.** Fixture per row, built by
  `scratchpad/repo-107/build/measure.mjs` (spawn with an argument array, no shell):
  `<fixture>/.oxfmtrc.json` above `<fixture>/sub/`, which holds `a.md` (one
  172-character bullet) and `a.ts` (a double-quoted string, an array of objects, a
  five-parameter function indented with a tab). `npx oxfmt <abs>/sub/a.md <abs>/sub/a.ts`
  run from the worktree root, so the repo's `.oxfmtrc.json` was **not** in the
  fixtures' path (the scratch directory is outside the repository). The `.ts` column
  is what changes for the keys that are not about prose. Lines are those after the
  run; `a.ts` is 5 lines in the control after formatting.

  | Parent `.oxfmtrc.json`                   | Exit | `a.md` lines | `a.ts` lines | Other effect on `a.ts`  | Verdict                     |
  | ---------------------------------------- | ---- | ------------ | ------------ | ----------------------- | --------------------------- |
  | none (control)                           | 0    | 1            | 5            | double quotes, indent 2 | defaults                    |
  | `{"printWidth":10}`                      | 0    | 1            | 33           |                         | honoured (code), md still 1 |
  | `{"proseWrap":"always"}`                 | 0    | 2            | 5            |                         | honoured (wraps at 100)     |
  | `{"printWidth":10,"proseWrap":"always"}` | 0    | 24           | 33           |                         | both honoured               |
  | `{"lineWidth":10}`                       | 0    | 1            | 5            |                         | **ignored**                 |
  | `{"lineWidth":10,"proseWrap":"always"}`  | 0    | 2            | 5            |                         | `lineWidth` ignored         |
  | `{"quoteStyle":"single"}`                | 0    | 1            | 5            | still double quotes     | **ignored**                 |
  | `{"singleQuote":true}`                   | 0    | 1            | 5            | `'hello'`               | honoured                    |
  | `{"tabWidth":8}`                         | 0    | 1            | 5            | indent 8                | honoured                    |

  The combined row is 24 lines here, not the filing's 19, because this bullet is
  longer than the filing's; the 1, 2 and 1 of the single-key rows match it. Two
  unknown keys, `lineWidth` and `quoteStyle`, exit 0 with no warning, which is the
  "parse without error" half of the old sentence and is still true. The same keys
  given through `-c <path>` to a config outside the parent chain
  (`scratchpad/repo-107/build/measure2.mjs`) gave the same `a.md` line counts: 1
  for `printWidth` alone, 2 for `proseWrap` alone, 24 for both. So a config named
  with `-c` honours them as a discovered parent does; the repo's root file is found
  by discovery from the working directory (`package.json` runs bare `oxfmt` and
  `oxfmt --check`), not given with `-c`.
  **Unmeasured:** whether a key set in the repo's own `.oxfmtrc.json` changes a file
  inside the repo (no key but `ignorePatterns` was put in that file, and the
  branch does not change it), `useTabs`, and the other oxfmt keys beyond the nine
  rows above.

  **Step 2, `ignorePatterns` exit 2: reproduced**, and it is not a fault. Same
  fixture shape, one target file `sub/a.md`, parent config as shown, discovered:

  | Parent `.oxfmtrc.json`            | Exit | Last line of output                                                                            |
  | --------------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
  | `{"ignorePatterns":["a.md"]}`     | 2    | `Expected at least one target file. All matched files may have been excluded by ignore rules.` |
  | `{"ignorePatterns":["*.md"]}`     | 2    | same                                                                                           |
  | `{"ignorePatterns":["sub/"]}`     | 2    | same                                                                                           |
  | `{"ignorePatterns":["nomatch/"]}` | 0    | `Finished in 211ms on 1 files using 12 threads.`                                               |
  | `{"ignorePatterns":[".claude/"]}` | 0    | `Finished in 184ms on 1 files using 12 threads.`                                               |
  | `-c` file, `["sub/"]`             | 2    | same                                                                                           |

  The exit is 2 whenever the patterns exclude every target; with a second target
  that survives (the first pass, `a.md` ignored but `a.ts` given) it is 0. That
  is the gate's exit 2: a parent config whose `ignorePatterns` matched the one file
  it was handed. The same message is what the dispatch measured for
  `npx oxfmt --check .claude/rules/toolchain-config.md` on `f7436872`, because the
  repo's own `.oxfmtrc.json` ignores `.claude/`.

  **Step 3, the pages.** `CLAUDE.md` (the Commands/Tooling sentence only, which
  keeps clear of repo-108's Layout hunk) and `.claude/rules/toolchain-config.md`
  now name the five honoured keys and the two ignored ones, with `0.62.0`. The rules
  page also gains a short paragraph on the parent-config discovery and the exit 2,
  which the reproduction made free to state. **Step 4:** `npx oxfmt CLAUDE.md`
  printed `Finished in 359ms on 1 files` and left the diff as written. For the rules
  page, `npx oxfmt --check .claude/rules/toolchain-config.md` exits 2 with
  `Expected at least one target file. All matched files may have been excluded by
ignore rules.`, as the dispatch measured, so it cannot be formatted by the tool
  and its wrapping was kept by hand to the width of the lines around it.

  **Fold-in.** None other. `docs/work/repo-55-...md` line 83 says oxfmt "reflows no
  prose at all" for the repo's config; that is a closed ticket's record and true
  for that config, so it is left (a done ticket is not edited).

  **The brief had wrong:** step 4 asks for `npx oxfmt` on the rules page, which
  `.oxfmtrc.json` ignores (`.claude/`); and the filing's "`printWidth` alone
  changes nothing" holds only for markdown — `printWidth` changes code at once
  (`a.ts` 5 to 33 lines), so the pages' list needed it as a code key too.

- 2026-10-20 — Fixed at landing by owner choice: gate 1, the first low
  (`nfr:maintainability`) — "Both pages list five keys as the ones oxfmt honours, and
  the list reads as complete. It is not." The owner chose "fix both at landing" on
  2026-10-19; both pages now say the five are the measured ones, "among others", and
  name the `configuration_schema.json` shipped with oxfmt as the full list.
  `ls node_modules/oxfmt/configuration_schema.json` → the file exists, and
  `Object.keys(schema.properties).length` → `26`, with `lineWidth` and `quoteStyle`
  absent. `grep -c "configuration_schema.json" CLAUDE.md .claude/rules/toolchain-config.md`
  → `CLAUDE.md:1`, `.claude/rules/toolchain-config.md:1`.

- 2026-10-20 — Fixed at landing by owner choice: gate 1, the second low (Log only) —
  "The Log's step 1 says a config named with `-c` is how the repo's root file is
  given. It is not." The Log's step-1 sentence now says the root file is found by
  discovery from the working directory. `grep -n "runs ba[r]e" <ticket>`
  prints only the step-1 line, 156 (the bracket keeps this entry from matching).
  `grep -n '"oxfmt' package.json` shows `54:    "format:check": "oxfmt --check",`,
  bare, with no `-c`.
