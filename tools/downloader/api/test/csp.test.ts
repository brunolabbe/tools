/**
 * The document's Content-Security-Policy (dl-35).
 *
 * A CSP is unusually easy to ship in a shape that looks right and enforces
 * nothing, so this file is deliberately not one `toContain` per directive. It
 * asserts three separate things:
 *
 *  1. **Which responses carry it.** Both doors to the document — the static
 *     `index.html` and the SPA fallback — and none of the `/api` ones.
 *  2. **What it says**, as a parsed directive map compared against the exact
 *     expected set, so a directive that quietly disappears is a failure rather
 *     than a substring that still matches.
 *  3. **That it cannot be a no-op.** `unsafe-inline`, `unsafe-eval`, a bare `*`
 *     and the `-Report-Only` header name are each a way to ship a policy that
 *     grants what it claims to deny, and each has its own assertion.
 *
 * What no test here can claim is that a *browser* enforces it. That is
 * `tools/downloader/e2e/csp.spec.ts`, which blocks a real image in a real
 * Chromium; jsdom and `inject()` both parse exactly nothing.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROUTES } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createHarness } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;
let webDir: string | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  if (webDir !== undefined) await fs.rm(webDir, { recursive: true, force: true });
  webDir = undefined;
});

const HTML = { accept: "text/html,application/xhtml+xml" };

/**
 * Written out here rather than imported from `routes/web.ts`.
 *
 * Importing the constant would make every assertion below a tautology: the
 * suite would agree with whatever the source said, including with a source that
 * had lost `object-src` overnight. This copy is the specification, and changing
 * the policy is supposed to cost an edit here.
 */
const EXPECTED: ReadonlyMap<string, readonly string[]> = new Map([
  ["default-src", ["'self'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'"]],
  ["img-src", ["'self'"]],
  ["connect-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["frame-ancestors", ["'none'"]],
]);

/** `a 'self'; b 'none'` → `{ a: ["'self'"], b: ["'none'"] }`, names lowercased. */
function parsePolicy(header: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const raw of header.split(";")) {
    const tokens = raw.trim().split(/\s+/u).filter(Boolean);
    const [name, ...values] = tokens;
    if (name === undefined) continue;
    directives.set(name.toLowerCase(), values);
  }
  return directives;
}

async function serving(): Promise<Harness> {
  // A stand-in for `web/dist/app`, the same shape `web-serving.test.ts` uses.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-csp-"));
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Downloader</title>");
  await fs.writeFile(path.join(root, "assets", "main-abc123.js"), "console.log(1)");
  webDir = root;
  harness = await createHarness({ config: { webDir: root } });
  return harness;
}

describe("the policy the document carries", () => {
  test("index.html at the root carries it, with exactly the expected directives", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({ method: "GET", url: "/", headers: HTML });

    expect(response.statusCode).toBe(200);
    const header = response.headers["content-security-policy"];
    expect(typeof header).toBe("string");

    const directives = parsePolicy(header as string);
    // Both directions: nothing expected is missing, and nothing unexpected has
    // been added. A `toContain` per directive would pass on either.
    expect([...directives.keys()].toSorted()).toEqual([...EXPECTED.keys()].toSorted());
    for (const [name, values] of EXPECTED) {
      expect(directives.get(name), name).toEqual(values);
    }
  });

  test("the SPA fallback carries the same policy, because it is the same document", async () => {
    // The failure this exists for: a header hung off the static plugin alone
    // is absent from every client-side deep link, which is most of the ways a
    // user arrives at a page they were linked to.
    const app = (await serving()).app;
    const response = await app.server.inject({
      method: "GET",
      url: "/jobs/some-id",
      headers: HTML,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Downloader</title>");

    // Compared against `EXPECTED` and not merely against what `/` happened to
    // answer: with the header missing from both, "the two agree" is satisfied
    // by two `undefined`s. Measured — that is exactly what this assertion did
    // before it was written this way, and it stayed green through the red run.
    const header = response.headers["content-security-policy"];
    expect(typeof header).toBe("string");
    const directives = parsePolicy(header as string);
    expect([...directives.keys()].toSorted()).toEqual([...EXPECTED.keys()].toSorted());
    for (const [name, values] of EXPECTED) {
      expect(directives.get(name), name).toEqual(values);
    }
  });

  test("it is enforced, not reported: there is no Report-Only header anywhere", async () => {
    // `Content-Security-Policy-Report-Only` is the single cheapest way to ship
    // a policy that blocks nothing at all, and it differs from the real header
    // by a suffix a reader skims past. Asserting only its absence would pass on
    // a service that sets no policy at all, so both halves are asserted.
    const app = (await serving()).app;
    for (const url of ["/", "/jobs/some-id"]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await app.server.inject({ method: "GET", url, headers: HTML });
      expect(response.headers["content-security-policy-report-only"], url).toBeUndefined();
      expect(typeof response.headers["content-security-policy"], url).toBe("string");
    }
  });

  test("nothing in it grants what it claims to deny", async () => {
    const app = (await serving()).app;
    const header = (await app.server.inject({ method: "GET", url: "/", headers: HTML })).headers[
      "content-security-policy"
    ] as string;

    // Each of these is a way to write a policy that parses, looks thorough and
    // permits the attack it names.
    expect(header).not.toContain("unsafe-inline");
    expect(header).not.toContain("unsafe-eval");
    expect(header).not.toContain("unsafe-hashes");
    expect(header).not.toContain("data:");
    expect(header).not.toContain("blob:");

    // A bare `*` as a whole token — `*.example.com` would be a different
    // decision, and this is not the assertion that should catch it.
    for (const [name, values] of parsePolicy(header)) {
      expect(values, name).not.toContain("*");
      expect(values, name).not.toContain("http:");
      expect(values, name).not.toContain("https:");
    }

    // `report-uri`/`report-to` with nowhere to send would be dead weight, and
    // the ticket's own instruction was not to add one.
    expect(header).not.toContain("report-uri");
    expect(header).not.toContain("report-to");
  });
});

describe("what does not carry it", () => {
  test("the API's JSON answers do not, on either a hit or a miss", async () => {
    const app = (await serving()).app;
    for (const url of [ROUTES.health, "/api/nope"]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await app.server.inject({ method: "GET", url, headers: HTML });
      expect(response.headers["content-type"], url).toContain("application/json");
      expect(response.headers["content-security-policy"], url).toBeUndefined();
    }
  });

  test("the thumbnail route's 404 does not, and keeps its own defence", async () => {
    // dl-29's route answers bytes, and its protection against a hostile
    // content type is the allowlist plus `nosniff` — not this. A CSP here
    // would be noise that reads as coverage.
    const app = (await serving()).app;
    const response = await app.server.inject({
      method: "GET",
      url: ROUTES.thumbnail("not-a-real-token"),
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  test("a hashed bundle asset does not: a script is not a document", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({ method: "GET", url: "/assets/main-abc123.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });
});

describe("without WEB_DIR", () => {
  test("no document is served, so no policy is set", async () => {
    // Running the API headless is a supported configuration. There is no
    // document for a policy to govern, and a header on the typed 404 would be
    // a claim about a page this process does not serve.
    harness = await createHarness();
    const response = await harness.app.server.inject({ method: "GET", url: "/", headers: HTML });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });
});
