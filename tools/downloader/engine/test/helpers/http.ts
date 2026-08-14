/**
 * Local fixture HTTP server.
 *
 * Everything in this suite that needs HTTP talks to one of these on an ephemeral
 * port. Real sites change, rate-limit and geo-vary, which makes a CI failure
 * against one meaningless.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

export interface FixtureServer {
  origin: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export type FixtureHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => void | Promise<void>;

export async function startFixtureServer(handler: FixtureHandler): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
    });
    void (async () => {
      try {
        await handler(request, response);
      } catch {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** Deterministic body so a byte-for-byte comparison means something. */
export function makeBody(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) buffer[index] = index % 251;
  return buffer;
}

/** `bytes=100-` / `bytes=100-199` → start offset, or null. */
export function parseRangeStart(header: string | undefined): number | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d+)-/u.exec(header.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}
