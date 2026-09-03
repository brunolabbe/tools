---
id: dl-32
tool: downloader
title: Decide whether the job list has a caller, then scope it or say it does not
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-32 — `GET /api/jobs` answers everyone with everyone's jobs

## Why

`GET /api/jobs` takes no credential, and there is no session model in this
service to take one from. It answers any caller who can reach the port with
every job in the store — not their jobs, because the concept does not exist.

[dl-23](./dl-23-rate-limit-the-download-route.md) closed the sharpest half of
this while it was next door: the list used to carry `result.downloadUrl`, a live
capability token for a finished file, so one unauthenticated call harvested every
downloadable file at once. That is fixed and tested; the list now returns a
`JobListItem` with the capability stripped, and `GET /api/jobs/:id` keeps it
because reaching that costs an attacker a `randomUUID()` job id.

**What is left is not a capability but a history**, and nobody has decided
whether that is a problem. It was recorded in dl-23's Log as needing its own
ticket rather than folded in, because the fix is not a redaction — it is a trust
model this service has never had.

## The reproduction

Measured against the branch as it stands, through the real Fastify stack, with an
unauthenticated `GET /api/jobs` and no id, token or header supplied. One
completed job returns:

```json
{
  "id": "4bb9f9e5-0e59-4609-8032-e3dd0f8de596",
  "sourceUrl": "https://site.example/watch/42",
  "status": "completed",
  "variant": { "url": "https://cdn.example/master.m3u8", "label": "1080p · H.264 + AAC", "…": "…" },
  "result": { "filename": "video.mp4", "sizeBytes": 27, "durationSec": 120, "expiresAt": "…" },
  "createdAt": "…",
  "updatedAt": "…",
  "finishedAt": "…",
  "attempts": 1,
  "progress": { "…": "…" }
}
```

Three things in there are worth naming separately, because they are not equally
bad:

1. **`sourceUrl` and `result.filename` are a browsing history.** Every page
   anyone pointed this service at, with a timestamp and a title-derived filename.
   For a single-user laptop deployment that is nothing; for the shared instance
   `docs/02-DEPLOYMENT.md` describes putting behind Cloudflare, it is the whole
   privacy story of every user.
2. **`variant.url` is a media URL, and the contract itself says these carry
   credentials.** `RequestContext`'s note in `contract/src/media.ts` states that
   CDNs "routinely" require "a signed query parameter with a short TTL". The
   field's _presence_ in the list response is measured above; whether a given
   deployment's variants are signed is not, and depends entirely on the origin.
   Where they are, this is a second credential leaving by the same door dl-23
   just closed — and unlike the download token it is one `redactUrl` was
   literally written for.
3. **`error` can carry a payload with `details`.** Bounded by the allowlist in
   `http-errors.ts`, so this is the least of the three, but it is caller-visible
   diagnostic text about someone else's failure.

## The decision this ticket exists to force

**Do not build first.** There is no session, no user, no ownership column and no
notion of "caller" anywhere in the service, so every option below is a different
answer to a question that has never been asked, not a different implementation of
an agreed one. **This is the user's call, and it is deliberately not ranked here**
— the right answer depends on how the thing is actually deployed, which the code
cannot tell you.

**Option A — say it is single-trust-boundary, and write that down.**
The service is one user's tool on one machine; anyone who can reach the port is
that user. Close this with a documented invariant in `01-ARCHITECTURE.md` and a
sentence in `docs/02-DEPLOYMENT.md` saying the API must never be exposed without
an authenticating proxy in front of it.
_Cost:_ no code. But `docs/02-DEPLOYMENT.md` already contemplates a shared
instance behind Cloudflare with `TRUST_PROXY` set, so this option requires either
retracting that or bounding it explicitly. It also makes every future
"just expose the API" a footgun with only prose guarding it.

**Option B — scope the list to a caller identity supplied by a proxy.**
Trust an authenticated header (`X-Forwarded-User` or similar) from a proxy the
operator already runs, store it on the job, filter the list by it.
_Cost:_ a schema migration on `jobs`, a config knob for the header name, and a
hard dependency on `trustProxy` being set correctly — with the failure mode that
an unset or misconfigured proxy silently makes every job belong to one caller.
It is the cheapest option that produces real scoping, and the easiest to
misconfigure into a false sense of one.

**Option C — give the service a real session.**
A first-class notion of a user, an owning session on every job, and the list
filtered by it.
_Cost:_ by far the largest, and it puts a login in front of a tool whose entire
appeal is that it has none. It also makes the file token redundant, which is
either a simplification or a rewrite depending on how it lands.

**Option D — remove the list route.**
Nothing in the UI calls `listJobs` today — measured during dl-23 — so deleting it
costs the product nothing and closes the exposure entirely.
_Cost:_ it removes a debugging affordance and an obvious future feature, and it
is the only option that is hard to reverse cheaply, because the client interface,
its mock and its tests all go with it.

## Build

Nothing until the decision above is answered. Then the work is whatever that
answer implies, and this ticket should be rewritten as a brief for it — the
options are not equal-sized and pretending they share a Build section would be
dishonest.

Traps worth knowing whichever way it goes:

- **`trustProxy` is off by default and that is load-bearing.** See the note on
  `ApiConfig.trustProxy`. Option B turns a header a client can forge into an
  identity, so it depends on that flag being right in a way nothing else in the
  service does.
- **`GET /api/jobs/:id` is the same exposure at retail.** Anything decided for
  the list has to be decided for the single read too, or scoping the list just
  moves the enumeration behind a `randomUUID()`. dl-23 accepted that trade
  deliberately for the _capability_; it is not obviously the right trade for the
  _history_.
- **The SSE stream at `/api/jobs/:id/events` is a third door**, and it carries a
  full `JobResult` including `downloadUrl` on the `completed` frame — which is
  correct and load-bearing, since it is how the UI learns its link.

## Done when

1. The decision above is recorded — as an ADR if it binds the architecture, or as
   an amendment to this ticket if it does not — naming which option was taken and
   why the others were not.
2. Whatever that option implies is built and tested, or the ticket is closed
   `dropped` with the reasoning if the answer is "no change".
3. If any code lands: a test proves an unauthenticated `GET /api/jobs` no longer
   returns a job it should not, through the real stack rather than at the client.

## Log

- **2026-08-31** — Filed from dl-23's gate D, at the user's request. dl-23 closed
  the capability half of this (the list no longer carries `result.downloadUrl`)
  and deliberately left the rest, because redacting a token is a fix and deciding
  who may read a history is not. The reproduction above was measured on dl-23's
  branch rather than reasoned about; `variant.url`'s _presence_ is measured and
  its credential-bearing _content_ is the contract's own claim, not something
  this session observed.
