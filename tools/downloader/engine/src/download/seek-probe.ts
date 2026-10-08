/**
 * Whether ffmpeg will be able to reach a progressive file's index (dl-102).
 *
 * `stream.ts` hands a progressive source to ffmpeg as a URL so that ffmpeg can
 * seek to a `moov` at the end of the file, and it seeks with `Range`. An origin
 * that ignores `Range` and answers every request with `200` and the whole body
 * takes that away: measured on ffmpeg 6.1.1, a tail-`moov` MP4 of about 1 MB
 * from such an origin finished as a clean response of 37,615 bytes of which
 * none of the 100 frames decoded, and `done` resolved. Nothing ffmpeg writes
 * says so reliably — the reconnect that follows its `Stream ends prematurely`
 * clears the one signal the stream reads — so the question is asked before
 * ffmpeg starts, of the origin itself.
 *
 * ## The probe
 *
 * **One request**, `Range: bytes=1-1`, with the replayed headers:
 *
 *  - a `206` means the origin honours `Range`, and ffmpeg can seek wherever the
 *    index is. The one byte is all that is read.
 *  - a `200` is the whole file from byte 0, so its first bytes are the file's
 *    first bytes and **the top-level boxes are walked off that same body**
 *    until `moov` or `mdat` appears. `moov` first is a fast-start file that
 *    ffmpeg reads front to back without seeking, and it works today from such
 *    an origin, so it must not be refused; `mdat` first is an index at the end,
 *    which is the refusal. The walk does not test what follows `ftyp`: ffmpeg
 *    6.1.1 writes `ftyp,free,mdat,moov`, a fast-start copy is
 *    `ftyp,moov,free,mdat`, and QuickTime's `wide,mdat,moov` has no `ftyp`.
 *  - anything else — another status, a body that is not boxes, a box chain
 *    that runs past `WALK_LIMIT_BYTES` before deciding, a refused tunnel, a
 *    certificate failure, a timeout — is **unknown**, and unknown lets ffmpeg
 *    run. That is deliberate, and the owner's choice of 2026-10-08: those
 *    failures are ffmpeg's to report and classify (a certificate failure must
 *    still arrive as `TLS_VERIFICATION_FAILED`, a `500` must still buy a
 *    mirror), and a probe that refused on them would turn every flaky origin
 *    into a final refusal. Two costs, both measured by dl-102's gate. An
 *    origin that fails the probe and then serves ffmpeg the whole body is not
 *    checked, and still yields a file of which no frame decodes (dl-103 is the
 *    second line of defence). And it is **not quite** ffmpeg running as it did
 *    before: the probe is now the first request the origin sees, so a fault
 *    that hits only the first request (one `429` or `500`, one refused
 *    `CONNECT`) is spent on the probe. From an origin that honours `Range`
 *    that heals; from one that ignores it, it turns a `DOWNLOAD_FAILED` into
 *    that undecodable file.
 *
 * A start of 1, not 0: the seek ffmpeg needs is to a later offset, and a `206`
 * for a range at zero is the weaker evidence (dl-64's size probe accepts a
 * `200` for a range at zero for the same reason). `bytes=1-1` still gets the
 * file from byte 0 when it is ignored.
 *
 * ## It measures the origin, not ffmpeg's input
 *
 * The URL is the candidate the resolver produced — the origin's — and never
 * whatever ffmpeg is later handed as `-i`. If something is ever put between
 * ffmpeg and the origin, this still has to ask the origin.
 *
 * ## Egress
 *
 * The engine enforces no SSRF policy of its own; the API's guarded egress
 * proxy is the check (see `createEngine`'s notes). So this request goes
 * through the proxy the runner gives ffmpeg — `EngineConfig.proxyUrl`, or
 * else the `http_proxy` ffmpeg would inherit — as an absolute-form request
 * for `http:` and a `CONNECT` tunnel for `https:`, verifying the
 * certificate with the same `tlsVerify` and `tlsCaFile` ffmpeg gets. Each
 * redirect hop is a fresh request on the same route, so the proxy vets each
 * one; "every redirect hop goes through the proxy, not only the first" in
 * `seek-probe.test.ts` fails if one does not. **It never connects around a
 * configured proxy**, and that makes its reach a subset of ffmpeg's rather
 * than the same: ffmpeg goes direct to a host an inherited `no_proxy`
 * names, where the probe stays on the proxy, and ffmpeg ignores a proxy that
 * is not `http://` and goes direct, where the probe sends nothing and the
 * verdict is unknown.
 */

import { readFile } from "node:fs/promises";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import type { RequestContext } from "@downloader/contract";
import { buildFetchHeaders } from "../ffmpeg/headers.ts";

/** Where a file's index sits, as far as its top-level boxes say. */
export type IndexPlacement = "front" | "end" | "unknown";

export type SeekVerdict =
  /** `206`: ffmpeg can seek. */
  | { kind: "seekable" }
  /** `200`, and the walk reached `moov` before `mdat`: nothing needs a seek. */
  | { kind: "index-first" }
  /** `200`, and the walk reached `mdat` first: ffmpeg would need to seek and cannot. */
  | { kind: "unseekable" }
  /** Anything else. ffmpeg runs as it always has. */
  | { kind: "unknown"; reason: string };

/**
 * How far into a `200` body the walk may read before it gives up. Real files
 * reach `moov` or `mdat` within a few dozen bytes (`ftyp`, perhaps `free`,
 * `wide` or a small `uuid`); a megabyte of boxes before either is not a shape
 * worth reading further for.
 */
export const WALK_LIMIT_BYTES = 1024 * 1024;

const PROBE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
/** A box type is four printable ASCII characters; anything else is not ISO BMFF. */
const BOX_TYPE = /^[\x20-\x7e]{4}$/u;

/**
 * Walks top-level ISO BMFF boxes as bytes arrive from offset 0, skipping each
 * box's body without keeping it, until `moov` or `mdat` decides.
 */
export class TopLevelBoxWalk {
  readonly #limit: number;
  /** Absolute offset of the next box header. */
  #next = 0;
  /** Bytes received so far. */
  #received = 0;
  /** Bytes from `#next` on, held only until a header is complete. */
  #pending: Buffer = Buffer.alloc(0);
  #verdict: IndexPlacement | null = null;

  constructor(limit: number = WALK_LIMIT_BYTES) {
    this.#limit = limit;
  }

  get verdict(): IndexPlacement | null {
    return this.#verdict;
  }

  /** Feeds the next bytes; returns the verdict once there is one. */
  push(chunk: Buffer): IndexPlacement | null {
    if (this.#verdict !== null) return this.#verdict;
    const chunkStart = this.#received;
    this.#received += chunk.length;
    if (this.#received <= this.#next) return null;
    const from = Math.max(0, this.#next - chunkStart);
    this.#pending = Buffer.concat([this.#pending, chunk.subarray(from)]);

    for (;;) {
      if (this.#pending.length < 8) return null;
      const type = this.#pending.toString("latin1", 4, 8);
      if (!BOX_TYPE.test(type)) return this.#decide("unknown");
      if (type === "moov") return this.#decide("front");
      if (type === "mdat") return this.#decide("end");

      let size = this.#pending.readUInt32BE(0);
      let headerSize = 8;
      if (size === 1) {
        if (this.#pending.length < 16) return null;
        const large = this.#pending.readBigUInt64BE(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return this.#decide("unknown");
        size = Number(large);
        headerSize = 16;
      } else if (size === 0) {
        // Runs to the end of the file, and it is neither of the two.
        return this.#decide("unknown");
      }
      if (size < headerSize) return this.#decide("unknown");

      this.#next += size;
      if (this.#next > this.#limit) return this.#decide("unknown");
      this.#pending = size <= this.#pending.length ? this.#pending.subarray(size) : Buffer.alloc(0);
    }
  }

  /** The body ended before a verdict. */
  end(): IndexPlacement {
    return this.#verdict ?? this.#decide("unknown");
  }

  #decide(verdict: IndexPlacement): IndexPlacement {
    this.#verdict = verdict;
    this.#pending = Buffer.alloc(0);
    return verdict;
  }
}

/** Top-level placement of the index in a whole buffer. For tests and callers holding bytes. */
export function indexPlacement(bytes: Buffer, limit: number = WALK_LIMIT_BYTES): IndexPlacement {
  const walk = new TopLevelBoxWalk(limit);
  return walk.push(bytes) ?? walk.end();
}

export interface SeekProbeOptions {
  requestContext: RequestContext;
  /** `EngineConfig.proxyUrl`: the proxy ffmpeg is given. */
  proxyUrl: string | undefined;
  tlsVerify: boolean;
  tlsCaFile: string | undefined;
  /** The caller's cancel. When it fires the probe rejects; nothing else makes it reject. */
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /** What ffmpeg inherits when no proxy is configured. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | undefined;
}

/** Thrown only when the caller's own signal fired. */
export class SeekProbeCanceled extends Error {
  constructor() {
    super("seek probe canceled");
    this.name = "SeekProbeCanceled";
  }
}

/**
 * The proxy ffmpeg would use, by the runner's rule: `proxyUrl` when set, and
 * otherwise whatever `http_proxy` ffmpeg inherits. ffmpeg's http and tls
 * protocols both read `http_proxy`, and only an `http://` one.
 */
function egressProxy(
  options: SeekProbeOptions,
): { kind: "direct" } | { kind: "proxy"; url: URL } | { kind: "unusable" } {
  const env = options.env ?? process.env;
  const raw =
    options.proxyUrl !== undefined && options.proxyUrl.length > 0
      ? options.proxyUrl
      : env["http_proxy"];
  if (raw === undefined || raw.length === 0) return { kind: "direct" };
  try {
    const url = new URL(raw);
    return url.protocol === "http:" ? { kind: "proxy", url } : { kind: "unusable" };
  } catch {
    return { kind: "unusable" };
  }
}

function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function awaitResponse(request: http.ClientRequest): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    request.once("response", resolve);
    // `on`, not `once`: an error after the response is ours, from destroying
    // it, and a second one with no listener would take the process down.
    request.on("error", reject);
    request.end();
  });
}

/** A `CONNECT` tunnel through `proxy` to `target`'s host and port. */
function openTunnel(proxy: URL, target: URL, signal: AbortSignal): Promise<net.Socket> {
  const authority = `${target.hostname}:${target.port === "" ? "443" : target.port}`;
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: bareHost(proxy.hostname),
      port: proxy.port === "" ? 80 : Number(proxy.port),
      method: "CONNECT",
      path: authority,
      headers: { host: authority },
      signal,
    });
    request.once("connect", (response, socket, head) => {
      socket.on("error", () => undefined);
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`the proxy refused the tunnel with ${response.statusCode ?? 0}`));
        return;
      }
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    });
    request.on("error", reject);
    request.end();
  });
}

async function get(
  target: URL,
  headers: Record<string, string>,
  route: { kind: "direct" } | { kind: "proxy"; url: URL },
  tlsSettings: { rejectUnauthorized: boolean; ca: Buffer | undefined },
  signal: AbortSignal,
): Promise<IncomingMessage> {
  if (target.protocol === "http:") {
    if (route.kind === "direct") {
      // Handed no CA at all: plain HTTP. The flow the scanner reports here was not traced.
      // js/file-access-to-http: the only file this module reads is `tlsCaFile`,
      // read in `probeSeek` and handed to `get` as `tlsSettings.ca`. It is the
      // CA bundle the origin's certificate is verified against, the same file
      // ffmpeg gets as `-ca_file`: it configures trust and is never sent. The
      // request's URL, headers and (empty) body come from the candidate URL, a
      // redirect's `Location` and the replayed `RequestContext`. Excused under
      // docs/adr/005, in engine/src/download/seek-probe.ts, 2026-10-08. If the
      // CA's bytes ever reach a request's URL or headers, "the CA file configures
      // trust and is never sent" fails, in engine/test/seek-probe.test.ts for
      // `http:` and in api/test/range-ignoring-origin.test.ts for `https:`,
      // direct and tunnelled. The boundary of that proof: the fixtures record
      // method, URL and headers, not a request body, and the api test's proxy
      // does not see the `CONNECT` request's headers. No code path puts the CA
      // in either; the tests do not observe them.
      // codeql[js/file-access-to-http]
      return awaitResponse(http.request(target, { headers, agent: false, signal }));
    }
    // Absolute form: the proxy names, resolves and vets the host itself.
    return awaitResponse(
      http.request({
        host: bareHost(route.url.hostname),
        port: route.url.port === "" ? 80 : Number(route.url.port),
        path: target.href,
        headers: { ...headers, host: target.host },
        agent: false,
        signal,
      }),
    );
  }

  const host = bareHost(target.hostname);
  const secure: tls.ConnectionOptions = {
    rejectUnauthorized: tlsSettings.rejectUnauthorized,
    ...(tlsSettings.ca === undefined ? {} : { ca: tlsSettings.ca }),
    // SNI takes a name, never an address.
    ...(net.isIP(host) === 0 ? { servername: host } : {}),
  };
  if (route.kind === "direct") {
    // js/file-access-to-http, excused under docs/adr/005, in
    // engine/src/download/seek-probe.ts, 2026-10-08: `secure.ca` is
    // the `tlsCaFile` trust anchor and is never sent; the reasoning is above the
    // plain-HTTP request in this function. "the CA file configures trust and is
    // never sent" in api/test/range-ignoring-origin.test.ts fails if it reaches
    // the URL or headers; a request body is not observed (see above).
    // codeql[js/file-access-to-http]
    return awaitResponse(https.request(target, { headers, agent: false, signal, ...secure }));
  }
  const socket = await openTunnel(route.url, target, signal);
  const response = await awaitResponse(
    // js/file-access-to-http, excused under docs/adr/005, in
    // engine/src/download/seek-probe.ts, 2026-10-08: `secure.ca`, inside the tunnel, is
    // the `tlsCaFile` trust anchor and is never sent; the reasoning is above the
    // plain-HTTP request in this function. "the CA file configures trust and is
    // never sent" in api/test/range-ignoring-origin.test.ts fails if it reaches
    // the URL or headers; a request body and the `CONNECT` request's headers
    // are not observed (see above).
    // codeql[js/file-access-to-http]
    https.request(target, {
      headers,
      signal,
      // `host` is what the certificate is checked against. On a wrapped socket
      // Node otherwise checks it against `localhost`, which fails every address
      // (measured: ERR_TLS_CERT_ALTNAME_INVALID through the terminating proxy).
      createConnection: () => tls.connect({ ...secure, host, socket }),
    }),
  ).catch((error: unknown) => {
    socket.destroy();
    throw error;
  });
  // The TLS layer does not own the tunnel it was handed; close it with the response.
  response.once("close", () => socket.destroy());
  return response;
}

/** Reads a `200` body into the walk until it decides, then drops the connection. */
function walkBody(response: IncomingMessage): Promise<IndexPlacement> {
  return new Promise((resolve, reject) => {
    const walk = new TopLevelBoxWalk();
    const finish = (verdict: IndexPlacement): void => {
      response.off("data", onData);
      response.destroy();
      resolve(verdict);
    };
    function onData(chunk: Buffer): void {
      const verdict = walk.push(chunk);
      if (verdict !== null) finish(verdict);
    }
    response.on("data", onData);
    response.once("end", () => finish(walk.end()));
    response.on("error", reject);
    // Cut before it ended, by the timeout or the origin. A no-op once settled.
    response.once("close", () => reject(new Error("the body was cut short")));
  });
}

/**
 * Asks `url`'s origin whether ffmpeg will be able to reach the file's index.
 * Resolves with a verdict for every outcome except the caller's cancel, which
 * rejects with `SeekProbeCanceled`.
 */
export async function probeSeek(url: string, options: SeekProbeOptions): Promise<SeekVerdict> {
  const route = egressProxy(options);
  if (route.kind === "unusable") return { kind: "unknown", reason: "proxy-not-http" };

  const timeout = AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS);
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
  const headers = {
    ...buildFetchHeaders(options.requestContext),
    range: "bytes=1-1",
    // The walk reads the body's own bytes; a compressed one would be noise.
    "accept-encoding": "identity",
  };

  try {
    const ca =
      options.tlsCaFile === undefined || options.tlsCaFile.length === 0
        ? undefined
        : await readFile(options.tlsCaFile);
    const tlsSettings = { rejectUnauthorized: options.tlsVerify, ca };

    let target = new URL(url);
    for (let hop = 0; ; hop += 1) {
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return { kind: "unknown", reason: "scheme" };
      }
      // oxlint-disable-next-line no-await-in-loop
      const response = await get(target, headers, route, tlsSettings, signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECTS.has(status) && location !== undefined && hop < MAX_REDIRECTS) {
        response.destroy();
        target = new URL(location, target);
        continue;
      }
      if (status === 206) {
        response.destroy();
        return { kind: "seekable" };
      }
      if (status !== 200) {
        response.destroy();
        return { kind: "unknown", reason: `status ${status}` };
      }
      // oxlint-disable-next-line no-await-in-loop
      const placement = await walkBody(response);
      if (placement === "front") return { kind: "index-first" };
      if (placement === "end") return { kind: "unseekable" };
      return { kind: "unknown", reason: "not-boxes" };
    }
  } catch (error: unknown) {
    if (options.signal?.aborted === true) throw new SeekProbeCanceled();
    // A code, never a message: a message can carry the URL, and this is logged.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const reason = timeout.aborted ? "timeout" : typeof code === "string" ? code : "failed";
    return { kind: "unknown", reason };
  }
}
