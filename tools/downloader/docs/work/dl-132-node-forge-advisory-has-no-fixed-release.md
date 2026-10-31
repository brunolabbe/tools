---
id: dl-132
tool: downloader
title: node-forge carries a high advisory with no fixed release, in code the API never calls
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# dl-132 — node-forge's advisory has no fixed release

## Why

After the 2026-10-24 dependency update (#632), `npm audit` reports one advisory
against this tree: **GHSA-86w9-cpqp-85rv** (high), "node-forge RSA PKCS#1 v1.5
signature verification accepts extra nested DigestAlgorithm elements", affecting
`node-forge <=1.4.0`. 1.4.0 is the latest release (registry checked 2026-10-25), so
`npm audit fix` has nothing to take.

**This tree does not reach the bug.** `@downloader/api` is the only package that
depends on node-forge, and nothing pulls it in transitively (`npm ls node-forge
--all`). Every call, in `tools/downloader/api/src/tls-interception.ts` and in the
test helpers (`test/helpers/tls-origin.ts`, `test/manifest-refetch.test.ts`),
creates keys and certificates and _signs_ them: `createCertificate`, `sign`,
`privateKeyFromPem`, `publicKeyFromPem`, `certificateToPem`, `generateKeyPair`.
Nothing calls a node-forge verify. The certificates it mints are verified by
Node's TLS (OpenSSL), Chromium and yt-dlp, never by node-forge.

The ticket exists so the advisory is not remembered only by a pull request
description: `npm audit` reports it on every run with no reason attached, and
nothing prompts the upgrade when a fix ships.

## Build

1. `npm view node-forge version`. If it is still `1.4.0`, there is nothing to do;
   leave the ticket `ready`.
2. Once a release fixes GHSA-86w9-cpqp-85rv and is at least seven days old
   (`.claude/rules/dependency-updates.md`; the advisory exemption does not apply,
   since this tree does not reach the bug), raise `tools/downloader/api`'s
   `node-forge` range to it and update the lockfile the way that rule says.
3. If that release is a new major, read its changelog against the calls listed
   above before bumping.
4. Re-run the reachability grep before closing: `grep -rn "forge\." --include=*.ts
   tools/downloader` must still show no verify call. If a verify has appeared, the
   bug is reachable and the advisory exemption applies after all.

## Done when

- `npm audit` reports no node-forge advisory, and `npm test -- --project
  downloader` passes.

## Log

- 2026-10-25: filed after #632 left this as the one advisory with no fix. If
  GitHub shows a Dependabot alert for it, dismiss it as "vulnerable code is not
  actually used", linking this ticket.
- 2026-10-31: done. node-forge 1.4.1 and 1.4.2 shipped on 2026-10-27, and by
  then `npm audit` named twelve node-forge advisories, not one — all `<=1.4.0`,
  all fixed in 1.4.1. Raised the range to `^1.4.2` (1.4.2 fixes 1.4.1's
  `pem.decode()` regression on non-string input) and took it at four days old.
  Build step 2 had this wrong: it said the advisory exemption did not apply
  because the tree does not reach the bug, but the owner's rule
  (`.claude/rules/dependency-updates.md`, 2026-10-24) exempts any fix for an
  advisory `npm audit` reports against this tree and sets no reachability test.
  Reachability still holds: the reachability grep finds no verify call. Of 1.4.1's
  behaviour changes, only the PEM parsing reaches this code (`privateKeyFromPem` and
  `publicKeyFromPem` on PEM that Node generates), and the downloader suite passes with
  1.4.2 actually loaded (2605 tests). The lockfile moves that one entry.
