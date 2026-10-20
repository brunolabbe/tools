---
id: repo-108
tool: repo
title: Share one set of design tokens across the three web UIs
kind: work-package
status: done
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

## Review

**Gate: FAIL** — 2026-10-20 · `6dd274bd...2b07c8df` (merge base `6dd274bd`) · Opus 5.5, depth standard

| Done when                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `@webtools/ui` exists; three web packages declare it in `dependencies` and import `tokens.css` first                        | `packages/ui/test/tokens.test.ts` › "declares @webtools/ui in dependencies" and › "main.tsx imports tokens.css before its own stylesheet" ✓. Also caught by `packages/core/test/image-closure.test.ts` › "a bare workspace specifier under `src` is in that package's `dependencies`" (dependency dropped from planner's web: 2 failed of 8)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2. Guard passes, and the Log shows it failing first on a planted `--muted` and on a role removed from a dark override          | `packages/ui/test/tokens.test.ts` › "every stylesheet sets every canonical colour role, in light and in dark" and › "no web source uses a retired name" ✓, 14 of 14. Re-planted: `--muted` in planner's sheet, 2 failed of 14; `--ok` removed from ledger's dark block, 1 failed of 14; `--warn` removed from the `tokens.css` role list, 1 failed of 14 (›"names every canonical colour role in its header…"). Restored: 14 of 14. The line is met; F1 is about the guard's reach beyond it                                                                                                                                                                                                                                                                                         |
| 3. No tool's rendering changes: roles and container `max-width` before and after, light and dark; each tool's e2e suite passes | **verified**. Every `var(--…)` reference under `tools/*/web/src` resolved at base and at head in every theme state (downloader 6, the others 2): 168 comparisons, 34 differ, and all 34 are new names (`--font-sans`, `--font-size-base`, `--font-mono`, `--page-width`) whose head value equals the literal they replaced. Built bundles in Chromium, every element of fragments rebuilt from each `.sr-only` site's ancestors: 22 differing properties of 71,176, all on ledger's Stats "Range" legend (F2), with every screenshot byte-identical. e2e on CI at `2b07c8df`: planner `e2e` 5 passed; downloader `e2e (direct)` 10 passed and `e2e (sniffer)` 1 passed. Ledger has no e2e suite (`tools/ledger/e2e/README.md`; no job in `ledger.yml`), so there was nothing to pass |
| 4. Three Dockerfiles copy `packages/ui/package.json` before `npm ci`; three image workflows green                              | `packages/core/test/image-closure.test.ts` › "every workspace the UI build resolves has its manifest copied before `npm ci`" ✓ (planner's line removed: 1 failed of 8). `docker` passed at `2b07c8df` in the planner, downloader and ledger workflows. Each ran `COPY packages/ui/package.json` then `RUN npm ci` ("added 308/325/494 packages"), and each built a CSS bundle with the same hash as the local build (`index-Dm_C8jfn.css`, `index-xjGJ5dqd.css`, `index-CmOKvbyK.css`)                                                                                                                                                                                                                                                                                               |
| 5. `.claude/rules/ui-package.md` carries the component rule; root `CLAUDE.md` Layout names `packages/ui`                       | verified by reading: the rule is path-scoped to `packages/ui/**` and `tools/*/web/src/**` and carries the three component clauses; Layout has the one line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6. `npm run check` and `npm test` pass                                                                                         | verified: `npm run check` exit 0. `npm test` exit 0: files 294 passed and 1 skipped of 295, tests 6203 passed and 2 skipped of 6205. `node scripts/check-lockfile-sync.mjs`: "up to date", exit 0. CI `check` and `test (ubuntu-latest)` passed at `2b07c8df`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- **high** · F1 · Done when 2's literal line is met, so it does not rest on this · the guard does not enforce the role list that four shipped texts say it enforces. `tokens.css`'s header says `tokens.test.ts` "fails when a stylesheet leaves one out". `test/support/stylesheet.ts` says the header and `COLOUR_ROLES` "cannot part". The test is titled "…so the doc and the guard agree", and `.claude/rules/ui-package.md` says a tool sets "every colour role listed in `tokens.css`'s header". But the test only asserts `COLOUR_ROLES ⊆ header`. Reproduction: add ` *     --info          informational` to the header's role list (no tool sheet sets `--info`, 0 of 3), then `npx vitest run packages/ui/test/tokens.test.ts` gives `Tests  14 passed (14)`, exit 0. The falsehood runs in the unsafe direction: an agent who follows `ui-package.md` adds a role to the header and believes it is enforced, and the names drift, which is the thing the ticket calls "the point of the whole change". Direction, not a tested remedy: assert that the header's role set and `COLOUR_ROLES` are equal, or derive `COLOUR_ROLES` from the header.
- **low** · F2 · no `Done when` line depends on it · ledger's `.sr-only` was dropped although it was not identical in effect (Build step 3). Ledger's copy had no `padding: 0`, and the shared one does. Measured in Chromium against both built bundles: the Stats "Range" `legend.sr-only` in `fieldset.range` goes from `padding-inline: 2px` (the UA's legend padding), `width: 4px` to `0`, `1px`. The screenshot is byte-identical in light and dark (it is clipped by `clip-path: inset(50%)`). Ledger's other three `.sr-only` sites and all five of planner's show 0 differences. Not visible. The Log does not mention it.
- **low** · F3 · no live call site · `image-closure.test.ts` › "neither list ships a workspace the API does not resolve" now accepts a web-only workspace in the **runtime** stage, while the new `webClosure` doc comment says "the runtime stage needs none of them". Planting `COPY --from=build /app/packages/ui/package.json packages/ui/` in planner's runtime stage gives 8 passed of 8 at head. Plants (a), (b) and (c) still fail at head as before: (a) fails 2 of 8 at head and 1 of 7 at base, and (c) fails 1 of 8 at head and 1 of 7 at base. (d) fails 2 of 8.
- **dropped** · planner's `.plans li` reads `var(--line)`, which no sheet defines, at base and at head alike. It is out of the reviewed range, and the branch's Log already records it as a visible change for the planner to decide.
- **dropped** · the builder's local downloader e2e failure on `download.spec.ts:33`, which I did not reproduce. CI's `e2e (direct)` ran 10 passed at `2b07c8df`, so there is nothing at this head to grade.
- **findings** · the hunt returned 5: 3 carried, 2 dropped.
- NFR: security n/a (CSS and manifests only) · performance n/a (bundle +0.6 kB of unused tokens) · reliability ✓ (image builds green, closure guard holds a–d) · maintainability: F1, F3.

### Gate 2

**Gate: FAIL** — 2026-10-20 · `2b07c8df..041db427` (round: `200eb345`, `905c68fe`, `a2d652ae`; merge base with main `00977771`) · Opus 5.5, depth standard

| Done when                                                                                | Proof at `041db427`                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `@webtools/ui` exists, declared and imported first                                    | unchanged by the round ✓. Plant (d), the dependency dropped from planner's web, fails 2 of 8 in `packages/core/test/image-closure.test.ts`                                                                                                                                                                                                                 |
| 2. Guard passes; fails on a planted `--muted` and on a role removed from a dark override | `packages/ui/test/tokens.test.ts` ✓, 14 of 14. The `--muted` plant in ledger's `App.tsx` fails 1 of 14 (`"tools/ledger/web/src/App.tsx uses --muted"`). The line is met; F1 is about the guard's reach beyond it                                                                                                                                           |
| 3. No rendering change; e2e passes                                                       | **verified**. `tokens-sweep.mjs`, base `00977771` against head: 168 comparisons, 34 differ, the same 34 new names gate 1 found (non-`same` output identical to gate 1's line for line). The merge adds no `var(`, `style` or `className` line under `tools/*/web/src`. CI at `041db427`: planner `e2e`, downloader `e2e (direct)` and `e2e (sniffer)` pass |
| 4. Dockerfiles copy `packages/ui/package.json`; image workflows green                    | `image-closure.test.ts` › "every workspace the UI build resolves has its manifest copied before `npm ci`" ✓ (plant (b): 1 of 8 fails). Three `docker` jobs pass at `041db427`                                                                                                                                                                              |
| 5. Rule page and Layout line                                                             | unchanged by the round; verified by gate 1                                                                                                                                                                                                                                                                                                                 |
| 6. `npm run check` and `npm test` pass                                                   | CI `check` (×2) and `test (ubuntu-latest)` pass at `041db427`. Not run locally                                                                                                                                                                                                                                                                             |

- **high** · F1 · **fixed in part** · the clause that remains: `headerRoles` in `packages/ui/test/support/stylesheet.ts` reads only lines shaped exactly ` *` + five spaces + `--name` + two or more spaces + text, and that shape is written down only in the test helper, not in the `tokens.css` header an editor edits. Any other shape is listed for a human and enforced by nothing. `stylesheet.ts` now says "a role added to one and not the other fails there", the `tokens.css` header still says the test "fails when a stylesheet leaves one out", and `.claude/rules/ui-package.md` still says a tool sets "every colour role listed in `tokens.css`'s header". The falsehood still runs in the unsafe direction. Reproduction: `bash header-shapes.sh <tree> <sha> <out> <shape>…` adds one role that no sheet sets, then runs `npx vitest run packages/ui/test/tokens.test.ts`. Gate 1's plant (the control) gives `1 failed | 13 passed (14)`. These pass at `14 passed (14)`, exit 0:
  - ` *     --text-inverted informational`: a 15-character name, aligned to the description column, which leaves one space;
  - ` *     --surface-raised raised panels`: a 16-character name;
  - the name indented one column short or long (four or six spaces), or one space;
  - a tab before or after the name;
  - a bare name with no description;
  - `--info, --note` on one line.

  The prose mention also passes, by design. A blank comment line before the role, CRLF line endings, and a second aligned entry after a caught one all fail as they should. The first two shapes are the ones an editor writes when the new name is longer than the 13 characters of `--accent-text`. Direction, not a tested remedy: read every header line whose first token after the ` *` margin starts with `--`, whatever the whitespace. Measured on the parser alone, `^\s*\*[ \t]+(--[\w-]+)` reads 11 roles from the header at head and 12 for 12 of the 14 planted shapes. It misses only the second role on a line and the prose mention.

- **low** · F2 · **not fixed, recorded on purpose** · ledger's `.sr-only` did differ. Its rule at `6dd274bd` has no `padding: 0`, and `tokens.css`'s rule has one. The round's Log entry states that fact and the gate's measurement correctly. It says the "earlier claim that ledger's rule was identical was too strong". The Log has no such sentence: the claim was implicit in the drop under Build step 3 and in the "0 differences across 176 elements" line, which is scoped to first screens. The substance is accurate.
- **low** · F3 · **fixed** · plant (c2), `packages/ui/package.json` copied into planner's runtime stage, now fails 1 of 8 (`"tools/planner/Dockerfile (runtime): packages/ui — …"`). Plants (a) and (c) still fail as at gate 1: (a) 2 of 8, and (c) 1 of 8. (b) fails 1 of 8 and (d) 2 of 8. With no plant (the control), it gives 8 of 8. So no legitimate build-stage `packages/ui` copy is refused.
- **dropped** · the merge from main: lg-54's `App.tsx` and `StatementPaste.tsx` changes carry no custom property, inline style or class name. The guard does scan `.tsx` (`webSources` reads `.css`, `.ts` and `.tsx` under each web's `src`) for retired names, but not for names that no sheet defines. That predates the round and is outside it, so it is not a finding.
- **findings** · the hunt returned 2 new candidates: the parser shapes, carried as F1's remaining clause rather than a new finding, and the merged-in web code, dropped. With gate 1's three findings, 3 carried.
- NFR: security n/a · performance n/a · reliability ✓ (image closure holds a–d and now c2) · maintainability: F1.

## Log

- 2026-10-18 — Filed after a scoping conversation with the owner. The two
  decisions above were put as options and answered there. The measurements in
  **Why** were taken on `main@140bd78a`. `--page-width` was added at the
  owner's prompt: the container widths read 62rem / 62rem / 40rem there.
- 2026-10-19 — Built on branch `repo-108-share-design-tokens` from
  `origin/main` at `f7436872`. The owner selected this ticket on 2026-10-19 in
  the batch "tools-13, 2026-10-19: repo-108, repo-107, repo-106", so this
  Build's edits to the root `CLAUDE.md` Layout block and its new
  `.claude/rules/ui-package.md` are the owner's. The commit type is
  `refactor`, per Build step 8.

  **What changed.** `packages/ui` (`@webtools/ui`) holds `src/tokens.css`:
  `color-scheme`, `--radius`, `--gap`, `--space-1..6`, `--page-width: 62rem`,
  `--font-sans`, `--font-mono`, `--font-size-sm/base/lg/xl`, `* { box-sizing }`,
  `body { margin; background; color }` and `.sr-only`, with the colour-role
  list in its header and no colour value. Each web `main.tsx` imports it before
  `./styles.css`; each `web/package.json` lists it in `dependencies`; each
  `Dockerfile` has `COPY packages/ui/package.json packages/ui/` before `npm ci`;
  `package-lock.json` has the new workspace (hand-edited, `node
scripts/check-lockfile-sync.mjs` prints `up to date`, exit 0: no
  `npm install` was run). Planner and ledger renamed `--muted` to `--text-muted`
  and `--bad` to `--danger` at every use and set the roles they lacked.
  Downloader and planner set `--font-size-base` and `--font-sans` in their
  `:root` and read them in `body { font }`; ledger sets `--page-width: 40rem`
  and reads `--font-sans`. `tools/downloader/web/public/terms.css` is a static
  page outside the bundle with its own `--muted`; it is not one of the three
  stylesheets and was left alone.

  **Done when 2, the guard failing first.** The checker is
  `packages/ui/test/support/stylesheet.ts`, run by
  `packages/ui/test/tokens.test.ts`. Two mutations on the real files, each
  undone from the commit with `git checkout e8c54770 -- <path>`:
  - `--muted` planted in `tools/planner/web/src/styles.css` (`.lede` read
    `var(--muted)`), `npx vitest run packages/ui/test/tokens.test.ts`:
    `Tests  2 failed | 12 passed (14)`, with
    `+   "tools/planner/web/src/styles.css: uses the retired name --muted"` and
    `+   "tools/planner/web/src/styles.css uses --muted"`.
  - `--ok` deleted from the dark override of `tools/ledger/web/src/styles.css`:
    `Tests  1 failed | 13 passed (14)`, with
    `+   "tools/ledger/web/src/styles.css: dark `:root` override does not set --ok"`.
  - Restored, `npx vitest run packages/ui packages/core/test/image-closure.test.ts`:
    `Test Files  2 passed (2)`, `Tests  22 passed (22)`.
    The suite also pins the checker on synthetic sheets (a role missing from
    dark only, from light only, a retired name, `--text-muted` not mistaken for
    `--muted`, a role named only in a comment, no dark block), so a regex that
    matched nothing could not pass the real files.

  **Done when 3, nothing rendered differently.** One Playwright session
  (Chromium, `colorScheme` light then dark, 1400x900) per tool against the
  built `web/dist/app`, the API stubbed to 503, run on the base tree
  (`f7436872`, a second worktree) and on this branch. `getComputedStyle` of
  `:root` for every canonical role (the old spelling read for `--muted` and
  `--bad` before), and of `.app` (downloader) or `.shell` (planner, ledger) for
  `max-width`:
  - Every value that existed before is identical after. The only differences
    are roles that did not exist and now do, marked `(new)` below, and
    downloader's `--gap`, which the shared file now declares (`1rem`, read by
    nothing there). `node compare.mts`: `mismatches: 16 of 156`, and all 16 are
    that set (roles `unset` before).
  - Stronger than the roles: every element's full computed style, custom
    properties aside, `0 differences across 176 elements, 83600 properties`
    (35, 24 and 29 elements, light and dark), and the six full-page screenshots
    are byte-identical. A first "before" screenshot of downloader light differed
    in 6 pixels by 1 on one channel at a corner of the URL field; the second
    base build and both branch builds agree with each other, and the computed
    style dump is zero, so that capture was a raster fluke, not a change.

  | tool       | role                           | light before | light after   | dark before | dark after    |
  | ---------- | ------------------------------ | ------------ | ------------- | ----------- | ------------- |
  | downloader | `--bg`                         | #f6f7f9      | #f6f7f9       | #101317     | #101317       |
  | downloader | `--surface`                    | #ffffff      | #ffffff       | #181c22     | #181c22       |
  | downloader | `--surface-2`                  | #f0f2f5      | #f0f2f5       | #1f242b     | #1f242b       |
  | downloader | `--border`                     | #d8dce3      | #d8dce3       | #2c333c     | #2c333c       |
  | downloader | `--text`                       | #16191f      | #16191f       | #e8ebf0     | #e8ebf0       |
  | downloader | `--text-muted`                 | #5c6472      | #5c6472       | #98a2b3     | #98a2b3       |
  | downloader | `--accent`                     | #2f5fe0      | #2f5fe0       | #7aa2ff     | #7aa2ff       |
  | downloader | `--accent-text`                | #ffffff      | #ffffff       | #0b0e12     | #0b0e12       |
  | downloader | `--ok`                         | #157a4a      | #157a4a       | #5fd39b     | #5fd39b       |
  | downloader | `--warn`                       | #9a6400      | #9a6400       | #e5b567     | #e5b567       |
  | downloader | `--danger`                     | #b3261e      | #b3261e       | #ff8a80     | #ff8a80       |
  | downloader | `.app` max-width               | 992px        | 992px         | 992px       | 992px         |
  | planner    | `--bg`                         | #fbfaf8      | #fbfaf8       | #17150f     | #17150f       |
  | planner    | `--surface`                    | #ffffff      | #ffffff       | #201d16     | #201d16       |
  | planner    | `--surface-2`                  | unset        | #f4f1ec (new) | unset       | #2a261c (new) |
  | planner    | `--border`                     | #e3ddd4      | #e3ddd4       | #35301f     | #35301f       |
  | planner    | `--text`                       | #201d19      | #201d19       | #f0ece4     | #f0ece4       |
  | planner    | `--text-muted` (was `--muted`) | #6b6459      | #6b6459       | #a49b8a     | #a49b8a       |
  | planner    | `--accent`                     | #2f5d50      | #2f5d50       | #7fbfa8     | #7fbfa8       |
  | planner    | `--accent-text`                | #ffffff      | #ffffff       | #14170f     | #14170f       |
  | planner    | `--ok`                         | unset        | #2f6f4f (new) | unset       | #2f6f4f (new) |
  | planner    | `--warn`                       | unset        | #8a6d1f (new) | unset       | #8a6d1f (new) |
  | planner    | `--danger` (was `--bad`)       | #a3341f      | #a3341f       | #e8836a     | #e8836a       |
  | planner    | `.shell` max-width             | 992px        | 992px         | 992px       | 992px         |
  | ledger     | `--bg`                         | #f8f9fa      | #f8f9fa       | #111418     | #111418       |
  | ledger     | `--surface`                    | #ffffff      | #ffffff       | #1a1e23     | #1a1e23       |
  | ledger     | `--surface-2`                  | unset        | #f0f2f4 (new) | unset       | #21262c (new) |
  | ledger     | `--border`                     | #dde1e6      | #dde1e6       | #2c323a     | #2c323a       |
  | ledger     | `--text`                       | #1b1f24      | #1b1f24       | #eceff2     | #eceff2       |
  | ledger     | `--text-muted` (was `--muted`) | #5d6670      | #5d6670       | #9aa4ae     | #9aa4ae       |
  | ledger     | `--accent`                     | #1f5f8b      | #1f5f8b       | #7db4dc     | #7db4dc       |
  | ledger     | `--accent-text`                | unset        | #ffffff (new) | unset       | #0b0e12 (new) |
  | ledger     | `--ok`                         | unset        | #1d7a4d (new) | unset       | #5fd39b (new) |
  | ledger     | `--warn`                       | unset        | #9a6400 (new) | unset       | #e5b567 (new) |
  | ledger     | `--danger` (was `--bad`)       | #a3341f      | #a3341f       | #e8836a     | #e8836a       |
  | ledger     | `.shell` max-width             | 640px        | 640px         | 640px       | 640px         |

  The new values are unused: nothing reads them yet, and they are the tool's
  palette choices, free to change in the ticket that first uses one. Two were
  not free. Planner's `.provenance .mark` read `var(--ok, #2f6f4f)` and
  `var(--warn, #8a6d1f)` with those fallbacks, so defining the roles with any
  other value would have changed a colour (and, in dark, the fallback is the
  rendered colour today). Planner therefore sets `--ok` and `--warn` to the
  fallback values in both themes, and says why in its stylesheet. Those two
  are poor on the dark surface; fixing that is a visible change and not this
  ticket's.

  **Each tool's e2e suite.**
  - planner, `npm run e2e:planner`: `5 passed (15.0s)`.
  - downloader, `npm run e2e:downloader`: `9 passed (1.4m)`, `1 failed`:
    `download.spec.ts:33 › paste a URL, pick a quality, and download the file`
    on `expect(job).toBeInViewport()` (`viewport ratio 0`, the dl-109
    assertion). **The same spec fails identically on the base tree**
    (`f7436872`, second worktree, `npx playwright test -c
tools/downloader/playwright.config.ts download.spec.ts`: `1 failed`,
    `3 passed (1.3m)`, the same line 82 and the same message), so it is not
    this change; the draft's CI is the reading of whether it is this
    environment.
  - ledger, `npm run e2e:ledger`: `Error: No tests found`, exit 1. The ledger
    has no spec (`tools/ledger/e2e/README.md` says so), so there is no suite
    to pass (not run on the base: no spec exists there either).

  **Done when 4 and the image-closure scan.** The ticket's Trap said
  `packages/core/test/image-closure.test.ts` "will not catch this omission",
  and that was half wrong in a way that mattered: the scan's `neither list
ships a workspace the API does not resolve` test treats a `COPY
packages/ui/...` line as stale, because `@webtools/ui` is in no API's
  closure, so the Dockerfile edit this ticket asks for failed
  `packages/core` until the scan was taught. It now computes each tool's web
  closure (`closureFrom("@<tool>/web")`), treats what the web needs beyond the
  API's closure as bundled-only, and has a new test, `every workspace the UI
build resolves has its manifest copied before \`npm ci\``, which catches the
omission the Trap describes. Shown failing: with `COPY packages/ui/...`removed from`tools/planner/Dockerfile`, `npx vitest run
  packages/core/test/image-closure.test.ts`gives`Tests 1 failed | 7 passed
  (8)`, `+ "tools/planner/Dockerfile: COPY packages/ui/package.json
  packages/ui/"`; restored, `Tests 8 passed (8)`. A scan over text still
  cannot prove an image builds; the three image workflows are the reading of
  Done when 4, on the draft pull request.

  **What the brief had wrong.**
  - `tools/ledger/web/src/styles.css` was 765 lines, not 741 (settled at
    intake, not re-run).
  - Build step 6 says a new package costs one tsconfig reference line. Here it
    costs none: `packages/ui` has no `tsconfig.json` and no TypeScript source to
    reference, and `tsconfig.tests.json`'s glob already includes
    `packages/*/test/**`. `npm run check` passes with the new test in it.
  - Build step 3 names only what the shared file provides; the planner
    `--ok`/`--warn` fallbacks above were not in the brief and bound two values.
  - Build step 5 said only the image build catches a missing manifest line.
    The scan now does too (above).

  **Not folded in, and one folded in.** Folded in: the `packages/ui` line in
  the root `README.md` Layout block, the twin of the `CLAUDE.md` one the Build
  names. Not folded in: planner's `.plans li` reads `var(--line)`, which no
  stylesheet defines, so its `border-bottom` is invalid at computed-value time
  and draws no rule; `var(--border)` is the obvious intent and drawing it is a
  visible change, so it is a decision for the planner, not a rename. Also not
  folded in: dark-theme values for planner's `--ok` and `--warn` (above).
  Neither can be filed in this branch: a ticket for another tool is its own
  `docs` pull request.

- 2026-10-20 — Round 1, after gate 1 (FAIL at `2b07c8df`, one high).
  - **F1, fixed (`200eb345`).** The guard asserted only that its role list
    sat inside `tokens.css`'s header, so a role added to the header alone read
    as enforced and was enforced by nothing. `tokens.test.ts` now asserts the
    header's role list (`headerRoles`, lines shaped ` *     --name   text`) and
    `COLOUR_ROLES` are equal in both directions. The gate's plant, an `--info`
    line added to the header's role list: before the fix `14 passed (14)`;
    after, `1 failed | 13 passed (14)` with
    `"listedButNotEnforced": ["--info"]`; removed, `14 passed (14)`. The
    converse, `--warn` dropped from the header: `1 failed | 13 passed (14)`
    with `"enforcedButNotListed": ["--warn"]`; restored, `14 passed (14)`. Each
    plant was undone with `git checkout 200eb345 -- packages/ui/src/tokens.css`.
  - **F3, fixed (`905c68fe`).** The stale-line check now allows a web-only
    workspace in the build stage only; the runtime stage allows the API's
    closure and `tools/<tool>/web`. The gate's plant: the line
    `packages/ui/package.json` copied from the build stage into
    `tools/planner/Dockerfile`'s runtime stage. `Tests  1 failed | 7 passed (8)`
    with a `tools/planner/Dockerfile (runtime): packages/ui` entry; restored,
    `8 passed (8)`.
  - **F2, left.** Ledger's `.sr-only` had no `padding: 0` and the shared one
    does, so the Stats "Range" `legend.sr-only` loses the UA's 2px
    inline padding (the gate measured `width: 4px` to `1px`). It is clipped to
    nothing by `clip-path: inset(50%)`, the screenshots are byte-identical, and
    I did not re-measure it. The finding names no fix and the one available,
    a ledger-local override, would put back a near-duplicate of the rule this
    ticket lifted, to preserve a padding nothing can see. The Build's "only
    where identical in effect" was read as "in what renders"; the Log's earlier
    claim that ledger's rule was identical was too strong.

- 2026-10-20 — Round 2, after gate 2 (FAIL at `041db427`, F1 fixed in part).
  - **F1, fixed (`b5299fe1`).** Round 1's `headerRoles` recognised one exact
    layout (` *`, five spaces, the name, two spaces), so a longer name, another
    indent, a tab or a bare name was listed for a human and enforced by
    nothing. It now reads every header line whose first token after the
    comment margin starts with `--`, whatever the whitespace, and every `--name`
    on that line, so a second role on a line is read too. The `tokens.css`
    header says the rule (one role per line, the line starting with its name),
    and `tokens.test.ts` pins the shapes in its own `the header reader` cases.
  - **Gate 2's shapes, re-run** with its `header-shapes.sh` and
    `plant-header-shapes.mjs` at `b5299fe1`, each restored from that sha with
    `git checkout`: unplanted `26 passed (26)`; `control`, `indent-1`,
    `indent-4`, `indent-6`, `tab`, `tab-after-name`, `two-on-line`,
    `two-on-line-second`, `no-description`, `after-blank`,
    `long-name-one-space`, `long-name-16` and `crlf` each `1 failed | 25 passed (26)`,
    with the planted name under `listedButNotEnforced`. `in-prose` stays
    `26 passed (26)`, by design: a name inside a sentence is a mention, not an
    entry, and the header now says so. The unplanted header reads exactly 11
    roles: bg, surface, surface-2, border, text, text-muted, accent,
    accent-text, ok, warn, danger.
- 2026-10-20 — Fixed at landing by owner choice: gate 3, F4 — "The `tokens.css`
  header says 'a name that is merely mentioned in a sentence is not' read. That
  is false for a mention inside an entry's description, or a mention that a
  rewrap puts at the start of a line", option (a): the header sentence now says
  every `--name` on an entry line counts, its description included, as
  `headerRoles`' doc comment already did. No code changed. The proof is outside
  the ticket, so no scope above `## Log` applies. The checks, on
  `packages/ui/src/tokens.css`: `grep -c merely` → 0 (was 1);
  `grep -c "its description"` → 1; and
  `npx vitest run packages/ui/test/tokens.test.ts` → `26 passed (26)`. F2 and
  F5 stay recorded unfixed.
