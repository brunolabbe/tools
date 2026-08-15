# Security

These tools are self-hosted. There is no instance run for you and no service to
attack — a report here is about the code, and the person affected by a bug in it
is whoever chose to deploy it.

## Reporting

**Use GitHub's private vulnerability reporting**: the repository's **Security**
tab → **Report a vulnerability**. That opens a channel only the maintainer can
read, which is the point — a public issue is a disclosure, and it publishes the
bug to everyone running the thing before there is a version to move to.

Do not open a public issue for anything in the list below.

A useful report names the version or commit, says what an attacker gets out of
it, and gives enough of a reproduction to run. Expect a first reply within a
week or so. This is a personal project with no bounty and no on-call, and it is
better to say that plainly than to imply a response time nobody is holding.

Only the most recent release of each tool is fixed. Both are versioned and
released independently — see [docs/03-RELEASING.md](./docs/03-RELEASING.md).

## What is worth reporting

The downloader fetches URLs a client names and runs a real browser to do it, so
its interesting surface is bigger than its size suggests. In rough order of how
much a working report would matter:

- **SSRF guard bypass.** Reaching a private, loopback, link-local or metadata
  address through the service. The guard resolves and vets addresses, re-checks
  after every redirect, and pins the vetted address into the socket to close the
  DNS-rebinding window. A way past any of that is the highest-value report here.
- **Command injection.** Nothing in this repo may invoke a shell; subprocesses
  are spawned with argument arrays and `shell: false`, and a source scan in
  `packages/core/test/spawn-safety.test.ts` enforces it repo-wide. User-supplied
  URLs and titles do reach subprocess arguments, so a way to make one of them
  behave as anything other than an argument matters.
- **Path traversal or arbitrary file read** through the file-serving routes, the
  storage directory, or a media title that becomes a filename.
- **Credential leakage.** Captured request headers routinely carry live session
  cookies, and a signed media URL carries its credential in the query string.
  Both are redacted before logging; a path that logs, stores or returns either
  unredacted is a real bug.
- **Rate-limit bypass**, in particular anything that lets a client choose its own
  bucket by sending a header. `TRUST_PROXY` is off by default for exactly this
  reason, and naming a CIDR rather than `true` is the documented deployment.
- **Container escape or privilege issues** in the published images.

## What is not a vulnerability

Some of these get reported often enough to be worth stating up front.

- **The service fetches URLs that a client supplies.** That is the product, not a
  flaw. The claim worth making is that it reaches somewhere the guard should have
  refused — see the first bullet above.
- **Running it exposed and unauthenticated.** It binds to loopback by default and
  says why; [docs/02-DEPLOYMENT.md](./docs/02-DEPLOYMENT.md) puts it behind a
  tunnel and a login. Choosing to publish it wide open is a deployment decision
  the code already warns about.
- **The absence of DRM circumvention.** Widevine, PlayReady and FairPlay are
  detected and refused by design — the pipeline stops at `DRM_PROTECTED`. This
  boundary is deliberate and is not going to move; reports asking for it past it
  will be closed.
- **Findings from a scanner with no demonstrated impact**, and vulnerable
  dependencies that no code path reaches. Say what the bug does, not what a tool
  named it.
