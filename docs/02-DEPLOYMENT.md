# Deployment — a public subdomain on a home host

How to put a tool from this repo on `<tool>.example.com` from a machine sitting
behind a domestic router, with authentication in front of it.

The container half is [`compose.prod.yaml`](../compose.prod.yaml). The half that
cannot be a file in this repo — the hostname, the certificate, the login policy —
lives in the Cloudflare dashboard, and is written out below so it is reviewable
even though it is not version controlled.

**This page is repo-wide, and the downloader is its worked example rather than
its subject** — the `downloader` in the diagram below, and in the commands that
follow it, is the tool that happened to be first. The tunnel, the login policy
and the version scheme are one story for whatever gets published, which is why
deployment lives here rather than under a tool, and why
[adr/004](./adr/004-one-compose-fragment-per-tool.md) gives each tool a compose
fragment of its own instead of a deployment story of its own. The planner
arrives later, and twice:
[`## Grounding the planner`](#grounding-the-planner-a-routing-engine-and-a-geocoder)
is what it takes to make its distances real, and
[`## Adding the second tool`](#adding-the-second-tool) re-reads the walkthrough
above as a delta — the tunnel does not change, and the Access policy must not be
copied. A reader who stops before those two has read one tool's walkthrough, not
the page.

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
- `RATE_LIMIT_FILES_PER_MINUTE` — per **file token**, not per client, so it does
  not depend on `TRUST_PROXY` and one leaked link cannot buy itself more
  allowance by being fetched from more addresses. Its default is 600 because a
  `<video>` element pointed at a download link issues one open-ended `Range`
  request per seek: dl-23 measured 207–274 requests a minute from an ordinary
  scrub-bar drag. Lower it only if you know nobody plays these links in a
  browser; 0 turns it off.
- `MAX_TOTAL_STORAGE_GB` and `FILE_RETENTION_HOURS` — the only things standing
  between a shared instance and a full disk.
- A Cloudflare **WAF rate limiting rule** on `/api/` as a second layer, since it
  rejects at the edge and costs the host nothing. The in-process limiter still
  has to be right: it is per-process and does not survive a restart, so two
  replicas grant two allowances and a redeploy resets every bucket. The scope of
  that, and the shared store that is the fix if this is ever scaled out, are in
  [dl-6](../tools/downloader/docs/work/dl-6-security-and-limits.md)'s Log.

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

## Grounding the planner: a routing engine and a geocoder

The planner ships with `GROUNDING_PROVIDER=fixtures`, which answers from a
checked-in table and reaches nothing — a fresh clone and the image gate both
run that way on purpose. **This section is what it takes to make the distances
real**, and it is the half of a self-hosted decision that gets skipped and then
has to be rediscovered a year later by whoever notices the roads are out of
date.

The services are [`compose.planner.yaml`](../compose.planner.yaml), a fragment
of their own for the reasons in
[adr/004](./adr/004-one-compose-fragment-per-tool.md). A downloader-only host
never merges it and never pulls either image.

### It is three services, and the first two surprise everyone once

**Valhalla routes; it does not geocode.** It answers "how long from this point
to that point" and has no opinion about where Sainte-Anne-des-Monts is. So the
planner needs a geocoder as well, and
[pl-28](../tools/planner/docs/work/pl-28-valhalla-adapter.md) chose Nominatim on
the same regional extract: same data, same box, one more container. The API sees
one seam and one provider name — `VALHALLA_URL` and `GEOCODER_URL` are two
addresses behind it.

**And Overpass discovers**, which is the third
([pl-33](../tools/planner/docs/work/pl-33-overpass-payload-and-notability.md)).
Routing and geocoding answer questions about places you already named; discovery
is the one that proposes — what is worth stopping for along this corridor. It
reads the same extract into a third form, because a graph, a geocoding database
and a queryable tag index share no artifact between them.

`OVERPASS_URL` is the one address here that may be left unset, and the planner
starts without it: a deployment can measure and geocode without discovering, and
`nearby` says so once in the log and returns nothing. That is the only optional
one of the three.

Neither URL has a default, anywhere. Naming `valhalla` with an endpoint missing
**refuses the boot**, with a message saying which variable. That is deliberate:
a service that starts without one reports healthy and then fails on its first
run, as a named travel-time gap on somebody's plan — which is the shape of an
honest answer, so nothing about it looks wrong.

### 1 — Choose the extract

One `.osm.pbf` from [Geofabrik](https://download.geofabrik.de/), and it is the
only line either service disagrees about. Take the **smallest region that
contains the trips this instance will plan**, because everything below scales
with it: a province is a comfortable afternoon and a continent is not.

```bash
# in .env, on the host
OSM_EXTRACT_URL=https://download.geofabrik.de/north-america/canada/quebec-latest.osm.pbf
NOMINATIM_PASSWORD=<anything; it is internal to that container>
```

Geofabrik regenerates every extract daily. Nothing here follows that
automatically and nothing should — see step 4.

### 2 — Build the graph

```bash
docker compose -f compose.planner.yaml --profile tiles run --rm valhalla-tiles
```

A profile rather than a service, so a routine `up -d` never selects it. It
downloads the extract, builds the tile set into the `valhalla_tiles` volume and
exits.

**What it is doing, and what to expect.** `valhalla_build_tiles` is a pipeline
of named stages — `initialize`, `parseways`, `parserelations`, `parsenodes`,
`constructedges`, `build`, `enhance`, `filter`, `transit`, `bss`, `hierarchy`,
`shortcuts`, `restrictions`, `elevation`, `validate`, `cleanup` — and it logs
each one as it starts. A run that appears to have hung is almost always in
`parseways` or `build`, which are the long ones. `-j` bounds the thread count if
you would rather the host stayed usable; `-s` and `-e` restart from a named
stage rather than from the top, which is the difference between losing an
afternoon and losing ten minutes when something runs out of disk.

**Budget an order of magnitude more scratch space than the `.pbf`**, and expect
the finished tiles to be a small multiple of it. A provincial extract is
tens-of-minutes-to-an-hour of CPU on a few cores; a country is a different
question and worth measuring before committing a maintenance window to it.
Those are shapes rather than measurements — **measure yours once and write the
number in your own runbook**, because it is the number you will want the next
time and nothing here can know your host.

None of the optional data sets are built: elevation matters to a cycling or
walking profile and this tool asks for `auto`; admin and time-zone data matter
to turn-by-turn narrative and time-of-day costing, neither of which a distance
matrix reads. Each one is a large download and more build time, and turning one
on is a deliberate act with a reason attached.

### 3 — Bring them up and point the planner at them

```bash
docker compose -f compose.planner.yaml up -d
docker compose -f compose.planner.yaml logs -f valhalla
```

Valhalla mmaps the tile set, so its resident memory tracks the tiles actually
touched rather than the size of the extract — which is the whole reason it and
not OSRM on a 16 GB host. Nominatim imports the same `.pbf` into PostgreSQL the
first time it starts, which is its own long wait and happens once.

The planner then takes these settings:

| Variable                         | Value                   | Required                    |
| -------------------------------- | ----------------------- | --------------------------- |
| `GROUNDING_PROVIDER`             | `valhalla`              | yes                         |
| `VALHALLA_URL`                   | `http://valhalla:8002`  | yes                         |
| `GEOCODER_URL`                   | `http://nominatim:8080` | yes                         |
| `OVERPASS_URL`                   | `http://overpass`       | no — discovery is off unset |
| `GROUNDING_DISCOVERY_TIMEOUT_MS` | `30000` (the default)   | no                          |

**Point `OVERPASS_URL` at your own instance, not at `overpass-api.de`.** pl-33
measured the public one with the query this adapter actually sends: 28.7 s for
Montréal→Québec City and **149 s** for Montréal→Percé, the example the corridor
feature exists for. It is a shared free service being asked for a 950 km
polyline query, and no client-side timeout fixes that — which is the same
objection that ruled out a metered router and a public geocoder above.

`GROUNDING_DISCOVERY_TIMEOUT_MS` is separate from `GROUNDING_TIMEOUT_MS` for
that reason: 5 s is right for a routing matrix and was never right for a
corridor search, and one number for both meant discovery could not have
succeeded once. Raise it only if your own instance is slower than the 30 s
default; if it is, the extract is probably larger than the region you plan in.

Those are compose service names on the fragment's private network. Neither
service is published to a host port, and neither URL goes through the SSRF
guard: this is an address the deployment wrote down, not one a stranger handed
us. If a fetch to a LAN address ever needs `allowPrivateAddresses` to work, the
answer is that the guard does not belong on that call —
[pl-26](../tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md) is the long
version.

Confirm it took, on the host:

```bash
curl -sS http://127.0.0.1:8090/api/health | jq .grounding   # {"provider":"valhalla"}
```

That is the whole of what health says about it. The name, never the endpoint —
the route is unauthenticated, and a self-hosted address is infrastructure
detail.

### 4 — Refreshing it, later

OSM changes; a graph built today is a snapshot. Re-running the build is the
same one command with `VALHALLA_FORCE_REBUILD=True`, against a freshly
downloaded extract:

```bash
VALHALLA_FORCE_REBUILD=True docker compose -f compose.planner.yaml \
  --profile tiles run --rm valhalla-tiles
docker compose -f compose.planner.yaml restart valhalla
```

**Do not automate this.** It is hours of CPU for a change measured in months,
and an automatic rebuild is a service that is periodically unavailable for
reasons nobody remembers. Once or twice a year, deliberately, is the right
cadence — and it is worth doing after a road opens that a plan got wrong,
because that is the moment somebody actually cares.

**The cache in front of it is unaffected and that is the point.** A distance is
good for a year and `grounding_cache` keeps it for six months, so a rebuild does
not invalidate anything: rows age out on their own schedule and the new graph
answers the next question. Nothing needs flushing, and flushing it by hand only
buys re-measuring roads that did not move.

**Two things a stale graph does that look like bugs.** A road that opened since
the build is not routable, so a leg through it comes back unmeasured and the
plan names it as a gap — honest, and confusing if you know the road is there.
And a place that has only existed in OSM for a few months does not geocode, so
its coordinates stay null and every leg touching it goes unmeasured. Both are
the same fix and it is this section.

### Neither image is pinned to anything this repo has run

`compose.planner.yaml` names both by tag with a default, and **neither was
pulled when it was written** — pl-28 was built in an environment with no Docker
and no route to a registry. Verify the tags against the projects' own release
pages before a first deployment and pin them in `.env`, the way
`cloudflared:latest` in `compose.prod.yaml` still needs doing. The `healthcheck`
on `valhalla` is the other thing to check early: it shells out to `curl`, and
whether that image ships one is exactly the sort of thing that shows up as a
container that answers fine by hand and reports unhealthy anyway.

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
