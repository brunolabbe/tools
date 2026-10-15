/**
 * dl-125 probe 2. DO NOT MERGE. Run with `npx tsx`, from the repository root.
 *
 * Two readings, printed to stdout because artifacts cannot be downloaded:
 *
 * 1. **The sample-boundary cut.** For fresh copies of dl-103's large
 *    fast-start fixture, every cut that lands exactly at a sample's first byte
 *    (from the moov's own sample tables, so no ffprobe is needed: ffmpeg-static
 *    ships none), plus random cuts, are served the way the dl-103 test's 60%
 *    answer serves them. Each run records whether ffmpeg logged `partial file`,
 *    how `done` ended, and `done`'s `durationSec`, which is ffmpeg's last
 *    `out_time` whenever a progress block arrived.
 * 2. **Whole sources.** Every progressive fixture the engine's suites build,
 *    served whole, with the variant declaring the container's own duration.
 *    Same three readings.
 *
 * The gap is declared duration minus `out_time`. A detection rule would fail a
 * `done` whose gap passes a threshold; the two distributions say what any
 * threshold catches and what it falsely fails.
 *
 * Usage: npx tsx .github/probe-dl-125-2/detect.mts <work dir> <fixture copies> <random cuts per copy>
 */
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const media = await import(
  pathToFileURL(path.join(root, "tools/downloader/engine/test/helpers/media.ts")).href
);
const { createEngine } = await import(
  pathToFileURL(path.join(root, "tools/downloader/engine/src/index.ts")).href
);

const [work = "dl125-work", copiesArg = "3", randomArg = "40"] = process.argv.slice(2);
const copies = Number(copiesArg);
const randomPerCopy = Number(randomArg);
await fs.mkdir(work, { recursive: true });
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
out(
  `ffmpeg: ${media.FFMPEG}; ffprobe: ${media.FFPROBE} (${existsSync(media.FFPROBE) ? "present" : "absent, ffmpeg -i fallback"})`,
);

const find = (boxes: [string, number, number][], type: string) =>
  boxes.filter(([name]) => name === type);

/** Every sample's first byte, across every track, from stco/co64 + stsc + stsz. */
function sampleStarts(file: Buffer): number[] {
  const children = (start: number, end: number): [string, number, number][] => {
    const boxes: [string, number, number][] = [];
    let at = start;
    while (at + 8 <= end) {
      let size = file.readUInt32BE(at);
      const type = file.toString("latin1", at + 4, at + 8);
      let header = 8;
      if (size === 1) {
        size = Number(file.readBigUInt64BE(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      boxes.push([type, at + header, at + size]);
      at += size;
    }
    return boxes;
  };
  const starts: number[] = [];
  for (const [, moovStart, moovEnd] of find(children(0, file.length), "moov")) {
    for (const [, trakStart, trakEnd] of find(children(moovStart, moovEnd), "trak")) {
      const mdia = find(children(trakStart, trakEnd), "mdia")[0];
      const minf = mdia && find(children(mdia[1], mdia[2]), "minf")[0];
      const stbl = minf && find(children(minf[1], minf[2]), "stbl")[0];
      if (!stbl) continue;
      const tables = children(stbl[1], stbl[2]);
      const stsz = find(tables, "stsz")[0];
      const stsc = find(tables, "stsc")[0];
      const stco = find(tables, "stco")[0];
      const co64 = find(tables, "co64")[0];
      if (!stsz || !stsc || (!stco && !co64)) continue;
      const fixed = file.readUInt32BE(stsz[1] + 4);
      const count = file.readUInt32BE(stsz[1] + 8);
      const sizes = Array.from({ length: count }, (_, i) =>
        fixed !== 0 ? fixed : file.readUInt32BE(stsz[1] + 12 + i * 4),
      );
      const offsets: number[] = [];
      if (stco) {
        const n = file.readUInt32BE(stco[1] + 4);
        for (let i = 0; i < n; i += 1) offsets.push(file.readUInt32BE(stco[1] + 8 + i * 4));
      } else if (co64) {
        const n = file.readUInt32BE(co64[1] + 4);
        for (let i = 0; i < n; i += 1)
          offsets.push(Number(file.readBigUInt64BE(co64[1] + 8 + i * 8)));
      }
      const entries = file.readUInt32BE(stsc[1] + 4);
      const runs = Array.from({ length: entries }, (_, i) => ({
        first: file.readUInt32BE(stsc[1] + 8 + i * 12),
        perChunk: file.readUInt32BE(stsc[1] + 12 + i * 12),
      }));
      let sample = 0;
      for (let chunk = 1; chunk <= offsets.length && sample < count; chunk += 1) {
        const run = runs.toReversed().find((entry) => entry.first <= chunk);
        let at = offsets[chunk - 1] ?? 0;
        for (let k = 0; k < (run?.perChunk ?? 0) && sample < count; k += 1) {
          starts.push(at);
          at += sizes[sample] ?? 0;
          sample += 1;
        }
      }
    }
  }
  return [...new Set(starts)].toSorted((a, b) => a - b);
}

let stored = Buffer.alloc(0);
const server = http.createServer((request, response) => {
  const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
  const start = range === null ? 0 : Number(range[1]);
  const end =
    range === null || range[2] === ""
      ? stored.length - 1
      : Math.min(Number(range[2]), stored.length - 1);
  response.writeHead(range === null ? 200 : 206, {
    ...(range === null ? {} : { "content-range": `bytes ${start}-${end}/${stored.length}` }),
    "content-length": String(end - start + 1),
  });
  response.end(stored.subarray(start, end + 1));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

interface Reading {
  outcome: string;
  outTimeSec: number | null;
  partial: boolean;
}

async function read(
  body: Buffer,
  name: string,
  declaredSec: number,
  kind: "av" | "video" | "audio",
): Promise<Reading> {
  stored = body;
  const lines: string[] = [];
  const logger = {
    debug: (message: string, fields?: Record<string, unknown>) => {
      if (message === "ffmpeg") lines.push(String(fields?.["line"]));
    },
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const engine = createEngine({ maxFileSizeBytes: 256 * 1024 * 1024, logger });
  let outcome = "";
  let outTimeSec: number | null = null;
  try {
    const stream = await engine.stream({
      jobId: `dl125-${name}`,
      variant: {
        id: name,
        protocol: "progressive",
        url: `${origin}/${name}`,
        hasVideo: kind !== "audio",
        hasAudio: kind !== "video",
        durationSec: declaredSec,
        label: name,
      },
      requestContext: { headers: {} },
    });
    stream.body.resume();
    outcome = await stream.done.then(
      (result: { bytes: number; durationSec: number | null }) => {
        outTimeSec = result.durationSec;
        return "done";
      },
      (error: { code?: string }) => error.code ?? "error",
    );
  } catch (error) {
    outcome = `refused ${(error as { code?: string }).code ?? "error"}`;
  }
  return { outcome, outTimeSec, partial: lines.some((line) => /partial file/u.test(line)) };
}

const fmt = (value: number | null): string => (value === null ? "null" : value.toFixed(3));
const boundaryGaps: { gap: number; rel: number; fraction: number }[] = [];
const wholeGaps: { gap: number; rel: number; name: string }[] = [];
const tally = new Map<string, number>();
const bump = (key: string): void => {
  tally.set(key, (tally.get(key) ?? 0) + 1);
};

// 1. Sample-boundary cuts and random cuts of fresh large fast-start fixtures.
for (let copy = 1; copy <= copies; copy += 1) {
  const dir = path.join(work, `large-${copy}`);
  await media.generateLargeProgressive(dir);
  const file = path.join(dir, "faststart.mp4");
  const whole = readFileSync(file);
  const declared = (await media.probeMedia(file)).durationSec ?? 4;
  const starts = sampleStarts(whole).filter((at) => at > 0);
  out(
    `copy ${copy}: ${whole.length} bytes, declared ${fmt(declared)} s, ${starts.length} sample starts from ${starts[0]} to ${starts.at(-1)}`,
  );
  let seed = 125 + copy;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const randomCuts = Array.from({ length: randomPerCopy }, () =>
    Math.floor(whole.length * (0.05 + 0.949 * random())),
  );
  for (const [label, cuts] of [
    ["boundary", starts],
    ["random", randomCuts],
  ] as const) {
    for (const cut of cuts) {
      const reading = await read(whole.subarray(0, cut), `large-${copy}-${cut}`, 4, "av");
      const fraction = cut / whole.length;
      bump(`${label} ${reading.outcome}${reading.partial ? " partial" : " no-partial"}`);
      if (reading.outcome === "done") {
        const gap = declared - (reading.outTimeSec ?? Number.NaN);
        if (label === "boundary") boundaryGaps.push({ gap, rel: gap / declared, fraction });
        out(
          `  ${label} cut=${cut} (${(fraction * 100).toFixed(2)}%) done out_time=${fmt(reading.outTimeSec)} gap=${fmt(gap)} partial=${reading.partial}`,
        );
      } else if (label === "random" && !reading.partial) {
        out(`  ${label} cut=${cut} ${reading.outcome} with no partial file`);
      }
    }
  }
}

// 2. Whole sources: every progressive fixture the engine's suites generate.
for (let copy = 1; copy <= copies; copy += 1) {
  const dir = path.join(work, `whole-${copy}`);
  const sources: [string, "av" | "video" | "audio"][] = [];
  for (const seconds of [4, 5, 9]) {
    await media.generateProgressive(path.join(dir, `prog${seconds}`), seconds);
    sources.push(
      [`prog${seconds}/moov-end.mp4`, "av"],
      [`prog${seconds}/faststart.mp4`, "av"],
      [`prog${seconds}/video-only.mp4`, "video"],
      [`prog${seconds}/audio-only.m4a`, "audio"],
    );
  }
  await media.generateLargeProgressive(path.join(dir, "large"));
  sources.push(["large/moov-end.mp4", "av"], ["large/faststart.mp4", "av"]);
  await media.generateLongGop(path.join(dir, "gop6"), 12, 6);
  sources.push(["gop6/moov-end.mp4", "av"]);
  await media.generateBitrateProgressive(path.join(dir, "rate"), 7, "1M");
  sources.push(["rate/moov-end.mp4", "av"], ["rate/faststart.mp4", "av"]);
  try {
    await media.generateWebm(path.join(dir, "webm"), 6);
    sources.push(["webm/source.webm", "av"]);
  } catch (error) {
    out(`webm not generated: ${String(error).slice(0, 200)}`);
  }
  for (const [name, kind] of sources) {
    const file = path.join(dir, name);
    const declared = (await media.probeMedia(file)).durationSec;
    const reading = await read(
      readFileSync(file),
      `whole-${copy}-${name.replace(/\W/gu, "-")}`,
      declared ?? 0,
      kind,
    );
    bump(`whole ${reading.outcome}${reading.partial ? " partial" : " no-partial"}`);
    const gap =
      declared === null || reading.outTimeSec === null ? Number.NaN : declared - reading.outTimeSec;
    if (Number.isFinite(gap) && declared !== null)
      wholeGaps.push({ gap, rel: gap / declared, name });
    out(
      `  whole ${copy} ${name}: ${reading.outcome} declared=${fmt(declared)} out_time=${fmt(reading.outTimeSec)} gap=${fmt(gap)}`,
    );
  }
}
server.close();

out("== outcomes ==");
for (const [key, count] of [...tally].toSorted()) out(`  ${key}: ${count}`);
const describe = (values: number[]): string => {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return `n=${sorted.length} min=${fmt(sorted[0] ?? null)} p5=${fmt(at(0.05) ?? null)} median=${fmt(at(0.5) ?? null)} p95=${fmt(at(0.95) ?? null)} max=${fmt(sorted.at(-1) ?? null)}`;
};
out("== gap, declared minus out_time, seconds ==");
out(`  boundary cuts that ended done: ${describe(boundaryGaps.map((g) => g.gap))}`);
out(`  whole sources:                 ${describe(wholeGaps.map((g) => g.gap))}`);
out("== gap as a fraction of declared ==");
out(`  boundary cuts that ended done: ${describe(boundaryGaps.map((g) => g.rel))}`);
out(`  whole sources:                 ${describe(wholeGaps.map((g) => g.rel))}`);
out("== a rule 'fail done when the gap exceeds T' ==");
for (const t of [0.05, 0.1, 0.2, 0.25, 0.5, 1]) {
  const caught = boundaryGaps.filter((g) => g.gap > t).length;
  const falsely = wholeGaps.filter((g) => g.gap > t).length;
  out(
    `  T=${t}s: catches ${caught} of ${boundaryGaps.length} boundary cuts; fails ${falsely} of ${wholeGaps.length} whole sources`,
  );
}
for (const t of [0.01, 0.02, 0.05, 0.1]) {
  const caught = boundaryGaps.filter((g) => g.rel > t).length;
  const falsely = wholeGaps.filter((g) => g.rel > t).length;
  out(
    `  T=${t * 100}% of declared: catches ${caught} of ${boundaryGaps.length}; fails ${falsely} of ${wholeGaps.length} whole sources`,
  );
}
out("== the boundary cuts a threshold misses: the last few seconds of the file ==");
for (const g of boundaryGaps
  .filter((x) => x.gap <= 0.25)
  .toSorted((a, b) => a.fraction - b.fraction)) {
  out(`  at ${(g.fraction * 100).toFixed(2)}% gap=${fmt(g.gap)}`);
}
out("== whole sources by gap, largest first ==");
for (const g of wholeGaps.toSorted((a, b) => b.gap - a.gap).slice(0, 12)) {
  out(`  ${g.name}: gap=${fmt(g.gap)} (${(g.rel * 100).toFixed(2)}%)`);
}
