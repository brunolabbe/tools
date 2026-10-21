---
paths:
  - "tools/*/web/src/**"
---

# Every screen fits a phone and a desktop

The owner's requirement (2026-10-18): every tool displays properly on a computer
and on a phone. This page is the rule, and `tools/<tool>/e2e/layout.spec.ts` is
the check that keeps it true.

**Every screen works from 360 px wide up to a desktop, with no horizontal scroll
of the page.** 360 is the owner's choice (a screen that works there works on a
standard iPhone, 375–393 px). The test is
`document.documentElement.scrollWidth <= window.innerWidth`: a document wider than
its window is a page that scrolls sideways, whatever caused it.

**Content wider than the screen scrolls inside its own container, not the page.**
A statement table, a long URL, a row of figures: wrap it in a box with
`overflow-x: auto` (the downloader's `.tablewrap` is the shape), or let it break
(`overflow-wrap: anywhere`) — whichever the content can bear. A fixed `width` or
`min-width` on a container is how a column ends up wider than the window. **Never
put `overflow-x: hidden` (or `clip`) on any element that wraps the page** —
`html` and `body` together, `main`, the app shell: the layout check cannot see
content clipped that way, so content cut off at the right edge passes it. Wide
content scrolls in its own container instead.

**A new screen gets a case in its tool's `layout.spec.ts`, in the same pull
request.** There is no router in any tool, so a "screen" is a view state: a tab,
a step of a flow, a page beside the bundle. The spec reaches each one with data
on it, because an empty screen does not prove a full one fits, measures it at
360×740 and at 1280×800, and writes a full-page screenshot of each to
`e2e/.artifacts/layout/`. **Open the screenshots**: a width assertion over a page
that rendered nothing passes.

A screen that overflows is marked `test.fixme` in that spec, with a comment naming
the per-tool ticket filed for it, rather than left red or fixed inside an
unrelated change.

Breakpoints are not tokens (`ui-package.md`): a `@media` width is a literal in
the tool's own stylesheet.
