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
