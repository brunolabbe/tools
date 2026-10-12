---
id: dl-118
tool: downloader
title: The three dl-83 accepted-residue rows spend about 11 s each in provoke-playback
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-118 — Three age-gate rows spend about 11 s each in provoke-playback

## Why

This came out of the 2026-10-12 suite-speed audit, found while building
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).
The owner chose, on 2026-10-12, to file it rather than widen dl-111 into
production provocation code.

Three rows in `resolvers/test/browser/browser-resolver.test.ts`, the
"accepted residue" `test.each` under "false candidates and the press, as gate
round 1 measured them (dl-83)", take 10.8 to 13.0 s each, against about 2.8 s
for a normal probe. Together that is about 36 s of a file that CI times at
620 s:

- `age-false-cookie-sheet-closable.html` — 12.8 to 13.0 s
- `age-false-cookie-sheet-sticky.html` — 12.8 to 13.0 s
- `age-false-shell-menu-button.html` — 10.8 s

It is not a stalled body: nothing in the row asks for a manifest. Their
`server.requests` hold the page and one or two beacons and nothing else
(`/beacon/accept` and `/beacon/view-partners`, or `/beacon/nav-18`), and the
tests assert `/beacon/play` never fires.

## Reproduction

Gate 1 of dl-111 wrote the script below and ran it first: about 11 s inside
`provoke-playback` and 12 ms in `settle`. The builder of dl-111 re-ran it on
2026-10-12 on `origin/main` plus the dl-111 fixtures (which change none of these
pages). Run it from a worktree with `node --import tsx stages.mts <worktree
root> <page path> 1`; each stage's number is the millisecond offset at which
that stage began, and the last stage ends at the total.

```ts
// stages.mts — probes one fixture page with the dl-83 confirming() settings.
const [tree, pathname, confirm = "1"] = process.argv.slice(2);
const base = `${tree}/tools/downloader/resolvers`;
const { BrowserPool } = await import(`${base}/src/browser/pool.ts`);
const { BrowserResolver } = await import(`${base}/src/resolvers/browser.ts`);
const { recordingHlsParser } = await import(`${base}/test/browser/helpers/fake-parsers.ts`);
const { startFixtureServer } = await import(`${base}/test/browser/helpers/fixture-server.ts`);

const server = await startFixtureServer();
const pool = new BrowserPool({ maxConcurrent: 1, headless: true });
try {
  const resolver = new BrowserResolver({
    pool,
    hlsParser: recordingHlsParser().parser,
    quietMs: 1200,
    confirmAge: confirm === "1",
    emptyMinWaitMs: 1200,
  });
  const t0 = performance.now();
  const marks: string[] = [];
  let outcome = "ok";
  try {
    await resolver.resolve(new URL(server.url(pathname)), {
      timeoutMs: 25_000,
      signal: new AbortController().signal,
      onStage: (e: { stage: string }) =>
        marks.push(`${Math.round(performance.now() - t0)} ${e.stage}`),
    });
  } catch (error) {
    outcome = `error ${(error as { code?: string }).code}`;
  }
  process.stdout.write(
    `${Math.round(performance.now() - t0)} ms, ${outcome}\n  ${marks.join("\n  ")}\n  requests: ${server.requests.join(" ")}\n`,
  );
} finally {
  await pool.close();
  await server.close();
}
```

Output from one run of the script above, by the dl-111 builder:

```
/age-false-cookie-sheet-sticky.html
12971 ms, error NO_MEDIA_FOUND
  0 browser-launch / 112 page-load / 634 provoke-playback
  11752 network-quiet / 12959 settle-requests
  requests: /age-false-cookie-sheet-sticky.html /beacon/accept /beacon/view-partners
/age-false-cookie-sheet-closable.html
12969 ms, error NO_MEDIA_FOUND
  0 browser-launch / 99 page-load / 620 provoke-playback
  11749 network-quiet / 12958 settle-requests
  requests: /age-false-cookie-sheet-closable.html /beacon/accept /beacon/view-partners
/age-false-shell-menu-button.html
10899 ms, error NO_MEDIA_FOUND
  0 browser-launch / 99 page-load / 622 provoke-playback
  9679 network-quiet / 10886 settle-requests
  requests: /age-false-shell-menu-button.html /beacon/nav-18
control, /age-false-shell-link.html (same suite, same settings)
2860 ms, ok
  0 browser-launch / 91 page-load / 622 provoke-playback
  1641 network-quiet / 2842 settle-requests / 2845 manifest-fetch
  requests: ... /media/mse/master.m3u8 /media/mse/v1080.m3u8 /media/mse/init.mp4 ...
```

`provoke-playback` runs from about 620 ms to 11.7 s (11.1 s) on the two
cookie-sheet rows and to 9.7 s (9.1 s) on the menu-button row; the control page's
`provoke-playback` is 1.0 s. `network-quiet` is the 1.2 s `quietMs` and
`settle-requests` is about 12 ms, so the time is neither the wait nor the cap.

**Not measured:** where inside `provoke-playback` the 9 to 11 s goes. The
suspicion, untimed, is clicks that a covering layer blocks, each waiting out
Playwright's 1500 to 2000 ms action timeout. Five sites were first suspected
(`provoke.ts:1552`, `:1573`, `:1674`, `:1753`, `:1771`; gate 1 of dl-111 named
no lines, so they are not its). Three of them cannot be the cause: `:1552` and
`:1573` in `clickChosenVideo` and `:1674` in `clickPlayerBox` are `force: true`
clicks, which skip Playwright's actionability wait, so a covering layer cannot
make them sit out their timeout. The blockable clicks in this path are `provokeFrame`'s `clickVisible(…, PLAY_SELECTORS,
{ timeoutMs: 2000, max: 3 })` (`:1771`, cited) and `clickByText(frame,
PLAY_TEXT, 2000)` (`:1775`, not cited); `:1753` is the `dismissModal` call,
which this note did not examine. That is step 1 below.

## Build

1. **Find the time.** Time each step of `provokePlayback` on the three pages
   (the clicks, the dismiss, the age press, the scroll) and name the ones that
   add up to 9 to 11 s. Paste the timing in the Log.
2. **Decide what the rows need.** The rows pin that a false age candidate is
   pressed where play is a click and that nothing plays. If the wait is a blocked
   click's action timeout, the options are a shorter timeout on a click that is
   expected to be blocked, or checking that the target is covered before clicking
   it. Either changes production provocation code, which dl-111 deliberately did
   not: pick one with the timing in hand, and change no default behaviour a real
   page can see (the owner's rule for the audit: a timing option may be added only
   with its default unchanged).
3. If the time is not removable without changing what the rows prove, say so in
   the Log and close the ticket with the measurement.

## Done when

1. The Log holds the per-step timing for the three pages.
2. Either the three rows drop below 5 s each with the same assertions, or the Log
   says which assertion the time buys.
3. `npm test -- --project downloader` passes.

## Log

- 2026-10-12 — Filed from dl-111's round 2. The reproduction is gate 1's script,
  re-run by dl-111's builder, with the numbers above. Difficulty is `standard`
  on the builder's judgement: step 1 is measurement, but step 2 touches
  production provocation code and needs a call on which clicks may wait less.
