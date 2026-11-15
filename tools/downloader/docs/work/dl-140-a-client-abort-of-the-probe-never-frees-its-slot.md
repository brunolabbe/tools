---
id: dl-140
tool: downloader
title: A client that aborts `POST /api/probe` never frees its probe slot, because the close listener is registered too late
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-140 — A client abort of `POST /api/probe` never frees its probe slot

## Why

Found by dl-138's first gate (Opus 5.5) on 2026-11-15, outside the range it was
reviewing, and filed on the owner's answer at the orchestrator's checkpoint the
same day (options: file; fold into dl-138; record only. Answer: file). dl-138 is
PR #799 and is not merged at the time of writing; its Log says this ticket is
being filed.

`routes/probe.ts` promises, in a comment above the listener, that "a client that
navigates away should not leave a browser probe running for another 40 seconds
holding a concurrency slot". The listener is
`request.raw.on("close", () => { if (request.raw.destroyed) controller.abort(…) })`,
and it is registered inside the handler. By then Fastify has already read the
body, and on Node 22.23.4 an `IncomingMessage` emits `close` with
`destroyed=true` as soon as its body has been read, before any handler runs. The
listener is registered after that event, so it never fires on a later client
abort. The promise is not kept, and what it protects is both gates:
`context.probeClientGate` (per client, 2 at once) and `context.probeGate` (global).
The two are not held for the same span: `probeGate`'s `release()` runs in the
`finally` around `registry.resolve`, before the output vet, so the vet holds only
the per-client slot. The listener has read this way since `8d0d6d08` (WP-5,
2026-08-08); `d1ec2c61` only moved the file.

The effect is that no phase of the request shortens the slot's hold when the
client goes away. It is held until the handler unwinds on its own: at the
resolver chain's deadline (`probeTimeoutMs`) at best, or later in the output
vet, which takes no signal. dl-138's Decision records two readings that this
corrects: the cost of its Question 2 option "abort on close, and start a waiting
box at once" ("frees only when its handler unwinds after the socket closes";
dl-138 lists its options unlettered, and on its branch that clause is now marked
WITHDRAWN) and round 2's N6 ("an abort in that first phase may not shorten
the hold") both underestimate the gap, since an abort shortens no phase. That
strengthens the owner's choice in dl-138 and does not reopen it: dl-138's page-side
timeout is there because the server's hold does not end on an abort.

### The reproduction

**Bare Node, no Fastify** (`node-close.mjs`, the gate's, run again here on
Node 22.23.4 when this ticket was filed). A POST with a JSON body is aborted by
the client at 300 ms. The server reads the body, then registers its `close`
listener 50 ms later, the way the route does after Fastify's parse:

```
31.0ms body read; req.destroyed=false req.complete=true
31.3ms req close (early listener); req.destroyed=true
80.9ms handler registers close listener; req.destroyed=true
317.6ms client abort
320.1ms fetch rejected AbortError
321.3ms res close; res.writableFinished=false
321.3ms socket close
```

`req` closed at 31 ms, 50 ms before the late listener existed, and **never fires
at the abort**: the listener registered at 80.9 ms produced no line. `res`
closed 4 ms after the abort, with `writableFinished=false`, which is what an
aborted client looks like to a server that has not answered. The dl-138 gate
measured the same two events on its own run: `req close` at 68 ms, before the
handler's listener, and `res close` 5.8 ms after the abort.

**The real app on a real port** (`zz-gate-dl138-server.test.ts` in the gate's
scratch directory, run through `run-server.sh`, which copies it into
`tools/downloader/api/test/` for the run and removes it after). It builds the
harness `createHarness` gives, listens on port 0, and POSTs `ROUTES.probe` with a
real `fetch` and an `AbortController`. Its resolver holds until its `signal`
aborts and then rejects `CANCELED`, so a listener that worked would free the
slot at once. It reads the per-client gate's `count` for the caller:

| Measurement                                                                                 | Result                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| One POST aborted once its slot is held; is the slot free 3 s later?                         | held 3 s after the abort, **10 of 10** runs                                                   |
| The chain's own deadline set to 1,500 ms, POST aborted at once: when is the slot freed?     | **1,502 ms** after the POST was sent, 3 of 3                                                  |
| Two held, both aborted, two new POSTs sent 1 s later                                        | `429 RATE_LIMITED` twice, **10 of 10** runs                                                   |
| The handler waiting in the output vet (`assertAllAllowed`, no signal), both aborted, 2 s on | 2 slots still held; a new POST answers `429 RATE_LIMITED`; freed 1.3 ms after the vet returns |

The second row is the one that places the cause: the slot came free at the
chain's own deadline and at no earlier moment, so the abort had no effect at all
on the hold.

### What is not measured

**The remedy is unmeasured on the route.** The gate's direction, not a remedy it
ran on `routes/probe.ts`: in the bare Node server above, `reply.raw`'s `close`
fired 3.7 ms after the abort (5.8 ms on the dl-138 gate's own run) with
`writableFinished=false`, so a listener on the
response (or on the socket) is not late the way the request's is. Nobody has
registered one on this route and watched a slot free. Fastify's own handling of
a closed response, Node 22's other minor releases, and a request that has
already begun to answer when it is aborted are all unread. The Build below
measures before it changes.

## Build

1. **Reproduce first.** Copy the gate's `zz-gate-dl138-server.test.ts` shape into
   a scratch test (not the repo) and read the first row of the table above on
   this tree: the per-client slot held 3 s after an abort. If it is not held,
   stop and report; the finding is wrong on this tree.
2. **Find a listener that fires.** Try `reply.raw.on("close", …)` registered
   where the current one is, and check `reply.raw.writableFinished === false`
   (the bare-Node run reads it so at the abort) rather than
   `request.raw.destroyed`, which is `true` from the moment the body is read.
   Read it against: an abort while the handler waits in the chain; an abort during the
   output vet; an abort after the handler has begun to send; and a request that
   finishes normally, where the abort must not fire and must not log. If
   another event is the right one, use it, and say why in the Log.
3. **What the abort reaches.** The signal is passed to the resolve chain and to
   `captureThumbnail`. It is not passed to `guard.assertAllowed` or
   `assertAllAllowed`, which take none: the slot is therefore held through a
   vet that a signal cannot interrupt (the fourth row). That is the per-client
   slot alone: the global slot is released when `registry.resolve` returns,
   before the vet, so an assertion about the global slot concerns an abort during
   the chain. Decide, and record,
   whether this ticket stops there (an abort during the chain frees the slot as
   the chain unwinds, and ~~one during the vet frees it when the vet returns~~
   **WITHDRAWN (corrected 2026-11-15, from gate 1's high): after the vet the
   handler runs into `captureThumbnail`, whose image fetch takes its own 4 s
   timeout and not the client's signal, so the slot is held until that ends and
   the probe ends `ok`; see the Log's amendment**) or
   also takes a signal through the vet. Do not widen silently: if the vet needs a signature change in `ssrf.ts`,
   say so in the Log and leave it as a follow-up ticket.
4. **Tests**, appended at the end of the probe route's spec: a client abort
   frees the per-client slot and the global slot within a bound well under the
   resolver deadline; a normal request is unaffected. Use a real port and a real
   `fetch` abort, not a mock of the request object, because the defect is in
   when Node emits the event, which a mock cannot reproduce.
5. **dl-138's record.** When this lands, add a line to dl-138's Log naming the
   change, since its Decision's reading of its Question 2 option "abort on close,
   and start a waiting box at once" and N6 is corrected here.
   dl-138 is not edited before it merges.

Traps:

- `request.raw.destroyed` is `true` as soon as the body is read, so a test built
  on a mock request object passes for the wrong reason: it cannot show when Node
  emits the event.
- The listener sits before the gates are taken, so it can fire at any `await` in
  the handler, including after the controller's consumers have finished. Read
  what an abort at each of them does, not only the one in the chain.
- The job and file routes have their own close handling, and are not read here.

## Done when

- A test with a real port and a real aborted `fetch` shows the per-client probe
  slot and the global slot (for an abort during the chain, since the vet holds
  only the per-client one) free within a stated bound after the abort, and it
  fails on `main` before the change (the first row of the table).
- A request that completes normally frees its slot as it does today, and its
  listener does not abort the controller.
- The Log states which event the remedy uses, the measurement that chose it, and
  what an abort during the output vet still does.

## Log

- 2026-11-15 — Filed from dl-138's first gate (Opus 5.5), on the owner's answer
  at the orchestrator's checkpoint: file. The gate named three options (file;
  fold into dl-138; record only) and recommended filing, and no recommendation
  was overridden. The bare-Node reproduction was run again here on Node 22.23.4
  and read as quoted; the real-app measurements are the gate's, from
  `server.txt` in its scratch directory, not re-run for this filing.
- 2026-11-15 — Owner's answer, at the orchestrator's checkpoint after gate 1
  graded `d1ae1be7` CONCERNS, on how the lander handles gate 1's findings.
  Options: fix the meds and the lows at landing with no re-gate (the gate's
  recommendation); fix the meds only; record only. Answer: fix the meds and the
  lows at landing. No recommendation was overridden. Gate 1's findings on this
  ticket were all lows.
- 2026-11-15 — Fixed at landing by owner choice: gate 1, the first low — "`req
  close` at 34 ms" and "`reply.raw`'s `close` fired 6 ms after the abort". The
  dl-138 gate's own run reads 68 ms and 5.8 ms, and the run quoted above reads
  3.7 ms for the response's close; both figures now say so. Proof, run after the
  commit that carries this entry: `git diff d1ae1be7 HEAD -- tools/downloader/docs/work/dl-140-a-client-abort-of-the-probe-never-frees-its-slot.md | grep -c '^-.*the same two events on its own run'` → 1, and `... | grep -c '^-.*fired 6 ms after the abort with'` → 1.
- 2026-11-15 — Fixed at landing by owner choice: gate 1, the second low — "The
  listener has read this way since `d1ec2c61`". `git log -L` on the listener's
  lines in `routes/probe.ts` lists only `8d0d6d08` (WP-5, 2026-08-08); `d1ec2c61`
  moved the file. The Why now names `8d0d6d08`. Proof: `git diff d1ae1be7 HEAD -- tools/downloader/docs/work/dl-140-a-client-abort-of-the-probe-never-frees-its-slot.md | grep -c '^-.*has read this way since'` → 1.
- 2026-11-15 — Fixed at landing by owner choice: gate 1, the third low — the
  output vet holds only the per-client slot, because `probeGate`'s `release()`
  runs in the `finally` around `registry.resolve`. The Why, Build 3 and Done when
  1 now say so. Proof, an added sentence with no removed line: `git diff d1ae1be7 HEAD -- tools/downloader/docs/work/dl-140-a-client-abort-of-the-probe-never-frees-its-slot.md | grep -v 'Fixed at landing' | grep -c '^+.*before the output vet, so the vet holds only'` → 1.
- 2026-11-15 — Fixed at landing by owner choice: gate 1, the fourth low — dl-138
  lists its options unlettered, so "option (c)" finds nothing there. The Why and
  Build 5 now name the Question 2 option by its words. Proof: `git diff d1ae1be7 HEAD -- tools/downloader/docs/work/dl-140-a-client-abort-of-the-probe-never-frees-its-slot.md | grep -c '^-.*corrects: option (c)'` → 1, and `... | grep -c '^-.*reading of option (c) and N6'` → 1.
- 2026-11-15 — Gate 1's full report is on the pull request thread, #809; status
  unchanged.
- 2026-11-15 — Owner's answer at intake, to Build 3's choice "whether this ticket stops there or also takes a signal through the vet". Options: stop at the chain (recommended: an abort during the chain frees the slot as the chain unwinds, one during the vet frees it when the vet returns, and a signature change in `ssrf.ts` is logged as a follow-up ticket); also take it through the vet (widen into `ssrf.ts`); the builder decides and records. Answer: stop at the chain. The brief's default and the recommendation, so nothing is overridden and Build 3 is unchanged. `status` stays `ready`.
- 2026-11-15 — Built, on branch `downloader/dl-140-abort-frees-slot` from `5f15e56f`. Gate pending; `status` left as it was.
  - **Reproduced first (Build 1), on the base.** A scratch spec (in the scratch directory, copied into `api/test/` for the run and removed) listens on port 0, sends a real `fetch` with an `AbortController`, aborts it once the per-client slot is held, and waits for both gates to read zero, with the resolver chain's deadline at 1,500 ms and a resolver that rejects `CANCELED` on its signal. Both slots were free **1,534 ms** after the POST was sent: the chain's own deadline, so the abort changed nothing. This is the ticket's second row; it holds on this tree.
  - **The event (Build 2).** `reply.raw`'s `close`, with `reply.raw.writableFinished === false`, registered where the old listener was. The measurement that chose it is the same spec after the change, and the red/green below: the base left `{"client":1,"global":1}` after 1,000 ms; the change frees both. A normal request's `close` follows its `finish`, so `writableFinished` is true and the controller is not aborted (case 5, which reads the resolver's signal after the response). One addition the brief did not name: `if (reply.raw.closed) abortIfClientLeft()` after registering, because a client that leaves during the awaits before the listener (the SSRF vet's DNS lookup, the human check's siteverify) has already emitted its `close` and no further one is coming. Without that line case 3 fails (mutation below).
  - **Tests**, appended at the end of `api/test/routes.test.ts` (the probe route's spec), real port and real `fetch` abort, `describe("a client that aborts POST /api/probe")`, five cases: (1) during the chain both slots free within 1,000 ms against a 20 s deadline, and the resolver's signal carries `CANCELED`; (2) two probes aborted, then a third is admitted rather than refused 429; (3) abort while the request URL's vet (`guard.assertAllowed`) is held, then the vet released: the handler takes its slot and gives it back at once; (4) abort while the output vet (`assertAllAllowed`) is held, for a probe that names no thumbnail: global 0 and client 1 until the vet returns, then both 0 (title corrected 2026-11-15, gate 1's F1: it said "frees ... when the vet returns", which holds only because this probe's capture is instant); (5) a request that completes normally, the signal never aborted.
  - **Red on the base, green on the change.** `npx vitest run tools/downloader/api/test/routes.test.ts` with `routes/probe.ts` restored to `5f15e56f`: `Tests  3 failed | 45 passed (48)`: cases 1, 2 and 3, `timed out waiting for both slots to free after the abort; last value: {"client":1,"global":1}`, `...the per-client slots to free; last value: 2`, `...the slots to free; last value: {"client":1,"global":1}`. On the change: `Tests  48 passed (48)`. Cases 4 and 5 pass on both sides by design: 4 pins what the vet still does, 5 is the no-regression case. **Mutation:** with only the `closed` line removed, `Tests  1 failed | 47 passed (48)`, case 3 alone.
  - **What an abort during the output vet still does (Done when 3).** Nothing until the vet returns: `assertAllAllowed` takes no signal, so the per-client slot stays held through it (`{client: 1, global: 0}` 100 ms after the abort, case 4). ~~and frees when it returns~~ **WITHDRAWN (corrected 2026-11-15, from gate 1's high; the amendment at the foot of this Log has the measurement):** a probe aborted during the vet ends `ok`, whether it names a thumbnail or not; case 4's names none, so its capture is instant and the slot frees when the vet returns, while a probe that names one runs on into `captureThumbnail` and holds the slot until that ends, about 4 s (the image fetch takes its own 4 s timeout and not the client's signal) plus that image URL's own `guard.assertAllowed` DNS check, which takes neither a signal nor a timeout (read from `thumbnails.ts` and `ssrf.ts`, not measured). The global slot is already free, since `release()` ran when the chain returned. **Owner's answer at intake: stop at the chain**, so `ssrf.ts` is untouched. Whether the vet needs a signal is a follow-up only if a vet is seen to run long; this ticket measured none, and a vet is a DNS lookup per URL, so it is **not filed**: no reproduction beyond case 4's held vet, which holds it by construction.
  - **What the brief had wrong.** (a) The Why's "dl-138 is PR #799 and is not merged": it merged as `4d0ad61d`, so Build 5's line is in this branch, in dl-138's Log. (b) With the probe rate limiter off, as this harness has it, a handler that starts after the socket is gone reads `request.ip` as `"unknown"` (case 3 on the base: `tryAcquire` was called with `"unknown"`), so on the base such a request took its per-client slot under a key shared by every client in that state, and held it for the whole chain; the change frees it at once. **Corrected 2026-11-15 (gate 1, F3):** that holds only with the limiter off. At its default of 10 a minute the `onRequest` hook's read has cached Node's peername and the handler keys under the client's address (`127.0.0.1` here), and with `trustProxy` on under the `X-Forwarded-For` address. Case 3 reads the key off its spy, so it is right either way; what the finding says about a deployment with the limiter off is unmeasured. A test that reads `count(clientKey("127.0.0.1"))` there reads an empty key and passes on the base; case 3 reads the key the handler used. (c) The `Date.now()` clock read 4,134 ms for a span `performance.now()` read 1,534 ms in the same run of the scratch spec (the whole test file took 3.7 s); the spec and the routes cases use `performance.now()` for the bound, and the cause of the skew is not found.
  - **Also, read from the code and not run.** **Scope corrected 2026-11-15 (gate 1, F1):** this holds for an abort during the chain (9 of 9, the gate's) and around the listener's registration (260 of 260), and not for one during the output vet, which ends `ok` (see the amendment at the foot of this Log). An aborted probe now ends as `CANCELED` (409, `request rejected` at info) and writes a `probe_outcomes` row with outcome `CANCELED`, which `report.ts` already excludes from its rates (dl-57, decision B); before, an abort wrote nothing until the handler unwound on its own.
  - **Fold-in considered, not taken.** None: the other `close` handling, on the job and file routes, is outside this ticket's Build and unread.
  - **Not measured.** The Windows leg, other Node 22 minors, and a request aborted after it has begun to answer. **Corrected 2026-11-15 (gate 1, F2):** this line predicted that a late abort aborts the finished controller, and it does not. The gate measured a reply that was ended but cut mid-flush (a real socket that read the headers of a 32 MiB body and stopped, then went away): `writableFinished` read false 50 ms after the headers and **true at `close`** in 20 of 20, so the controller was not aborted, no `CANCELED` row was written and nothing was released twice, because Node counts a destroyed socket's empty buffer as flushed. No case of this branch drives it; the figure is the gate's.
- 2026-11-15 — Owner's answer, at the orchestrator's checkpoint after gate 1 failed `bc800d3a` on one high, **amending the intake answer above** (which stands: stop at the chain; `ssrf.ts` and `thumbnails.ts` untouched). The question was re-asked with the gate's measurement because the intake option had quoted Build 3's sentence "one during the vet frees it when the vet returns", which is false. Options: correct the text only (the gate's recommendation and the orchestrator's); correct the text and file a follow-up ticket for the thumbnail signal; fold the client's signal into the thumbnail image fetch in dl-140. Answer: **correct the text only**, no code change and no follow-up ticket. No recommendation was overridden. The known limit, stated so the next reader need not measure it: after the output vet returns, the handler runs on into `captureThumbnail`, whose image fetch is bounded by `AbortSignal.timeout(4 s)` and not by the client's signal, so an abort during the vet frees the per-client slot only when that capture ends (the gate measured 2,013 ms after the vet returned, against a thumbnail answering after 2 s, and 2,010 ms on the base), and the probe ends `ok`, not `CANCELED`: an `ok` `probe_outcomes` row, a probe-cache write and `probe complete` at info, with no `request rejected` line.
- 2026-11-15 — Owner's answer, at the orchestrator's checkpoint after gate 2 passed `c1abda7d` with F1 fixed in part (a residual graded low, two clauses). Options: fix both clauses at landing (gate 2's recommendation and the orchestrator's); record the residual and land as is; treat F1 as still high and run round 3 and gate 3. Answer: **the lander fixes both**, text only, no source or test change. No recommendation was overridden.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, F1 clause (a) — "the dl-138 line, the Log's Done when 3 bullet and the PR body attach ends `ok` to a probe that names a thumbnail only, where a probe that names none ends `ok` too". The ends `ok` claim now stands apart from the thumbnail clause in the Done when 3 bullet and in dl-138's Build 5 line (any probe aborted during the vet ends `ok`), and the PR body says the same. Proof: `git diff c1abda7d HEAD -- tools/downloader/docs/work/dl-140-a-client-abort-of-the-probe-never-frees-its-slot.md | grep -c '^-.*so its capture is instant and the slot frees when the vet returns; a probe that names one'` → 1.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, F1 clause (b) — "the dl-138 line's holds the per-client slot up to about 4 s after the vet omits the thumbnail URL's own guard.assertAllowed in captureThumbnail". The figure is now about 4 s plus that image URL's DNS check, in both places, worded as read from `thumbnails.ts` and `ssrf.ts` and not measured. Proof: `git diff c1abda7d HEAD -- tools/downloader/docs/work/dl-138-client-request-timeouts.md | grep -c '^-.*holds the per-client slot up to about 4 s after the vet and ends'` → 1.
