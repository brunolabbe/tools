---
id: pl-2
tool: planner
title: Ship the planner as a released image on its own subdomain
kind: chore
status: done
milestone: null
depends_on: [dl-10]
difficulty: standard
---

# pl-2 — A released image, and a hostname to serve it from

**Packages:** none. `tools/planner/Dockerfile`, `.github/workflows/planner.yml`,
`compose.prod.yaml`, and the Cloudflare half that cannot live in this repo.

## Why

[dl-10](../../../downloader/docs/work/dl-10-release-pipeline.md) built the
release machinery against one tool. This is the second consumer, and the point
of it: if the planner needs anything in `release.yml` changed, the design was
wrong and the generality was imagined rather than earned.

It is also the tool's first artifact. Today the planner exists only as a
`npm run dev:planner` on somebody's laptop.

## Build

1. **`tools/planner/Dockerfile`** — a plain Node base. Explicitly _not_ the
   downloader's: that one is built on Playwright's image and carries Chromium
   and ffmpeg for the browser sniffer, which is two gigabytes this tool would
   never open. Build stage on `node:22-bookworm` because `better-sqlite3` is a
   native addon whose fallback path needs python3, make and g++; runtime on
   `-slim`, same Debian release so the compiled binary meets the glibc it was
   linked against.
2. **`CHAT_PROVIDER=scripted` set explicitly in the image**, although it is also
   the default. An unset value gives a service that boots, reports healthy, and
   answers every question from a fixed script — the right default for a fresh
   clone, the wrong thing to arrive at by omission on a deployed host.
3. **`.github/workflows/planner.yml`** — build the image and wait for
   `/api/health`, path-filtered to this tool and `packages/**`. Started, not
   just built: a native addon crossing build stage to runtime stage fails at the
   first query, not at compile.
4. **A release component** in `release-please-config.json` and a `version.txt`.
5. **A `planner` service in `compose.prod.yaml`**, on the `edge` network, and a
   public hostname pointing at `planner:8090`. The tunnel does not change — one
   tunnel per host, one subdomain per tool.
6. **Its own Cloudflare Access application.** This does not carry over from the
   downloader's and must not be copied.

## Done when

- `docker run` of the published image serves the UI and answers `/api/health`
  with the version that was released.
- A planner-only release builds the planner image and **not** the downloader's.
- `planner.<domain>` serves the UI behind an Access login, and an
  unauthenticated request never reaches the host.

## Traps

**The downloader's Access policy is not a template.** Three differences, and the
first is not a hardening preference:

- **No Bypass rule.** The downloader's on `/api/files/*` is bought by a 256-bit
  capability token. Nothing here is safe to serve unauthenticated.
- **There is no owner model at all.** No table the design proposes carries a user
  column — not migration 1's `conversations`, and not the `intakes` and `answers`
  that supersede it in [pl-7](./pl-7-intake-persistence-and-wizard.md). So every
  visitor shares one store and can read and edit everyone's trips. Until a user
  model lands, an Access allowlist is not a precaution around the data model; it
  is the only configuration in which that model is coherent.
- **Streaming replies will meet Cloudflare's 100-second idle timeout.** The
  downloader survives it only because of the 15-second heartbeat in
  `routes/events.ts`. Build the same thing in with the streaming rather than
  diagnosing it after.

Rate limiting is no longer a difference from the downloader's: this bullet used
to read "No rate limiting and no `TRUST_PROXY`. `ApiConfig` has neither," which
this Traps section carried as fact from 2026-08-14 until now, past both halves
going false under it. `rateLimitRunsPerMinute` landed with pl-16 (`ApiConfig`
at `tools/planner/api/src/config.ts:187`, default 5 at `:247`, read from
`RATE_LIMIT_RUNS_PER_MINUTE` at `:422`, wired into the run queue at
`tools/planner/api/src/server.ts:237`, enforced on `POST /api/plans` by
`routes/plans.ts:56-57`), and
`TRUST_PROXY` landed with [pl-38](./pl-38-the-planner-limiter-shares-one-bucket.md).
The token-budget argument this bullet made still holds — an open endpoint is
still a stranger spending `MAX_OUTPUT_TOKENS`'s budget once `MODEL_PROVIDER` is
real — it is just no longer this ticket's gap to name.

## Review

**Gate: PASS** — 2026-09-08 · `4fad5f8...f82a77c` · reviewed on a different model
from the one that wrote the branch, in its own worktree.

| Done when                                                                                                      | Proof                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker run` of the published image serves the UI and answers `/api/health` with the released version          | **out of this diff's scope** — closed by pl-13 and gated by `.github/workflows/planner.yml`; no code changed here that could regress it, and it was not re-run |
| A planner-only release builds the planner image and not the downloader's                                       | **out of this diff's scope** — closed by steps 1–4 with dl-10; unrelated files                                                                                 |
| `planner.<domain>` serves the UI behind an Access login, and an unauthenticated request never reaches the host | **not provable from a repository**, and left open rather than dodged — the Log entry below says why `in-flight` is the honest state                            |

- **premise, verified** · The branch's whole claim is that the new fragment is
  additive. The reviewer ran `docker compose config` over both merges rather
  than trusting the Log, and diffed them: `downloader`, `cloudflared`'s existing
  `depends_on.downloader`, the `edge` subnet, `TRUST_PROXY` and the `storage`
  volume are byte-identical. `cloudflared.depends_on` merges as a key union —
  `planner` joins `downloader`, it does not replace it. A downloader-only host
  is untouched.
- **verified** · repo-33's measurement reproduced independently: the project
  name resolved to the reviewer's own worktree basename, not to the builder's.
  Same mechanism, different string, which is the right thing to see.
- **verified** · `tools/planner/Dockerfile:136` "HEALTHCHECK" — so
  `cloudflared`'s `condition: service_healthy` on the planner is satisfiable
  rather than a config error at boot.
- **verified** · the internal half of the "one hostname, two paths" argument:
  `tools/downloader/api/src/routes/web.ts:147` "prefix:" and
  `tools/planner/api/src/routes/web.ts:65` "prefix:" both mount at the root, and
  neither `vite.config.ts` sets `base`.
- **unverified, external** · that Cloudflare Tunnel's Path field matches without
  stripping. `WebFetch` is blocked by the container firewall and the reviewer
  had no `WebSearch`. Recorded as unverified rather than accepted: the page's
  conclusion does not depend on it, because both bundles collide at `/assets/…`
  under any prefix behaviour.
- **low, fixed on this branch** · Both the new fragment and a paragraph of
  `02-DEPLOYMENT.md` inherited from `main` said the planner has no rate limiter.
  It has one — `RATE_LIMIT_RUNS_PER_MINUTE`, default 5, on `POST /api/plans`.
  What it has not got is `trustProxy`, so behind `cloudflared` every client
  shares one bucket for the whole hostname. Confirmed by hand before acting on
  it. Both texts now say that, and the defect is
  [pl-38](./pl-38-the-planner-limiter-shares-one-bucket.md) rather than a
  sentence nobody can act on. The reviewer proposed this and did not do it.
- NFR · security: the finding above, and no new attack surface — this diff
  touches compose, docs and tickets, no code. reliability: `cloudflared` waits on
  both health checks before publishing either hostname, verified in the merged
  config rather than asserted. performance: n/a.

### Gate on the Cloudflare-setup script (0ca4d87)

**Gate: CONCERNS, all three findings repaired on the branch** — 2026-09-12 ·
`main(8d79d8e)...0ca4d87` · reviewed on a different model from the one that wrote
the branch, in its own worktree. The reviewer mutation-tested the ingress merge,
the apply order and the proxied-flag guard by hand rather than reading them.

The three `Done when` lines are unchanged by this diff and carry the 2026-09-08
gate's verdicts. The third was still open when this gate ran; it closed later the
same day against a running host, and the final Log entry is the measurement.

- **med, fixed on this branch** ·
  `scripts/cloudflare-setup.mjs:15` "never removes a rule it did not add" was
  the claim, and no test held the code to it. Every "foreign" fixture in the suite was `downloader.example.com` —
  which `desiredState` always also wants, since `TOOLS` carries both tools — so
  a narrower regression that keeps only pre-existing rules **also present in
  `desired`**, silently dropping any genuinely third-party hostname sharing the
  tunnel, passed all eleven tests. Reproduced independently before acting on it:
  the mutation is green on the old suite. This is not hypothetical — the account
  this was applied to had exactly such a hostname, sharing the tunnel with
  nothing else of ours.
  `scripts/test/cloudflare-setup.test.ts:63` "const SHARED_TUNNEL = [" is now a
  fixture whose foreign rule is in no tool's table, and `:84` "a hostname belonging to nobody in TOOLS survives the merge"
  plus the rule-count case beside it both go red under the reviewer's mutation.
- **low, fixed on this branch** · Two hostname-less rules in the _existing_
  config: the second was silently dropped, because the merge kept
  `existing.find(isCatchAll)` and discarded the rest — the function removing a
  rule it did not add, in the one place it promised not to.
  `scripts/cloudflare-setup.mjs:104` "if (catchAlls.length > 1)" makes it a
  conflict, so the run refuses and a person decides which was meant.
- **low, fixed on this branch** · A `desired` rule with a falsy hostname
  produced a second catch-all, which matches everything and would swallow the
  tunnel. Unreachable from the CLI — `desiredState` builds every hostname from a
  subdomain and a domain — but `planIngress` is exported and general, so it
  throws instead.
- **found while repairing, not by the gate** · `GET /zones/:id/dns_records`
  read one page of 500 and said nothing at the ceiling. A zone at 500+ could
  have made the plan print `ADD` for a record that already exists on an unread
  page. The API refuses the duplicate, so nothing corrupts — but a plan is a
  document someone approves before `--apply`, and being wrong in it is the
  defect. It now refuses.
- **verified** ·
  `scripts/cloudflare-setup.mjs:230` "export function applyOrder" holds for
  every partial plan the reviewer tried — no access with routing, access with no
  ingress, empty — and inverting it fails
  `scripts/test/cloudflare-setup.test.ts:262` "expect(lastAccess).toBeLessThan(firstRouting)".
- **verified** · `npm run check` and `npm test` exit 0 at the tip. The test file
  is purely additive, so no existing assertion changed meaning.
- **unverified by the reviewer, verified here** · that the script was applied to
  a live account and read back from the API. The reviewer's sandbox has neither
  the credential nor a route to Cloudflare and recorded the Log's claim as
  asserted rather than confirmed, which is the right call from where it sat. It
  was re-run after these repairs and still reports `nothing to do`.
- NFR · security: three exact token permissions, no credential ever printed, no
  shell invoked; Access applications created before any routing write, so the
  hostname cannot resolve before its policy exists. reliability: idempotent, and
  refuses rather than overwrites — now including the catch-all case.
  performance: n/a.

## Log

**2026-08-14 — steps 1–4 landed with dl-10.**

The image, its CI gate and the release component are written. `release.yml`
needed **no** change to cover a second tool, which is the thing this ticket
existed to check: the build matrix is `paths_released` resolved at runtime, so
the planner joined by adding a component, a `version.txt` and a Dockerfile.

Not done, and deliberately not bundled: steps 5 and 6. The compose service and
the Access application are deployment decisions with a Cloudflare-dashboard half
that no file in this repo can hold, and the tool has no user model yet — see the
first trap. The image is published and runnable; nothing points a hostname at it.

Unverified: no Docker in the dev container, so the image has not been built
locally. `planner.yml` is the first real build.

**2026-08-14 — the env var in step 2 is now `MODEL_PROVIDER`.** Renamed by
[pl-8](./pl-8-model-provider-seam.md) along with the seam behind it. The brief
above is left saying `CHAT_PROVIDER` because that is what landed; the argument
for setting it explicitly in the image is unchanged, and so is the value. Nothing
that reads it broke, because `scripted` is the default and the fallback both.

**2026-08-16 — the first half of _done when_ is closed, by
[pl-13](./pl-13-drive-the-intake-end-to-end.md).** "`docker run` of the published
image serves the UI" was written as an acceptance and was never true: `WEB_DIR`
was set here in step 2 and parsed in `config.ts`, and `server.ts` registered no
static handler, so the image shipped a bundle it never handed out. Nothing caught
it because the CI gate asked only for `/api/health`, which answered perfectly
throughout — an acceptance criterion that no check was pointed at.

`api/src/routes/web.ts` serves it now, and `planner.yml` asks the running
container for `/` and greps for the bundle's own root element rather than
trusting a 200. **So do not re-verify that half when picking this ticket up** —
it is gated. What is left is genuinely steps 5 and 6: the compose service, the
subdomain and the Access application, all of which still need the user model
argument in the first trap resolved or accepted.

**2026-09-07 — step 5 is done, in a file the brief did not name; step 6 is the
operator's and cannot be done from here.**

**The brief's step 5 is superseded.** It says "a `planner` service in
`compose.prod.yaml`", written 2026-08-14. [adr/004](../../../docs/adr/004-one-compose-fragment-per-tool.md)
was accepted eight days later and calls that specific move "the part that is
easy to get wrong": a `planner:` block in the shared overlay is a service
definition, so a downloader-only host merging `compose.prod.yaml` would stand up
the planner without naming it. The service is therefore in a fragment of its
own, [`compose.planner.prod.yaml`](../../../compose.planner.prod.yaml), and the
host merges three files instead of two.

Verified rather than asserted, with `docker compose config` over both merges —
there is Docker in this environment now, which there was not on 2026-08-14:

- three-file merge — `cloudflared` depends on `downloader` **and** `planner`,
  `planner` is on `edge`, `planner_storage` is added.
- two-file merge — `downloader` and `cloudflared` only, `storage` only. The
  additive claim is the one worth checking and it holds.
- `PLANNER_TAG` unset refuses the boot naming the variable, rather than
  resolving to something nobody chose.

**What ADR 004 asks for and this does not do is the rename**, now filed as
[repo-33](../../../docs/work/repo-33-adr-004-rename-and-the-project-name.md).
It is not a paste: `compose.yaml` sets no `name:`, so the compose project is the
clone's directory basename, and setting the explicit `name:` the ADR requires
renames the project under a running host and orphans the `storage` volume
holding `jobs.db`. That is a migration with a live-data step, and bundling it
with this would have made the diff unreadable at exactly the moment an operator
needs to read it.

**Step 6 is not done and cannot be, from a repository.** The Access application
is a dashboard object. What was owed here was that the four differences from the
downloader's policy stop being a trap paragraph and become the numbered step
somebody follows, and
[02-DEPLOYMENT.md](../../../docs/02-DEPLOYMENT.md)'s `## Adding the second tool`
is now that walkthrough rather than the prose delta it was.

**So this ticket stays `in-flight` on purpose.** Two of its three _Done when_
lines are closed — the image was gated by pl-13, and a planner-only release
builds only the planner. The third is "`planner.<domain>` serves the UI behind an
Access login", which is true of a machine and not of a branch. Whoever brings the
hostname up closes it. Marking it `done` here would be
[repo-32](../../../docs/work/repo-32-done-can-hide-an-outstanding-obligation.md)'s
exact failure with a live unauthenticated endpoint on the other side of it.

One thing the brief got right and is worth restating: the trap about the
downloader's policy not being a template is the most valuable paragraph in this
ticket, and the reason it now appears in the deployment page in full.

**2026-09-08 — the Traps section's rate-limiting bullet corrected, from
pl-38's branch.** "No rate limiting and no `TRUST_PROXY`. `ApiConfig` has
neither" had been true when this section was written on 2026-08-14 and stayed
in the file after both halves stopped being true — rate limiting landed with
pl-16, before pl-38's own gate even started, and the second half closed on
pl-38 itself. The `## Review` section above already reflected the corrected
world (`f82a77c`'s gate ran after pl-16), so the ticket had been contradicting
itself: a Traps bullet asserting a gap forty lines above a Review section that
did not see one. `status` is left `in-flight` — that is a separate, already
recorded question about the third `Done when` line being true of a machine
rather than a branch, and this correction does not touch it. Made from
pl-38's worktree rather than this ticket's own, because pl-2 was not checked
out live at the time; flagged and cleared with the session that had been
holding it before this edit was made.

**2026-09-12 — step 6 is executable now, and running it against a real account
disproved two things this ticket assumed.**

The Cloudflare half was "a dashboard object" and therefore nobody's to automate.
That was wrong: the tunnel configuration, the DNS record the dashboard creates
silently on your behalf, and the Access application are all API v4 calls, and
they are now [`scripts/cloudflare-setup.mjs`](../../../../scripts/cloudflare-setup.mjs)
with `scripts/test/cloudflare-setup.test.ts` behind it. What could not live in
this repo was never the procedure — only the credential.

**Applied to a live account, and read back from the API rather than trusted from
the script's own output.** `planner.<domain>` and `downloader.<domain>` now
carry ingress rules, proxied CNAMEs and an Access application each, with the
downloader's `api/files/*` bypass beside it. A second run reports
`nothing to do`.

**Two assumptions this ticket and 02-DEPLOYMENT.md carried, both false.**

- **"The downloader is already live behind Access" was not true of the account
  it was said of.** There were no Access applications at all — not one, for
  anything — and no `downloader` hostname; what existed was an unrelated
  hostname pointing at a port on the host. The deployment page reads as though
  step 4 has been done once already by the time you reach the second tool, and
  the delta for the second tool inherits that. It does not hold. Everything in
  the plan was a create.
- **An account-owned API token is not a user token.** The dashboard's _Account
  API tokens_ page — now the default path — issues a `cfat`-prefixed token that
  answers `401 1000 Invalid API Token` at `/user/tokens/verify` and verifies
  fine at `/accounts/<id>/tokens/verify`. The script asked the wrong endpoint
  first, so a correct token failed at the only call that could not be skipped,
  with an error indistinguishable from a mistyped secret. `verifyPath` and its
  test exist because of that measurement.

**One defect found by writing it down rather than by running it.** The obvious
order — route the hostname, then put a login on it — leaves the endpoint live
and unauthenticated for the length of the remaining calls, and indefinitely if
one fails. On a host whose `cloudflared` is already connected that is real
exposure, and for the downloader the page is explicit about what an open
instance is for. `applyOrder` creates every Access application first; the test
was watched failing with the order inverted.

**The third _Done when_ is still open, and still for the same reason.** The
Cloudflare side is configured and verified; nothing is served until an operator
brings the stack up with `TUNNEL_TOKEN`, `GHCR_OWNER` and both tags in `.env`.
That is a machine, not a branch. `in-flight` stays.

**repo-33 does not collide with this.** Checked rather than assumed: it renames
the compose _files_ and sets the compose _project_ name, while tunnel ingress
addresses a _service_ on the compose network, which it does not touch. The port
check in this branch's test finds each fragment by the service it defines rather
than by filename, verified by performing the rename in the worktree and watching
the suite stay green. The one shared surface is `02-DEPLOYMENT.md`, in different
sections.

**2026-09-12 — the third _Done when_ closed, and `status` with it.**

The owner brought the stack up, reached `planner.oludoi.com`, was asked for a
one-time PIN and got the UI. That proves the authenticated half. The other half
of that line — "an unauthenticated request never reaches the host" — is not
something a successful login demonstrates, so it was measured separately:

- `planner.<domain>` and `downloader.<domain>`, with no credential, both answer
  `302` to `<team>.cloudflareaccess.com/cdn-cgi/access/login/…`. The redirect is
  issued by the edge, so the request is turned around before the tunnel, which
  is the claim.
- `downloader.<domain>/api/files/<a token that does not exist>` answers **`404`,
  not a redirect**. Two things at once: the Bypass application matches the more
  specific path as intended, and the origin is genuinely serving — a 404 for an
  unknown capability token is the downloader's own answer, not Cloudflare's.
  A hostname that merely resolved could not produce it.

This ticket has been `in-flight` since 2026-08-14 for a reason that was always
about a machine rather than a branch, and it is the reason the previous two
sessions declined to close it. It is closed now because someone ran it, not
because a diff looked finished.

**2026-09-12 — the citation gate caught two things this branch broke, and one of
them was in another ticket.**

The `## Review` section above failed `citations-gate.mjs` with four unanchored
references. They _had_ anchors; `oxfmt` reflowed the markdown and pushed each
quote onto the line after its citation, and the gate reads the pair inline. The
pairs now start their line so reflow cannot separate them. **The lesson is the
verification, not the fix:** `node scripts/citations.mjs <record>` was run and
exited 0, reporting the unanchored ones as informational. The gate's own command
is `--section Review --require-anchors --require-distinct-anchors`, and without
those flags it answers a weaker question than CI asks.

**And three citations in
[pl-38](./pl-38-the-planner-limiter-shares-one-bucket.md) moved because of this
branch**, not because of anything pl-38 did: inserting a section into
`02-DEPLOYMENT.md` shifted the lines its gate record cites. Repointed here,
in the commit that moved them, because a record that cites the wrong line is
worse than one that cites none — it reads as verified.
