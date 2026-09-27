import path from "node:path";
import { describe, expect, test } from "vitest";
import { API_DEFAULTS, loadApiConfig } from "../src/config.ts";

describe("loadApiConfig", () => {
  test("defaults to loopback on 8100, beside the other tools rather than on top of them", () => {
    const config = loadApiConfig({}, {});

    expect(config.host).toBe("127.0.0.1");
    // 8080 is the downloader's and 8090 the planner's; all three run at once.
    expect(config.port).toBe(8100);
    expect(config.databasePath).toBe(path.resolve(API_DEFAULTS.dataDir, API_DEFAULTS.databaseFile));
    expect(config.trustProxy).toBe(false);
    expect(config.webDir).toBeUndefined();
    expect(config.corsOrigins).toEqual([]);
    expect(config.logLevel).toBe("info");
  });

  test("reads what the container sets", () => {
    const config = loadApiConfig(
      {},
      {
        HOST: "0.0.0.0",
        PORT: "8100",
        DATABASE_PATH: "/data/ledger.db",
        TRUST_PROXY: "172.30.42.0/24",
        WEB_DIR: "/app/tools/ledger/web/dist/app",
      },
    );

    expect(config.host).toBe("0.0.0.0");
    expect(config.databasePath).toBe("/data/ledger.db");
    expect(config.trustProxy).toBe("172.30.42.0/24");
    expect(config.webDir).toBe(path.resolve("/app/tools/ledger/web/dist/app"));
  });

  test("treats a blank WEB_DIR as unset rather than as the current directory", () => {
    // `WEB_DIR=` is what a commented-out `.env` line collapses into, and
    // resolving it would serve whatever directory the API started in.
    expect(loadApiConfig({}, { WEB_DIR: "  " }).webDir).toBeUndefined();
  });

  test("keeps :memory: as it is, rather than resolving it to a file", () => {
    expect(loadApiConfig({}, { DATABASE_PATH: ":memory:" }).databasePath).toBe(":memory:");
  });
});
