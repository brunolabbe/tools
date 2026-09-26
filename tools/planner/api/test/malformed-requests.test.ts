import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";

let app: App | undefined;
let webDir: string | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  if (webDir !== undefined) await fs.rm(webDir, { recursive: true, force: true });
  webDir = undefined;
});

/** Build a simple static bundle matching web-serving.test.ts. */
async function buildBundle(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-web-"));
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Planner</title>");
  await fs.writeFile(path.join(root, "assets", "main-abc123.js"), "console.log(1)");
  return root;
}

describe("malformed request body handling", () => {
  test("POST /api/intakes with empty declared-JSON body: 400, logged at info", async () => {
    const { createLogger } = await import("../src/logger.ts");
    const raw: string[] = [];
    app = await createApp({
      config: { databasePath: ":memory:", logLevel: "debug" },
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });

    const response = await app.server.inject({
      method: "POST",
      url: "/api/intakes",
      headers: { "content-type": "application/json" },
      payload: "",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(raw.some((line) => line.includes('"msg":"request failed"'))).toBe(false);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('"level":"info"');
    // The log line's own `code` field, not just the response body's — a
    // second, independent `AppError.from` in `registerErrorHandling` used to
    // leave this at `INTERNAL` while the response above already said
    // `BAD_REQUEST` (pl-51).
    expect(rejected[0]).toContain('"code":"BAD_REQUEST"');
  });

  test("POST /api/intakes with malformed JSON: 400, logged at info", async () => {
    const { createLogger } = await import("../src/logger.ts");
    const raw: string[] = [];
    app = await createApp({
      config: { databasePath: ":memory:", logLevel: "debug" },
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });

    const response = await app.server.inject({
      method: "POST",
      url: "/api/intakes",
      headers: { "content-type": "application/json" },
      payload: "{malformed json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(raw.some((line) => line.includes('"msg":"request failed"'))).toBe(false);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('"level":"info"');
    // The log line's own `code` field, not just the response body's — a
    // second, independent `AppError.from` in `registerErrorHandling` used to
    // leave this at `INTERNAL` while the response above already said
    // `BAD_REQUEST` (pl-51).
    expect(rejected[0]).toContain('"code":"BAD_REQUEST"');
  });
});

describe("@fastify/static precondition and range errors", () => {
  test("GET asset with If-Match on stale ETag: 412, logged at info", async () => {
    const { createLogger } = await import("../src/logger.ts");
    const raw: string[] = [];
    webDir = await buildBundle();
    app = await createApp({
      config: { databasePath: ":memory:", logLevel: "debug", webDir },
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });

    const response = await app.server.inject({
      method: "GET",
      url: "/assets/main-abc123.js",
      headers: { "if-match": '"bogus-etag"' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(raw.some((line) => line.includes('"msg":"request failed"'))).toBe(false);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('"level":"info"');
    expect(rejected[0]).toContain('"code":"BAD_REQUEST"');
  });

  test("GET asset with unsatisfiable Range: 416, logged at info", async () => {
    const { createLogger } = await import("../src/logger.ts");
    const raw: string[] = [];
    webDir = await buildBundle();
    app = await createApp({
      config: { databasePath: ":memory:", logLevel: "debug", webDir },
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });

    const response = await app.server.inject({
      method: "GET",
      url: "/assets/main-abc123.js",
      headers: { range: "bytes=999999-9999999" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(raw.some((line) => line.includes('"msg":"request failed"'))).toBe(false);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('"level":"info"');
    expect(rejected[0]).toContain('"code":"BAD_REQUEST"');
  });
});
