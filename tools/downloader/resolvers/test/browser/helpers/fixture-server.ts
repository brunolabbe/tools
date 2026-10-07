/**
 * Static server for the browser-sniffer fixtures.
 *
 * Real sites change, rate-limit and geo-vary, which makes CI failures
 * meaningless — so every page these tests drive is served from disk on an
 * ephemeral loopback port.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../fixtures/pages", import.meta.url)));

/** dl-83: the only pages `/enter-redirect` sends a press back to. */
const ENTER_REDIRECT_TARGETS: readonly string[] = [
  "/age-link-redirect-L.html",
  "/age-link-redirect-S.html",
];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mpd": "application/dash+xml",
  ".mp4": "video/mp4",
  ".m4s": "video/iso.segment",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

/**
 * dl-79: playlist endpoints that name nothing about what they carry. The path
 * has no extension and the type is `text/plain` or `application/octet-stream`,
 * so only the body says it is a manifest. Keyed by `pathname?id`.
 */
const UNTYPED_ENDPOINTS: Record<string, { file: string; contentType: string }> = {
  "/api/playlist?1": {
    file: path.join("media", "untyped", "media.m3u8"),
    contentType: "text/plain; charset=utf-8",
  },
  "/api/playlist?2": {
    file: path.join("media", "untyped", "not-a-playlist.txt"),
    contentType: "text/plain; charset=utf-8",
  },
  "/api/playlist?3": {
    file: path.join("media", "untyped", "media.m3u8"),
    contentType: "application/octet-stream",
  },
  "/api/manifest?1": {
    file: path.join("media", "dash", "manifest.mpd"),
    contentType: "text/plain; charset=utf-8",
  },
  // dl-92: the one *typed* extensionless master. It is here because it shares
  // the route shape, not the untyped body-sniffing path.
  "/api/playlist?4": {
    file: path.join("media", "extless", "master.m3u8"),
    contentType: "application/vnd.apple.mpegurl",
  },
};

/** Pages served with a deliberate non-2xx, so classification has something to read. */
const STATUS_OVERRIDES: Record<string, number> = {
  "/challenge.html": 403,
};

export interface FixtureServer {
  origin: string;
  /**
   * A second origin, serving the same fixture directory on a different
   * loopback port — genuinely cross-origin, not same-origin-by-convention.
   * dl-55, decision 3's cross-origin chooser fixture needs a frame
   * `isScriptableFrame` really does say no to, which two ports on the same
   * primary server cannot give it.
   */
  secondaryOrigin: string;
  /**
   * Every pathname requested, in order, across *both* origins. A fixture that
   * must prove a control was or was not pressed reports it to a `/beacon/`
   * path, and a test clears this before the probe it asserts on.
   */
  requests: string[];
  url(pathname: string): string;
  secondaryUrl(pathname: string): string;
  close(): Promise<void>;
}

function resolveWithin(pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(ROOT, `.${path.posix.normalize(decoded)}`);
  // Never serve outside the fixture directory, even from a test server.
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : undefined;
}

/**
 * The parent page for a cross-origin chooser fixture (dl-55, decision 3;
 * dl-61): an `<iframe>` pointing at `innerPath` on the *secondary* origin,
 * injected at request time since a static file cannot know an ephemeral port
 * in advance.
 */
function crossOriginFrameHtml(secondaryOrigin: string, innerPath: string, title: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${title}: outer</title></head>
  <body>
    <h1>${title}: outer</h1>
    <iframe
      id="embed"
      src="${secondaryOrigin}${innerPath}"
      width="640"
      height="360"
      title="Embedded"
    ></iframe>
  </body>
</html>
`;
}

/** Outer pages that embed a secondary-origin fixture, keyed by the path that serves them. */
const CROSS_ORIGIN_FRAMES: Record<string, { innerPath: string; title: string }> = {
  "/cross-origin-card.html": {
    innerPath: "/cross-origin-card-inner.html",
    title: "Cross-origin card",
  },
  "/cross-origin-shadow.html": { innerPath: "/shadow-player.html", title: "Cross-origin shadow" },
  "/cross-origin-shadow-order.html": {
    innerPath: "/shadow-player-order.html",
    title: "Cross-origin shadow order",
  },
  // dl-82 gate 2: a consent overlay in a frame where no script runs, with and
  // without dialog semantics.
  "/consent-xo-dialog.html": {
    innerPath: "/consent-xo-inner.html?dialog",
    title: "Cross-origin consent dialog",
  },
  "/consent-xo-nodialog.html": {
    innerPath: "/consent-xo-inner.html",
    title: "Cross-origin consent layer",
  },
};

/** Shared by both origins: same static root, same redirect/beacon rules. */
function makeHandler(
  requests: string[],
  secondaryOrigin: () => string,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = requestUrl.pathname;
      requests.push(pathname);

      if (pathname.startsWith("/beacon/")) {
        response.writeHead(204).end();
        return;
      }

      // dl-79: ordinary `.ts` segments, answered from memory because a `.ts`
      // file under the fixtures is a TypeScript file to the linter.
      if (/^\/media\/untyped\/seg-\d+\.ts$/.test(pathname)) {
        const body = Buffer.from(`fixture mpeg-ts segment ${pathname}\n`);
        response.writeHead(200, {
          "content-type": "video/mp2t",
          "content-length": String(body.byteLength),
          "cache-control": "no-store",
        });
        response.end(body);
        return;
      }

      // A login wall reached by redirect, which is the shape real sites use.
      if (pathname === "/gated") {
        response.writeHead(302, { location: "/login.html" });
        response.end();
        return;
      }

      // dl-55: a redirect during load is legitimate — the landing URL is
      // recorded only after navigation settles, so this must still probe.
      if (pathname === "/guard-redirect") {
        response.writeHead(302, { location: "/mse.html" });
        response.end();
        return;
      }

      // dl-55, decision 2: proves the landing URL is the page reached after
      // the redirect, not the one first requested — a wrong `landingUrl`
      // would flag the target's own fragment-only play as a departure, and
      // `/guard-redirect` alone cannot tell the two apart.
      if (pathname === "/guard-redirect-then-fragment") {
        response.writeHead(302, { location: "/guard-redirect-fragment-target.html" });
        response.end();
        return;
      }

      // dl-83 gate round 2: a server-side age gate. The entry link sets a
      // cookie here and is sent straight back to the page it came from, so the
      // press never leaves although the link names another path. `next` is
      // matched against the pages that use it rather than checked for shape: a
      // `startsWith("/")` guard lets `/\host` through, which browsers read as
      // `//host`.
      if (pathname === "/enter-redirect") {
        const next = requestUrl.searchParams.get("next") ?? "/";
        const safe = ENTER_REDIRECT_TARGETS.includes(next) ? next : "/";
        response.writeHead(302, { "set-cookie": "age=1; Path=/", location: safe });
        response.end();
        return;
      }

      // dl-55, decision 3: a genuinely cross-origin frame, not same-origin by
      // convention — the port is injected at request time.
      // dl-61 reuses the same shape for a player inside an open shadow root.
      const crossOriginFrame = CROSS_ORIGIN_FRAMES[pathname];
      if (crossOriginFrame !== undefined) {
        const body = crossOriginFrameHtml(
          secondaryOrigin(),
          crossOriginFrame.innerPath,
          crossOriginFrame.title,
        );
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
          "cache-control": "no-store",
        });
        response.end(body);
        return;
      }

      // Extensionless, signed manifest: only Content-Type identifies it.
      const untyped = UNTYPED_ENDPOINTS[`${pathname}?${requestUrl.searchParams.get("id") ?? ""}`];
      const filePath =
        untyped !== undefined
          ? path.join(ROOT, untyped.file)
          : pathname === "/media/dash/stream"
            ? path.join(ROOT, "media", "dash", "manifest.mpd")
            : resolveWithin(pathname);

      if (filePath === undefined) {
        response.writeHead(400).end("bad path");
        return;
      }

      try {
        const body = await readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();
        response.writeHead(STATUS_OVERRIDES[pathname] ?? 200, {
          "content-type":
            untyped?.contentType ?? CONTENT_TYPES[extension] ?? "application/octet-stream",
          "content-length": String(body.byteLength),
          "cache-control": "no-store",
        });
        response.end(body);
      } catch {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      }
    })();
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  // Read lazily by the primary handler: the secondary server has not been
  // assigned a port yet when the primary one starts listening.
  let secondaryOrigin = "";

  const primary: Server = createServer(makeHandler(requests, () => secondaryOrigin));
  const secondary: Server = createServer(makeHandler(requests, () => secondaryOrigin));

  const origin = await listen(primary);
  secondaryOrigin = await listen(secondary);

  return {
    origin,
    secondaryOrigin,
    requests,
    url: (pathname: string) => new URL(pathname, origin).toString(),
    secondaryUrl: (pathname: string) => new URL(pathname, secondaryOrigin).toString(),
    close: async () => {
      await Promise.all(
        [primary, secondary].map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            }),
        ),
      );
    },
  };
}
