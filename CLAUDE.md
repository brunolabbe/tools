# CLAUDE.md

Conventions for every agent working in this repo, whichever tool you are in.
Each tool under `tools/` has its own `CLAUDE.md` carrying the rules that apply
only there — **read that one too** before touching its code, and do not import
its rules into another tool.

This page holds only what is true in **every** session. A rule that matters in one
part of the tree is a path-scoped rule in `.claude/rules/`, which loads itself when
you open a matching file; a multi-step procedure is a skill in `.claude/skills/`;
a role you dispatch is a subagent in `.claude/agents/`; and something that must
happen every time without exception is a hook in `.claude/hooks/`, wired up in
`.claude/settings.json`. Put a new convention in the narrowest of those that fits
— this page is the one that costs every session.

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
  docs/              that tool's analysis, architecture, roadmap, tickets
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
npx vitest run <package-dir>  # just one package, e.g. tools/downloader/api
npm run lint:fix              # oxlint --fix
npm run format                # oxfmt
npm run build                 # every workspace
npm run status                # open tickets per tool, computed from their frontmatter
npm run status -- --show <id> # one ticket: its fields, its blockers, its path
```

Per-tool commands (`dev`, `e2e`) live in that tool's `CLAUDE.md`.

Tooling: **oxlint** and **oxfmt** (not eslint/prettier). Config in
`.oxlintrc.json` and `.oxfmtrc.json`.

Both config files are **JSONC despite the `.json` extension**, and `oxfmt` honours
only `ignorePatterns` at the pinned version — do not argue with its output, run
`npm run format` and move on. The detail, and why the fixture ignore pattern needs
its `**/`, is in
[`.claude/rules/toolchain-config.md`](./.claude/rules/toolchain-config.md).

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

**An image ships every workspace its API resolves**, and **a package declares
every workspace it imports under `src`** — in `dependencies`, not
`devDependencies`. Both are enforced by a scan in
`packages/core/test/image-closure.test.ts`, which fails naming the missing line.
Why each `Dockerfile` keeps that list by hand twice and how the two halves fail
differently is in [`.claude/rules/image-closure.md`](./.claude/rules/image-closure.md),
which loads itself when you open one.

## Testing

**vitest**, one project per tool plus one for `packages/`, configured in the root
`vitest.config.ts`. Tests live in `<package>/test/**/*.test.{ts,tsx}` and are
typechecked by the same `npm run check` the source is. Import `test`/`expect`/`vi`
explicitly — globals are off on purpose. Fixtures, not live network calls.

The rest — how the tsconfig projects split, why a new package costs one reference
line and a `web` or `e2e` suite costs a file, and what `**/test/fixtures/` in
`.oxfmtrc.json` is protecting — is in
[`.claude/rules/testing.md`](./.claude/rules/testing.md), which loads itself when
you open a test, a fixture or a tsconfig.

CI runs lint, typecheck and every unit suite on every push. **`ci.yml`'s `check`
job is filtered by nothing at all**, markdown included, because `npm run check`
runs `oxfmt --check` and oxfmt formats markdown here — a documentation-only
change can break it, and used to merge green because CI skipped `**.md` entirely.
The unit matrix still skips an all-`.md` change, through a `changes` job rather
than a trigger filter. A tool's slow gates (e2e, container build) live in
`.github/workflows/<tool>.yml`, path-filtered so work on one tool does not pay for
another's.

## Documentation and work

**A tool's documentation lives with its code**, in `tools/<tool>/docs/`, on the
same spine for every tool: `00-ANALYSIS`, `01-ARCHITECTURE`, `02-ROADMAP`, and
`work/`. The root `docs/` holds only what is true of the repo — the tool index,
the ticket format, and ADRs for decisions binding more than one tool. A document
that describes two tools is where two tools start to fuse.

**Work is one file per ticket** in `tools/<tool>/docs/work/`, carrying its brief
and its log together. Ids are prefixed per tool (`dl-`, `pl-`), and repo-wide work
— the toolchain, the conventions, CI — is `repo-` in `docs/work/`. The format, the
fields and the preamble to hand an agent are in
[docs/01-TICKETS.md](./docs/01-TICKETS.md).

**A ticket carries a decision or a reproduction. If the work has neither left, do
it now** — a typo, a stale sentence, a rename the change you are making already
implies, work this branch has just made free. Filing costs an intake slot, a
dispatch, a gate, a pull request and a merge, paid later by someone with none of
the context; and nothing forces it, since `scripts/commit-message.mjs` accepts a
subject with no id. **Size is not the test** — a one-line fix for a _defect_ still
earns a ticket, because the reproduction is the deliverable. The threshold, the
inverse cases and what to do with a ticket you fold in are in
[docs/01-TICKETS.md](./docs/01-TICKETS.md).

Append to a ticket's Log when you finish work on it, including whatever the brief
turned out to have wrong. That is the note the next agent needs, and there is
nowhere else for it: the roadmap is deliberately too thin to hold it.

**There is no status page. The view is `npm run status`**, computed on every run
from the tickets so it cannot disagree with them — `-- --ready`, `-- --json`,
`-- --prs`, `-- --tool <name>`, `-- --show <id>`, `-- --markdown`. A projection
kept in version control needs a writer, and every writer available here was
unsafe, noisy or racy; the reasoning is in
[adr/003](./docs/adr/003-the-status-page-is-generated.md). A gap worth recording
is a ticket worth filing.

**A ticket's frontmatter is the only place its state is recorded.** Move a ticket
to `done` by editing the ticket, in the commit that earns it.

**A ticket file does not know about a branch.** It says `status: ready` until
something merges, so "what is next" is `gh pr list` first and the ticket files
second — otherwise a ticket that has been in review for four days reads as
untouched, and gets built twice. Check the base branch too: a pull request opened
against another feature branch disappears with it, and its own page still says
merged.

**Commits are conventional, and it is enforced.** `type(scope): subject`, with the
scope naming a tool (`downloader`, `planner`) or `core` · `repo` · `ci` · `deps`,
and the ticket id in the subject: `fix(downloader): stop re-probing in place
(dl-9)`. **Anything that reaches a changelog requires a scope**, because a
changelog line that does not say which tool it belongs to is noise. That set is
not written down anywhere: `scripts/commit-message.mjs` computes it from the
types that are not `hidden` in `release-please-config.json`, plus anything
breaking. So a type added to that config without `hidden` starts requiring a
scope the day it is added, with nothing here to update — which is the point, since
the hand-written list this replaced had been wrong about `perf` and `revert` for
as long as it existed. `.githooks/commit-msg` rejects a bad message as you write
it.

**The pull request title is the message that lands.** This repo squash-merges, so
a branch's own commits are working notes and the title is the changelog line —
check yours with `node scripts/commit-message.mjs --text "<title>"` before opening
the pull request. A commit that touches two tools lands in both changelogs under
one sentence written for one of them, which is the tell that it should have been
two commits — meaning **two pull requests**, since a squash merge lands one title
carrying every path in the branch.

**Changelog attribution is by path; the type decides whether there is one at
all.** release-please routes a commit to a tool by the files it touched, never by
the scope in its subject — so a `fix(repo):` whose only path under `tools/` is one
`.md` file releases that tool anyway. The way out is the type, not the scope:
`docs` is `hidden` in `release-please-config.json`. **Read the test off that config
rather than off this sentence** — a type added there without `hidden` is releasing
the day it is added. Worked examples and measurements:
[docs/03-RELEASING.md](./docs/03-RELEASING.md).

## What is denied

`.claude/settings.json` denies merging a pull request, cutting a release,
`gh api`, printing the gh auth token, `npm publish`, pushing to `main`, and
reading a real `.env` (`.env.example` stays readable). **A deny rule binds in
every permission mode, `--dangerously-skip-permissions` included** — it is the
only rule that still holds in the devcontainer, where prompts are off. Merging and
releasing are denied because they are **yours to decide**: the gate workflow
deliberately ends at "open the PR", and releases are cut by release-please from
merged commits.

**It is a guardrail, not a boundary** — a string-prefix match with no
understanding of intent, and measured escapes exist (`/bin/echo` defeats a deny on
`echo`). So **if you hit one, stop and say so; do not find another spelling.**
Routing around it defeats a decision the repo made on purpose, and it will work.

## Decisions

**Surface a decision as a question with options; never resolve it in prose.**
Whenever two readings of a task lead to materially different work — scope that
widens past what was asked, a contract-adjacent change, an architectural choice
two implementations would both satisfy, a defect that could be fixed here or
filed — ask, with `AskUserQuestion`, giving the concrete options and their real
costs, the recommended one first. Do not settle it with an assumption buried in a
paragraph and do not leave it as an observation in a document: an open decision
written as prose goes stale, and the next agent inherits it as a fact.

**Batch the questions** to a checkpoint rather than asking one at a time, and
**hold a question until you can bring a measurement rather than a guess** — where
the answer turns on a fact a single command would settle, spend the command and
ask once, with the number attached.

If you genuinely cannot ask — you are a subagent, and your report goes to whoever
dispatched you — then put the decision in the report **as options with a
recommendation**, labelled as an open decision, so the agent that can ask still
can. Never convert it into a choice you made quietly.

## Style

TypeScript strict, ESM, `.ts` extensions in relative imports (NodeNext),
`import type` for type-only imports, `node:` protocol for builtins. No `any`.
No `console` — use the logger. Comment _why_, not _what_.

## Adding a tool

Seven steps, two of which fail silently if skipped. They are in the
[`add-tool`](./.claude/skills/add-tool/SKILL.md) skill — run `/add-tool` rather
than working from memory.
