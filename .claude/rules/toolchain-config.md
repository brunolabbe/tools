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

`oxfmt` is opinionated in the gofmt sense — **at the pinned version the only
setting it honours is `ignorePatterns`.** Style keys like `quoteStyle` and
`lineWidth` parse without error but are silently ignored, so do not add them and
do not argue with its output (it uses double quotes). Run `npm run format` and
move on. Lint rules, by contrast, are fully configurable in `.oxlintrc.json`.

`ignorePatterns` entries are gitignore-shaped: an entry with an internal slash is
anchored to the config's directory, so a bare `test/fixtures/` matches nothing and
`**/test/fixtures/` is what actually covers them. Do not broaden that to
`**/fixtures/` — it would swallow `tools/downloader/e2e/fixtures/hls-origin.ts`,
TypeScript the repo does want formatted.
