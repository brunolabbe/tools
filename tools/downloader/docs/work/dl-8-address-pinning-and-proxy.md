---
id: dl-8
tool: downloader
title: Pin vetted addresses into the socket, and proxy direct fetches
kind: fix
status: done
milestone: null
depends_on: [dl-5, dl-6]
---

# dl-8 — Address pinning and a real proxy

**Area:** `tools/downloader/api/src/dispatcher.ts`

## Why

Two gaps [03-STATUS.md](../03-STATUS.md) listed separately turned out to be one
seam, so they closed together.

The SSRF guard resolved a name, approved it, and then let the socket resolve it
again — the address that was checked and the address that was connected to were
never the same object, and a TTL-0 record was free to differ. And `PROXY_URL`
reached ffmpeg, yt-dlp and the browser while every direct `fetch` quietly went
around it, because Node's global `fetch` ignores `http_proxy` entirely.

## Build

One undici `Agent` that both fixes go through.

1. Resolve once, check **every** record, hand the survivors straight to the
   socket via the `lookup` that `net.connect` accepts and undici passes through
   from `Agent`'s `connect` options.
2. `ProxyAgent` when `PROXY_URL` is set, so direct fetches use the same egress
   as everything else. Validate the URL at boot rather than at first request.
3. Share one policy with `ssrf.ts`: `isBlockedAddress` for the address rule and
   the guard's `isExemptHost` for the escape hatches.

## Done when

A test resolves a public address for the pre-flight check, points the
connector's resolver at loopback, and fetches over a real socket — a DNS rebind
reduced to its essentials — and the connector refuses it.

## Log

Shipped in `858bb93`.

**DNS rebinding is now actually fixed, not narrowed.** There is no second
resolution left to disagree with the first.

`ssrf.ts` stays exactly where it was. It refuses a URL before a socket exists,
with a typed error naming a reason, and it is the only check that can cover the
URLs **ffmpeg** fetches through its own HTTP stack — which is why the sweep over
every URL in a `ProbeResult` is still load-bearing. The two share one policy, so
a fixture host that the pre-flight check waves through cannot be refused at
connect time.

**The proxy now applies to direct fetches.** On a deployment that sets a proxy
because its egress IP matters, the old behaviour meant signed URLs issued to one
address and redeemed from another — a 403 that reads like a flaky extractor.
`socks5://` is the common mistake, and `ProxyAgent` speaks HTTP to the proxy, so
that is now refused at boot.

**Proxy and pinning are exclusive, deliberately.** With a proxy there is no
local resolution to pin, so pinning is not weakened — it is simply not the
mechanism in play. What bounds egress there is the proxy's own policy.

The tests worth reading are the last block of
`tools/downloader/api/test/dispatcher.test.ts`. The companion test proves the
dispatcher is genuinely in the socket path rather than being ignored.
`npm run e2e:downloader` passed unchanged.
