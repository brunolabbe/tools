import { afterEach, describe, expect, test } from "vitest";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

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
