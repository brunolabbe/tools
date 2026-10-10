/**
 * The manifest re-fetch's own HTTP client (dl-97).
 *
 * `#loadManifest` used to re-fetch through `context.request`, Playwright's
 * `APIRequestContext`. That returns only once the whole body has been received
 * **and inflated**, and has no option to stop part way: a gzip body of 255 KB
 * that inflates to 256 MiB took the Node process up 772 MB, and a 1 GiB one ran
 * into the 8 s timeout holding a gigabyte. The timeout was the only bound. So the
 * body is read here instead, as a stream, inflated as a stream, and abandoned as
 * soon as the inflated length passes the caller's cap.
 *
 * Leaving `context.request` means rebuilding by hand the four things it did for
 * free, and each is a way to pass a happy-path test and be wrong:
 *
 * - **The proxy, and with it the SSRF guard.** Every hop goes through the same
 *   egress proxy the browser uses (dl-12), which vets each target before it
 *   connects, so a redirect to an internal address is refused there exactly as a
 *   page's own fetch would be. A proxy URL this client cannot speak is a refusal,
 *   never a reason to dial the origin directly.
 * - **Redirects.** Followed here, hop by hop, each one a fresh request through the
 *   proxy, up to a limit.
 * - **Cookies.** Read from the browser context's jar for each hop's own URL, so a
 *   redirect to another host is not handed the first host's session. The caller
 *   supplies the jar as two functions.
 * - **Trust.** The egress proxy can terminate TLS under a root it generates, which
 *   Chromium trusts by its SPKI pin (dl-37). Node never trusted it, so before this
 *   client every HTTPS re-fetch behind that proxy failed its handshake and fell
 *   back to the captured body. Here Node verifies every chain itself, and when
 *   the proxy terminates, the anchor it verifies against is that root's PEM, the
 *   way ffmpeg is handed `rootCaPath`. An earlier cut of dl-97 took the SPKI pin
 *   instead and checked the chain by hand behind `rejectUnauthorized: false`;
 *   that version and why it was replaced are in the ticket's Log.
 *
 * The size probe (dl-101) is the second caller. It needs a `HEAD`, and a ranged
 * `GET` whose body is never wanted, so {@link fetchHeaders} runs the same hops,
 * cookies and trust and hands back the final response's headers with its body
 * unread; its playlist read is {@link fetchManifest} again.
 */

import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";
import { AppError } from "@downloader/contract";

export interface ManifestFetchOptions {
  /** Replayed request headers. A `cookie` among them is sent on the first hop only. */
  headers: Record<string, string>;
  /** The `Cookie` header for one hop's URL, from the browser context's jar. */
  cookieFor: (url: URL) => Promise<string | undefined>;
  /** Hands a response's `Set-Cookie` values back to that jar. */
  storeCookies: (url: URL, setCookie: readonly string[]) => Promise<void>;
  /** The browser's own egress proxy. Absent, the client dials the origin itself. */
  proxyUrl?: string | undefined;
  /** The proxy's generated root, PEM, when it terminates TLS: then the only anchor. */
  proxyRootCaPem?: string | undefined;
  /** Inflated bytes past which the body is abandoned. */
  maxBodyBytes: number;
  maxRedirects: number;
  timeoutMs: number;
}

export type ManifestFetchResult =
  | { outcome: "ok"; text: string }
  /** A final response outside 2xx, the proxy's own refusal included. */
  | { outcome: "status"; status: number }
  /**
   * The inflated body passed `maxBodyBytes`, and was not read further.
   * `readBytes` is how much of it was inflated before stopping: 0 when the
   * declared length alone refused it.
   */
  | { outcome: "too-large"; limitBytes: number; readBytes: number }
  /** Something this client declines to do, named. */
  | { outcome: "refused"; reason: RefusalReason };

export type RefusalReason =
  | "unsupported-scheme"
  | "unsupported-proxy"
  | "unsupported-encoding"
  | "unusable-redirect"
  | "too-many-redirects"
  | "untrusted-certificate";

/** What Playwright sent when the re-fetch was `context.request`. */
const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  accept: "*/*",
  "accept-encoding": "gzip, deflate, br",
};

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Anything holding a socket open, so the call can close all of it when it ends. */
interface Closable {
  destroy(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** The answers any entry point can give before it has read a byte of a body. */
type Stop = Extract<ManifestFetchResult, { outcome: "status" | "refused" }>;

type Hop = { kind: "response"; response: http.IncomingMessage } | { kind: "result"; result: Stop };

/** Turns the final 2xx response into the entry point's own answer. */
type Finish<T> = (response: http.IncomingMessage, open: Set<Closable>) => Promise<T>;

/**
 * One `GET`, redirects followed, body capped. Resolves with an outcome for every
 * answer the server gave; rejects only on a transport failure or the deadline.
 */
export async function fetchManifest(
  url: string,
  options: ManifestFetchOptions,
): Promise<ManifestFetchResult> {
  return await run(url, options, "GET", async (response, open) => {
    return await readCapped(response, options.maxBodyBytes, open);
  });
}

/** What {@link fetchHeaders} is asked: the client's options, minus any body to read. */
export type HeadersFetchOptions = Omit<ManifestFetchOptions, "maxBodyBytes"> & {
  /** `HEAD` asks for no body at all; `GET` is for a ranged read whose body is never wanted. */
  method?: "GET" | "HEAD";
};

export type HeadersFetchResult =
  /** A final 2xx. `headers` are lower-cased, repeated ones joined with `, `. */
  { outcome: "headers"; status: number; headers: Record<string, string> } | Stop;

/**
 * One `HEAD` (or a `GET` whose body is thrown away), redirects followed, and the
 * final response's headers returned **without reading its body** (dl-101). A
 * server that ignores `Range` answers a one-byte probe with the whole resource;
 * the response is closed as soon as its headers are in, so what crosses the wire
 * is whatever the socket had already buffered, never the resource.
 */
export async function fetchHeaders(
  url: string,
  options: HeadersFetchOptions,
): Promise<HeadersFetchResult> {
  return await run(url, options, options.method ?? "HEAD", (response) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const status = response.statusCode ?? 0;
    response.destroy();
    return Promise.resolve<HeadersFetchResult>({ outcome: "headers", status, headers });
  });
}

async function run<T>(
  url: string,
  options: Omit<ManifestFetchOptions, "maxBodyBytes">,
  method: "GET" | "HEAD",
  finish: Finish<T>,
): Promise<Stop | T> {
  const open = new Set<Closable>();
  let timer: NodeJS.Timeout | undefined;
  // The race, not a destroy-with-error, is what ends the call on time: a wait the
  // deadline has no socket to close (the jar, a handshake that never answers)
  // must not be able to outlive it.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AppError("TIMEOUT", "The request exceeded its time budget."));
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([follow(new URL(url), options, method, finish, open), deadline]);
  } finally {
    clearTimeout(timer);
    for (const resource of open) resource.destroy();
  }
}

async function follow<T>(
  start: URL,
  options: Omit<ManifestFetchOptions, "maxBodyBytes">,
  method: "GET" | "HEAD",
  finish: Finish<T>,
  open: Set<Closable>,
): Promise<Stop | T> {
  let proxy: URL | undefined;
  if (options.proxyUrl !== undefined && options.proxyUrl !== "") {
    proxy = new URL(options.proxyUrl);
    // Not one this client speaks, so not one it can route through. Going around
    // it would skip the guard, so the answer is no re-fetch at all.
    if (proxy.protocol !== "http:") return { outcome: "refused", reason: "unsupported-proxy" };
  }

  const replayed = lowerCased(options.headers);
  const firstCookie = replayed["cookie"];
  delete replayed["cookie"];

  let current = start;
  let previous = start;
  for (let hop = 0; ; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return { outcome: "refused", reason: "unsupported-scheme" };
    }

    // Once a hop changes origin it is gone for the rest of the chain, as
    // Playwright had it: coming back does not earn the credential back.
    if (current.origin !== previous.origin) delete replayed["authorization"];
    const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...replayed };
    // The first hop sends what the browser sent, as `context.request` did; every
    // later one asks the jar about its own URL.
    const fromJar = hop === 0 && firstCookie !== undefined ? undefined : options.cookieFor(current);
    // oxlint-disable-next-line no-await-in-loop
    const cookie = fromJar === undefined ? firstCookie : await fromJar;
    if (cookie !== undefined && cookie !== "") headers["cookie"] = cookie;
    headers["host"] = current.host;
    headers["connection"] = "close";

    // oxlint-disable-next-line no-await-in-loop
    const answer = await request(current, method, headers, proxy, options, open);
    if (answer.kind === "result") return answer.result;
    const { response } = answer;

    const setCookie = response.headers["set-cookie"];
    if (setCookie !== undefined && setCookie.length > 0) {
      // oxlint-disable-next-line no-await-in-loop
      await options.storeCookies(current, setCookie);
    }

    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (REDIRECT_STATUSES.has(status) && location !== undefined) {
      response.destroy();
      if (hop >= options.maxRedirects) return { outcome: "refused", reason: "too-many-redirects" };
      previous = current;
      try {
        current = new URL(Buffer.from(location, "latin1").toString("utf8"), current);
      } catch {
        return { outcome: "refused", reason: "unusable-redirect" };
      }
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      return { outcome: "status", status };
    }
    // oxlint-disable-next-line no-await-in-loop
    return await finish(response, open);
  }
}

/** Sends one request, through the proxy when there is one. */
async function request(
  target: URL,
  method: "GET" | "HEAD",
  headers: Record<string, string>,
  proxy: URL | undefined,
  options: Omit<ManifestFetchOptions, "maxBodyBytes">,
  open: Set<Closable>,
): Promise<Hop> {
  let socket: Duplex;
  let path = `${target.pathname}${target.search}`;
  if (target.protocol === "http:") {
    if (proxy === undefined) {
      socket = track(net.connect({ host: bare(target.hostname), port: portOf(target) }), open);
    } else {
      // Absolute form, which is what the egress proxy vets for plain HTTP.
      socket = track(net.connect({ host: bare(proxy.hostname), port: portOf(proxy) }), open);
      path = target.href;
    }
  } else {
    let raw: Duplex;
    if (proxy === undefined) {
      raw = track(net.connect({ host: bare(target.hostname), port: portOf(target) }), open);
    } else {
      const tunnel = await connectTunnel(proxy, target, open);
      if (typeof tunnel === "number")
        return { kind: "result", result: { outcome: "status", status: tunnel } };
      raw = tunnel;
    }
    const secured = await startTls(raw, target, options.proxyRootCaPem, open);
    if (secured === undefined) {
      return { kind: "result", result: { outcome: "refused", reason: "untrusted-certificate" } };
    }
    socket = secured;
  }

  return await new Promise<Hop>((resolve, reject) => {
    const outgoing = http.request({
      method,
      path,
      headers,
      createConnection: () => socket,
    });
    track(outgoing, open);
    outgoing.once("response", (response) => {
      track(response, open);
      resolve({ kind: "response", response });
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

/** `CONNECT` through the proxy. A refusal comes back as its status code. */
async function connectTunnel(
  proxy: URL,
  target: URL,
  open: Set<Closable>,
): Promise<Duplex | number> {
  const authority = `${target.hostname}:${String(portOf(target))}`;
  return await new Promise<Duplex | number>((resolve, reject) => {
    const connect = http.request({
      host: bare(proxy.hostname),
      port: portOf(proxy),
      method: "CONNECT",
      path: authority,
      headers: { host: authority },
      agent: false,
    });
    track(connect, open);
    connect.once("connect", (response, socket) => {
      track(socket, open);
      response.resume();
      if (response.statusCode === 200) {
        resolve(socket);
      } else {
        socket.destroy();
        resolve(response.statusCode ?? 0);
      }
    });
    // A proxy that answers a CONNECT with an ordinary response, not a tunnel.
    connect.once("response", (response) => {
      response.destroy();
      resolve(response.statusCode ?? 0);
    });
    connect.once("error", reject);
    connect.end();
  });
}

/**
 * Wraps `raw` in TLS and lets Node verify it: chain, signature, validity and
 * host. Behind the terminating proxy the only anchor is the proxy's own root,
 * handed over as its PEM, exactly as ffmpeg is handed `rootCaPath`; otherwise
 * Node's default store, the verdict `context.request` reached. `undefined`
 * means the chain was refused.
 *
 * `host` is passed as well as `servername`, and for an IP literal it is the only
 * name: with a wrapped socket Node checks identity against `servername`, then
 * `host`, then the socket's own `_host`, then `"localhost"` (dl-97 gate 1, F3).
 */
async function startTls(
  raw: Duplex,
  target: URL,
  rootCaPem: string | undefined,
  open: Set<Closable>,
): Promise<tls.TLSSocket | undefined> {
  const host = bare(target.hostname);
  const socket = track(
    tls.connect({
      socket: raw,
      host,
      ...(net.isIP(host) === 0 ? { servername: host } : {}),
      ...(rootCaPem === undefined || rootCaPem === "" ? {} : { ca: [rootCaPem] }),
    }),
    open,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", () => resolve());
      socket.once("error", reject);
    });
  } catch (error) {
    if (!isCertificateRefusal(error)) throw error;
    socket.destroy();
    return undefined;
  }
  return socket;
}

/** OpenSSL's verify codes and Node's own name check: a chain that arrived and was refused. */
function isCertificateRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  return code.startsWith("ERR_TLS_CERT_") || CERTIFICATE_CODES.has(code);
}

const CERTIFICATE_CODES: ReadonlySet<string> = new Set([
  "CERT_CHAIN_TOO_LONG",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "PATH_LENGTH_EXCEEDED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/**
 * Reads the body through its decoder and stops at `limit` inflated bytes. The
 * decoder runs a chunk at a time, so what is held is the cap plus one chunk,
 * whatever the body would have inflated to.
 */
async function readCapped(
  response: http.IncomingMessage,
  limit: number,
  open: Set<Closable>,
): Promise<ManifestFetchResult> {
  const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  let decoder: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | undefined;
  if (encoding === "gzip" || encoding === "x-gzip") {
    decoder = zlib.createGunzip(LENIENT_ZLIB);
  } else if (encoding === "deflate") {
    decoder = zlib.createInflate(LENIENT_ZLIB);
  } else if (encoding === "br") {
    decoder = zlib.createBrotliDecompress(LENIENT_BROTLI);
  } else if (encoding !== "identity" && encoding !== "") {
    response.destroy();
    return { outcome: "refused", reason: "unsupported-encoding" };
  }
  if (decoder === undefined) {
    const declared = Number(response.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      response.destroy();
      return { outcome: "too-large", limitBytes: limit, readBytes: 0 };
    }
  } else {
    track(decoder, open);
  }

  return await new Promise<ManifestFetchResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const body = decoder === undefined ? response : response.pipe(decoder);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    response.once("error", fail);
    decoder?.once("error", fail);
    body.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        settled = true;
        // Destroying the decoder stops it between chunks; nothing past this one
        // is inflated.
        decoder?.destroy();
        response.destroy();
        resolve({ outcome: "too-large", limitBytes: limit, readBytes: total });
        return;
      }
      chunks.push(chunk);
    });
    body.once("end", () => {
      if (settled) return;
      settled = true;
      resolve({ outcome: "ok", text: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** Tolerates a body cut short, as Playwright's decoder and a browser both do. */
const LENIENT_ZLIB: zlib.ZlibOptions = {
  flush: zlib.constants.Z_SYNC_FLUSH,
  finishFlush: zlib.constants.Z_SYNC_FLUSH,
};
const LENIENT_BROTLI: zlib.BrotliOptions = {
  flush: zlib.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
};

/**
 * Registers a resource for closing, and gives it an `error` listener of last
 * resort: a raw socket under a TLS wrap, or a stream whose stage has already
 * resolved, can still fail, and an `error` nobody listens for takes the process
 * down. The stage that is waiting on a resource attaches its own listener too.
 */
function track<T extends Closable>(resource: T, open: Set<Closable>): T {
  resource.on("error", () => {});
  open.add(resource);
  return resource;
}

function lowerCased(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = value;
  return result;
}

/** `URL` keeps the brackets on an IPv6 literal; sockets want them gone. */
function bare(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function portOf(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}
