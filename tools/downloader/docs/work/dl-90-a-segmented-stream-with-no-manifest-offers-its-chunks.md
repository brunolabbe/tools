---
id: dl-90
tool: downloader
title: A segmented stream whose manifest was never captured offers its numbered chunks as downloads
kind: fix
status: ready
milestone: null
depends_on: [dl-78]
difficulty: standard
---

# dl-90 — A segmented stream with no captured manifest offers its numbered chunks

## Why

[dl-78](./dl-78-a-progressive-file-is-demoted-to-a-segment.md) stopped
`classifyMedia` demoting a whole file to a `segment` just because its name is a
number (`839201.mp4`). A numbered `.mp4` is now `progressive`, and `rankHits`
drops it again only through `isChunkOfSegmentedPlayback` in
`resolvers/src/browser/rank.ts`, which fires when the capture holds an `hls` or
`dash` hit or a chunk-_named_ neighbour (`init.mp4`, `seg-1.mp4`, `chunk-9.mp4`).

A segmented stream whose chunks are named `00000.mp4`, `00001.mp4` … and whose
playlist was **never captured as a manifest hit** has neither. Nothing demotes
the chunks, so they are offered as downloads. At the base of dl-78 the same page
ended in `NO_MEDIA_FOUND`, an honest failure; now it is a wrong answer, one fMP4
fragment with no `moov`, labelled "MP4 · 2.0 MB". Cases where the manifest goes
uncaptured:

- an untyped playlist URL (`/api/playlist?id=7`, `text/plain`), which is
  [dl-79](./dl-79-a-manifest-with-no-recognisable-type-or-extension.md)'s subject;
- a manifest delivered inside a JSON response;
- a manifest held in a blob.

Found by the dl-78 gate (gate 1, 2026-10-06, recorded in dl-78's `## Review`) as
its one `med` finding. **The owner chose to file it rather than fold it into
dl-78** (2026-10-06), so dl-78 landed as it stood.

dl-79 (PR #373, unmerged when this was filed) narrows the case for untyped
playlist responses only. The gate says so from reading dl-79's diff, not from a
run; it did not test a manifest inside JSON or a blob. **Re-run the reproduction
below on the merged tree before building**, since dl-79 may have changed what
remains.

## Reproduction

The gate's harness, `capture.mts`, drives a real Chromium through
`BrowserResolver` against a local server. Run it from the worktree root:
`node --import tsx capture.mts /nomanifest.html`. (Its `ROOT` constant names the
gate's worktree; point it at the checkout under test.) The relevant page, the
server paths it needs and the player script, quoted from it:

```ts
const MB = 1024 * 1024;
const CHUNK = Buffer.alloc(2 * MB);

const HLS = (dir: string) =>
  `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="${dir}00000.mp4"\n#EXTINF:6,\n${dir}00001.mp4\n#EXTINF:6,\n${dir}00002.mp4\n#EXT-X-ENDLIST\n`;

function page(script: string, video = ""): string {
  return `<!doctype html><html><head><title>t</title></head><body>${video}<script>${script}</script></body></html>`;
}
// A "player" that fetches the manifest, then the numbered chunks, as an MSE player would.
const fetchAll = (urls: string[]) =>
  `(async()=>{for(const u of ${JSON.stringify(urls)}){try{const r=await fetch(u);await r.arrayBuffer();}catch(e){}}})();`;

const PAGES: Record<string, string> = {
  // Segmented stream whose manifest URL carries no extension and an untyped content-type.
  "/nomanifest.html": page(
    fetchAll(["/api/playlist?id=7", "/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"]),
  ),
};

// in the server handler:
if (path === "/api/playlist") {
  res.writeHead(200, { "content-type": "text/plain" }).end(HLS("/n/"));
  return;
}
if (path.endsWith(".mp4")) {
  res
    .writeHead(200, { "content-type": "video/mp4", "content-length": String(CHUNK.length) })
    .end(CHUNK);
  return;
}

// the resolve call, and how an outcome is printed
const resolver = new BrowserResolver({ pool, quietMs: 1200 });
const result = await resolver.resolve(new URL(origin + path), {
  timeoutMs: 25_000,
  signal: new AbortController().signal,
});
const v = result.variants.map(
  (x) => `${x.protocol} ${x.url.replace(origin, "")} ${x.filesizeBytes ?? "-"}`,
);
process.stdout.write(`[real] ${path} -> ${v.length} variants: ${v.join(" | ")}\n`);
```

The playlist is served `text/plain` from an extensionless URL, so
`classifyMedia` gives it no kind and no manifest hit is recorded. The chunks are
`video/mp4`, 2 MB each.

Measured by the gate:

- at dl-78's head (`df39926`):
  `[real] /nomanifest.html -> 3 variants: progressive /n/00000.mp4 2097152 | progressive /n/00001.mp4 2097152 | progressive /n/00002.mp4 2097152`
- at its base `src` (`056aab7`): `[real] /nomanifest.html -> THROW NO_MEDIA_FOUND`

For contrast, the same pages **with** a captured manifest (HLS and DASH, chunks in
the manifest's directory and in a different one, real and throwing parsers) gave
8 of 8 outcomes offering only the manifest, so the defect is the missing
evidence and not the numbered-name rule.

## Build

1. **Re-run the reproduction** on `origin/main` as it stands, and record what it
   prints. If dl-79 has merged, add the JSON-borne and blob variants to the
   harness: dl-79 does not read those, and the gate did not run them.
2. Decide what counts as evidence of a segmented stream when no manifest was
   captured. The gate's candidate, **not a decision**, is option (b) of its open
   decision: three or more purely numeric names (`^\d+\.(mp4|m4v)$`) in one
   directory count as evidence, so `clip-720.mp4`/`clip-1080.mp4` keep their stem
   and stay whole files. The cost is a rule a test has to pin. Check the
   opposing case before adopting it: a directory of three numerically named whole
   files (`/media/1.mp4`, `/media/2.mp4`, `/media/3.mp4`, a gallery or a
   playlist of full clips) must keep its files, or this swaps one wrong answer
   for another.
3. Put the rule where `isChunkOfSegmentedPlayback` already sits
   (`resolvers/src/browser/rank.ts`) and keep `classifyMedia`'s kind unchanged,
   so dl-78's `responseFileSize` and `keep` behaviour stands.
4. If the rule cannot separate the two shapes by name alone, say so and stop
   rather than guessing; the alternatives (sniffing the chunk's `moov`, reading
   its `Content-Range` pattern) are the owner's to choose.

## Done when

- The `/nomanifest.html` reproduction does not offer `/n/00000.mp4`…`/n/00002.mp4`
  as downloads: a browser-resolver spec that fails on `origin/main` and passes
  with the fix.
- A test proves three whole numbered files in one directory are still offered.
- A test proves `clip-720.mp4`/`clip-1080.mp4` stay whole files.
- dl-78's fixtures still pass: a resolution-suffixed whole file and a file whose
  server answers every `Range` with a short 206.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- 2026-10-06, filed from the dl-78 gate's `med` finding. The owner chose to file
  rather than fold it in. Option (b) above is the gate's candidate fix, not a
  decision. `difficulty: standard` is unconfirmed: the ticket gives no basis for
  more than the judgement the heuristic needs.
