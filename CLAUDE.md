# CLAUDE.md

Conventions for every agent working in this repo, whichever tool you are in.
Each tool under `tools/` has its own `CLAUDE.md` carrying the rules that apply
only there — **read that one too** before touching its code, and do not import
its rules into another tool.

## What this is

A repo of small, independent web tools that share a toolchain, a CI pipeline and
a set of conventions. They do not share a domain. Today:

- `tools/downloader` — page URL in, video stream found and downloaded, link out.
- `tools/planner` — describe a trip, plan it with an assistant, keep the plan.

## Layout

```
packages/core        tool-agnostic primitives: error machinery, job transitions, redaction
tools/<tool>/
  contract/          that tool's types, error codes, zod schemas — its seam
  <libraries>/       whatever that tool needs (the downloader has resolvers, engine)
  api/               its HTTP service
  web/               its UI
  e2e/               its Playwright specs
  docs/              that tool's analysis, architecture, roadmap, status, tickets
docs/                repo-wide only: the tool index, the ticket format, ADRs
```

Two rules hold this shape, and they are the ones that keep tools from fusing:

**A tool never imports from another tool.** `@downloader/*` is off limits to
everything outside `tools/downloader`. If two tools need the same thing, it goes
to `packages/`. If you find yourself wanting the exception, say so instead.

**Shared code moves to `packages/` on the second real consumer, not the first
guess.** An abstraction extracted for an imagined caller fits neither. Build it
inside the tool, and lift it when something else actually needs it.

## Commands

```bash
npm install                   # workspaces
npm run check                 # lint + format check + typecheck — must pass before done
npm test                      # vitest, every project
npm test -- --project <tool>  # just one tool's suite — seconds, not a minute
npm run lint:fix              # oxlint --fix
npm run format                # oxfmt
npm run build                 # every workspace
```

Per-tool commands (`dev`, `e2e`) live in that tool's `CLAUDE.md`.

Tooling: **oxlint** and **oxfmt** (not eslint/prettier). Config in
`.oxlintrc.json` and `.oxfmtrc.json`.

`oxfmt` is opinionated in the gofmt sense — at the pinned version the only
setting it honours is `ignorePatterns`. Style keys like `quoteStyle` and
`lineWidth` parse without error but are silently ignored, so do not add them and
do not argue with its output (it uses double quotes). Run `npm run format` and
move on. Lint rules, by contrast, are fully configurable in `.oxlintrc.json`.

## Rules

**Each tool's `contract` package is its contract.** Import that tool's
cross-package types from `@<tool>/contract`, never redefine them locally. If you
think a contract is wrong, stop and say so — do not edit it unilaterally; its
sibling packages depend on it.

**Errors are typed, per tool.** Throw the `AppError` from your tool's contract,
with a code from its taxonomy. Never a bare `Error`, never an ad-hoc string
code. If no existing code fits, say so rather than inventing one locally.

Codes that describe the _transport or the job runner_ — bad URL, unreachable,
no such route, timed out, rate limited, canceled — live in `@webtools/core` and
are shared. Codes about a _domain_ belong to the tool. A new code that would mean
something to a tool which has never heard of yours belongs in core; anything else
does not.

`NOT_FOUND` and `JOB_NOT_FOUND` are both in core and are not interchangeable: the
first is a URL that matched no route, the second a job the runner has no record
of. `NOT_FOUND` is there because both tools independently reached for their
nearest _domain_ code for a route miss and re-worded it at the call site — which
is the tell. If the copy has to be replaced where the error is raised, the code is
the wrong one.

**Never invoke a shell.** Spawn with argument arrays, `shell: false`. User URLs
and titles reach subprocess arguments. Enforced repo-wide by a source scan in
`packages/core/test/spawn-safety.test.ts`.

**Kill process trees**, not processes. On Windows use `taskkill /T /F`; a bare
`child.kill()` leaves orphaned children behind.

**Redact credentials** anywhere headers or URLs are logged — `redactHeaders` and
`redactUrl` from `@webtools/core`. Captured headers routinely contain live
session credentials, and a signed URL carries its credential in the query
string, so a bare URL in a log line is as sensitive as a cookie.

**SSRF-check every URL** that a user influenced, including after each redirect
and including URLs that came back out of your own code.

**Never fake progress.** When the total is unknown, report `null` and let the UI
show an indeterminate state.

## Testing

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

CI runs lint, typecheck and every unit suite on every push. A tool's slow gates
(e2e, container build) live in `.github/workflows/<tool>.yml`, path-filtered so
work on one tool does not pay for another's.

## Documentation and work

**A tool's documentation lives with its code**, in `tools/<tool>/docs/`, on the
same spine for every tool: `00-ANALYSIS`, `01-ARCHITECTURE`, `02-ROADMAP`,
`03-STATUS`, and `work/`. The root `docs/` holds only what is true of the repo —
the tool index, the ticket format, and ADRs for decisions binding more than one
tool. A document that describes two tools is where two tools start to fuse.

**Work is one file per ticket** in `tools/<tool>/docs/work/`, carrying its brief
and its log together. Ids are prefixed per tool (`dl-`, `pl-`). The format, the
fields and the preamble to hand an agent are in
[docs/01-TICKETS.md](./docs/01-TICKETS.md).

Append to a ticket's Log when you finish work on it, including whatever the
brief turned out to have wrong. That is the note the next agent needs, and the
roadmap and status pages are deliberately too thin to hold it.

**Commits are conventional, and it is enforced.** `type(scope): subject`, with
the scope naming a tool (`downloader`, `planner`) or `core` · `repo` · `ci` ·
`deps`, and the ticket id in the subject: `fix(downloader): stop re-probing in
place (dl-9)`. `feat` and `fix` require a scope — they are the two that reach a
changelog. Versions and changelogs are generated from these commits per tool, so
a message is not paperwork: it is the release note. `.githooks/commit-msg`
rejects a bad one as you write it, and the rule itself lives in
`scripts/commit-message.mjs`. The taxonomy, the escape hatches and how a release
is cut are in [docs/03-RELEASING.md](./docs/03-RELEASING.md).

## Style

TypeScript strict, ESM, `.ts` extensions in relative imports (NodeNext),
`import type` for type-only imports, `node:` protocol for builtins. No `any`.
No `console` — use the logger. Comment _why_, not _what_.

## Adding a tool

1. `tools/<name>/contract` — its types and its error catalog, built on
   `@webtools/core` (copy `tools/downloader/contract/src/errors.ts`, which is the
   worked example).
2. Its packages, scoped `@<name>/*`, each with a `tsconfig.json` referencing the
   ones it depends on.
3. Register each package's `src` project in the root `tsconfig.json`, and add a
   vitest project in `vitest.config.ts`. Its tests are already inside
   `tsconfig.tests.json`'s glob, so they need only a `references` entry there.
   A `web` package is the exception, and it announces itself: the glob picks its
   tests up too, and they fail loudly against the node surface — no DOM lib, no
   JSX. Give it its own `test/tsconfig.json` beside the downloader's, add its
   path to that glob's `exclude`, and reference it from the root. The `exclude`
   names `tools/downloader/web/test/**` and nothing wider on purpose — a pattern
   that pre-excluded every tool's `web` would drop a new one into no project at
   all, and pass green while checking nothing.

   An `e2e` package is the quieter exception: its specs are `*.spec.ts` and sit
   outside any `test/` directory, so the glob never sees them and nothing fails
   to tell you they are unchecked. Copy `tools/planner/e2e/tsconfig.json`, which
   also pulls in the tool's `playwright.config.ts` from a directory up, and add
   the reference from the root. Skipping this is silent, which is exactly why it
   is listed here.

4. `tools/<name>/CLAUDE.md` — what the tool is, and only the rules specific to
   it. Do not restate anything on this page.
5. `tools/<name>/docs/02-ROADMAP.md` and an empty `work/`, plus a row in
   [docs/00-TOOLS.md](./docs/00-TOOLS.md). The rest of the spine arrives when
   there is something true to put in it — a young tool with two documents is an
   honest young tool.
6. `.github/workflows/<name>.yml` for anything slow, path-filtered to that tool.
7. To make it releasable: `tools/<name>/Dockerfile`, a `version.txt`, and an
   entry in both `release-please-config.json` and
   `.release-please-manifest.json`. Nothing in `release.yml` changes — it builds
   whatever was released. Add the image gate in step 6 _before_ the first
   release, so that release is not the first time the image is built.
