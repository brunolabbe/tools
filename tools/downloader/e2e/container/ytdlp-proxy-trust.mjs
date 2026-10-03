// dl-73: the shipped yt-dlp, through the terminating proxy, against an origin
// only the operator's root can vouch for. Run by the container gate in
// `.github/workflows/downloader.yml`, inside the image it just built:
//
//     docker run --rm -v "$PWD/tools/downloader/e2e/container:/app/tools/downloader/e2e/container:ro" \
//       downloader:local node tools/downloader/e2e/container/ytdlp-proxy-trust.mjs
//
// and runnable outside a container the same way, from the repo root after
// `npm run build`, wherever a real yt-dlp is on `PATH`.
//
// ## What it proves, and why it needs the image
//
// When the API's egress proxy terminates TLS (dl-37), yt-dlp trusts the leaf it
// is handed only through `SSL_CERT_FILE` **together with** `--compat-options
// no-certifi`. The shipped binary is a PyInstaller build carrying its own
// `certifi`, which it prefers over the system store, so `SSL_CERT_FILE` alone is
// read and never consulted. dl-39 measured that once by hand, against
// 2025.09.26, and left it ungated because yt-dlp was optional. dl-72 made it
// ship in every image, YouTube resolves through nothing else, and
// `ytdlp-bump.yml` now moves the version on a schedule — so the pair is checked
// here, against the binary the image actually carries, on every run.
//
// The unit suites cannot make this claim: they run yt-dlp as a stand-in that
// echoes its argv (`resolvers/test/fixtures/ytdlp/fake-ytdlp.mjs`), which
// proves what we pass and nothing about whether a given yt-dlp still honours
// it.
//
// ## Why `createApp` rather than the resolver alone
//
// The flags must be the ones the service passes, not a second copy written
// here. So this builds the real app from the image's own `dist` — the same
// `server.ts` that builds the tier interception, starts the tier proxy and
// hands `trustBundlePath` to `buildRegistry`, which hands it to
// `YtDlpResolver` — and asks it to probe through `POST /api/probe`, injected,
// with every other tier off. Dropping either half of the pair from
// `resolvers/src/resolvers/ytdlp.ts` turns this red; dl-73's Log has the run.
//
// ## Why the result means the pair worked
//
// The origin's certificate is issued by a root that only the proxy is told
// about (`egressCaFile`, as `EGRESS_CA_FILE` would be). yt-dlp never sees that
// root, and the resolver never passes `--no-check-certificates`, so the only
// certificate yt-dlp can verify on this path is the proxy's leaf — and the only
// way it can verify that is the generated root in `SSL_CERT_FILE`, consulted
// because of `no-certifi`. A probe answered by `yt-dlp` is therefore the pair
// working, end to end, with the proxy verifying the origin on the other side.
//
// No third-party site: the origin is in this process, on loopback.

import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createApp } from "../../api/dist/index.js";
import { createTlsInterception } from "../../api/dist/tls-interception.js";

const HOST = "127.0.0.1";

/** A real, if tiny, HLS ladder: yt-dlp's generic extractor reads the master. */
const BODIES = new Map([
  [
    "/master.m3u8",
    {
      type: "application/vnd.apple.mpegurl",
      body: [
        "#EXTM3U",
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"',
        "low.m3u8",
        "",
      ].join("\n"),
    },
  ],
  [
    "/low.m3u8",
    {
      type: "application/vnd.apple.mpegurl",
      body: [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:2",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXTINF:2.0,",
        "seg0.ts",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    },
  ],
  // Bytes, not a playable segment: nothing here decodes it, and a size probe
  // only needs a body with a length.
  ["/seg0.ts", { type: "video/mp2t", body: Buffer.alloc(188 * 64, 0x47) }],
]);

function say(line) {
  process.stdout.write(`${line}\n`);
}

/** @param {https.Server} server */
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      resolve(/** @type {import("node:net").AddressInfo} */ (server.address()).port);
    });
  });
}

async function main() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "dl-73-"));
  // The operator's private root, standing in for a corporate CA. Issued with
  // the same code the proxy uses only because Node writes no certificate on
  // its own; it is a separate root, and yt-dlp is never given it.
  const operator = await createTlsInterception({});
  const operatorCaFile = path.join(work, "operator-ca.pem");
  await fs.writeFile(operatorCaFile, operator.rootCaPem);

  /** @type {string[]} */
  const requests = [];
  const origin = https.createServer(operator.leafFor(HOST), (request, response) => {
    const url = request.url ?? "/";
    requests.push(url);
    const entry = BODIES.get(url);
    if (entry === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": entry.type }).end(entry.body);
  });
  const port = await listen(origin);
  const target = `https://${HOST}:${String(port)}/master.m3u8`;

  const app = await createApp({
    startGc: false,
    config: {
      // yt-dlp alone, so an answer can only have come from it and a failure is
      // its failure rather than a fallthrough to a tier that would succeed.
      enableYtdlpResolver: true,
      enableBrowserResolver: false,
      enableDirectResolver: false,
      // The default, spelled out: the tiers' proxy terminates only when this is
      // on, and a gate that silently tunnelled would prove nothing.
      ffmpegTlsIntercept: true,
      egressCaFile: operatorCaFile,
      ssrfAllowHosts: [HOST],
      storageDir: work,
      databasePath: ":memory:",
      logLevel: "warn",
    },
  });

  let failed = false;
  try {
    const health = await app.server.inject({ method: "GET", url: "/api/health" });
    const ytdlp = health.json().ytdlp;
    say(`yt-dlp in this image: ${JSON.stringify(ytdlp)}`);
    if (ytdlp?.available !== true) {
      say("FAIL: the service did not find a yt-dlp binary, so there is nothing to prove.");
      return 1;
    }

    say(`probing ${target} through the terminating proxy, yt-dlp tier only`);
    const response = await app.server.inject({
      method: "POST",
      url: "/api/probe",
      payload: { url: target },
    });
    const body = response.json();
    say(`HTTP ${String(response.statusCode)}`);
    say(`origin saw: ${JSON.stringify(requests)}`);

    if (response.statusCode !== 200) {
      say(`FAIL: the probe was refused: ${JSON.stringify(body.error ?? body)}`);
      failed = true;
    } else if (body.probe?.resolver !== "yt-dlp") {
      say(`FAIL: answered by ${String(body.probe?.resolver)}, not yt-dlp.`);
      failed = true;
    } else if (!(body.probe.variants?.length > 0)) {
      say("FAIL: yt-dlp answered with no variants.");
      failed = true;
    } else if (!requests.includes("/master.m3u8")) {
      say("FAIL: the origin never served the manifest, so nothing crossed the proxy.");
      failed = true;
    } else {
      say(
        `PASS: ${String(ytdlp.path)} verified the proxy's leaf and found ` +
          `${String(body.probe.variants.length)} variant(s).`,
      );
    }
  } finally {
    await app.shutdown();
    await new Promise((resolve) => {
      origin.close(resolve);
      origin.closeAllConnections();
    });
    await operator.close();
    await fs.rm(work, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
