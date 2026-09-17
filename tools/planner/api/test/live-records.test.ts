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
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { redactHeaders, redactUrl } from "@webtools/core";

const FIXTURES_LIVE_DIR = fileURLToPath(new URL("./fixtures/live/", import.meta.url));

/** Key names a live record must never carry, whatever their value. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "apikey",
  "headers",
]);

function looksLikeUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new -- probing for parseability, the return value is unused
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function walk(node: unknown, at: string, violations: string[]): void {
  if (typeof node === "string") {
    if (node.includes("sk-ant-")) {
      violations.push(`${at}: contains an "sk-ant-" substring`);
    }
    if (looksLikeUrl(node) && redactUrl(node) !== node) {
      violations.push(`${at}: a URL that changes under redactUrl (carries a query string)`);
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
      }
      walk(value, `${at}.${key}`, violations);
    }

    if (entries.length > 0 && entries.every(([, value]) => typeof value === "string")) {
      const asMap = Object.fromEntries(entries) as Record<string, string>;
      const redacted = redactHeaders(asMap);
      if (JSON.stringify(redacted) !== JSON.stringify(asMap)) {
        violations.push(`${at}: a string map that changes under redactHeaders`);
      }
    }
  }
}

/** Every JSON file under `fixtures/live/`, or an empty list before the owner's first run lands one. */
function liveRecordFiles(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(FIXTURES_LIVE_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(FIXTURES_LIVE_DIR, name));
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
    walk(parsed, path.basename(file), violations);
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
    expect(violations).toContainEqual(
      "synthetic.url: a URL that changes under redactUrl (carries a query string)",
    );
  });

  test("catches a header-shaped string map with a secret value", () => {
    const violations: string[] = [];
    walk({ cookie: "session=abc" }, "synthetic", violations);
    expect(violations).toContainEqual("synthetic: a string map that changes under redactHeaders");
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
