/**
 * Holds `api/test/fixtures/live/` clean, forever and not once — pl-40 Build
 * step 5.
 *
 * Runs in CI with no key, because it only reads files: every record under
 * `fixtures/live/` is walked and every string leaf is checked for a live
 * credential or an unredacted URL or header map. It is green today over zero
 * files, because no owner run has landed one yet — `status: in-flight` on the
 * ticket says so. That is not a hollow assertion: the walk below was proved
 * red by hand, planting a violation in a scratch record and removing it
 * again (recorded in the ticket's Log, not committed here, since committing
 * the plant would defeat the point of the test it is proving).
 *
 * **Revised after the first gate (2026-09-17).** The walk originally treated
 * any string that `new URL()` accepts as a URL, compared whole against
 * `redactUrl`'s output. That is wrong for two reasons the gate reproduced: a
 * non-`http(s)` scheme (an OSM `wikipedia` tag reads `"fr:Observatoire de la
 * capitale"`, which `new URL()` happily parses with `origin === "null"`) makes
 * every such tag value "change" under `redactUrl`, and even a clean `http(s)`
 * URL with no query string can "change" on nothing but trailing-slash or
 * scheme-casing normalization.
 *
 * **A third false positive surfaced while verifying that fix, against the
 * harness's own real records rather than a synthetic one.** Overpass's real
 * capture carries OSM `fixme`/`website`-style tags whose value is prose with
 * a public reference URL and an ordinary query-string record id — see
 * `hasSecretLookingQueryParam`'s own comment for the exact string. "Any query
 * string at all" would never go green over real map data, on any corridor,
 * which fails the Done-when line ("green over the checked-in records") this
 * file exists to prove rather than serves it — so the check is narrowed to a
 * query string whose *parameter name* looks credential-shaped (`token`,
 * `signature`, `X-Amz-Signature`, …), which still catches every synthetic and
 * real signed-URL shape tried against it and passes a public record id.
 *
 * The fix also looks for `http(s)` URLs **embedded in prose**, not only
 * whole-string ones, since `content` and `systemPrompt` are exactly that
 * shape and the original walk missed a URL sitting inside a sentence entirely
 * (also reproduced). The gate additionally found the walk was non-recursive
 * (a nested output directory read green over an unread leak) and that a
 * failed `readdirSync` for any reason, not only "not created yet", read as
 * "no records" — both fixed below.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { REDACTED, redactHeaders, redactUrl } from "@webtools/core";

const FIXTURES_LIVE_DIR = fileURLToPath(new URL("./fixtures/live/", import.meta.url));

/** Key names a live record must never carry, whatever their value — checked literally first. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "apikey",
  "headers",
]);

/**
 * An `http(s)` URL embedded anywhere in a string, prose included.
 *
 * Deliberately narrower than "anything `new URL()` accepts" — an OSM tag
 * value like `wikipedia: "fr:Observatoire de la capitale"` parses under a
 * bare `fr:` scheme with no meaningful `origin`, and is not the kind of URL
 * `redactUrl` exists to protect. Stops at the first `"`, `'`, `<`, `>` or
 * whitespace, which is enough to isolate a URL sitting inside a sentence —
 * exactly the shape a specialist's `content` or `systemPrompt` carries a
 * source link in.
 */
const EMBEDDED_HTTP_URL = /https?:\/\/[^\s"'<>]+/g;

function httpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Query parameter names that look like a credential, not a public record id.
 *
 * **Found necessary against real data, not assumed.** `finds[].tags` is
 * OSM's own free text, and a real corridor capture carries entries such as
 * `fixme: "…location à valider sur place : https://vieux.montreal.qc.ca/
 * inventaire/fiches/fiche_bat.php?id=0040-85-7973-09"` — a public
 * heritage-registry record id, not a secret, and every corridor this ticket
 * will ever run over is going to carry more of exactly this shape. A blanket
 * "any query string" rule (Build step 5's literal wording, tried first) is
 * therefore not a usable acceptance test: it never goes green over real map
 * data, on any corridor, forever — which fails the ticket's own
 * `live-records.test.ts` Done-when line rather than serving it.
 *
 * **This narrowing is the owner's decision, 2026-09-18 (pl-40's Open
 * decision C), not the builder's alone.** Two options went to the owner: this
 * denylist, kept and widened as new signed-URL shapes are found, or the
 * literal rule with a carve-out for URLs already present in
 * `overpass-nearby.json`. The owner took the denylist, on the basis both the
 * builder and the gate recommended it: a denylist can always be widened
 * cheaply the next time a real capture needs it; a carve-out tied to one
 * fixture cannot generalise to the next corridor's own set of public,
 * non-secret query strings. **Build step 5 is amended by this decision**: "a
 * URL that changes under redactUrl" now means, specifically, one carrying a
 * query parameter named on this list — not literally any query string.
 * Names below the AWS row were added after the gate's second pass planted
 * three shapes this list did not yet catch: Google Cloud's signed-URL
 * parameters, Akamai's token-auth parameters, and a bare `password`/`pwd`/
 * `credential` — each has its own regression test below.
 */
const SECRET_QUERY_PARAM_NAMES =
  /^(token|signature|sig|auth|authorization|session|key|secret|apikey|api[-_]?key|access[-_]?token|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential|hdnts|hdnea|password|pwd|credential)$/i;

function hasSecretLookingQueryParam(url: URL): boolean {
  for (const name of url.searchParams.keys()) {
    if (SECRET_QUERY_PARAM_NAMES.test(name)) return true;
  }
  return false;
}

/**
 * Whether `redactHeaders` would redact this one key, whatever its sibling
 * keys' value types are.
 *
 * The gate found the previous check only fired when *every* value in the
 * enclosing object was a string — so a `cookie` key next to one non-string
 * sibling escaped detection entirely. Asking `redactHeaders` about the key in
 * isolation is both the fix and the more honest check: it is the same
 * denylist `redactHeaders` itself uses, so this can never drift from it.
 */
function isSecretHeaderName(key: string): boolean {
  return redactHeaders({ [key]: "probe" })[key] === REDACTED;
}

function walk(node: unknown, at: string, violations: string[]): void {
  if (typeof node === "string") {
    if (node.includes("sk-ant-")) {
      violations.push(`${at}: contains an "sk-ant-" substring`);
    }
    for (const match of node.matchAll(EMBEDDED_HTTP_URL)) {
      const url = httpUrl(match[0]);
      if (url !== null && hasSecretLookingQueryParam(url)) {
        // Never interpolate the raw match: it is the very query string being
        // flagged, and a failing assertion's message is not a safe place for it.
        violations.push(
          `${at}: carries an http(s) URL with a credential-shaped query parameter ` +
            `(redactUrl would strip it: ${redactUrl(match[0])})`,
        );
      }
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      walk(item, `${at}[${index}]`, violations);
    });
    return;
  }

  if (node !== null && typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>);

    for (const [key, value] of entries) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        violations.push(`${at}.${key}: a record must never carry a key named this`);
      } else if (isSecretHeaderName(key)) {
        violations.push(
          `${at}.${key}: a record must never carry a key named this (redactHeaders would redact it)`,
        );
      }
      walk(value, `${at}.${key}`, violations);
    }

    // A redundant backstop over the previous, narrower check: a whole
    // string-keyed-and-valued map that still changes under `redactHeaders` —
    // kept because it is cheap and catches nothing the per-key check above
    // does not already, except by a different route.
    if (entries.length > 0 && entries.every(([, value]) => typeof value === "string")) {
      const asMap = Object.fromEntries(entries) as Record<string, string>;
      const redacted = redactHeaders(asMap);
      if (JSON.stringify(redacted) !== JSON.stringify(asMap)) {
        violations.push(`${at}: a string map that changes under redactHeaders`);
      }
    }
  }
}

/**
 * Every JSON file under `dir`, at any depth, or an empty list for a `dir`
 * that does not exist yet.
 *
 * **Only a missing directory reads as "no records yet."** The gate found the
 * previous version swallowed every error the same way — a permissions
 * problem or an `ENOTDIR` would have silently reported zero files too, the
 * same as the ordinary "not created yet" case `status: in-flight` describes.
 * Takes `dir` as a parameter, rather than closing over `FIXTURES_LIVE_DIR`
 * directly, so the recursion and the error handling below are testable
 * against a throwaway directory instead of the real fixture tree.
 */
function collectJsonFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch (error: unknown) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries.filter((name) => name.endsWith(".json")).map((name) => path.join(dir, name));
}

function liveRecordFiles(): string[] {
  return collectJsonFiles(FIXTURES_LIVE_DIR);
}

describe("fixtures/live/ carries no credential and nothing an unredacted log line would", () => {
  const files = liveRecordFiles();

  test("at least documents whether any records exist yet", () => {
    // Not a claim either way — `status: in-flight` means this can legitimately
    // be zero. The walk below runs over whatever is here, empty or not.
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  test.each(files.length > 0 ? files : ["(no records checked in yet)"])("%s", (file) => {
    if (files.length === 0) return;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const violations: string[] = [];
    walk(parsed, path.relative(FIXTURES_LIVE_DIR, file), violations);
    expect(violations).toEqual([]);
  });
});

describe("the walk itself — proved able to fail, over synthetic records", () => {
  test("catches an sk-ant- substring", () => {
    const violations: string[] = [];
    walk({ note: "leaked sk-ant-abc123" }, "synthetic", violations);
    expect(violations).toEqual(['synthetic.note: contains an "sk-ant-" substring']);
  });

  test("catches a forbidden key name regardless of its value", () => {
    const violations: string[] = [];
    walk({ "x-api-key": "whatever" }, "synthetic", violations);
    expect(violations).toContainEqual(
      "synthetic.x-api-key: a record must never carry a key named this",
    );
  });

  test("catches a signed URL that redactUrl would strip", () => {
    const violations: string[] = [];
    walk({ url: "https://fixtures.invalid/path?token=secret" }, "synthetic", violations);
    expect(violations).toEqual([
      "synthetic.url: carries an http(s) URL with a credential-shaped query parameter " +
        "(redactUrl would strip it: https://fixtures.invalid/path?[redacted])",
    ]);
  });

  test("catches an AWS-style presigned URL (the shape a positive control ought to use)", () => {
    const violations: string[] = [];
    walk(
      { url: "https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc123" },
      "synthetic",
      violations,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("credential-shaped query parameter");
  });

  // The gate's second pass planted three shapes the denylist above did not
  // yet catch, over the fully re-verified fixed build — the owner's decision
  // (2026-09-18, pl-40's Open decision C) was to widen the list rather than
  // fall back to Build step 5's literal "any query string", and these three
  // are that widening's own regression tests.
  test("catches a Google Cloud Storage-style signed URL", () => {
    const violations: string[] = [];
    walk(
      {
        url: "https://storage.googleapis.com/bucket/key?X-Goog-Signature=abc&X-Goog-Credential=xyz",
      },
      "synthetic",
      violations,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("credential-shaped query parameter");
  });

  test("catches an Akamai token-auth URL (hdnts/hdnea)", () => {
    const violations: string[] = [];
    walk(
      { url: "https://cdn.example.invalid/video.m3u8?hdnts=exp=1234~acl=/*~hmac=abc" },
      "synthetic",
      violations,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("credential-shaped query parameter");
  });

  test("catches a bare password/pwd/credential query parameter", () => {
    for (const name of ["password", "pwd", "credential"]) {
      const violations: string[] = [];
      walk({ url: `https://fixtures.invalid/login?${name}=hunter2` }, "synthetic", violations);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("credential-shaped query parameter");
    }
  });

  test("catches a signed URL embedded in prose, the shape a reply's content or a system prompt carries one in", () => {
    const violations: string[] = [];
    walk(
      { embedded: "see https://cdn.example.invalid/a.mp4?sig=secret for the source" },
      "synthetic",
      violations,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("credential-shaped query parameter");
    expect(violations[0]).not.toContain("sig=secret");
  });

  test("does NOT flag a public record id in a query string — real data, not synthetic (the gate's own fix reproduced a second false positive here)", () => {
    // A real `fixme` tag from api/test/fixtures/overpass-nearby.json, carried
    // verbatim into a Find and then into a system prompt's discovery block.
    // A blanket "any query string" rule (tried first, in response to MED 1)
    // flagged this on every corridor run, forever — it is public open data,
    // not a credential, and the record must be able to land green over it.
    const violations: string[] = [];
    walk(
      {
        tags: {
          fixme:
            "Présence de vestige mis au jour en 1990, location à valider sur place : " +
            "https://vieux.montreal.qc.ca/inventaire/fiches/fiche_bat.php?id=0040-85-7973-09",
        },
      },
      "synthetic",
      violations,
    );
    expect(violations).toEqual([]);
  });

  test("catches a header-shaped string map with a secret value", () => {
    const violations: string[] = [];
    walk({ cookie: "session=abc" }, "synthetic", violations);
    expect(violations).toContainEqual(
      "synthetic.cookie: a record must never carry a key named this (redactHeaders would redact it)",
    );
  });

  test("catches a secret-named key even beside a non-string sibling", () => {
    // The gate's finding: the previous check only ran when every sibling
    // value was also a string, so a `cookie` next to a number escaped.
    const violations: string[] = [];
    walk({ cookie: "session=abc", count: 3 }, "synthetic", violations);
    expect(violations).toContainEqual(
      "synthetic.cookie: a record must never carry a key named this (redactHeaders would redact it)",
    );
  });

  test("does not flag a non-http(s) scheme an OSM tag legitimately carries", () => {
    // The gate's MED 1: `new URL("fr:Observatoire de la capitale")` parses
    // with `origin === "null"`, which the old whole-string comparison always
    // called "changed". A real wiki-language tag value must pass clean.
    const violations: string[] = [];
    walk(
      {
        tags: {
          wikipedia: "fr:Observatoire de la capitale",
          "wikipedia:en": "en:Plains of Abraham",
          wikimedia_commons: "Category:Saint-Jean gate",
        },
      },
      "synthetic",
      violations,
    );
    expect(violations).toEqual([]);
  });

  test("does not flag a clean http(s) URL with no query string, whatever its trailing slash", () => {
    const violations: string[] = [];
    walk(
      { a: "https://www.openstreetmap.org/node/1", b: "https://fixtures.invalid" },
      "synthetic",
      violations,
    );
    expect(violations).toEqual([]);
  });

  test("passes a record shaped like a real one", () => {
    const violations: string[] = [];
    walk(
      {
        set: "A",
        briefFixture: "road-trip",
        requestedModel: "claude-opus-5",
        finds: [
          {
            index: 0,
            name: "A lookout",
            sources: [{ url: "https://www.openstreetmap.org/node/1" }],
          },
        ],
      },
      "synthetic",
      violations,
    );
    expect(violations).toEqual([]);
  });
});

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "pl-40-live-records-"));
}

describe("collectJsonFiles — a real filesystem, a throwaway directory", () => {
  test("finds a record nested under a subdirectory, not only the top level (the gate's LOW 5(a))", () => {
    const dir = tempDir();
    try {
      mkdirSync(path.join(dir, "set-b"), { recursive: true });
      writeFileSync(path.join(dir, "set-b", "scratch-plant.json"), "{}");
      expect(collectJsonFiles(dir)).toEqual([path.join(dir, "set-b", "scratch-plant.json")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a directory that does not exist yet reads as no records, not an error", () => {
    const missing = path.join(os.tmpdir(), `pl-40-live-records-missing-${String(Date.now())}`);
    expect(collectJsonFiles(missing)).toEqual([]);
  });

  test("a real read error over an existing path is not swallowed the same way as 'not created yet' (the gate's LOW 5(c))", () => {
    const dir = tempDir();
    try {
      const notADirectory = path.join(dir, "this-is-a-file");
      writeFileSync(notADirectory, "not a directory");
      // Asking readdirSync to list a file, not a directory, raises ENOTDIR —
      // and only ENOENT is the "not created yet" case this function treats
      // as empty.
      expect(() => collectJsonFiles(notADirectory)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
