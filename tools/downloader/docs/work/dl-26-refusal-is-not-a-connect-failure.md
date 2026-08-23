---
id: dl-26
tool: downloader
title: Say whether the egress proxy refused a fetch or simply could not connect
kind: fix
status: done
milestone: null
depends_on: [dl-11, dl-12]
---

# dl-26 — A refusal and a dead network are not the same log line

## Why

The egress proxy's refusal log is the **only** account a blocked subprocess
fetch has. `egress-proxy.ts`'s own header says why: one proxy serves every
download, nothing in the request identifies the caller, so a client sees a
generic `DOWNLOAD_FAILED` and the reason lives in the log or nowhere.

That log had one message for five call sites, and only two of them were
decisions this service made:

```
{"level":"warn","host":"example.tv:443","code":"INTERNAL","msg":"refused an ffmpeg fetch"}
```

Every word after `host` is wrong in the case that produced it. Nothing refused
anything — the guard had allowed the target and the TCP connect timed out
against a firewall dropping packets. `AppError.from` saw a bare `ETIMEDOUT`,
had no code to map it to and stamped `INTERNAL`; the errno, the one fact worth
having, was dropped on the way. A reader following that line goes to `ssrf.ts`
hunting for the rule that fired, and there is no rule and no bug there.

Nor was it ffmpeg. The fetches were Chromium's, during a browser probe that
never started a job. The message dates from dl-11, when ffmpeg was the only
client this proxy had; dl-12 widened it to the browser and yt-dlp tiers and the
message stayed.

Found in the field: a probe against a host this container's network cannot
reach, timing out at `probeTimeoutMs` and reported as `TIMEOUT`, with these
warnings underneath it looking like the cause.

## Build

1. In `startEgressProxy`, replace `denied` with three named loggers:
   - `refused` — our policy said no. Keeps the `AppError` code, which is
     `BLOCKED_TARGET` or `INVALID_URL` and names the rule.
   - `unreachable` — we allowed it and could not reach it. Logs `errno`,
     `syscall` and `reason` off the `ErrnoException`, and **does not use the
     word refused**.
   - `upstreamRefused` — chained mode, the operator's proxy turned it down.
2. Route the five call sites. The trap: `serverSocket.once("error")` and
   `proxied.once("error")` carry **both** kinds. `createPinningLookup` reports a
   rebind through `callback(error)`, which node surfaces as the socket's `error`
   event — so a `BLOCKED_TARGET` arrives at the same place an `ETIMEDOUT` does.
   Split on `error instanceof AppError`, not on the call site, or the refusal
   that matters most gets filed as a network hiccup.
3. Cover it in `test/egress-proxy.test.ts` with a recording logger.

## Done when

- A policy block logs `refused a subprocess fetch` carrying `BLOCKED_TARGET`.
- An allowed-but-unreachable host logs `a subprocess fetch could not connect`
  with the real `errno`, and no `code` field and no "refused" in the message.
- A rebind caught at connect is still logged as a refusal with
  `BLOCKED_TARGET`, though it arrives through the socket error path.
- No message in this file claims a fetch was ffmpeg's.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

| Acceptance                        | Proven by                                                            |
| --------------------------------- | -------------------------------------------------------------------- |
| Policy block names the rule       | `api/test/egress-proxy.test.ts` — "a policy refusal names the rule"  |
| Unreachable host is not a refusal | `api/test/egress-proxy.test.ts` — "an allowed host we cannot reach"  |
| Rebind at connect stays a refusal | `api/test/egress-proxy.test.ts` — "a rebind caught at connect stays" |
| No message claims ffmpeg          | `api/test/egress-proxy.test.ts` — "no message claims the fetch was"  |
| Gates pass                        | `npm run check`, `npm test -- --project downloader` — both green     |

Findings:

- _none above `low`._
- **low** — the split is verified by mutation, not only by assertion: collapsing
  `connectFailed` back to a single `refused` call fails the unreachable-host
  test and nothing else, so that test is load-bearing rather than decorative.
- **note** — this changes log messages that nothing parses today. If anything
  downstream ever greps `refused an ffmpeg fetch`, it stops matching.

Gate: **PASS** (self-reviewed; no reviewer subagent was dispatched, at the
operator's instruction for this session).

## Log

- Found while diagnosing a probe that returned `TIMEOUT` after 48s. The site
  resolved (Cloudflare address) and TCP 443 black-holed — 12s, no RST. The
  downloader was innocent; the container's egress is allowlisted, and
  `github.com` connected in 27ms while `example.com` and `1.1.1.1` did not.
  The four `refused an ffmpeg fetch` lines under the timeout were Chromium's
  subresource CONNECTs failing, and they are what made the tool look guilty.
- The brief's step 2 was the only part with a real trap in it, and it was worse
  than written: splitting by call site is not merely imprecise, it would have
  **downgraded a live SSRF refusal** — the rebinding case dl-8 exists for — into
  "could not connect". The type check is what makes the split correct.
- `upstreamRefused` was not in the original sketch. The chained path's error is
  an `AppError("UNREACHABLE")` raised by _the upstream's_ policy, and folding it
  into `refused` would have claimed a decision this service did not make.
- Worth knowing for the next reader: a fresh worktree needs its `dist` built
  before any suite runs, or every test in it fails with `packageEntryFailure`,
  which reads as a broken change and is not.
