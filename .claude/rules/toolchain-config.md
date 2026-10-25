---
paths:
  - ".oxlintrc.json"
  - ".oxfmtrc.json"
---

# The two oxc config files

Lifted out of the root `CLAUDE.md` so it loads when you open one of them. The
rules are unchanged.

**Both are JSONC despite the `.json` extension** — they carry `//` comments,
neither survives a strict `JSON.parse`, and no code here parses either one; only
the oxc binaries read them, and oxfmt preserves the comments when it formats them.
`.oxlintrc.json` has been commented since `b876906`. Editor JSON validators will
squiggle both unless `files.associations` maps them to `jsonc`.

`oxfmt` is opinionated in the gofmt sense, but it is not a one-key formatter:
**at 0.74.0, the pinned version, it honours `ignorePatterns`, `printWidth`,
`proseWrap`, `singleQuote` and `tabWidth`, among others** (those five are the ones
measured, at 0.62.0; at 0.74.0 all five are still in the shipped
`configuration_schema.json`, which is the full list, and `lineWidth` and
`quoteStyle` were re-measured as still ignored).
`proseWrap: "always"` is what switches markdown wrapping on, and `printWidth` is the
width it wraps to (default 100; `printWidth` alone leaves markdown untouched). Keys that are not oxfmt's, like
`quoteStyle` and `lineWidth`, parse without error and are silently ignored, so do
not add them. This repo's `.oxfmtrc.json` sets only `ignorePatterns`, so the output
is oxfmt's defaults (double quotes, 100 columns, prose never reflowed): do not argue
with it, run `npm run format` and move on. Lint rules, by contrast, are fully
configurable in `.oxlintrc.json`.

A config is also picked up from a directory above the file being formatted, not
only from the working directory: a stray `.oxfmtrc.json` in a parent
of a scratch fixture changes what `oxfmt` does to it, and an `ignorePatterns` entry
that matches every target makes `oxfmt` exit 2 ("Expected at least one target
file").

`ignorePatterns` entries are gitignore-shaped: an entry with an internal slash is
anchored to the config's directory, so a bare `test/fixtures/` matches nothing and
`**/test/fixtures/` is what actually covers them. Do not broaden that to
`**/fixtures/` — it would swallow `tools/downloader/e2e/fixtures/hls-origin.ts`,
TypeScript the repo does want formatted.
