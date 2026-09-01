/**
 * A loopback HTTP proxy that puts every subprocess fetch behind the SSRF guard.
 *
 * ## Why this exists
 *
 * `guarded-fetch.ts` checks every redirect hop and `dispatcher.ts` pins each
 * connection to a vetted address — but both live inside undici, and three of
 * this service's fetchers are not undici at all: ffmpeg goes through
 * libavformat, and the browser and yt-dlp tiers are separate processes with
 * their own network stacks. Three things follow from that, and they are the
 * three holes dl-11 closed for ffmpeg and dl-12 closed for the other two:
 *
 *  1. **The URLs nobody vetted, because nobody had seen them.** ffmpeg reads a
 *     playlist and then fetches what it points at — `#EXTINF` segments, the
 *     `#EXT-X-MAP` init segment, the `#EXT-X-KEY` key, DASH template expansions.
 *     Chromium does the same thing on a far wider scale: every script, image,
 *     `fetch()` and XHR a hostile page names, with the timing and the error
 *     readable back in the page's own JavaScript. None of those URLs exist when
 *     `assertAllAllowed` sweeps the `ProbeResult`, so that sweep — load-bearing
 *     as it is — structurally cannot cover them.
 *  2. **Redirects.** A vetted manifest URL answering `302` to an internal
 *     address is followed without anyone checking the second hop.
 *  3. **Re-resolution.** ffmpeg and Chromium resolve names themselves, so dl-8's
 *     pinning never applies and the pre-flight answer is not binding.
 *
 * Parsing manifests ourselves and pre-vetting each URI is the obvious answer and
 * the wrong one — it gives up why `download/manifest.ts` exists (analysis §6)
 * and still misses key URIs and nested playlists. Nor is there any version of it
 * for a page's subresources. The check belongs at the socket, and a proxy is
 * where all three of these will accept one.
 *
 * ## What it does
 *
 * `CONNECT host:port` for HTTPS, absolute-form requests for plain HTTP. Each is
 * vetted with the same `SsrfGuard` the rest of the service uses and connected
 * through the same pinning `lookup` as `dispatcher.ts`.
 *
 * **Tunnelled by default, and terminating for ffmpeg only.** Without
 * `interceptTls` a `CONNECT` is piped byte-for-byte, certificates stay end to end
 * and no client needs a trust-store change — which is what dl-14 chose and what
 * Chromium and yt-dlp still get, because both verify their own connections
 * without help. With it the proxy verifies the origin itself and re-encrypts to
 * the client under a locally issued leaf, because **ffmpeg cannot verify its own
 * segment connections and no argument makes it** (dl-21 measured sixteen; the
 * propagation list is a compile-time array). See `tls-interception.ts` for the
 * mechanism and what it costs; dl-27 for the decision.
 *
 * **In proxy mode the client resolves nothing.** It connects to us and names a
 * host; we do the resolving. That is what closes hole 3 — there is no second
 * resolution left to disagree with the first, exactly as in dl-8.
 *
 * ## What it is not
 *
 * Not a general-purpose proxy, and it must not become one. It binds loopback on
 * an ephemeral port, it takes absolute-form requests only, and it refuses any
 * method outside the set a browser or a media client actually sends. There is no
 * authentication because there is nothing usable to authenticate with: ffmpeg
 * 6.1 sends no `Proxy-Authorization`, with or without credentials in the proxy
 * URL. Loopback binding is the containment.
 *
 * ## What it still cannot see
 *
 * WebRTC opens UDP straight out of Chromium, which no HTTP proxy observes, and
 * a `ws://` upgrade on a plain-HTTP page is refused rather than tunnelled
 * (`wss://` rides inside a `CONNECT` and is unaffected). QUIC is not a bypass:
 * Chromium speaks no UDP through an HTTP proxy and falls back to TCP.
 *
 * That also means a refusal cannot be attributed to a job — one proxy serves
 * every download and nothing in the request identifies the caller. A blocked
 * fetch is logged here and surfaces to the client as the `DOWNLOAD_FAILED` that
 * any ffmpeg failure does, or as whatever a page makes of a subresource it could
 * not load; the refusal reason lives in the log, not in the error code. See the
 * tickets' logs.
 */

import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { createPinningLookup, systemResolve } from "./dispatcher.ts";
import type { AddressResolver } from "./dispatcher.ts";
import type { AppLogger } from "./logger.ts";
import type { SsrfGuard } from "./ssrf.ts";
import {
  certificateRejectionCode,
  isCertificateRejection,
  OriginCertificateError,
} from "./tls-interception.ts";
import type { TlsInterception } from "./tls-interception.ts";

export interface EgressProxyOptions {
  guard: SsrfGuard;
  logger: AppLogger;
  /**
   * The operator's egress proxy. When set this proxy **chains** through it
   * rather than connecting itself — see `mode` below.
   */
  upstreamProxyUrl?: string | undefined;
  /** Injected in tests, for the same reason `dispatcher.ts` injects one. */
  resolve?: AddressResolver | undefined;
  /**
   * Terminate every `CONNECT` instead of tunnelling it, verifying the origin
   * here and re-encrypting to the client under a leaf this issues.
   *
   * Set for ffmpeg's proxy and for nothing else. See `tls-interception.ts`.
   */
  interceptTls?: TlsInterception | undefined;
}

export interface EgressProxy {
  /**
   * What to hand every subprocess: ffmpeg's `http_proxy`, Chromium's
   * `--proxy-server`, yt-dlp's `--proxy`. Always `http://127.0.0.1:<port>`, and
   * never anything a client should see — see `withoutEgressProxy`.
   */
  url: string;
  /**
   * `pinned` — this process resolves the target and binds the address into the
   * socket. `chained` — an upstream proxy resolves it and its policy is what
   * bounds egress, so only the pre-flight check applies. Worth logging at boot
   * for exactly the reason `EgressDispatcher.mode` is.
   */
  mode: "pinned" | "chained";
  /**
   * `tunnel` — a `CONNECT` is piped and the origin's own certificate reaches the
   * client. `terminate` — this proxy verified the origin and the client is
   * talking to a leaf issued here. Worth logging at boot for the same reason
   * `mode` is: it is the difference between "ffmpeg checked the certificate" and
   * "we did", and only one of the two covers the segments.
   */
  tls: "tunnel" | "terminate";
  close(): Promise<void>;
}

/** Hop-by-hop headers, which a proxy consumes rather than forwards (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * ffmpeg only ever reads, and while this proxy served ffmpeg alone the set was
 * `GET`/`HEAD`. A page is not so tidy: its `fetch()` and XHR reach a proxy as
 * absolute-form `POST` (measured against Chromium, not assumed), and refusing
 * those would break plain-HTTP pages in a way no log explains — the browser
 * tier's whole job is to let a page's own player run.
 *
 * What keeps this from being an open proxy is the guard on every target, the
 * absolute-form-only rule and the loopback binding, not the verb list. The list
 * is here to keep the surface recognisable rather than to be the boundary.
 */
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * A tunnel that stalls forever is a connection leaked per job. ffmpeg has its
 * own `-rw_timeout`, but it cannot help with a socket that connected and then
 * went silent before any byte was exchanged.
 */
const TUNNEL_IDLE_MS = 120_000;

function refuse(socket: net.Socket, status: number, reason: string): void {
  // The reason phrase reaches ffmpeg's stderr, and the stderr tail reaches the
  // AppError details — which is the only path a refusal has to the client,
  // given a job cannot be identified here.
  if (socket.writable) socket.end(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  else socket.destroy();
}

/**
 * `example.com:443` or `[::1]:443` — the only form a CONNECT target takes.
 *
 * Parsed by hand rather than through `URL`, which normalises a default port
 * away: `new URL("https://host:443")` reports an empty `port`, so a scheme-based
 * parse cannot tell a well-formed target from one that named no port at all.
 */
const AUTHORITY = /^(\[[0-9a-f:.]+\]|[^:/?#[\]@\s]+):(\d{1,5})$/iu;

function parseAuthority(target: string): { host: string; port: number } | null {
  const match = AUTHORITY.exec(target);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  // Brackets stay out of the host handed to `net.connect`; the guard sees the
  // raw target, where they are part of the URL syntax it expects.
  const bracketed = match[1];
  const host = bracketed.startsWith("[") ? bracketed.slice(1, -1) : bracketed;
  return { host, port };
}

function forwardableHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Pipes two sockets and makes sure that when either end goes, both do.
 *
 * `pipe` alone leaves the other half open on an error, and on cancel that is a
 * socket outliving the ffmpeg process `killProcessTree` just reaped.
 */
function joinSockets(a: net.Socket, b: net.Socket): void {
  const shutdown = (): void => {
    a.destroy();
    b.destroy();
  };
  for (const socket of [a, b]) {
    socket.setTimeout(TUNNEL_IDLE_MS, shutdown);
    socket.once("error", shutdown);
    socket.once("close", shutdown);
  }
  a.pipe(b);
  b.pipe(a);
}

export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const { guard, logger } = options;
  const upstream =
    options.upstreamProxyUrl === undefined || options.upstreamProxyUrl === ""
      ? null
      : new URL(options.upstreamProxyUrl);

  const intercept = options.interceptTls ?? null;

  const lookup = createPinningLookup(guard, options.resolve ?? systemResolve);
  // In chained mode the upstream resolves the target, so there is no local
  // resolution to pin — the same trade dl-8 documents for `PROXY_URL`.
  const connectOptions = upstream === null ? { lookup } : {};

  /**
   * A target **this proxy's policy** turned down. `code` is the guard's own —
   * `BLOCKED_TARGET` for an address we refuse to reach, `INVALID_URL` for one
   * that never parsed — and it names the rule that fired.
   */
  function refused(host: string, error: unknown): void {
    const appError = AppError.from(error);
    logger.warn("refused a subprocess fetch", {
      host,
      code: appError.code,
      details: appError.details,
    });
  }

  /**
   * A target the policy **allowed** and the network could not deliver.
   *
   * Kept apart from `refused` because collapsing the two is actively
   * misleading: a socket error is not an `AppError`, so `AppError.from` stamps
   * it `INTERNAL`, and a line reading `refused … INTERNAL` sends the reader
   * into `ssrf.ts` looking for the rule that fired when the truth is that the
   * packets went nowhere. The errno is the fact worth logging — `ETIMEDOUT` is
   * a firewall dropping traffic, `ECONNREFUSED` a host that answered no,
   * `ENOTFOUND` a name that does not resolve — and none of it survives the
   * `AppError` wrapper. dl-26.
   */
  function unreachable(host: string, error: unknown): void {
    const errno = error as NodeJS.ErrnoException | null;
    logger.warn("a subprocess fetch could not connect", {
      host,
      errno: errno?.code ?? "UNKNOWN",
      syscall: errno?.syscall,
      reason: errno?.message,
    });
  }

  /**
   * The origin's certificate did not verify, in `terminate` mode.
   *
   * The third thing that has to be told apart below, and the one whose evidence
   * is thinnest: dl-21 measured that **no certificate semantics survive to
   * ffmpeg** from a refused segment connection — a dropped tunnel is exit 183
   * `Invalid data found`, a 502 is exit 8 `Server returned 5XX` — so this line
   * and the reason phrase in `refuse` are the whole of what anyone gets. Filing
   * it as `unreachable` would report an intercepted CDN as a flaky network.
   */
  function certificateRejected(host: string, error: unknown): void {
    logger.warn("refused a subprocess fetch: the origin's certificate did not verify", {
      host,
      code: certificateRejectionCode(error),
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * A socket that failed, which is **three** different events wearing one shape.
   *
   * `createPinningLookup` delivers its verdict to `callback(error)`, and node
   * surfaces that as the socket's `error` event — so a name that rebinds to a
   * blocked address between the pre-flight check and the connect arrives here
   * as a `BLOCKED_TARGET` `AppError`, indistinguishable by call site from an
   * `ETIMEDOUT`. Splitting on the type is what keeps the refusal that matters
   * most from being filed as a network hiccup (dl-26), and dl-27's terminating
   * mode adds a third outcome to the same socket: a certificate this proxy
   * refused, which is neither our policy nor a dead network.
   */
  function connectFailed(host: string, error: unknown): void {
    if (error instanceof AppError) refused(host, error);
    else if (isCertificateRejection(error)) certificateRejected(host, error);
    else unreachable(host, error);
  }

  /**
   * The operator's proxy turned it down, in chained mode. Ours is not the
   * policy that fired, and saying so is the difference between reading this
   * file and reading the upstream's configuration.
   */
  function upstreamRefused(host: string, error: unknown): void {
    const appError = AppError.from(error);
    logger.warn("the upstream proxy refused a subprocess fetch", {
      host,
      code: appError.code,
      details: appError.details,
    });
  }

  const server = http.createServer();

  // Absolute-form plain HTTP. ffmpeg sends `GET http://host:80/path HTTP/1.1`.
  server.on("request", (request, response) => {
    void (async (): Promise<void> => {
      const target = request.url ?? "";
      if (!ALLOWED_METHODS.has(request.method ?? "")) {
        response.writeHead(405).end();
        return;
      }
      if (!target.startsWith("http://")) {
        // Origin-form means someone is talking to this as if it were an origin
        // server, which it is not.
        response.writeHead(400).end();
        return;
      }

      try {
        await guard.assertAllowed(target);
      } catch (error) {
        refused(target, error);
        response.writeHead(403).end();
        return;
      }

      const forward =
        upstream === null
          ? { url: target, options: { ...connectOptions } }
          : { url: target, options: { host: upstream.hostname, port: upstreamPort(upstream) } };

      // This proxy exists to fetch a URL the user chose, so `js/request-forgery`
      // fires on the call below on every shape this code could take — the taint is
      // the feature. Two separate things bound it, and they are covered in
      // different files: disabling `guard.assertAllowed` above fails 5 tests in
      // `egress-proxy.test.ts`, while disabling the address rejection inside the
      // pinning `lookup` carried in `connectOptions` fails 2 there and 6 in
      // `dispatcher.test.ts`, which is the file that owns that lookup. Those
      // suites are the guarantee; this comment only explains it. Excused under
      // `docs/adr/005`, which carries the rule and doubles as the register.
      // Measured 2026-09-01 at 6e273cc — an earlier draft of this comment claimed
      // 5 for both halves, which repo-13's gate disproved.
      // codeql[js/request-forgery]
      const proxied = http.request(
        forward.url,
        {
          method: request.method as string,
          headers: forwardableHeaders(request.headers),
          ...forward.options,
          ...(upstream === null ? {} : { path: target }),
        },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        },
      );

      proxied.once("error", (error: unknown) => {
        connectFailed(target, error);
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      // A client that gives up must not leave the upstream request running.
      response.once("close", () => proxied.destroy());
      request.pipe(proxied);
    })();
  });

  // CONNECT: everything over HTTPS, which is everything that matters.
  server.on("connect", (request, rawSocket, head) => {
    void (async (): Promise<void> => {
      // The event is declared with a `Duplex` because an upgrade handler is not
      // obliged to be over TCP. A CONNECT always is, and the tunnel needs
      // `setTimeout` and `unshift`, which only the concrete socket has.
      const clientSocket = rawSocket as net.Socket;
      const target = request.url ?? "";
      const authority = parseAuthority(target);
      if (authority === null) {
        refuse(clientSocket, 400, "Bad CONNECT target");
        return;
      }

      const { host, port } = authority;
      try {
        await guard.assertAllowed(`https://${target}`);
      } catch (error) {
        refused(target, error);
        refuse(clientSocket, 403, "Blocked by egress policy");
        return;
      }

      const serverSocket =
        upstream === null
          ? net.connect({ host, port, ...connectOptions })
          : net.connect({ host: upstream.hostname, port: upstreamPort(upstream) });

      // One outcome per CONNECT. Without this the origin-side TLS failure below
      // is logged twice — once as the certificate refusal it is and once as the
      // `ECONNRESET` node raises on the socket underneath it — and the second
      // one writes a 502 status line into a tunnel that may already be carrying
      // bytes. It also bounds the pre-dl-27 wart where a mid-stream server
      // error re-entered this handler after `establish`.
      let settled = false;
      const fail = (error: unknown, status: number, reason: string): void => {
        if (settled) return;
        settled = true;
        connectFailed(target, error);
        refuse(clientSocket, status, reason);
        serverSocket.destroy();
      };

      serverSocket.once("error", (error: unknown) => {
        fail(error, 502, "Upstream connect failed");
      });

      const open = (): void => {
        if (settled) return;
        if (intercept === null) {
          settled = true;
          establish(clientSocket, serverSocket, head);
          return;
        }
        terminateTls({
          clientSocket,
          serverSocket,
          head,
          host,
          intercept,
          onEstablished: () => {
            settled = true;
          },
          // The reason phrase is not decoration. ffmpeg logs a proxy's status
          // line verbatim — `[httpproxy] HTTP error 502 <phrase>` — so this is
          // the one channel that carries *why* into the failing run's own
          // stderr, where `isTlsVerificationFailure` reads it and the job fails
          // as `TLS_VERIFICATION_FAILED` rather than as a dead link. Measured
          // in dl-27; it needs `-loglevel warning`, which is why `GLOBAL_ARGS`
          // now asks for one.
          onRejected: (error) =>
            fail(
              error,
              502,
              `TLS certificate verification failed (${certificateRejectionCode(error)})`,
            ),
          onFailed: (error) => {
            fail(error, 502, "Upstream connect failed");
          },
        });
      };

      serverSocket.once("connect", () => {
        if (upstream === null) {
          open();
          return;
        }
        // Chained: ask the operator's proxy for the same tunnel, and only
        // report success once it has agreed to it.
        chainConnect(serverSocket, target, upstream, (error) => {
          if (error !== null) {
            if (settled) return;
            settled = true;
            upstreamRefused(target, error);
            refuse(clientSocket, 502, "Upstream proxy refused");
            serverSocket.destroy();
            return;
          }
          open();
        });
      });
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only. This is the containment, since there is no usable
    // authentication to put in front of it.
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    mode: upstream === null ? "pinned" : "chained",
    tls: intercept === null ? "tunnel" : "terminate",
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Drops the proxy this process told the resolvers to use out of a probe's
 * `RequestContext`.
 *
 * Every resolver echoes `ResolveOptions.proxyUrl` into the context it returns,
 * which was informative while that value was the operator's proxy. Since dl-12
 * it is this proxy — an ephemeral loopback port, meaningless to anyone outside
 * this process and wrong after a restart. The field means "the proxy needed to
 * re-issue this request from somewhere else", and that is not it.
 *
 * Called on both paths a `ProbeResult` takes to a client: the probe response and
 * the `probed` job event.
 */
export function withoutEgressProxy(probe: ProbeResult): ProbeResult {
  if (probe.requestContext.proxyUrl === undefined) return probe;
  const { headers, expiresAt } = probe.requestContext;
  return {
    ...probe,
    requestContext: { headers, ...(expiresAt === undefined ? {} : { expiresAt }) },
  };
}

function upstreamPort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function establish(clientSocket: net.Socket, serverSocket: net.Socket, head: Buffer): void {
  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head.length > 0) serverSocket.write(head);
  joinSockets(clientSocket, serverSocket);
}

interface TerminateOptions {
  clientSocket: net.Socket;
  /** Connected, and either the origin or a chained proxy's open tunnel to it. */
  serverSocket: net.Socket;
  head: Buffer;
  host: string;
  intercept: TlsInterception;
  onEstablished: () => void;
  onRejected: (error: unknown) => void;
  onFailed: (error: unknown) => void;
}

/**
 * Verifies the origin here, then re-encrypts to the client under a leaf we
 * issued: the half of dl-27 that ffmpeg's argv could not reach.
 *
 * The order is the point. The origin handshake completes **before** the client
 * is told `200`, so a refused certificate is a refused `CONNECT` rather than a
 * tunnel that opens and then dies — which is what lets the reason travel as a
 * status line at all.
 */
function terminateTls(options: TerminateOptions): void {
  const { clientSocket, serverSocket, head, host, intercept } = options;
  let done = false;

  const secure = tls.connect({
    socket: serverSocket,
    // What the certificate is checked against. Node falls back to `localhost`
    // when neither this nor `servername` is given on a wrapped socket, which
    // would verify a chain and then match it against the wrong name.
    host,
    // **An IP has no SNI** — RFC 6066 forbids it, and a numeric `servername`
    // makes some origins abort the handshake. The leaf is matched on the
    // address in `subjectAltName` instead; see `tls-interception.ts`.
    ...(net.isIP(host) === 0 ? { servername: host } : {}),
    rejectUnauthorized: intercept.verifyOrigins,
    ...(intercept.originCa === undefined ? {} : { ca: [...intercept.originCa] }),
  });

  secure.once("error", (error: unknown) => {
    if (done) return;
    done = true;
    // The socket, not the error, is what says a certificate was refused — see
    // `OriginCertificateError`. Read before `destroy`, which clears nothing but
    // is not worth racing.
    const authorizationError = secure.authorizationError;
    secure.destroy();
    if (authorizationError === null || authorizationError === undefined) {
      options.onFailed(error);
      return;
    }
    options.onRejected(
      new OriginCertificateError(
        String(authorizationError),
        error instanceof Error ? error.message : String(error),
        error,
      ),
    );
  });

  secure.once("secureConnect", () => {
    if (done) return;
    done = true;
    options.onEstablished();
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    // Bytes the client sent before it was told to go ahead are the start of its
    // ClientHello, and belong to the TLS socket about to wrap this one.
    if (head.length > 0) clientSocket.unshift(head);

    const leaf = intercept.leafFor(host);
    const clientTls = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: leaf.key,
      cert: leaf.cert,
    });
    joinSockets(clientTls, secure);
  });
}

/**
 * Speaks CONNECT to the upstream proxy and waits for its status line.
 *
 * Hand-rolled because the response has to be consumed off the raw socket — the
 * bytes after the blank line belong to the tunnel, not to us.
 */
function chainConnect(
  socket: net.Socket,
  target: string,
  upstream: URL,
  done: (error: AppError | null) => void,
): void {
  const auth =
    upstream.username === ""
      ? ""
      : `Proxy-Authorization: Basic ${Buffer.from(
          `${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`,
        ).toString("base64")}\r\n`;

  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);

  let buffer = "";
  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString("latin1");
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) {
      if (buffer.length > 8192) {
        socket.removeListener("data", onData);
        done(new AppError("UNREACHABLE", "The upstream proxy sent an unusable response."));
      }
      return;
    }
    socket.removeListener("data", onData);
    const status = Number(/^HTTP\/1\.[01] (\d{3})/u.exec(buffer)?.[1] ?? 0);
    if (status !== 200) {
      done(
        new AppError("UNREACHABLE", "The upstream proxy refused the tunnel.", {
          details: { status },
        }),
      );
      return;
    }
    // Anything past the blank line is already tunnel payload; put it back.
    const leftover = Buffer.from(buffer.slice(end + 4), "latin1");
    if (leftover.length > 0) socket.unshift(leftover);
    done(null);
  };
  socket.on("data", onData);
}
