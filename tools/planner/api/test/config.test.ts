import path from "node:path";
import { describe, expect, test } from "vitest";
import { API_DEFAULTS, loadApiConfig } from "../src/config.ts";

describe("loadApiConfig", () => {
  test("falls back to the defaults when the environment says nothing", () => {
    const config = loadApiConfig({}, {});
    expect(config.host).toBe(API_DEFAULTS.host);
    expect(config.port).toBe(API_DEFAULTS.port);
    expect(config.chatProvider).toBe("scripted");
    expect(config.corsOrigins).toEqual([]);
    expect(config.webDir).toBeUndefined();
  });

  test("reads the environment, and resolves WEB_DIR to an absolute path", () => {
    const config = loadApiConfig(
      {},
      {
        HOST: "0.0.0.0",
        PORT: "9100",
        CORS_ORIGINS: "https://a.example, https://b.example ,",
        WEB_DIR: "./web/dist/app",
        LOG_LEVEL: "warn",
      },
    );
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9100);
    expect(config.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
    // `isAbsolute`, not a leading "/": this suite runs on Windows in CI too,
    // where an absolute path starts with a drive letter.
    expect(path.isAbsolute(config.webDir ?? "")).toBe(true);
    expect(config.webDir?.endsWith(path.join("web", "dist", "app"))).toBe(true);
    expect(config.logLevel).toBe("warn");
  });

  test("falls back to the scripted provider when the name is unknown", () => {
    // Visibly scripted is a safe failure — health reports it by name — so a
    // typo should not stop the process the way a bad egress setting would.
    expect(loadApiConfig({}, { CHAT_PROVIDER: "gpt-9" }).chatProvider).toBe("scripted");
  });

  test("clamps a nonsense token ceiling instead of passing it to a provider", () => {
    expect(loadApiConfig({}, { MAX_OUTPUT_TOKENS: "-5" }).maxOutputTokens).toBe(1);
    expect(loadApiConfig({}, { MAX_OUTPUT_TOKENS: "99999999" }).maxOutputTokens).toBe(32_000);
    expect(loadApiConfig({}, { MAX_OUTPUT_TOKENS: "not a number" }).maxOutputTokens).toBe(
      API_DEFAULTS.maxOutputTokens,
    );
  });

  test("honours :memory: rather than resolving it as a path", () => {
    expect(loadApiConfig({}, { DATABASE_PATH: ":memory:" }).databasePath).toBe(":memory:");
  });

  test("lets an explicit override beat the environment", () => {
    expect(loadApiConfig({ port: 1234 }, { PORT: "9100" }).port).toBe(1234);
  });
});
