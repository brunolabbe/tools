# Deployment — a public subdomain on a home host

How to put a tool from this repo on `<tool>.example.com` from a machine sitting
behind a domestic router, with authentication in front of it.

The container half is [`compose.prod.yaml`](../compose.prod.yaml). The half that
cannot be a file in this repo — the hostname, the certificate, the login policy —
lives in the Cloudflare dashboard, and is written out below so it is reviewable
even though it is not version controlled.

---

## Shape

```
        browser
           │  https://downloader.example.com
           ▼
   ┌───────────────────────────────────┐
   │           Cloudflare              │
   │  TLS  ·  Access (login)  ·  WAF   │
   └───────────────┬───────────────────┘
                   │  the tunnel — established from the inside, outbound
   ═ ═ ═ ═ ═ ═ ═ ═ ┼ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═  home router, no ports open
                   │
   ┌───────────────▼───────────────────┐
   │  mini-PC                          │
   │  ┌─────────────┐  ┌─────────────┐ │
   │  │ cloudflared │─►│ downloader  │ │  compose network 172.30.42.0/24
   │  └─────────────┘  │   :8080     │ │
   │                   └──────┬──────┘ │
   │                          ▼        │
   │                    volume /data   │
   └───────────────────────────────────┘
```

The direction of that connection is the entire security argument. `cloudflared`
dials Cloudflare and holds the connection open; requests come back down it.
Nothing dials in, so there is no port to forward, no address to keep current,
and nothing for a scanner to find. It works behind CGNAT, where a port forward
cannot work at all.

## Before you start

- A domain on Cloudflare, using Cloudflare's nameservers.
- Docker and the Compose plugin on the host. `depends_on: condition:` needs
  Compose v2, which every current install has.
- A checkout of this repo on the host, for the two compose files and `.env`.
  The image is **not** built here: it is pulled from GHCR at an exact version,
  which is what makes "roll back" a pull rather than a rebuild. See
  [03-RELEASING.md](./03-RELEASING.md).
- `docker login ghcr.io` on the host, with a **classic** personal access token
  carrying `read:packages` and nothing else. This is the one credential the
  arrangement costs, and it is read-only. It has to be a classic token:
  `read:packages` has no fine-grained equivalent, so a fine-grained one cannot
  be given the scope at all. See
  [03-RELEASING.md](./03-RELEASING.md#registry-access).

  A **package's visibility is its own setting**, independent of the repository's:
  the first push creates it private, and making the repository public does not
  change that. So the login above is required even for a stranger reading this
  from a public repo, unless the package has been flipped to public deliberately
  (its page on GHCR → **Package settings** → **Change visibility**). Worth
  deciding on purpose in either direction — private and documented is a fine
  answer, and so is public; what is not fine is a public repo whose deployment
  instructions 404 for everyone who follows them.

Nothing needs to be installed on the router.

---

## 1 — Create the tunnel

In the Zero Trust dashboard (`one.dash.cloudflare.com`):

**Networks → Tunnels → Create a tunnel → Cloudflared.** Name it after the host,
not after the tool — one tunnel serves every hostname this machine publishes,
and you will want the second one later.

Cloudflare then offers an install command. Do not run it: it installs
`cloudflared` as a system service, and here it runs as a container instead. Copy
only the token out of it — the long opaque string after `--token`.

On the host:

```bash
cp .env.prod.example .env
$EDITOR .env                       # paste the token into TUNNEL_TOKEN
```

That token is a bearer credential for the tunnel, not an identifier. Anyone
holding it can publish traffic as you. `.env` is gitignored; if it ever leaks,
delete the tunnel and create another, because there is no rotation.

## 2 — Route the hostname

Still in the tunnel's configuration, **Public Hostnames → Add a public
hostname**:

| Field     | Value             |
| --------- | ----------------- |
| Subdomain | `downloader`      |
| Domain    | your domain       |
| Path      | _(empty)_         |
| Type      | `HTTP`            |
| URL       | `downloader:8080` |

`downloader:8080` is the service name from `compose.yaml` resolved on the
compose network, which is why `cloudflared` has to share that network and does.
`HTTP`, not `HTTPS`: the leg from `cloudflared` to the container never leaves
the host, and giving it its own certificate would mean managing one to protect a
hop that already cannot be observed.

Cloudflare creates the proxied DNS record itself. Do not add one by hand.

## 3 — Bring it up

Set the two lines in `.env` that say which image to run — `GHCR_OWNER`, and
`DOWNLOADER_TAG` at a released version — then:

```bash
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml up -d
docker compose -f compose.yaml -f compose.prod.yaml logs -f cloudflared
```

No `--build`: this host pulls a released image rather than compiling one. The
first pull is long — the downloader's image carries Playwright's Chromium and
ffmpeg — but subsequent ones move only the layers that changed. `cloudflared`
waits for the container's health check before it registers, so a few seconds of
`dependency failed to start` at the top of the logs is the intended behaviour
and not an error.

Once the logs show four `Registered tunnel connection` lines, the hostname is
live.

## 4 — Put a login in front of it

**This is the step that matters, and the service is unsafe without it.** There
is no authentication anywhere in the application — see the security posture in
[01-ARCHITECTURE.md](../tools/downloader/docs/01-ARCHITECTURE.md). A reachable, unauthenticated
instance is a machine that will fetch any URL a stranger names, open it in a
real browser, and spend your disk and your bandwidth doing it. That is not a
hypothetical use of an open endpoint; it is the only use.

**Access → Applications → Add an application → Self-hosted.**

| Field            | Value        |
| ---------------- | ------------ |
| Application name | `downloader` |
| Session duration | 1 week       |
| Subdomain        | `downloader` |
| Domain           | your domain  |
| Path             | _(empty)_    |

Then one policy: action **Allow**, include **Emails** → your address. Add a
login method under **Settings → Authentication** if you have not — one-time PIN
by email needs no setup at all, and Google or GitHub is two fields.

Unauthenticated requests are now rejected at Cloudflare's edge. They never reach
the tunnel, so they never reach the host.

### Keep the download links shareable

Access in front of everything would also gate `/api/files/:token`, which defeats
the point of a link you hand to someone. It does not have to: that token _is_ the
authorisation, 32 bytes from a CSPRNG, and [`jobs/tokens.ts`](../tools/downloader/api/src/jobs/tokens.ts)
explains why it is strong enough to stand alone.

So add a **second** application, identical except:

| Field | Value         |
| ----- | ------------- |
| Path  | `api/files/*` |

with a single policy: action **Bypass**, include **Everyone**. Access matches the
more specific path first, so the UI demands a login and finished download links
keep working for whoever you send them to.

### When you want it genuinely public

Widen the first application's policy — or delete it — once the app has its own
authentication. Nothing in `compose.prod.yaml` changes. Until that exists, this
is the auth layer, and leaving it on costs you a login page you see once a week.

---

## Verifying

```bash
curl -sS https://downloader.example.com/api/health          # expect an Access login page
curl -sS http://127.0.0.1:8080/api/health | jq              # on the host: real JSON
```

The first returning HTML rather than JSON is the good outcome — it means Access
is enforcing. From a browser you get the login, then the UI.

Then run one real download end to end and watch the progress bar move. That
exercises the parts most likely to break behind a proxy and nothing else does:
the SSE stream, and a ranged file transfer.

---

## Things that will bite you

**Rate limits silently stop working if `TRUST_PROXY` is wrong.** Every limiter
in the API keys on `request.ip`. Behind the tunnel that is `cloudflared`'s
address unless `X-Forwarded-For` is trusted, so all clients would share one
bucket — safe, but one busy user throttles everyone. `compose.prod.yaml` sets it
to the compose subnet, which is why that subnet is pinned rather than
auto-allocated. Set it to `true` instead and any client can name its own bucket
with a header; that is worse than leaving it off.

**The progress stream survives Cloudflare only because of the heartbeat.**
Cloudflare drops a proxied response that produces nothing for 100 seconds, and
ffmpeg can legitimately go minutes without a progress frame.
[`routes/events.ts`](../tools/downloader/api/src/routes/events.ts) sends a
heartbeat every 15 s and sets `Cache-Control: no-transform`, so this already
works — but it is the reason it works, and it is worth knowing before changing
either.

**An expiring Access session looks like a hung download.** When the session ends
mid-stream, the reconnecting `EventSource` is handed a login page, the client
discards it as an invalid frame, and the UI stops updating. The job itself
finishes normally on the server. A one-week session duration makes this rare;
reloading the page fixes it.

**Leave Rocket Loader off** for this hostname (Speed → Optimization). It rewrites
script loading and has no business near a React bundle. Auto-minify no longer
exists, so there is nothing else to turn off.

**Cloudflare's 100 MB limit is on uploads, not downloads.** Requests here carry a
URL and a couple of options — `MAX_BODY_BYTES` in
[`server.ts`](../tools/downloader/api/src/server.ts) caps them at 64 KB. Files
come back out and are not subject to it.

**Bulk video through the proxy is discouraged by Cloudflare's self-serve terms.**
At personal scale this is not something anyone notices. If you ever do get a
notice, the fix is to move the file transfer off the tunnel — publish the LAN
address for `/api/files/*` and keep the UI where it is — not to argue about it.

---

## Operating it

Consider tightening these once it is reachable by more than you. The defaults in
`compose.yaml` assume a single trusted user on a laptop:

- `RATE_LIMIT_PROBE_PER_MINUTE` / `RATE_LIMIT_JOBS_PER_MINUTE` — per client, and
  meaningful now that `TRUST_PROXY` makes "client" mean the right thing.
- `MAX_TOTAL_STORAGE_GB` and `FILE_RETENTION_HOURS` — the only things standing
  between a shared instance and a full disk.
- A Cloudflare **WAF rate limiting rule** on `/api/` as a second layer, since it
  rejects at the edge and costs the host nothing. The in-process limiter still
  has to be right: it is per-process and does not survive a restart, which
  [03-STATUS.md](../tools/downloader/docs/03-STATUS.md) covers.

Updating — set `DOWNLOADER_TAG` in `.env` to the version you want, then:

```bash
git pull                                                      # compose files only
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

Rolling back is the same three commands with the previous version in `.env`, and
takes as long as a pull. Which versions exist, and how one gets cut, are in
[03-RELEASING.md](./03-RELEASING.md).

The `/data` volume carries the job database and any file still inside its
retention window across the restart. Jobs that were mid-download are failed
honestly at boot rather than left showing a progress bar that will never move.

For LAN access alongside the public hostname — worth it for multi-gigabyte files
when you are at home — republish the port on all interfaces in a local override
rather than editing `compose.yaml`, which deliberately binds to loopback.

## Adding the second tool

**The tunnel does not change.** One tunnel, one `cloudflared`, one subdomain per
tool — add a service on the `edge` network and a public hostname pointing at
`planner:8090`, which is why step 1 says to name the tunnel after the host and
not after the downloader. The `planner` API has the same shape as this one: a
Fastify app serving its UI same-origin from `WEB_DIR`, SQLite behind it, and a
`/api/health` that reports 503 while draining, so `depends_on: service_healthy`
works once its image carries a `HEALTHCHECK`.

**The access policy does not carry over, and must not be copied.** Four
differences, and the first is not a hardening preference:

- **No Bypass rule.** The one on `/api/files/*` above is bought by a 256-bit
  capability token. `planner` has no capability tokens, so nothing in it is safe
  to serve unauthenticated. Its Access application gets one Allow policy and no
  exceptions.
- **`planner` has no owner model at all.** Migration 1 in
  [`db/schema.ts`](../tools/planner/api/src/db/schema.ts) is
  `conversations (id, title, created_at, updated_at)` — no user column — and
  `Conversation` in the contract has no user field either. Every visitor
  therefore shares one conversation store and can read and edit everyone's
  plans. For the downloader, an open instance costs bandwidth; here there is no
  privacy boundary to lose, because there is not one yet. Until a user model
  lands, an Access allowlist is not a precaution around the data model — it is
  the only configuration in which that model is coherent.
- **No rate limiting, and no `TRUST_PROXY` to set.** Its `ApiConfig` has neither
  the limiter fields nor the trust setting the downloader's has, so the
  `TRUST_PROXY` line in `compose.prod.yaml` is downloader-specific and has no
  planner equivalent. This matters more here, not less: once `MODEL_PROVIDER` is
  something other than `scripted`, an unauthenticated endpoint is a stranger
  spending your token budget, with `MAX_OUTPUT_TOKENS` capping one reply and
  nothing at all capping the number of replies. A Cloudflare WAF rate limiting
  rule is the only layer available until the tool grows its own.
- **`MODEL_PROVIDER` defaults to `scripted`.** A deployment that does not set it
  looks healthy and answers from a fixed script. `/api/health` reports
  `agent.provider`, so it is visible — but set it explicitly rather than relying
  on someone reading a health payload.

**It has its own image, and had to.** The downloader's is built on Playwright's
base and installs ffmpeg and yt-dlp; `planner` needs neither, so
[`tools/planner/Dockerfile`](../tools/planner/Dockerfile) is a plain Node base
and a twentieth of the size. That is why each tool now owns its Dockerfile, the
way the slow CI gates already live in `.github/workflows/<tool>.yml`. Both are
published to GHCR by the release pipeline — see
[03-RELEASING.md](./03-RELEASING.md) — so what is left here is the compose
service and the Cloudflare half, which is
[pl-2](../tools/planner/docs/work/pl-2-container-image.md).

Two things to expect a little further out. A real model provider means outbound
egress and, on a hosted API, a key — `.env.prod.example` grows past
`TUNNEL_TOKEN`, or a local model joins the compose network instead. And
streaming replies, which
[`agent/src/provider.ts`](../tools/planner/agent/src/provider.ts) says are
coming, will meet Cloudflare's 100-second idle timeout: this service survives it
only because of the 15-second heartbeat in `routes/events.ts`, and `planner` will
need the same thing built in with the streaming rather than diagnosed after it.
