---
id: lg-3
tool: ledger
title: Verify the Cloudflare Access token on every request
kind: work-package
status: ready
milestone: P2
depends_on: []
difficulty: hard
---

# lg-3 — Verify the Cloudflare Access token on every request

## Why

Who did something — whose receipt this is, who classified a row — is the Access
identity, and the tool has no login of its own
([00-ANALYSIS.md §7](../00-ANALYSIS.md)). Reading the plain email header would
trust anything that reaches the origin, and the loopback port reaches it without
passing through Access.

## Build

1. Verify `Cf-Access-Jwt-Assertion` on every route except `/api/health`:
   - the signature, against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`);
   - the audience, which is the application's AUD tag;
   - the expiry.
     The team name and the AUD tag are configuration, read in `api/src/config.ts`
     only.
2. **Map email to person in configuration**, never in a table seeded from the
   repository. An address the configuration does not know gets a 403. A request
   with a missing or invalid token gets a 401.
3. **Cache the JWKS, and refresh it when a key id is unknown.** A request never
   makes an unbounded number of fetches. The fetch goes to a fixed host built
   from configuration, never from anything in the request.
4. **Development:** a configured fixed identity. The production image refuses
   to start when both that and a production mode are set.
5. **Never log the token or the header.** `logger.ts` already censors both; do
   not rely on that alone.
6. Expose the person on the request context for later tickets.

## Done when

1. A valid token, signed by a test key the test serves as JWKS, reaches a
   route as the mapped person.
2. Each of these gets a 401: a missing token, a token with a bad signature, one
   with the wrong audience, and an expired one.
3. A valid token for an unmapped email gets a 403.
4. `/api/health` answers without a token.
5. The development identity cannot be enabled in production mode; a config
   test proves it.
6. Gates green, the container-build workflow included.

## Log
