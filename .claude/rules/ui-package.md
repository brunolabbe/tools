---
paths:
  - "packages/ui/**"
  - "tools/*/web/src/**"
---

# The shared UI package

`@webtools/ui` (`packages/ui`) is where the three web UIs keep what they share.
Today that is `src/tokens.css`: the names every tool's colour and spacing
tokens use, and the few base rules all three had identically. It grows into a
component library one component at a time, and the rules below are how.

**A component moves into `@webtools/ui` when a second tool needs it, not
before.** The same test as every other shared thing in this repo: an abstraction
extracted for an imagined caller fits neither of the tools that later use it.
Build it inside the tool that needs it first. On 2026-10-18 twelve class names
appeared in more than one stylesheet and only `.muted` in all three, so there
was nothing else to lift.

**It moves from the tool that built it, and keeps that tool's tests.** The
component and its tests go together, so what the first tool proved about it is
still proved after the move. The tool then imports it from `@webtools/ui`.

**The shared version takes only the props the two real uses need.** Not the
union of what either could want, and not an option for a third caller that does
not exist. A prop is added when a third use needs it.

**Names are shared; palettes are not.** A tool sets every colour role listed in
`tokens.css`'s header, in its light `:root` and in its dark override, with its
own values. `packages/ui/test/tokens.test.ts` reads each tool's `styles.css` and
fails on a missing role or a retired name (`--muted`, `--bad`). A role only one
tool uses stays in that tool's stylesheet until a second tool needs it. **A name
arrives in `tokens.css` with the first tool that reads it**: the same test fails on
a name no tool's `web/src` reads with `var(`, which is how a spacing and a
font-size scale nobody used left it (repo-130).

**Breakpoints are not tokens.** A custom property does not resolve inside
`@media (max-width: ...)`, so each stylesheet keeps its own literals. Reaching
for a preprocessor or `@custom-media` to change that is a toolchain decision,
not part of a UI change.

**A new web package does three things:** list `@webtools/ui` in its
`dependencies`, import `@webtools/ui/tokens.css` before its own stylesheet in
`main.tsx`, and copy `packages/ui/package.json` before `npm ci` in its
`Dockerfile`. Skip the last and `npm ci` never makes the symlink, so only the
image build fails, on a Vite import that cannot resolve.
`packages/core/test/image-closure.test.ts` checks it.

**Components ship as TypeScript source** (repo-131): `exports` names
`src/*.ts`, the tool's Vite and vitest compile it, and `tsc` reads its
declarations through a project reference, so a web package that imports a
component lists `packages/ui` in the `references` of its `tsconfig.json` and of
its `test/tsconfig.json`. A built `dist` puts every Vite run behind a build
step: exports pointed at an unbuilt `dist` failed `vite build` with "Rolldown
failed to resolve import", where the source export built with no `dist` at all.
