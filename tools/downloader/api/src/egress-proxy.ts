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
 * **No TLS interception.** A `CONNECT` is tunnelled byte-for-byte, so
 * certificates stay end-to-end and no client needs a trust-store change. Not
 * seeing the request path costs nothing: the guard is host- and address-based.
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
import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { createPinningLookup, systemResolve } from "./dispatcher.ts";
import type { AddressResolver } from "./dispatcher.ts";
import type { AppLogger } from "./logger.ts";
import type { SsrfGuard } from "./ssrf.ts";

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

  const lookup = createPinningLookup(guard, options.resolve ?? systemResolve);
  // In chained mode the upstream resolves the target, so there is no local
  // resolution to pin — the same trade dl-8 documents for `PROXY_URL`.
  const connectOptions = upstream === null ? { lookup } : {};

  function denied(host: string, error: unknown): void {
    const appError = AppError.from(error);
    logger.warn("refused an ffmpeg fetch", {
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
        denied(target, error);
        response.writeHead(403).end();
        return;
      }

      const forward =
        upstream === null
          ? { url: target, options: { ...connectOptions } }
          : { url: target, options: { host: upstream.hostname, port: upstreamPort(upstream) } };

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
        denied(target, error);
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
        denied(target, error);
        refuse(clientSocket, 403, "Blocked by egress policy");
        return;
      }

      const serverSocket =
        upstream === null
          ? net.connect({ host, port, ...connectOptions })
          : net.connect({ host: upstream.hostname, port: upstreamPort(upstream) });

      serverSocket.once("error", (error: unknown) => {
        denied(target, error);
        refuse(clientSocket, 502, "Upstream connect failed");
      });

      serverSocket.once("connect", () => {
        if (upstream === null) {
          establish(clientSocket, serverSocket, head);
          return;
        }
        // Chained: ask the operator's proxy for the same tunnel, and only
        // report success once it has agreed to it.
        chainConnect(serverSocket, target, upstream, (error) => {
          if (error !== null) {
            denied(target, error);
            refuse(clientSocket, 502, "Upstream proxy refused");
            serverSocket.destroy();
            return;
          }
          establish(clientSocket, serverSocket, head);
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
