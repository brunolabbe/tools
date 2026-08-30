---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "tsconfig*.json"
  - "vitest.config.ts"
  - "**/test/fixtures/**"
---

# Testing

Lifted out of the root `CLAUDE.md` so it loads when you are in a test, a
fixture or a tsconfig, and costs nothing the rest of the time. The rules are
unchanged.


**vitest**, configured once in the root `vitest.config.ts` as one project per
tool plus one for `packages/`. Tests live in `<package>/test/**/*.test.{ts,tsx}`.
Import `test`/`expect`/`vi` explicitly — globals are off on purpose, so oxlint's
`no-undef` keeps working.

**Tests are typechecked, and by the same gate the source is.** So `npm run
check` holds a fake to the signature of the thing it fakes, and there is no
second command to remember. `tsconfig.tests.json` at the root covers every suite
that runs under node — its `include` is a glob, so **a new package's tests cost
one reference line there, not a file**. Only a genuinely different compiler surface earns a file of
its own, and there are three beyond the default: the `web` surface (Bundler +
DOM + JSX), the Playwright surface (DOM + Playwright's types) and
`scripts/test` (`allowJs`). They split on `lib` and `types` being per-project,
which is what keeps `document` out of scope in an API test — enforced, not
aspirational.

**A surface is shared; a project file is not.** `tools/downloader/e2e` and
`tools/planner/e2e` are the same surface and still need one file each, because a
project's `include` is rooted at its own directory — there is no way to write one
that spans both without moving the specs. The same is true of the `web` surface
since pl-12: `tools/downloader/web/test` and `tools/planner/web/test` are twins.
So the count of surfaces is three and the count of files is five, and a second
tool's e2e or `web` suite costs a file of its own copied from the first. That is
not the per-package `test/tsconfig.json` shape below returning: it is one file
per _tool's_ suite on a shared surface, of which there are as many as there are
tools with one.

Do not add a `test/tsconfig.json` back per package; that shape existed briefly and
was eight copies of the same five lines. Do not reach for `node:test`: the pinned Node (22.15)
cannot strip TypeScript types without a flag, so `.ts` tests fail under it.

Fixtures, not live network calls — real services change, rate-limit and geo-vary,
which makes CI failures meaningless. Check in real payloads under
`test/fixtures/` and parse them offline. E2E runs against a local fixture server.

**What keeps the formatter off them is `**/test/fixtures/` in `.oxfmtrc.json`,
and the `**/` is the whole of it.** These are gitignore-shaped patterns: an entry
with an internal slash is anchored to the config's directory, so the bare
`test/fixtures/` that stood there until repo-4 matched nothing, and every fixture
**oxfmt claims** was formatted like source. That is the `.json`, `.html` and
`.mjs` ones and only those — the `.m3u8`, `.mpd`, `.m4s`, `.mp4`, `.txt` and
`.png` captures are extensions oxfmt never handled, so the manifests and segments
were never at risk and no one should go hunting damage in them. For JSON the
damage would be indentation only, but oxfmt reflows HTML text nodes and rewrites
inline `<script>`, which is editing the thing under test. A fixture directory must therefore be named
`test/fixtures/` to be covered; do not broaden the entry to `**/fixtures/`,
which would swallow `tools/downloader/e2e/fixtures/hls-origin.ts`, TypeScript
the repo does want formatted. Anything under a covered directory is exempt
whatever its extension.

**A test that runs a tool out of `node_modules` cannot spawn its `bin` directly,
because Windows does not honour a shebang.** `packages/core`'s oxfmt scan learned
this the expensive way. `node_modules/oxfmt/bin/oxfmt` is a three-line
`#!/usr/bin/env node` script reached through a symlink; npm writes `.cmd` and
`.ps1` shims beside it, and spawning either needs a shell — which this repo
forbids outright and enforces in `packages/core/test/spawn-safety.test.ts`, so the
easy way out is closed by design. The process then simply never starts: both pipes
come back `undefined`, a `?? ""` collapses them to `""`, and an assertion about
the tool's output blames a missing _message_ for a missing _process_. It fails on
Windows only, and it reads as a wording change in the tool.

Resolve the package and run its entry under `process.execPath` instead —
`createRequire(import.meta.url).resolve("<pkg>/package.json")`, then its `bin`
field — and **assert the spawn itself succeeded** (`expect(result.error).toBeUndefined()`)
so the next platform difference cannot disguise itself as a failed assertion. Then
assert on what the tool *did* to a file, never on the words it printed: a
third-party diagnostic is not yours to depend on, and the exit code alone cannot
tell "excluded" from "clean".

CI runs lint, typecheck and every unit suite on every push. **`ci.yml`'s `check`
job is filtered by nothing at all**, markdown included, because `npm run check`
runs `oxfmt --check` and oxfmt formats markdown here — a documentation-only
change can break it, and used to merge green because CI skipped `**.md`
entirely. The unit matrix still skips a change that is all `.md`, through a
`changes` job rather than a trigger filter. A tool's slow gates (e2e, container
build) live in `.github/workflows/<tool>.yml`, path-filtered so work on one tool
does not pay for another's.
