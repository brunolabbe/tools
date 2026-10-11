// DL106-PROBE (temporary): what the fixture's timer-paced origin really delivers.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "vitest";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function say(text: string): void {
  process.stderr.write(`DL106 PROBE ${text}\n`);
}

async function timerCost(ms: number): Promise<string> {
  const samples: number[] = [];
  for (let index = 0; index < 100; index += 1) {
    const before = performance.now();
    // oxlint-disable-next-line no-await-in-loop
    await sleep(ms);
    samples.push(performance.now() - before);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return `sleep(${ms}): mean=${mean.toFixed(2)} min=${samples[0]?.toFixed(2)} p50=${samples[50]?.toFixed(2)} p90=${samples[90]?.toFixed(2)} max=${samples[99]?.toFixed(2)}`;
}

/** The fixture's own pacing loop, as parallel-ranges.test.ts's `send` writes it. */
async function paced(
  response: http.ServerResponse,
  total: number,
  perConnection: number,
  slice: number,
  bucket: boolean,
): Promise<void> {
  const body = Buffer.alloc(total, 1);
  let offset = 0;
  let next = performance.now();
  while (offset < body.length && !response.destroyed) {
    const piece = body.subarray(offset, offset + slice);
    offset += piece.length;
    if (bucket) {
      next = Math.max(next, performance.now() - 50) + (piece.length * 1000) / perConnection;
      const wait = next - performance.now();
      if (wait > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await sleep(wait);
      }
    } else {
      next += (piece.length * 1000) / perConnection;
      // oxlint-disable-next-line no-await-in-loop
      await sleep(Math.max(0, next - performance.now()));
    }
    if (!response.write(piece)) {
      // oxlint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => response.once("drain", () => resolve()));
    }
  }
  response.end();
}

async function measure(
  perConnection: number,
  slice: number,
  connections: number,
  bucket: boolean,
): Promise<string> {
  const total = Math.round(perConnection * 1.5);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-length": String(total) });
    void paced(response, total, perConnection, slice, bucket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const started = performance.now();
  const rates = await Promise.all(
    Array.from({ length: connections }, () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        let got = 0;
        http.get(`http://127.0.0.1:${port}/`, { agent: false }, (response) => {
          response.on("data", (chunk: Buffer) => (got += chunk.length));
          response.on("end", () => resolve((got * 1000) / (performance.now() - t0)));
        });
      }),
    ),
  );
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `bucket=${bucket} asked=${perConnection} slice=${slice} conns=${connections} got=${rates.map((rate) => Math.round(rate)).join(",")} in ${Math.round(performance.now() - started)} ms`;
}

test("dl-106 probe: timer cost and what a paced origin delivers", async () => {
  say(`platform=${process.platform} node=${process.version}`);
  for (const ms of [0, 1, 4, 8, 16, 33]) say(await timerCost(ms));
  for (const [bps, slice, connections] of [
    [500_000, 16384, 1],
    [1_000_000, 16384, 1],
    [2_000_000, 16384, 1],
    [4_000_000, 16384, 1],
    [40_000_000, 16384, 1],
    [2_000_000, 16384, 4],
    [4_000_000, 16384, 4],
  ] as const) {
    say(await measure(bps, slice, connections, false));
    say(await measure(bps, slice, connections, true));
  }
}, 120_000);
