---
id: repo-108
tool: repo
title: Share one set of design tokens across the three web UIs
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-108 — Share one set of design tokens across the three web UIs

## Why

Each web UI is React 19 on Vite 7 with one hand-written stylesheet and nothing
shared: `tools/downloader/web/src/styles.css` (969 lines),
`tools/planner/web/src/styles.css` (570), `tools/ledger/web/src/styles.css`
(741). All three already use the same pattern: colour roles as custom
properties on `:root`, overridden under `prefers-color-scheme: dark`, and
`--radius: 10px`. They share `--bg`, `--surface`, `--border`, `--text` and
`--accent`. Then they diverge:

| Role           | downloader     | planner   | ledger    |
| -------------- | -------------- | --------- | --------- |
| muted text     | `--text-muted` | `--muted` | `--muted` |
| error          | `--danger`     | `--bad`   | `--bad`   |
| success        | `--ok`         | —         | —         |
| spacing        | —              | `--gap`   | `--gap`   |
| explicit theme | `[data-theme]` | —         | —         |

Ledger's `--bad` is planner's, hex for hex (`#a3341f` / `#e8836a`), so the
copying has already happened by hand. Three real consumers pass the root
`CLAUDE.md` test for lifting code to `packages/`.

Components do not pass it yet. Measured 2026-10-18 on `main@140bd78a`: of 174
top-level class selectors across the three stylesheets, 12 names appear in more
than one tool and only `.muted` in all three. No `.tsx` file name repeats except
`App.tsx` and `main.tsx`.

## Decision — answered 2026-10-18 by the owner

**Scope.** Options were: tokens only, with components added on the second
consumer · tokens plus the proven overlap (`.card`, `.notice`, `.sr-only`,
`.muted`) · a full React component library up front, as a recorded exception to
the second-consumer rule · nothing for now. **Chosen: tokens now, and the
package grows into the component library one component at a time**, each one
lifted when a second tool needs it. The owner's long-term aim is the full
library; this is the route there that keeps to the rule.

**Identity.** Options were: shared names with each tool keeping its own palette ·
one shared look. **Chosen: shared names, own palette.** Planner's warm greys and
downloader's cool ones stay as they are.

## Build

1. **Package.** Create `packages/ui` as `@webtools/ui`. It is named for where it
   is going (components), not for its first contents. To start it holds
   `src/tokens.css`, exported as `@webtools/ui/tokens.css`. That file holds
   - the **non-colour** token names: `--radius` (10px in all three), `--gap`,
     a spacing scale, and a font-size and font-stack scale as names. The
     _values_ stay per tool where they differ today: body text is 15px in
     downloader, 16px in planner and unset in ledger, and the stacks differ
     too;
   - `--page-width`, the content column's `max-width`, defaulting to `62rem`.
     Downloader's `.app` and planner's `.shell` both use 62rem today. Ledger's
     `.shell` sets its own `40rem`: a phone-first column that stays narrow on
     purpose. Each container then reads `max-width: var(--page-width)`;
   - `color-scheme: light dark`, and the only base rules the three files share
     exactly today: `box-sizing: border-box` on `*`, and `margin: 0`,
     `background: var(--bg)` and `color: var(--text)` on `body`;
   - `.sr-only`, which two tools define;
   - a header comment listing the **colour role names** every tool must set,
     and saying the values belong to the tool.

   It holds no colour values: the palette stays per tool.

   **Trap:** breakpoints cannot be tokens. A custom property does not resolve
   inside `@media (max-width: …)`. Planner's 46rem and 34rem and ledger's 48rem
   stay as literals in each tool's stylesheet. Do not reach for a preprocessor
   or `@custom-media` to get round it; that is a toolchain decision, not part of
   this ticket.

2. **Vocabulary.** The canonical colour roles are `--bg`, `--surface`,
   `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`,
   `--accent-text`, `--ok`, `--warn`, `--danger`. Keep downloader's spellings,
   since they say what the role is. Rename planner's and ledger's `--muted` →
   `--text-muted` and `--bad` → `--danger` at every use. A tool's extra role
   (downloader's `--blocked`, planner's `--warn-bg`) stays local. Do not force it
   into the shared list unless a second tool needs it.
3. **Adopt.** Each `tools/<tool>/web/src/main.tsx` imports
   `@webtools/ui/tokens.css` before `./styles.css`. Each tool's stylesheet drops
   whatever the shared file now provides, but **only where the rule is identical
   in effect**. A near-duplicate stays local.
4. **Theme switching.** Leave downloader's `[data-theme]` override where it is.
   Lifting it is the second-consumer test again, and no second tool has a theme
   picker.
5. **Manifests.**
   - Each `tools/<tool>/web/package.json` lists `@webtools/ui` in
     `dependencies`.
   - Each `tools/<tool>/Dockerfile` adds `COPY packages/ui/package.json
packages/ui/` beside the `packages/core` manifest line, before `npm ci`.
     Without it `npm ci` never creates the symlink, and the Vite build in the
     image fails to resolve the import.
   - **Trap:** `packages/core/test/image-closure.test.ts` walks the graph from
     each tool's **api**, so it will not catch this omission for a web-only
     dependency. Only the per-tool image build will. No runtime-stage pair is
     needed: Vite inlines the CSS into `web/dist/app`.
6. **Guard.** Add a test in `packages/ui/test/` (the `core` vitest project
   covers `packages/*/test`) that reads the three tool stylesheets and fails:
   - when one does not set every canonical colour role, in both the light
     `:root` and the dark override;
   - when one uses a retired name (`--muted`, `--bad`).

   That test is the point of the whole change: without it the names drift again
   within a few tickets. A new package costs one tsconfig reference line
   (`.claude/rules/testing.md`).

7. **The rule for components.** Write `.claude/rules/ui-package.md`, path-scoped
   to `packages/ui/**` and `tools/*/web/src/**`. It says:
   - a component moves into `@webtools/ui` when a **second** tool needs it, not
     before;
   - it moves from the tool that built it, keeping that tool's tests;
   - the shared version takes only the props the two real uses need.

   Add `packages/ui` to the layout block in the root `CLAUDE.md` with a
   one-line gloss, and nothing more there.

8. **Commit type.** The change is meant to leave every UI looking exactly as it
   did, so it is `refactor`, which `release-please-config.json` hides. One pull
   request across the three tools then writes no changelog line in any of them.
   If anything _visible_ changes, it has stopped being this ticket.

## Done when

1. `@webtools/ui` exists. All three web packages declare it in `dependencies`
   and import `tokens.css` before their own stylesheet.
2. The guard test in `packages/ui/test/` passes, and the Log shows it failing
   first: once with a `--muted` planted in a tool stylesheet, and once with a
   canonical role removed from one dark override.
3. No tool's rendering changes. For each tool, the Log records the resolved
   value of every canonical role in light and dark, plus the page container's
   computed `max-width`, before and after (read with `getComputedStyle` in a
   Playwright session), and the two match. Each tool's e2e suite passes.
4. All three Dockerfiles copy `packages/ui/package.json` before `npm ci`, and
   the three image workflows build green on the pull request.
5. `.claude/rules/ui-package.md` exists with the component rule, and the root
   `CLAUDE.md` layout names `packages/ui`.
6. `npm run check` and `npm test` pass.

## Log

- 2026-10-18 — Filed after a scoping conversation with the owner. The two
  decisions above were put as options and answered there. The measurements in
  **Why** were taken on `main@140bd78a`. `--page-width` was added at the
  owner's prompt: the container widths read 62rem / 62rem / 40rem there.
