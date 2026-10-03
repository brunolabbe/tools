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
// ## Two probes, because a success alone proves nothing about verification
//
// The origin's certificate is issued by a root that only the proxy is told
// about (`egressCaFile`, as `EGRESS_CA_FILE` would be), and yt-dlp is never
// given it. So the first probe can only succeed if yt-dlp verified the proxy's
// leaf against the generated root in `SSL_CERT_FILE` — **or if yt-dlp verified
// nothing at all**. A `--no-check-certificates` added to the resolver, or a
// release that fails open, would pass that probe just as well, with or without
// the proxy (dl-73's first gate measured both).
//
// So the second probe is the control. Same app, same resolver, same flags,
// same proxy, same origin — and the trust bundle the app handed yt-dlp
// rewritten to hold an unrelated root instead. yt-dlp must now refuse, and the
// API must say `TLS_VERIFICATION_FAILED`. The first probe passing **and** the
// second refusing is the pair working; either alone is not.
//
// The bundle is found on disk, which is the one place this reaches past the
// app's public surface: `createApp` does not expose it, and the per-process
// generated root is deliberately unreachable. `TMPDIR` is pointed at a
// directory of this script's own before `createApp`, so the interceptions'
// directories are the only `downloader-egress-ca-*` there; finding none is a
// failure rather than a skipped control.
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

/** Every trust bundle an interception wrote under `dir`. See the header. */
async function trustBundlesUnder(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("downloader-egress-ca-")) continue;
    const bundle = path.join(dir, entry.name, "egress-trust-bundle.pem");
    try {
      await fs.access(bundle);
      found.push(bundle);
    } catch {
      // A directory without a bundle is not the one yt-dlp was handed.
    }
  }
  return found;
}

/** @param {import("fastify").FastifyInstance} server */
async function probe(server, url) {
  const response = await server.inject({
    method: "POST",
    url: "/api/probe",
    // `refresh`, or the control would be answered from the probe cache.
    payload: { url, refresh: true },
  });
  return { status: response.statusCode, body: response.json() };
}

async function main() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "dl-73-"));
  // The operator's private root, standing in for a corporate CA, and a second
  // root that vouches for nothing on this path — the control's anchor. Both
  // are issued with the code the proxy uses only because Node writes no
  // certificate on its own; neither is the proxy's root, and yt-dlp is given
  // neither until the control hands it the unrelated one.
  const operator = await createTlsInterception({});
  const unrelated = await createTlsInterception({});
  const operatorCaFile = path.join(work, "operator-ca.pem");
  await fs.writeFile(operatorCaFile, operator.rootCaPem);

  // Before `createApp`: `os.tmpdir()` reads this on every call, so the app's
  // interceptions put their directories here and nowhere else.
  const appTmp = path.join(work, "app-tmp");
  await fs.mkdir(appTmp);
  process.env["TMPDIR"] = appTmp;

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

  const failures = [];
  try {
    const health = await app.server.inject({ method: "GET", url: "/api/health" });
    const ytdlp = health.json().ytdlp;
    say(`yt-dlp in this image: ${JSON.stringify(ytdlp)}`);
    if (ytdlp?.available !== true) {
      say("FAIL: the service did not find a yt-dlp binary, so there is nothing to prove.");
      return 1;
    }

    say(`probe 1: ${target} through the terminating proxy, yt-dlp tier only`);
    const first = await probe(app.server, target);
    say(`  HTTP ${String(first.status)}; origin saw ${JSON.stringify(requests)}`);
    if (first.status !== 200) {
      failures.push(`probe 1 was refused: ${JSON.stringify(first.body.error ?? first.body)}`);
    } else if (first.body.probe?.resolver !== "yt-dlp") {
      failures.push(`probe 1 was answered by ${String(first.body.probe?.resolver)}, not yt-dlp`);
    } else if (!(first.body.probe.variants?.length > 0)) {
      failures.push("probe 1: yt-dlp answered with no variants");
    } else if (!requests.includes("/master.m3u8")) {
      failures.push("probe 1: the origin never served the manifest");
    }

    const bundles = await trustBundlesUnder(appTmp);
    say(`control: replacing ${String(bundles.length)} trust bundle(s) with an unrelated root`);
    if (bundles.length === 0) {
      failures.push("control: no trust bundle found under the app's TMPDIR, so nothing was tested");
    } else {
      for (const bundle of bundles) await fs.writeFile(bundle, unrelated.rootCaPem);
      const seenBefore = requests.length;
      say(`probe 2: ${target}, same everything, yt-dlp now trusting only that root`);
      const second = await probe(app.server, target);
      const reached = requests.slice(seenBefore);
      say(`  HTTP ${String(second.status)}; origin saw ${JSON.stringify(reached)}`);
      if (second.status === 200) {
        failures.push(
          "control: yt-dlp accepted a leaf no root it was given vouches for — it is not verifying (--no-check-certificates, or a release that fails open)",
        );
      } else if (second.body.error?.code !== "TLS_VERIFICATION_FAILED") {
        failures.push(
          `control: refused, but not on trust: ${JSON.stringify(second.body.error ?? second.body)}`,
        );
      } else if (reached.length > 0) {
        failures.push(`control: refused, yet the origin served ${JSON.stringify(reached)}`);
      }
    }

    if (failures.length === 0) {
      say(
        `PASS: ${String(ytdlp.path)} verified the proxy's leaf through SSL_CERT_FILE ` +
          `(${String(first.body.probe.variants.length)} variant(s)), and refused it once that ` +
          "file named an unrelated root.",
      );
    }
    for (const failure of failures) say(`FAIL: ${failure}`);
  } finally {
    await app.shutdown();
    await new Promise((resolve) => {
      origin.close(resolve);
      origin.closeAllConnections();
    });
    await operator.close();
    await unrelated.close();
    await fs.rm(work, { recursive: true, force: true });
  }
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await main();
