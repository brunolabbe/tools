---
paths:
  - "tools/planner/e2e/**"
---

# The planner e2e suite

Lifted out of `tools/planner/CLAUDE.md` so it loads when you open a spec. The
rules are unchanged.

**The e2e suite reads the screen; it never names a question.** Because the tree
is content, a spec that types into `#field-road-trip.drive-appetite` or counts
eight questions turns a content edit into a red build. `e2e/intake-walk.ts` fills
whatever control is in front of it and keeps the prompts it was shown, and the
specs assert against those — so both sides of the assertion move when the tree
does. The walk is shared rather than copied for exactly that reason: two copies
of the rule is one copy nobody reads before editing the tree. Read a plan's title
and an item's heading off the page for the same reason, never write them down.

**It is four spec files, over three paths on purpose, and one of the four is
not a path** — the intake (`intake.spec.ts`, pl-13, two tests), pinning
(`pin.spec.ts`, pl-19, two) and revision (`revise.spec.ts`, pl-46, one), which crosses the seam a re-plan's run and an
edit's synchronous write each open: a re-plan answers 202 and continues over
SSE, `RunView` hands back to the plan page, and every change appends a
revision that has to be read back with its diff derived on the server. The
suite exists to prove the API and the browser are wired together; branch
coverage costs milliseconds in a component test and a browser launch here.
A spec earns its place by crossing a seam no unit test reaches, and **the reload
is usually that seam**: `e2e/pin.spec.ts` and `e2e/revise.spec.ts` pass every
pre-reload assertion against a client that never calls the server, because the
web suite's fake _is_ the client module. Never read the database from a spec —
one that queries SQLite is an integration test wearing a browser.

The fourth file, `layout.spec.ts` (repo-109), is the exception that proves the
rule: it crosses no seam, and earns its place by measuring every screen at 360 px
and at 1280 px, which no unit test can do without a browser. It reaches its
screens with the shared walks and names no question, like the rest; the rule it
keeps is `responsive-layout.md`.
