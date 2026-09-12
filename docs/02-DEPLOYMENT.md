# Deployment — a public subdomain on a home host

How to put a tool from this repo on `<tool>.example.com` from a machine sitting
behind a domestic router, with authentication in front of it.

The container half is a set of compose fragments merged on the host —
[`compose.prod.yaml`](../compose.prod.yaml) for the tunnel and the network, plus
one pair per tool, listed under
[`## What the host merges`](#what-the-host-merges). The half that cannot be a
file in this repo — the hostname, the certificate, the login policy — lives in
the Cloudflare dashboard, and is written out below so it is reviewable even
though it is not version controlled.

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
- A checkout of this repo on the host, for the compose fragments and `.env`.
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

## 2 and 4, in one command

Steps 2 and 4 are the two that are pure Cloudflare, and they are also
[`scripts/cloudflare-setup.mjs`](../scripts/cloudflare-setup.mjs) — both tools at
once, from a checkout, with no dashboard:

```bash
CLOUDFLARE_API_TOKEN=… node scripts/cloudflare-setup.mjs \
  --domain example.com --email you@example.com --tunnel <the tunnel's name>
```

That prints a plan and writes nothing. `--apply` makes the changes. It is
idempotent — a second run reports `nothing to do` — so it is also the way to
check a host still matches what this page describes.

The token wants exactly three permissions, and one of them is per-zone:

| Scope   | Permission                | Access |
| ------- | ------------------------- | ------ |
| Account | Cloudflare Tunnel         | Edit   |
| Account | Access: Apps and Policies | Edit   |
| Zone    | DNS                       | Edit   |

**A token made on the dashboard's _Account API tokens_ page is account-owned**,
which is now the default, and an account-owned token is not a user token: it
answers `401 Invalid API Token` at `/user/tokens/verify` while being perfectly
valid. The script verifies against the account when it knows one, which is why
`--account` exists beside `--zone`. Both ids are on the domain's Overview page,
and passing them also covers a token without `Zone → Read` — a correct token for
this job, since nothing here needs to _list_ zones.

**It refuses where it cannot be sure, and it never deletes.** The ingress call
replaces the tunnel's entire rule list, so adding a tool means writing every
other tool's rule back out; a hostname already routed somewhere else stops the
run with a conflict rather than being rewritten, and so does a DNS name that
exists as something other than this tunnel's CNAME. Widening or removing an
Access policy stays a dashboard decision — see
[When you want it genuinely public](#when-you-want-it-genuinely-public).

**Access applications are created before the routing**, on purpose. Ingress plus
a proxied record is what makes a hostname answer; the Access application is what
makes it ask for a login. In that order the endpoint would be live and open for
as long as the remaining calls take, which on a host whose `cloudflared` is
already connected is real exposure. Inverted, the worst case is a policy
guarding a name that does not resolve yet.

**Read step 4 before running it either way.** The script encodes which tool gets
a Bypass rule and which must never have one; the argument for that is below, and
it is not a preference.

---

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

`downloader:8080` is the service name from `compose.downloader.yaml` resolved on the
compose network, which is why `cloudflared` has to share that network and does.
`HTTP`, not `HTTPS`: the leg from `cloudflared` to the container never leaves
the host, and giving it its own certificate would mean managing one to protect a
hop that already cannot be observed.

Cloudflare creates the proxied DNS record itself. Do not add one by hand.

## 3 — Bring it up

Set the two lines in `.env` that say which image to run — `GHCR_OWNER`, and
`DOWNLOADER_TAG` at a released version — then:

```bash
docker compose pull
docker compose up -d
docker compose logs -f cloudflared
```

No `-f` flags, because `.env.prod.example` ships `COMPOSE_FILE` naming the
downloader's three fragments and you copied it in step 1. If you wrote your own
`.env`, that line is
`COMPOSE_FILE=compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml`,
and every command below assumes it — spelled out, each is
`docker compose -f compose.downloader.yaml -f compose.prod.yaml -f compose.downloader.prod.yaml ...`.

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
authentication. No compose fragment changes. Until that exists, this
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
bucket — safe, but one busy user throttles everyone.
`compose.downloader.prod.yaml` sets it to the `edge` subnet that
`compose.prod.yaml` pins, which is why that subnet is fixed rather than
auto-allocated. `compose.planner.prod.yaml` names the same one for the same
reason. Set it to `true` instead and any client can name its own bucket
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
`compose.downloader.yaml` assume a single trusted user on a laptop:

- `RATE_LIMIT_PROBE_PER_MINUTE` / `RATE_LIMIT_JOBS_PER_MINUTE` /
  `RATE_LIMIT_PROBE_EVENTS_PER_MINUTE` — per client, and meaningful now that
  `TRUST_PROXY` makes "client" mean the right thing. The third is the SSE
  channel that narrates an analysis, and it defaults to the same number as the
  probe because the two are used one-for-one; subscribing is what creates a
  channel, so without it one client could fill the hub and leave every other
  user's analysis silent (dl-46).
- `RATE_LIMIT_FILES_PER_MINUTE` — per **file token**, not per client, so it does
  not depend on `TRUST_PROXY` and one leaked link cannot buy itself more
  allowance by being fetched from more addresses. Its default is 600 because a
  `<video>` element pointed at a download link issues one open-ended `Range`
  request per seek: dl-23 measured 207–274 requests a minute from an ordinary
  scrub-bar drag. Lower it only if you know nobody plays these links in a
  browser; 0 turns it off.
- `RATE_LIMIT_THUMBNAIL_PER_MINUTE` — per **thumbnail token**, on the same
  reasoning and with the same independence from `TRUST_PROXY`. Its default is 60
  because the client is an `<img>` rather than a player: one request per result
  panel, and the response is `private, max-age=300`.
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
docker compose pull
docker compose up -d
```

Rolling back is the same three commands with the previous version in `.env`, and
takes as long as a pull. Which versions exist, and how one gets cut, are in
[03-RELEASING.md](./03-RELEASING.md).

The `/data` volume carries the job database and any file still inside its
retention window across the restart. Jobs that were mid-download are failed
honestly at boot rather than left showing a progress bar that will never move.

For LAN access alongside the public hostname — worth it for multi-gigabyte files
when you are at home — republish the port on all interfaces in a local override
rather than editing `compose.downloader.yaml`, which deliberately binds to
loopback.

## Migrating the volumes onto the project name

**Read this before your first `up -d` after pulling repo-33, and do not skip it
on the grounds that the diff looks like a rename.** It is a rename _and_ a
migration, and the migration is the half that is not in the diff.

Every fragment now sets `name: webtools`. Before repo-33 the downloader's
fragments set no `name:` at all, so compose derived the project name from the
basename of the directory you cloned into — `tools`, or `webtools-main`, or
whatever the tarball unpacked as. Volumes are named `<project>_<volume>`, so
this host's job database and its downloaded files are in **`<basename>_storage`**
and the new project will look for `webtools_storage`, which does not exist.

Nothing is lost when that happens. The stack comes up looking like a fresh
install — an empty job list, no files — with the real data still on disk under a
name nothing references. It is recoverable at any point by doing this section.

**`docker compose down -v` is the command that makes it unrecoverable**, and it
is plausible to type while a half-renamed stack is behaving oddly. Every `down`
below is deliberately without `-v`. The old volume is **kept**, not removed:
deleting it is a separate act for once the new one is proven.

**The planner's grounding volumes do not need this.**
[`compose.planner.yaml`](../compose.planner.yaml) has set `name: webtools` since
it was written, so `valhalla_tiles`, `nominatim_data` and `overpass_db` are
already under that project — which is exactly why merging it with the old
`compose.yaml` was forbidden. What moves is `storage` (the downloader) and, on a
host that was already running the planner's released image, `planner_storage`.

**If this host runs both tools, it moves both volumes, and the steps below are
not a subset you can take the first half of.** That configuration was the
documented one — `-f compose.yaml -f compose.prod.yaml -f compose.planner.prod.yaml up -d`
— and none of those three files set a `name:`, so both tools' volumes are under
the same basename-derived project. Steps 2, 3 and 5 each say what changes; the
one that bites is step 2, because a `down` over a partial file set leaves the
other tool's container **running**, and step 4 then copies a database out from
under a live process.

### 1 — Find the name the volumes are actually under

Before pulling, on the host, with the old checkout still in place:

```bash
docker compose ls                       # the project name this host runs under
docker volume ls | grep -E '_storage$'      # ..._storage and ..._planner_storage
```

`docker volume ls` is the one to trust: it is the on-disk truth rather than a
derivation. Note the prefix — everything below calls it `$OLD`.

```bash
OLD=<the prefix you just read>          # e.g. tools, webtools-main
```

### 2 — Stop the stack, without `-v`

**Name every file this host runs, not just the downloader's.** The old commands
still work until you pull:

```bash
# a downloader-only host
docker compose -f compose.yaml -f compose.prod.yaml down

# a host running both tools — the third `-f` is the one that matters
docker compose -f compose.yaml -f compose.prod.yaml \
               -f compose.planner.prod.yaml down
```

Stopped rather than running, because copying a SQLite database out from under a
process that has it open copies a torn one — and `down` only stops the services
**in the file set you gave it**. A container from the same project that is not
in that set is an orphan to this invocation and is left running; `down --help`
lists `--remove-orphans` for exactly that reason, and it is not the flag you
want here, because it removes the container rather than shutting the service
down as part of the stack. Naming the files is.

Check it actually stopped before going on — this should print nothing:

```bash
docker ps --filter "label=com.docker.compose.project=${OLD}" --format '{{.Names}}'
```

### 3 — Pull, and set `COMPOSE_FILE`

Then update `.env` so it carries the fragment list — copy the `COMPOSE_FILE`
line out of `.env.prod.example`, keeping your own `TUNNEL_TOKEN`, `GHCR_OWNER`
and `DOWNLOADER_TAG`:

```bash
# a downloader-only host
COMPOSE_FILE=compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml

# both tools — and keep PLANNER_TAG
COMPOSE_FILE=compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml:compose.planner.prod.yaml
```

Check that compose agrees about the name, and about the service list, before
anything starts:

```bash
docker compose config --format json | jq -r .name     # expect: webtools
docker compose config --services                      # expect the tools you run
```

### 4 — Copy the volume

`docker volume` has no rename, so this is create-and-copy. A throwaway container
with both volumes mounted is the whole mechanism:

```bash
docker volume create webtools_storage
docker run --rm \
  -v "${OLD}_storage:/from:ro" \
  -v webtools_storage:/to \
  alpine:3 sh -c 'cp -a /from/. /to/'
```

`cp -a` rather than `cp -r`: it preserves ownership and timestamps, and the
container runs as a non-root user, so a copy that resets ownership gives you a
`/data` the service cannot write. The `.` in `/from/.` is what copies dotfiles
too. `:ro` on the source is deliberate — the old volume is the backup until the
new one is proven, and a typo in this command should not be able to touch it.

On a host running both tools, the same again for the planner's database — the
one step 2 had to stop it to make safe:

```bash
docker volume create webtools_planner_storage
docker run --rm \
  -v "${OLD}_planner_storage:/from:ro" \
  -v webtools_planner_storage:/to \
  alpine:3 sh -c 'cp -a /from/. /to/'
```

### 5 — Check the copy before starting anything

```bash
docker run --rm -v "${OLD}_storage:/old:ro" -v webtools_storage:/new alpine:3 \
  sh -c 'du -sb /old /new; find /old -type f | wc -l; find /new -type f | wc -l'
```

and, on a host that copied the planner's database too, **the same check again —
this is not optional, it is the one that catches a planner left running through
step 2**:

```bash
docker run --rm -v "${OLD}_planner_storage:/old:ro" \
  -v webtools_planner_storage:/new alpine:3 \
  sh -c 'du -sb /old /new; find /old -type f | wc -l; find /new -type f | wc -l'
```

Two identical byte counts and two identical file counts, each time. `jobs.db`
should be in the downloader's listing and `planner.db` in the planner's; if
either pair of byte totals differs by a few kilobytes, a `-wal` file was copied
from a stack that was not fully stopped — go back to step 2, and re-read which
files it says to name.

### 6 — Bring it up and look at the data, in every tool this host runs

```bash
docker compose up -d
docker compose logs -f cloudflared
docker compose ps                       # every service you expected, and no more
```

Then open the UI. **The check that matters is data you recognise, not
`/api/health`** — health answers perfectly against an empty database, which is
the exact failure this whole section exists to prevent, and it answers that way
in both tools.

- **downloader** — old jobs present in the list, and a file still inside its
  retention window still downloadable.
- **planner**, if this host runs it — old plans present. `/api/health` answering
  and the UI rendering prove neither: an empty `planner.db` looks exactly like a
  working fresh install.

If either one comes up empty, **do not run step 7**. Nothing is lost: the old
volume still holds the data, and going back is step 2 followed by a re-copy.

### 7 — Later, and deliberately, remove the old volume

Once you have seen the data through the UI — **every tool, per step 6** — and
are not planning to roll back:

```bash
docker volume rm "${OLD}_storage"
docker volume rm "${OLD}_planner_storage"    # only if this host runs the planner
```

Not before, and not on the strength of a stack that merely started. Rolling back to a previous `DOWNLOADER_TAG` is a `pull` away, but
rolling back the _project name_ means putting the old compose files back, and
the old volume is what makes that free.

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

**The tunnel does not change, and neither does anything above.** One tunnel per
host, one subdomain per tool — which is why step 1 says to name the tunnel after
the machine and not after the downloader. What follows is a delta on the
walkthrough above, and the only step in it that is genuinely new work is the
Access application.

### What the host merges

A host says which tools it runs by the list of files it merges, and nothing
else. [adr/004](./adr/004-one-compose-fragment-per-tool.md) is why:

That list is `COMPOSE_FILE` in `.env`. Written out as `-f` flags, the three
that mean something:

```bash
# the downloader alone — what a downloader-only host runs
docker compose -f compose.downloader.yaml -f compose.prod.yaml \
               -f compose.downloader.prod.yaml up -d

# both tools, one tunnel
docker compose -f compose.downloader.yaml -f compose.prod.yaml \
               -f compose.downloader.prod.yaml -f compose.planner.prod.yaml up -d

# the planner alone, which is now something a host can say
docker compose -f compose.prod.yaml -f compose.planner.prod.yaml up -d
```

and as the `COMPOSE_FILE` lines that replace them:

```bash
COMPOSE_FILE=compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml
COMPOSE_FILE=compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml:compose.planner.prod.yaml
COMPOSE_FILE=compose.prod.yaml:compose.planner.prod.yaml
```

**[`compose.prod.yaml`](../compose.prod.yaml) names no tool**, and that is the
property the whole arrangement exists for. It carries `cloudflared` and the
`edge` network and nothing else; each tool's released image, its `TRUST_PROXY`
and its entry in `cloudflared`'s `depends_on` live in
`compose.<tool>.prod.yaml`. A `planner:` block in the shared overlay would be a
service definition — an image and a network are enough to start one — so a
downloader-only host merging it would stand up the planner without ever asking
for it. The third line above is what that buys: a host that runs the planner and
not the downloader, which was not expressible while the shared overlay still
carried the downloader's image.

[`compose.planner.prod.yaml`](../compose.planner.prod.yaml) is additive in the
same way its opposite number is: it adds the `planner` service on the `edge`
network and adds `planner` to `cloudflared`'s `depends_on`, and it changes
nothing a host that does not merge it sees.

**Every fragment sets `name: webtools`**, so any merge of them is one compose
project — including [`compose.planner.yaml`](../compose.planner.yaml), which is
why merging the grounding fragment with the downloader's is now an ordinary
thing to do. It was not before
[repo-33](./work/repo-33-adr-004-rename-and-the-project-name.md): the old
`compose.yaml` set no name, so it took the basename of the host's clone
directory while the grounding fragment said `webtools`, and the two were
different compose projects. **If this host has been running from a directory not
called `webtools`, read
[`## Migrating the volumes onto the project name`](#migrating-the-volumes-onto-the-project-name)
before your next `up -d`.**

### 1 — Name the version

In `.env` on the host, beside the `DOWNLOADER_TAG` already there:

```bash
PLANNER_TAG=0.4.0     # an exact version, never `latest` — same argument as the downloader's
```

The two tools release independently, so these are unrelated numbers. Leaving
`PLANNER_TAG` empty while merging the fragment refuses the boot with a message
naming the variable, rather than starting something on a tag nobody chose.

### 2 — Route the hostname

`scripts/cloudflare-setup.mjs` already knows about both tools, so if you ran it
for the downloader there is nothing to do here — it adds the planner's hostname
and its Access application in the same run, and reports the downloader's as
`ok`. By hand instead: same tunnel, **Public Hostnames → Add a public
hostname**:

| Field     | Value          |
| --------- | -------------- |
| Subdomain | `planner`      |
| Domain    | your domain    |
| Path      | _(empty)_      |
| Type      | `HTTP`         |
| URL       | `planner:8090` |

`8090`, not `8080`: the downloader's API defaults there and both tools run on
this machine. Cloudflare creates the proxied DNS record itself.

**Leave `Path` empty, and do not try to put both tools on one hostname under
`/downloader` and `/planner`.** The Path field matches; it does not strip, so
the origin receives the prefix it cannot serve. Making that work is a change in
both tools rather than a routing setting: each mounts its bundle at the root
(`prefix: "/"` in both `api/src/routes/web.ts` files) and neither `vite.config.ts`
sets `base`, so the document would ask for `/assets/…` at the apex and the two
tools would collide there. A subdomain each costs nothing and is what the rest
of this page assumes.

### 3 — Its own Access application, which is not a copy of the downloader's

**Access → Applications → Add an application → Self-hosted**, subdomain
`planner`, path empty, one policy: action **Allow**, include **Emails** → your
address.

**That is the whole application. Do not add a Bypass rule.** Three differences
from the downloader's, and the first is not a hardening preference:

- **No Bypass rule.** The one on `/api/files/*` above is bought by a 256-bit
  capability token, and [`jobs/tokens.ts`](../tools/downloader/api/src/jobs/tokens.ts)
  is the argument for why that token can stand alone. `planner` has no
  capability tokens, so nothing in it is safe to serve unauthenticated.
- **`planner` has no owner model at all.** Migration 1 in
  [`db/schema.ts`](../tools/planner/api/src/db/schema.ts) is
  `conversations (id, title, created_at, updated_at)` — no user column — and
  `Conversation` in the contract has no user field either. Every visitor
  therefore shares one conversation store and can read and edit everyone's
  plans. For the downloader, an open instance costs bandwidth; here there is no
  privacy boundary to lose, because there is not one yet. Until a user model
  lands, an Access allowlist is not a precaution around the data model — it is
  the only configuration in which that model is coherent.
- **`MODEL_PROVIDER` defaults to `scripted`.** A deployment that does not set it
  looks healthy and answers from a fixed script. It is set explicitly in the
  image and again in the fragment, and `/api/health` reports `agent.provider` —
  but set it deliberately rather than relying on someone reading a health
  payload.

Rate limiting is per-client the same way the downloader's is: `RATE_LIMIT_RUNS_PER_MINUTE`
(default 5, on `POST /api/plans`) is keyed on `request.ip`, and
[`compose.planner.prod.yaml`](../compose.planner.prod.yaml) sets `TRUST_PROXY` to
the same `edge` subnet the downloader's line names, so behind `cloudflared` that
means the visitor rather than the tunnel. Until pl-38 it did not —
`ApiConfig` had no trust field at all, so every client shared one five-per-minute
bucket for the whole hostname, and an Access allowlist with one email on it was
the only thing hiding that. See that ticket's Log if `TRUST_PROXY` is ever
missing from the fragment again: this matters more once `MODEL_PROVIDER` is
something other than `scripted`, because then an unauthenticated endpoint is a
stranger spending your token budget, with `MAX_OUTPUT_TOKENS` capping one reply
and nothing capping the number of replies.

### 4 — Bring it up, and check the right thing

Add `compose.planner.prod.yaml` to `COMPOSE_FILE` in `.env` — see
[`## What the host merges`](#what-the-host-merges) — then:

```bash
docker compose pull
docker compose up -d
```

This pull is short — the planner's image is a plain Node base, not the
downloader's Playwright one. `cloudflared` now waits on **both** services'
health checks before it registers, so the tunnel comes up a little later than it
used to and a restart no longer publishes either hostname early.

```bash
curl -sS https://planner.example.com/api/health           # expect an Access login page
curl -sS http://127.0.0.1:8090/api/health | jq            # on the host: real JSON
curl -sS http://127.0.0.1:8090/api/health | jq .grounding # {"provider":"fixtures"} until you do the section above
```

The first returning HTML rather than JSON is the good outcome — it means Access
is enforcing.

Then drive one intake end to end in the browser. `/api/health` answering is not
evidence the UI is served: pl-2 shipped an image whose bundle was never handed
out, and the CI gate asked only for `/api/health`, which answered perfectly
throughout. That gate now greps the document for the bundle's root element, and
this is the deployed equivalent of the same check.

### It has its own image, and had to

The downloader's is built on Playwright's base and installs ffmpeg and yt-dlp;
`planner` needs neither, so
[`tools/planner/Dockerfile`](../tools/planner/Dockerfile) is a plain Node base
and a twentieth of the size. That is why each tool owns its Dockerfile, the way
the slow CI gates already live in `.github/workflows/<tool>.yml`. Both are
published to GHCR by the release pipeline — see
[03-RELEASING.md](./03-RELEASING.md).

Two things to expect a little further out. A real model provider means outbound
egress and, on a hosted API, a key — `.env.prod.example` grows past
`TUNNEL_TOKEN`, or a local model joins the compose network instead. And
streaming replies, which
[`agent/src/provider.ts`](../tools/planner/agent/src/provider.ts) says are
coming, will meet Cloudflare's 100-second idle timeout: the downloader survives
it only because of the 15-second heartbeat in `routes/events.ts`, and `planner`
will need the same thing built in with the streaming rather than diagnosed after
it.
