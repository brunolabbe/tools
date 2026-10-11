/**
 * Parallel ranged reads for a progressive source throttled per connection
 * (dl-98).
 *
 * The reported origin served about 27 KB/s to each connection and about four
 * times that to four, so a 100 MB file took over an hour on the one connection
 * ffmpeg opens. This module puts **a loopback range server** between ffmpeg and
 * such an origin (the owner's Decision 1): ffmpeg reads
 * `http://127.0.0.1:<port>/<token>` as it would the origin, seeking with
 * `Range` as it likes, and the feeder behind it fetches from the origin.
 *
 * ## One connection until it measures slow
 *
 * The feeder starts as a relay: each request ffmpeg makes becomes one request
 * to the origin with the same `Range`, and the origin's status line, framing
 * headers and body go back unchanged. ffmpeg cannot tell it from the origin, so
 * a fast origin never sees a second connection (Decision 3).
 *
 * While it relays a `206`, it measures the origin's rate — only while the bytes
 * flow, never while ffmpeg is not reading, so a slow visitor is not mistaken
 * for a slow origin. After `measureMs` of that it compares the rate with the
 * media's bitrate, the file's size over its duration. At or above it, the job
 * stays on one connection for good. Below it, the request in flight is
 * **split**: the connection already open keeps reading up to one chunk ahead,
 * and the rest of the file is fetched as bounded ranges, `connections` at once,
 * each `chunkBytes` long, and handed to ffmpeg in order. When the size or the
 * duration is unknown no comparison is made, and the job stays on one.
 *
 * ## What it holds
 *
 * Only chunks fetched and not yet handed to ffmpeg, and at most `connections`
 * of them, each at most `chunkBytes`: 4 × 4 MB by default (Decision 2). There
 * is no disk (dl-53). `stats().maxHeldBytes` is the measured high-water mark.
 *
 * ## A host that refuses
 *
 * Decision 5: once split, a `429`, `403` or `503` on a ranged fetch, a reset,
 * a `200` that ignores the range, or the split reading no faster than
 * `speedupFloor` times the single connection, drops the job back to one
 * connection — the chunk at the head is kept, everything ahead is dropped, and
 * one open-ended request continues from where the head stopped. ffmpeg sees
 * none of it. The host is reported through `onRefused`, which the engine keeps
 * until the process restarts. Any other failure of a ranged fetch also drops
 * back, without remembering the host: it is not a refusal of the fan-out.
 *
 * ## Framing is exact
 *
 * dl-103 reads ffmpeg's `partial file` and an early end at the same offset as
 * an unseekable origin, and anything shorter as a short source; it cannot tell
 * an origin from this server. So every answer the server composes declares its
 * `Content-Length`, a relayed one declares what the origin declared, and a
 * fetch that fails mid-body is passed on as a cut connection, never as a clean
 * end — which ffmpeg reconnects from as it would from the origin.
 *
 * ## Egress
 *
 * Every origin request is `seek-probe.ts`'s `get`, on the route the probe
 * takes: through the proxy ffmpeg is given, as an absolute-form request or a
 * `CONNECT` tunnel, with the same `tlsVerify` and `tlsCaFile`, each redirect hop
 * a fresh request through it. The guarded proxy is the SSRF check, as it is for
 * ffmpeg. Each carries the replayed `RequestContext`. ffmpeg's own request to
 * the loopback carries none of it and goes around the proxy by `-http_proxy ""`
 * (see `buildLoopbackInputArgs`), so the server listens on 127.0.0.1 only and
 * answers one unguessable path.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AppError, redactUrl } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import { buildFetchHeaders } from "../ffmpeg/headers.ts";
import type { Logger } from "../logger.ts";
import type { EgressRoute } from "./seek-probe.ts";
import { get, TunnelRefused } from "./seek-probe.ts";

export interface ParallelRangeSettings {
  /** Connections once split, the one already open included (Decision 4). */
  connections: number;
  /** Bytes per ranged fetch (Decision 2). */
  chunkBytes: number;
  /** How long a rate is measured, on one connection and then on several, before it is judged. */
  measureMs: number;
  /**
   * The split must read at least this many times faster than one connection,
   * or it is a per-client throttle and the host is refused. A per-connection
   * throttle gives about `connections` times (3.7 measured at four); a
   * per-client one gives about 1, so 1.5 sits well clear of both.
   */
  speedupFloor: number;
}

export const PARALLEL_RANGE_DEFAULTS: Readonly<ParallelRangeSettings> = {
  connections: 4,
  chunkBytes: 4 * 1024 * 1024,
  measureMs: 5_000,
  speedupFloor: 1.5,
};

/** Decision 5's refusals, by what the fixture or the origin did. */
export type RefusalKind = "status" | "reset" | "range-ignored" | "no-speedup";

/**
 * True when `host` is `entry` or a subdomain of it, for any entry: an origin
 * that objects usually objects from every name it serves under. Case-blind,
 * and a bracketed IPv6 address matches its bare form.
 */
export function hostListed(host: string, list: readonly string[]): boolean {
  const name = bare(host).toLowerCase();
  return list.some((raw) => {
    const entry = bare(raw.trim()).toLowerCase().replace(/^\./u, "");
    return entry !== "" && (name === entry || name.endsWith(`.${entry}`));
  });
}

function bare(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export interface FeederStats {
  mode: "single" | "parallel" | "fallen-back";
  /** The most bytes fetched and not yet handed to ffmpeg, at any one moment. */
  maxHeldBytes: number;
  /** Bytes handed to ffmpeg, every request together: what the size cap counts. */
  deliveredBytes: number;
  /** Requests sent to the origin, redirect hops not counted. */
  originRequests: number;
  /** The most ranged fetches in flight at once. */
  maxConcurrentFetches: number;
  refusal: { kind: RefusalKind; detail: string } | null;
}

export interface RangeFeederOptions {
  /** The origin's URL: the candidate, never anything in its place. */
  url: string;
  requestContext: RequestContext;
  /** `egressProxy`'s answer; `unusable` is the caller's to refuse before this. */
  route: EgressRoute;
  tlsVerify: boolean;
  tlsCaFile: string | undefined;
  settings: ParallelRangeSettings;
  /** The file's size when the probe knew it; the origin's own `Content-Range` wins. */
  sizeHint: number | null;
  /** The media's duration, asked each time it is needed: ffmpeg may learn it late (dl-96). */
  durationSec: () => number | null;
  /** The size cap, on bytes handed to ffmpeg. 0 is none. */
  maxBytes: number;
  signal?: AbortSignal | undefined;
  logger: Logger;
  jobId: string;
  /** Decision 5: this host refused the fan-out. */
  onRefused: (host: string, kind: RefusalKind) => void;
  /** A failure ffmpeg cannot report for itself: the size cap. */
  onFatal: (error: AppError) => void;
}

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
/** Statuses Decision 5 names as a host refusing. */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);
/** Socket failures that mean the origin cut the connection, which Decision 5 counts as a reset. */
const RESET_CODES: ReadonlySet<string> = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);
/** Origin headers a relayed answer carries; the rest are the origin's business. */
const RELAYED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-encoding",
  "last-modified",
  "etag",
] as const;
/** Node's TLS codes for a certificate that did not verify, as ffmpeg would be told them. */
const CERTIFICATE_CODE = /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ALTNAME/u;

/** `bytes=S-` or `bytes=S-E`; null for anything else. */
function parseRange(header: string | undefined): { start: number; end: number | null } | null {
  const match = /^bytes=(\d+)-(\d*)$/u.exec(header?.trim() ?? "");
  if (match === null) return null;
  return { start: Number(match[1]), end: match[2] === "" ? null : Number(match[2]) + 1 };
}

/** `bytes S-E/T`, with T possibly `*`. */
function parseContentRange(
  header: string | undefined,
): { start: number; end: number; total: number | null } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(header?.trim() ?? "");
  if (match === null) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]) + 1,
    total: match[3] === "*" ? null : Number(match[3]),
  };
}

/** Records a rate over the time something was actually flowing, and nothing else. */
class Meter {
  bytes = 0;
  activeMs = 0;
  #lastAt: number | null = null;

  /** `bytes` arrived now; the interval since the last call counts unless it was interrupted. */
  record(bytes: number, now: number): void {
    if (this.#lastAt !== null) {
      this.activeMs += now - this.#lastAt;
      this.bytes += bytes;
    }
    this.#lastAt = now;
  }

  interrupt(): void {
    this.#lastAt = null;
  }

  reset(): void {
    this.bytes = 0;
    this.activeMs = 0;
    this.#lastAt = null;
  }

  /** Bytes per second. */
  rate(): number {
    return this.activeMs > 0 ? (this.bytes * 1000) / this.activeMs : 0;
  }
}

interface FetchFailure {
  /** Decision 5's kind, or null for a failure that is not a refusal. */
  refusal: RefusalKind | null;
  detail: string;
  /** For a relayed failure before a response: what ffmpeg is told. */
  status: number;
  statusMessage: string;
}

/** One request to the origin, and the bytes it has brought that ffmpeg has not had yet. */
class Fetch {
  readonly start: number;
  /** Exclusive. Null while open-ended: a relay, or the connection open before the split. */
  end: number | null;
  received = 0;
  readonly queue: Buffer[] = [];
  queued = 0;
  done = false;
  started = false;
  failure: FetchFailure | null = null;
  response: IncomingMessage | null = null;
  paused = false;
  readonly controller = new AbortController();
  #closed!: () => void;
  readonly closed: Promise<void> = new Promise((resolve) => {
    this.#closed = resolve;
  });

  constructor(start: number, end: number | null) {
    this.start = start;
    this.end = end;
  }

  get inFlight(): boolean {
    return this.started && !this.done && this.failure === null;
  }

  markClosed(): void {
    this.#closed();
  }

  /** Stops the network side; the queue is kept. */
  abort(): void {
    this.controller.abort();
    this.response?.destroy();
    if (!this.started) this.markClosed();
  }
}

/** One request ffmpeg made of the loopback. */
class Serve {
  readonly feeder: RangeFeeder;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  /** Next byte ffmpeg gets. */
  position: number;
  /** Exclusive; null until known. */
  end: number | null;
  /** Answered by the server itself, which owns the framing; otherwise relayed. */
  composed: boolean;
  readonly fetches: Fetch[] = [];
  blocked = false;
  finished = false;

  constructor(
    feeder: RangeFeeder,
    request: IncomingMessage,
    response: ServerResponse,
    start: number,
    end: number | null,
    composed: boolean,
  ) {
    this.feeder = feeder;
    this.request = request;
    this.response = response;
    this.position = start;
    this.end = end;
    this.composed = composed;
  }
}

/**
 * The loopback server and the fetches behind it, for one ffmpeg run. Start it
 * with `RangeFeeder.start`, hand ffmpeg `url`, and `close` it when ffmpeg has
 * exited: a run refused before its first byte leaves by a throw (dl-103), so
 * the caller closes it from ffmpeg's `completion`.
 */
export class RangeFeeder {
  readonly url: string;
  readonly #server: http.Server;
  readonly #options: RangeFeederOptions;
  readonly #path: string;
  readonly #host: string;
  readonly #ca: Buffer | undefined;
  readonly #serves = new Set<Serve>();
  #mode: FeederStats["mode"] = "single";
  /** Measured at or above the bitrate: one connection for the rest of the run. */
  #settled = false;
  #size: number | null;
  #contentType: string | undefined;
  /** Where a redirect led; later fetches go straight there, as ffmpeg's do. */
  #target: URL;
  #closed = false;
  #held = 0;
  #maxHeld = 0;
  #delivered = 0;
  #originRequests = 0;
  #maxConcurrent = 0;
  #refusal: FeederStats["refusal"] = null;
  readonly #meter = new Meter();
  #singleRate = 0;
  /** The split has been measured once and held up; it is not judged again. */
  #splitJudged = false;
  #onAbort: (() => void) | null = null;

  private constructor(
    server: http.Server,
    url: string,
    path: string,
    options: RangeFeederOptions,
    ca: Buffer | undefined,
  ) {
    this.#server = server;
    this.url = url;
    this.#path = path;
    this.#options = options;
    this.#ca = ca;
    this.#target = new URL(options.url);
    this.#host = this.#target.hostname;
    this.#size = options.sizeHint !== null && options.sizeHint > 0 ? options.sizeHint : null;
  }

  static async start(options: RangeFeederOptions): Promise<RangeFeeder> {
    const ca =
      options.tlsCaFile === undefined || options.tlsCaFile.length === 0
        ? undefined
        : await readFile(options.tlsCaFile);
    const path = `/${randomBytes(16).toString("hex")}`;
    let feeder: RangeFeeder | null = null;
    const server = http.createServer((request, response) => {
      if (feeder === null) {
        response.writeHead(503).end();
        return;
      }
      feeder.#accept(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const port = (server.address() as AddressInfo).port;
    feeder = new RangeFeeder(server, `http://127.0.0.1:${port}${path}`, path, options, ca);
    const signal = options.signal;
    if (signal !== undefined) {
      const created = feeder;
      if (signal.aborted) created.close();
      else {
        created.#onAbort = () => created.close();
        signal.addEventListener("abort", created.#onAbort, { once: true });
      }
    }
    return feeder;
  }

  stats(): FeederStats {
    return {
      mode: this.#mode,
      maxHeldBytes: this.#maxHeld,
      deliveredBytes: this.#delivered,
      originRequests: this.#originRequests,
      maxConcurrentFetches: this.#maxConcurrent,
      refusal: this.#refusal,
    };
  }

  /** Stops every fetch and the server. Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#onAbort !== null) this.#options.signal?.removeEventListener("abort", this.#onAbort);
    for (const serve of this.#serves) this.#drop(serve);
    this.#serves.clear();
    this.#server.close();
    this.#server.closeAllConnections();
  }

  // --- ffmpeg's side -------------------------------------------------------

  #accept(request: IncomingMessage, response: ServerResponse): void {
    if (this.#closed) {
      response.destroy();
      return;
    }
    if (new URL(request.url ?? "/", "http://loopback").pathname !== this.#path) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end();
      return;
    }

    const asked = parseRange(request.headers.range);
    const composed = this.#mode === "parallel";
    const serve = new Serve(
      this,
      request,
      response,
      asked?.start ?? 0,
      asked?.end ?? null,
      composed,
    );
    this.#serves.add(serve);
    response.on("drain", () => {
      serve.blocked = false;
      this.#pump(serve);
    });
    response.once("close", () => {
      // ffmpeg went away: a seek, its exit, or the end of the body.
      this.#drop(serve);
      this.#serves.delete(serve);
      this.#fillAll();
    });

    if (composed) {
      this.#compose(serve, asked);
      return;
    }
    // A relay: the origin's own answer to ffmpeg's own range.
    const fetch = new Fetch(serve.position, null);
    serve.fetches.push(fetch);
    this.#begin(serve, fetch, request.headers.range ?? null);
  }

  /** Split mode: the server answers from what it knows, and fetches in chunks. */
  #compose(serve: Serve, asked: { start: number; end: number | null } | null): void {
    const size = this.#size as number;
    if (serve.position >= size) {
      serve.response.writeHead(416, { "content-range": `bytes */${size}` }).end();
      serve.finished = true;
      return;
    }
    serve.end = Math.min(serve.end ?? size, size);
    const length = serve.end - serve.position;
    serve.response.writeHead(asked === null ? 200 : 206, {
      ...(this.#contentType === undefined ? {} : { "content-type": this.#contentType }),
      "accept-ranges": "bytes",
      "content-length": String(length),
      ...(asked === null
        ? {}
        : { "content-range": `bytes ${serve.position}-${serve.end - 1}/${size}` }),
    });
    this.#fill(serve);
  }

  /** Hands ffmpeg what is ready, in order, as fast as it reads. */
  #pump(serve: Serve): void {
    while (!serve.blocked && !serve.finished && !this.#closed) {
      const head = serve.fetches[0];
      if (head === undefined) {
        if (serve.end !== null && serve.position >= serve.end) {
          serve.finished = true;
          serve.response.end();
        }
        return;
      }
      const chunk = head.queue.shift();
      if (chunk !== undefined) {
        head.queued -= chunk.length;
        this.#held -= chunk.length;
        serve.position += chunk.length;
        this.#delivered += chunk.length;
        if (this.#options.maxBytes > 0 && this.#delivered > this.#options.maxBytes) {
          this.#fatal(
            new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
              details: { sourceBytes: this.#delivered, limitBytes: this.#options.maxBytes },
            }),
          );
          return;
        }
        if (!serve.response.write(chunk)) serve.blocked = true;
        continue;
      }
      if (head.failure !== null) {
        this.#headFailed(serve, head);
        return;
      }
      if (head.done) {
        serve.fetches.shift();
        if (!serve.composed && serve.fetches.length === 0) {
          // A relay ends when the origin's body did.
          serve.finished = true;
          serve.response.end();
          return;
        }
        this.#fillAll();
        continue;
      }
      break;
    }
    // Flow control for a fetch that is not bounded by one chunk: a relay, the
    // connection open before the split, or the continuation after a fallback.
    const head = serve.fetches[0];
    const unbounded = head !== undefined && (head.end === null || this.#mode !== "parallel");
    if (head !== undefined && unbounded && head.response !== null) {
      if (serve.blocked && !head.paused) {
        head.paused = true;
        head.response.pause();
        this.#meter.interrupt();
      } else if (!serve.blocked && head.paused) {
        head.paused = false;
        head.response.resume();
      }
    }
  }

  /** The fetch ffmpeg is waiting on failed. */
  #headFailed(serve: Serve, head: Fetch): void {
    const failure = head.failure as FetchFailure;
    if (this.#mode === "parallel") {
      this.#fallBack(failure);
      return;
    }
    if (!serve.response.headersSent) {
      // Nothing came back at all: say what went wrong in the words ffmpeg logs.
      serve.finished = true;
      serve.response.writeHead(failure.status, failure.statusMessage).end();
      return;
    }
    // Cut, as the origin's connection was, so that ffmpeg reconnects.
    serve.finished = true;
    serve.response.destroy();
  }

  // --- the origin's side ---------------------------------------------------

  /** Sends `fetch`'s request. `range` is the header to send, or null for none. */
  #begin(serve: Serve, fetch: Fetch, range: string | null): void {
    fetch.started = true;
    this.#originRequests += 1;
    this.#maxConcurrent = Math.max(this.#maxConcurrent, this.#inFlight());
    void this.#request(fetch, range).then(
      (response) => this.#receive(serve, fetch, response),
      (error: unknown) => {
        fetch.markClosed();
        this.#fail(serve, fetch, failureOf(error));
      },
    );
  }

  /** One request, through `route`, redirects followed each on a fresh request through it. */
  async #request(fetch: Fetch, range: string | null): Promise<IncomingMessage> {
    const headers: Record<string, string> = {
      ...buildFetchHeaders(this.#options.requestContext),
      // The fetch reads the body's own bytes; a compressed one would be a different length.
      "accept-encoding": "identity",
      ...(range === null ? {} : { range }),
    };
    const tlsSettings = { rejectUnauthorized: this.#options.tlsVerify, ca: this.#ca };
    let target = this.#target;
    for (let hop = 0; ; hop += 1) {
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw Object.assign(new Error("a redirect left http"), { code: "ERR_SCHEME" });
      }
      // oxlint-disable-next-line no-await-in-loop
      const response = await get(
        target,
        headers,
        this.#options.route,
        tlsSettings,
        fetch.controller.signal,
      );
      const location = response.headers.location;
      if (REDIRECTS.has(response.statusCode ?? 0) && location !== undefined) {
        response.destroy();
        if (hop >= MAX_REDIRECTS)
          throw Object.assign(new Error("redirects"), { code: "ERR_REDIRECTS" });
        target = new URL(location, target);
        continue;
      }
      this.#target = target;
      return response;
    }
  }

  #receive(serve: Serve, fetch: Fetch, response: IncomingMessage): void {
    fetch.response = response;
    response.once("close", () => fetch.markClosed());
    if (this.#closed || fetch.controller.signal.aborted) {
      response.destroy();
      return;
    }
    const status = response.statusCode ?? 0;
    const range = parseContentRange(response.headers["content-range"]);

    if (
      fetch.end === null &&
      !serve.composed &&
      fetch === serve.fetches[0] &&
      !serve.response.headersSent
    ) {
      if (this.#relayHead(serve, response, status, range)) return;
    } else {
      // Composed: anything but the exact bytes asked for is a failure.
      const refused = this.#check(fetch, status, range);
      if (refused !== null) {
        response.destroy();
        this.#fail(serve, fetch, refused);
        return;
      }
    }

    response.on("data", (chunk: Buffer) => this.#data(serve, fetch, chunk));
    response.once("end", () => {
      if (fetch.done || fetch.failure !== null) return;
      if (fetch.end !== null && fetch.start + fetch.received < fetch.end) {
        this.#fail(serve, fetch, reset("the body ended short"));
        return;
      }
      fetch.done = true;
      this.#pump(serve);
    });
    response.on("error", () => undefined);
    response.once("close", () => {
      if (!fetch.done && fetch.failure === null && !response.complete) {
        this.#fail(serve, fetch, reset("closed"));
      }
    });
  }

  /**
   * A relay's answer: the origin's status line and framing, unchanged. True
   * when the body was handed straight on (an error page), and is not read here.
   */
  #relayHead(
    serve: Serve,
    response: IncomingMessage,
    status: number,
    range: ReturnType<typeof parseContentRange>,
  ): boolean {
    const headers: Record<string, string> = {};
    for (const name of RELAYED_HEADERS) {
      const value = response.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    serve.response.writeHead(status, response.statusMessage ?? "", headers);
    if (status === 206 && range !== null) {
      serve.end = range.end;
      if (range.total !== null) this.#size = range.total;
      this.#contentType = response.headers["content-type"] ?? this.#contentType;
    } else if (status === 200 && serve.request.headers.range === undefined) {
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > 0) this.#size = length;
    }
    // Not a 206: the origin did not range this request, and nothing here can split it.
    if (status !== 206) serve.end = null;
    if (status >= 200 && status < 300) return false;
    // An error page goes to ffmpeg as it came, and ffmpeg reports it.
    serve.fetches.length = 0;
    serve.finished = true;
    response.pipe(serve.response);
    return true;
  }

  /** Why a composed fetch's answer is not the bytes it asked for, or null when it is. */
  #check(
    fetch: Fetch,
    status: number,
    range: ReturnType<typeof parseContentRange>,
  ): FetchFailure | null {
    if (status === 200)
      return { refusal: "range-ignored", detail: "200", status, statusMessage: "" };
    if (REFUSAL_STATUSES.has(status)) {
      return { refusal: "status", detail: String(status), status, statusMessage: "" };
    }
    if (status !== 206 || range === null || range.start !== fetch.start + fetch.received) {
      return {
        refusal: null,
        detail: `status ${status}`,
        status: 502,
        statusMessage: "Bad Gateway",
      };
    }
    return null;
  }

  #data(serve: Serve, fetch: Fetch, chunk: Buffer): void {
    if (fetch.done || fetch.failure !== null || this.#closed) return;
    let piece = chunk;
    if (fetch.end !== null) {
      const room = fetch.end - (fetch.start + fetch.received);
      if (room <= 0) return;
      if (piece.length > room) piece = piece.subarray(0, room);
    }
    fetch.received += piece.length;
    fetch.queue.push(piece);
    fetch.queued += piece.length;
    this.#held += piece.length;
    this.#maxHeld = Math.max(this.#maxHeld, this.#held);

    const now = performance.now();
    if (this.#mode === "parallel") {
      // A rate for the split only while every slot is reading.
      if (this.#inFlight() >= this.#options.settings.connections)
        this.#meter.record(piece.length, now);
      else this.#meter.interrupt();
    } else if (this.#mode === "single" && serve.end !== null && fetch.end === null) {
      if (!fetch.paused) this.#meter.record(piece.length, now);
    }

    if (fetch.end !== null && fetch.start + fetch.received >= fetch.end) {
      fetch.done = true;
      // The connection that was open before the split keeps sending past its chunk.
      fetch.response?.destroy();
      this.#fillAll();
    }
    this.#judge(serve, fetch);
    this.#pump(serve);
  }

  #fail(serve: Serve, fetch: Fetch, failure: FetchFailure): void {
    // An abort is ours — a seek, a fallback, the end of the run — not the origin's.
    if (fetch.done || fetch.failure !== null || this.#closed) return;
    if (fetch.controller.signal.aborted) return;
    fetch.failure = failure;
    if (this.#mode === "parallel") {
      this.#fallBack(failure);
      return;
    }
    this.#pump(serve);
  }

  // --- decisions -------------------------------------------------------------

  /** The rate the media plays at, in bytes per second; null when either half is unknown. */
  #bitrate(): number | null {
    const duration = this.#options.durationSec();
    if (this.#size === null || duration === null || !(duration > 0)) return null;
    return this.#size / duration;
  }

  /** After each chunk of data: is it time to split, or to give up on the split? */
  #judge(serve: Serve, fetch: Fetch): void {
    const { measureMs, chunkBytes, speedupFloor } = this.#options.settings;
    if (this.#meter.activeMs < measureMs) return;

    if (this.#mode === "parallel") {
      if (this.#splitJudged) return;
      const rate = this.#meter.rate();
      if (rate < this.#singleRate * speedupFloor) {
        this.#fallBack({
          refusal: "no-speedup",
          detail: `${Math.round(rate)} B/s split against ${Math.round(this.#singleRate)} B/s on one`,
          status: 502,
          statusMessage: "",
        });
      } else {
        // Judged once: a speed-up that held is not re-litigated every window.
        this.#splitJudged = true;
        this.#options.logger.debug("parallel ranges are faster", {
          jobId: this.#options.jobId,
          bytesPerSecond: Math.round(rate),
          single: Math.round(this.#singleRate),
        });
      }
      return;
    }
    if (this.#mode !== "single" || this.#settled) return;

    const rate = this.#meter.rate();
    const bitrate = this.#bitrate();
    if (bitrate === null) {
      // Perhaps ffmpeg has not said the duration yet; measure again.
      this.#meter.reset();
      return;
    }
    if (rate >= bitrate) {
      this.#settled = true;
      this.#options.logger.debug("origin fast enough on one connection", {
        jobId: this.#options.jobId,
        bytesPerSecond: Math.round(rate),
        bitrate: Math.round(bitrate),
      });
      return;
    }
    const from = fetch.start + fetch.received;
    if (serve.end === null || serve.end - from <= chunkBytes || fetch !== serve.fetches[0]) {
      // Too little of this request is left to split; the next request may have more.
      this.#meter.reset();
      return;
    }
    this.#split(serve, fetch, rate, bitrate);
  }

  #split(serve: Serve, lead: Fetch, rate: number, bitrate: number): void {
    this.#mode = "parallel";
    this.#singleRate = rate;
    this.#meter.reset();
    serve.composed = true;
    const from = lead.start + lead.received;
    lead.end = Math.min(from + this.#options.settings.chunkBytes, serve.end as number);
    lead.paused = false;
    lead.response?.resume();
    this.#options.logger.info(
      "origin slower than the media on one connection; reading ranges in parallel",
      {
        jobId: this.#options.jobId,
        url: redactUrl(this.#options.url),
        bytesPerSecond: Math.round(rate),
        bitrate: Math.round(bitrate),
        connections: this.#options.settings.connections,
      },
    );
    this.#fillAll();
  }

  /** In split mode, starts chunk fetches for every serve until the slots are full. */
  #fillAll(): void {
    if (this.#mode !== "parallel" || this.#closed) return;
    for (const serve of this.#serves) this.#fill(serve);
  }

  #fill(serve: Serve): void {
    if (this.#mode !== "parallel" || serve.finished || serve.end === null) return;
    const { connections, chunkBytes } = this.#options.settings;
    for (;;) {
      // Slots are shared by every serve: what is held is bounded per run, not per request.
      if (this.#occupied() >= connections) return;
      const last = serve.fetches.at(-1);
      const next = last === undefined ? serve.position : (last.end ?? Number.POSITIVE_INFINITY);
      if (next >= serve.end) return;
      const fetch = new Fetch(next, Math.min(next + chunkBytes, serve.end));
      serve.fetches.push(fetch);
      this.#begin(serve, fetch, `bytes=${fetch.start}-${(fetch.end as number) - 1}`);
    }
  }

  /** Fetches holding a slot: started or queued, and not yet handed over in full. */
  #occupied(): number {
    let count = 0;
    for (const serve of this.#serves) count += serve.fetches.length;
    return count;
  }

  #inFlight(): number {
    let count = 0;
    for (const serve of this.#serves)
      for (const fetch of serve.fetches) if (fetch.inFlight) count += 1;
    return count;
  }

  /**
   * Decision 5: back to one connection for the rest of the run. Each serve
   * keeps its head chunk's bytes and continues from where that chunk stopped,
   * on one open-ended request, once the dropped ones have closed — so the
   * origin never sees the continuation beside them.
   */
  #fallBack(failure: FetchFailure): void {
    if (this.#mode !== "parallel") return;
    this.#mode = "fallen-back";
    this.#meter.reset();
    const remembered = failure.refusal !== null;
    if (remembered)
      this.#refusal = { kind: failure.refusal as RefusalKind, detail: failure.detail };
    this.#options.logger.warn("the origin refused parallel ranges; back to one connection", {
      jobId: this.#options.jobId,
      url: redactUrl(this.#options.url),
      kind: failure.refusal ?? "failure",
      detail: failure.detail,
      remembered,
    });
    if (failure.refusal !== null) this.#options.onRefused(this.#host, failure.refusal);

    for (const serve of this.#serves) {
      if (serve.finished) continue;
      const head = serve.fetches[0];
      const resumeAt = head === undefined ? serve.position : head.start + head.received;
      const dropped = serve.fetches.splice(head === undefined ? 0 : 1);
      for (const fetch of dropped) {
        this.#held -= fetch.queued;
        fetch.abort();
      }
      const closing = dropped.map((fetch) => fetch.closed);
      if (head !== undefined) {
        // Its bytes so far are good; the rest comes from the continuation.
        if (!head.done) closing.push(head.closed);
        head.abort();
        head.failure = null;
        head.done = true;
        head.end = resumeAt;
      }
      if (serve.end === null || resumeAt >= serve.end) {
        this.#pump(serve);
        continue;
      }
      const rest = new Fetch(resumeAt, serve.end);
      serve.fetches.push(rest);
      void (async () => {
        await Promise.all(closing);
        if (this.#closed || serve.finished) return;
        this.#begin(serve, rest, `bytes=${resumeAt}-`);
      })();
      this.#pump(serve);
    }
  }

  #fatal(error: AppError): void {
    this.#options.onFatal(error);
    this.close();
  }

  /** Releases everything a serve holds. */
  #drop(serve: Serve): void {
    for (const fetch of serve.fetches) {
      this.#held -= fetch.queued;
      fetch.queue.length = 0;
      fetch.queued = 0;
      fetch.abort();
    }
    serve.fetches.length = 0;
    if (!serve.finished) {
      serve.finished = true;
      serve.response.destroy();
    }
  }
}

function reset(detail: string): FetchFailure {
  return { refusal: "reset", detail, status: 502, statusMessage: "Connection reset by peer" };
}

/** What a request that never got a response failed with, in ffmpeg's words where it has some. */
function failureOf(error: unknown): FetchFailure {
  if (error instanceof TunnelRefused) {
    // The guarded proxy's verdict, verbatim: a certificate refusal must still
    // read as one (dl-27), and a refusal of the address as the proxy put it.
    return {
      refusal: REFUSAL_STATUSES.has(error.status) ? "status" : null,
      detail: `tunnel ${error.status}`,
      status: error.status >= 400 && error.status < 600 ? error.status : 502,
      statusMessage: error.statusMessage,
    };
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "failed";
  if (RESET_CODES.has(code)) return reset(code);
  if (CERTIFICATE_CODE.test(code)) {
    return {
      refusal: null,
      detail: code,
      status: 502,
      statusMessage: `TLS certificate verification failed (${code})`,
    };
  }
  return { refusal: null, detail: code, status: 502, statusMessage: code };
}
