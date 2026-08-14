# CLAUDE.md

Conventions for every agent working in this repo, whichever tool you are in.
Each tool under `tools/` has its own `CLAUDE.md` carrying the rules that apply
only there — **read that one too** before touching its code, and do not import
its rules into another tool.

## What this is

A repo of small, independent web tools that share a toolchain, a CI pipeline and
a set of conventions. They do not share a domain. Today:

- `tools/downloader` — page URL in, video stream found and downloaded, link out.

## Layout

```
packages/core        tool-agnostic primitives: error machinery, job transitions, redaction
tools/<tool>/
  contract/          that tool's types, error codes, zod schemas — its seam
  <libraries>/       whatever that tool needs (the downloader has resolvers, engine)
  api/               its HTTP service
  web/               its UI
  e2e/               its Playwright specs
docs/                analysis, architecture, roadmap, agent briefs, status
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
timed out, rate limited, canceled — live in `@webtools/core` and are shared.
Codes about a _domain_ belong to the tool. A new code that would mean something
to a tool which has never heard of yours belongs in core; anything else does not.

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
`no-undef` keeps working. Do not reach for `node:test`: the pinned Node (22.15)
cannot strip TypeScript types without a flag, so `.ts` tests fail under it.

Fixtures, not live network calls — real services change, rate-limit and geo-vary,
which makes CI failures meaningless. Check in real payloads under
`test/fixtures/` and parse them offline. E2E runs against a local fixture server.

CI runs lint, typecheck and every unit suite on every push. A tool's slow gates
(e2e, container build) live in `.github/workflows/<tool>.yml`, path-filtered so
work on one tool does not pay for another's.

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
3. Register the projects in the root `tsconfig.json` and a vitest project in
   `vitest.config.ts`.
4. `tools/<name>/CLAUDE.md` — what the tool is, and only the rules specific to
   it. Do not restate anything on this page.
5. `.github/workflows/<name>.yml` for anything slow, path-filtered to that tool.
