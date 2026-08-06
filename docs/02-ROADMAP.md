# Roadmap — two plans, one recommendation

The goal is **any website**. That single requirement eliminates a whole class of
approach before the comparison starts, so it is worth being explicit about what
was ruled out and why.

---

## Ruled out: the "extractor wrapper"

A thin API + UI over `yt-dlp` alone. Two days of work, ~1800 sites on day one —
and permanently incapable of the stated goal.

An extractor-only system can reach exactly the sites someone has hand-written an
extractor for. For every other site its coverage is not "degraded", it is
**zero**: no partial answer, no lower-quality fallback, nothing. "Any site nobody
has written code for yet" is precisely the case the project exists to solve, so
an approach that structurally cannot address it is not a smaller version of the
product — it is a different product.

**Not a stepping stone either.** Shipping it first would build an API, a UI and a
job pipeline around the assumption that resolution is fast, synchronous and
cheap. Browser sniffing is none of those: 10–20 s, 300 MB, and failure modes
(bot challenges, consent banners, players that never autoplay) that have to be
designed for rather than bolted on. The retrofit costs more than doing it right
once.

So it is off the table entirely. The two plans below both handle unknown sites.

---

## The two options

### Plan A — "browser-first"

Playwright sniffs every page; no extractor dependency at all.

**Reject.** It does meet the goal, so this is a real choice rather than a straw
man — but it pays the browser cost on _every_ probe, including the many sites
where a 2 s extractor already exists. ~15 s and 300 MB each time, plus worse
titles, worse variant metadata and worse subtitles than an extractor that knows
the site's own API. Correct mechanism, wrong to apply it uniformly.

Worth revisiting if the yt-dlp dependency ever becomes a real operational
burden — the hybrid degrades into exactly this configuration by design (see
below), so choosing Plan B now does not foreclose it.

### Plan B — hybrid registry ✅ **recommended**

Priority-ordered resolvers: site-specific → yt-dlp → browser sniffer → direct URL.
First usable answer wins. Fast and accurate where extractors exist, genuinely
universal where they do not.

**This is the plan.** The browser sniffer (WP-2) is what makes the goal
reachable; the extractor tier is a _speed optimisation layered on top of it_, and
that ordering matters:

- **yt-dlp is never a dependency.** If the binary is absent, its resolver's
  `canHandle()` returns false and every request falls through to the sniffer.
  The system is fully functional with `ENABLE_YTDLP_RESOLVER=false` — just
  slower on well-known sites. Any agent that lets a missing binary produce an
  error instead of a fallthrough has introduced a bug.
- **Coverage never depends on extractor maintenance.** When an extractor breaks
  after a site redesign — which happens constantly — that site degrades to the
  sniffer path rather than going dark.

Everything below assumes Plan B.

---

## Phases

Phase 0 is done. Phases 1–3 are the parallel block — that is where you get
leverage from running several agents at once.

### Phase 0 — Foundations ✅ _complete_

Monorepo, TypeScript project references, oxlint + oxfmt, and
`packages/shared`: types, error taxonomy, job FSM, zod API schemas.

This exists so the parallel agents in Phase 1 code against a fixed contract
instead of negotiating interfaces with each other mid-flight.

### Phase 1 — Parallel build ⟶ **4 agents at once**

| WP       | Package              | Deliverable                                            |
| -------- | -------------------- | ------------------------------------------------------ |
| **WP-2** | `packages/resolvers` | **Browser sniffer (Playwright) — critical path**       |
| **WP-1** | `packages/resolvers` | Registry + manifest parsers + yt-dlp fast path         |
| **WP-3** | `packages/engine`    | ffmpeg runner, HLS/DASH/progressive download, progress |
| **WP-4** | `apps/web`           | Full UI against a mocked API                           |

**WP-2 is listed first deliberately.** It is both the hardest package and the
only one that determines whether the product can do what it claims — if you run
one agent rather than four, run that one. WP-1's registry and manifest parsers
are needed alongside it; its yt-dlp tier is the genuinely optional part and can
be cut from scope without threatening the milestone.

WP-1 and WP-2 share a package but touch disjoint files; both implement the same
`Resolver` interface. WP-2 consumes WP-1's manifest parsers — the one real
dependency inside Phase 1, so if the parsers slip, have WP-2 stub them behind
the same signature rather than idling. WP-4 mocks `apps/api` from the zod schemas
in `shared`, so it does not wait on the backend.

### Phase 2 — Integration ⟶ **1 agent, after Phase 1**

| WP       | Package    | Deliverable                                                      |
| -------- | ---------- | ---------------------------------------------------------------- |
| **WP-5** | `apps/api` | Fastify routes, job orchestrator + FSM, SSE, SQLite, file tokens |

This is the join point. One agent, because it wires the others together and
concurrent edits here cause more trouble than they save.

### Phase 3 — Hardening ⟶ **2 agents**

| WP       | Area              | Deliverable                                                         |
| -------- | ----------------- | ------------------------------------------------------------------- |
| **WP-6** | Security & limits | SSRF guard, rate limits, path confinement, disk quota, retention GC |
| **WP-7** | Ops & e2e         | Dockerfile, health checks, structured logging, end-to-end tests     |

### Phase 4 — Coverage (ongoing, never "done")

Add site-specific resolvers at priority 10 for whatever the browser sniffer
misses. Each is one file, one test, no changes elsewhere. If a new site ever
forces an edit to the engine or the API, the abstraction has sprung a leak —
fix the abstraction rather than special-casing.

---

## Milestones

- **M1 — Vertical slice.** One hardcoded HLS URL downloads to disk from the CLI.
  Proves ffmpeg + header replay. _After WP-3._
- **M2 — Any-site probe.** Paste an arbitrary URL, get a variant list back.
  Proves the registry + sniffer. _After WP-1/WP-2._
  **Acceptance requires `ENABLE_YTDLP_RESOLVER=false`** — a probe that only works
  with the extractor tier enabled has not demonstrated the capability the project
  is for. Test on a site with no yt-dlp extractor.
- **M3 — Functional goal.** Paste URL → pick quality → progress → download link.
  **This is the goal you stated.** _After WP-5._
- **M4 — Deployable.** Rate-limited, SSRF-guarded, containerised, GC'd. _After WP-6/WP-7._

---

## Sequencing for agents

```
        ┌── WP-2 resolvers: browser sniffer ◄── CRITICAL PATH ──┐
        ├── WP-1 resolvers: registry + parsers + yt-dlp ────────┤
Phase 0 ┤        └─ parsers feed WP-2                           ├──► WP-5 api ──┬── WP-6 security
  ✅    ├── WP-3 engine: ffmpeg + download ─────────────────────┤      (M3)     └── WP-7 ops
        └── WP-4 web: UI on mocked API ────────────────────────┘                      (M4)
              (M1 after WP-3, M2 after WP-1/2)
```

Rules that keep parallel agents from fighting:

1. **`packages/shared` is frozen during Phase 1.** If an agent needs a contract
   change, it stops and asks rather than editing — a unilateral edit silently
   breaks three siblings.
2. **One agent per package**, except WP-1/WP-2 which are file-disjoint.
3. **Every WP ships tests with fixtures**, not live network calls. Real sites
   change and rate-limit; fixtures make failures mean something.
4. **`npm run check` must pass** before a WP is called done — lint, format,
   typecheck, all of it.

Ready-to-paste briefs for each work package are in
[03-AGENT-BRIEFS.md](./03-AGENT-BRIEFS.md).
