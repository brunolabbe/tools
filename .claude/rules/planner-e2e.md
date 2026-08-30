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

**It is four specs over two paths on purpose** — the intake (pl-13) and pinning
(pl-19). The suite exists to prove the API and the browser are wired together;
branch coverage costs milliseconds in a component test and a browser launch here.
A spec earns its place by crossing a seam no unit test reaches, and **the reload
is usually that seam**: `e2e/pin.spec.ts` passes every pre-reload assertion
against a client that never calls the server, because the web suite's fake _is_
the client module. Never read the database from a spec — one that queries SQLite
is an integration test wearing a browser.
