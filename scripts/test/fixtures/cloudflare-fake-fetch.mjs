/**
 * A fake Cloudflare behind `fetch`, for a run of `scripts/cloudflare-setup.mjs`
 * as a real process: `node --import <this file> scripts/cloudflare-setup.mjs …`.
 *
 * The in-process suites cannot see the exit code, because the entry point is the
 * only place that sets it (dl-71). This is the smallest account that lets a whole
 * run reach it. Nothing here touches the network, and no key is a real one.
 *
 * FAKE_CF_SCENARIO picks the account:
 *   conflict  a widget named `downloader` already guards another domain
 *   forbidden the widget list answers 403
 * FAKE_CF_WRITES names a file; every non-GET call is appended to it, one per line.
 */

import { appendFileSync } from "node:fs";

const scenario = process.env.FAKE_CF_SCENARIO;
const writesFile = process.env.FAKE_CF_WRITES;

const answer = (result, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, errors: [], result }), { status });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  if (method !== "GET" && writesFile) appendFileSync(writesFile, `${method} ${url}\n`);

  if (url.endsWith("/tokens/verify")) return answer({ status: "active" });
  if (url.includes("/cfd_tunnel?")) return answer([{ id: "abc", name: "home" }]);
  if (url.endsWith("/cfd_tunnel/abc/configurations")) {
    return answer({ config: { ingress: [{ service: "http_status:404" }] } });
  }
  if (url.includes("/dns_records") || url.endsWith("/access/apps")) return answer([]);
  if (url.includes("/challenges/widgets")) {
    if (scenario === "forbidden") return answer(null, 403);
    return answer([
      { sitekey: "0xFAKE-SITE", name: "downloader", domains: ["other.example.com"] },
    ]);
  }
  return answer(null, 404);
};
