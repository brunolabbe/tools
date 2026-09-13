---
id: dl-49
tool: downloader
title: Take the login off downloader.oludoi.com, once an anonymous visitor cannot spend the host
kind: work-package
status: ready
milestone: M5
depends_on: [dl-50, dl-51, dl-52, dl-53, dl-54]
difficulty: standard
---

# dl-49 — Open the downloader without a login

**Packages:** none in `tools/downloader` — `scripts/cloudflare-setup.mjs` and its
test, `docs/02-DEPLOYMENT.md`, `SECURITY.md`, and one Cloudflare dashboard change
that only the owner makes.

## Why

**The owner's decision, 2026-09-13: the downloader goes public, and visitors are
not made to log in.** Today `downloader.oludoi.com` sits behind a Cloudflare
Access application that allows one address, with a Bypass on `api/files/*` so
download links stay shareable.

[02-DEPLOYMENT.md](../../../../docs/02-DEPLOYMENT.md) makes the app's own
authentication the precondition for removing that application ("When you want it
genuinely public"). That precondition is the one this decision rejects, so it is
replaced rather than met: the five tickets this depends on are what stands in
for a login. Each answers one way an anonymous visitor could spend the host —
automation ([dl-50](./dl-50-a-human-check-without-an-account.md)), one client
holding every slot ([dl-51](./dl-51-one-client-holds-every-job-slot.md)),
limits sized for one trusted user
([dl-52](./dl-52-limits-for-anonymous-traffic.md)), bulk video through the
tunnel ([dl-53](./dl-53-finished-files-and-the-tunnel.md)), and what the
operator owes when someone points it at something they should not
([dl-54](./dl-54-terms-takedown-and-what-is-logged.md)).

**The planner is not part of this.** Its Access application stays. The comment
on `TOOLS` in `scripts/cloudflare-setup.mjs` says why: it has no owner model, so
the allowlist is the only configuration in which its data model is coherent.

## Build

1. **`scripts/cloudflare-setup.mjs`** — drop the downloader's `allow`
   application from `TOOLS`, so a later `--apply` does not recreate the login
   the owner removed. The script never deletes, so it cannot remove the live
   application itself, and it must not learn to: that refusal is argued in its
   header. The `api/files/*` Bypass becomes redundant once nothing is gated;
   decide whether it goes too, and keep `scripts/test/cloudflare-setup.test.ts`
   asserting the downloader's intended shape and the planner's unchanged one.
2. **`docs/02-DEPLOYMENT.md`** — rewrite step 4 and "When you want it genuinely
   public". Step 4 currently says the service "is unsafe without it". It should
   say what makes it safe without a login now (dl-50 through dl-54), and that a
   host that has **not** applied those still needs Access. A reader deploying
   their own copy is the audience.
3. **`SECURITY.md`** opens with "There is no instance run for you and no service
   to attack". That stops being true. Say which instance is public, and that
   reports about it go through the same private channel.
4. **The owner deletes the downloader's Access application** on the dashboard.
   This is outward-facing and hard to take back quietly, so it is the owner's
   action, not an agent's. The ticket's Log records who did it and when.

## Done when

- From outside the host, `curl -sS https://downloader.oludoi.com/api/health`
  returns the API's JSON rather than an Access login page.
- `curl -sS -o /dev/null -w '%{http_code}' https://planner.oludoi.com/` still
  answers `302` to the Access login.
- `node scripts/cloudflare-setup.mjs --domain oludoi.com …` (plan mode) reports
  nothing to do and proposes no downloader `allow` application.
- `scripts/test/cloudflare-setup.test.ts` asserts the new downloader shape and
  the unchanged planner shape.
- `docs/02-DEPLOYMENT.md` and `SECURITY.md` no longer say the instance is private
  or that it needs a login.
- `npm run check` and `npm test` are green.

## Log

- 2026-09-13 — Filed with dl-50 through dl-54 as the plan to open the downloader
  without a login. Nothing is built.
