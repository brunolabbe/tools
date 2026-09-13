---
id: dl-53
tool: downloader
title: Decide how finished files reach the public without making the tunnel a video CDN
kind: work-package
status: needs-decision
milestone: M5
depends_on: []
difficulty: hard
---

# dl-53 — Finished files and the tunnel

**Packages:** depends on the option chosen. Option A has none. Option B touches
`api` (the file route and the retention sweep) and the deployment docs.

## Why

`docs/02-DEPLOYMENT.md` ("Things that will bite you") says bulk video through
the Cloudflare proxy is discouraged by the self-serve terms. It adds that "at
personal scale this is not something anyone notices". Its fix, publishing the
LAN address for `/api/files/*`, only works for someone on the LAN. A public
service is exactly the scale that gets noticed, and its visitors are not on
the owner's network.

Every finished file today leaves through `/api/files/:token` on the tunnel. A
`<video>` element seeking through a link costs 207–274 requests a minute, as
measured in [dl-23](./dl-23-rate-limit-the-download-route.md).

**Before choosing, read the current Cloudflare terms** for the plan this zone
is on. Write down in the Log what they say about serving video, with the date
you read them. The deployment doc paraphrases them, and a paraphrase can go
stale.

## The decision

**A — Keep files on the tunnel, and make them small and short-lived
(recommended to launch).** Lower `MAX_FILE_SIZE_MB` and `FILE_RETENTION_HOURS`
(dl-52), and set `RATE_LIMIT_FILES_PER_MINUTE` to what one person watching one
file needs. No code changes. The risk stays: a notice, and the tunnel suspended
with it, which takes the planner down too because they share it. The fallback
is B.

**B — Serve files from object storage outside the proxy, such as Cloudflare
R2.** The API uploads a finished file and hands out a short-lived signed link
instead of `/api/files/:token`. Costs:

- The capability model changes. dl-23's per-token limit and the retention
  sweep now govern a bucket, not a directory.
- A new credential and a new outbound destination for the host.
- Storage has a cost, although R2's egress does not.
- Signed links expire, which today's tokens do not do independently of
  retention.

**C — Serve files straight from the host, without the tunnel.** A forwarded
port with its own TLS certificate, and a second hostname for `/api/files/*`.
The home IP address becomes public, and the router becomes part of the attack
surface. This is listed because it is the obvious idea. It is the one this plan
recommends against.

## Build

Written with the decision.

## Done when

Written with the decision.

## Log

- 2026-09-13 — Filed as `needs-decision`. Cloudflare's current terms have not
  been read for this filing. That reading comes first.
