import path from "node:path";
import { DEFAULT_RUN_BUDGET } from "@planner/agent";
import { AppError } from "@planner/contract";
import { describe, expect, test } from "vitest";
import { API_DEFAULTS, loadApiConfig } from "../src/config.ts";

describe("loadApiConfig", () => {
  test("falls back to the defaults when the environment says nothing", () => {
    const config = loadApiConfig({}, {});
    expect(config.host).toBe(API_DEFAULTS.host);
    expect(config.port).toBe(API_DEFAULTS.port);
    expect(config.modelProvider).toBe("scripted");
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

  test("refuses an unknown model provider rather than running the script", () => {
    // pl-39. This used to fall back to `scripted`, which was safe while that
    // was the only name. With a real provider beside it, a typo on a production
    // host runs the script and bills nothing while looking configured.
    expect(() => loadApiConfig({}, { MODEL_PROVIDER: "antropic" })).toThrow(
      /MODEL_PROVIDER is "antropic", which this build does not know/u,
    );
    try {
      loadApiConfig({}, { MODEL_PROVIDER: "gpt-9" });
      expect.unreachable("an unknown provider booted");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("AGENT_UNCONFIGURED");
    }
  });

  test("an empty MODEL_PROVIDER is unset, not unknown", () => {
    // What a commented-out `.env` line collapses into.
    expect(loadApiConfig({}, { MODEL_PROVIDER: "  " }).modelProvider).toBe("scripted");
  });

  test("refuses anthropic when ANTHROPIC_CUSTOM_HEADERS is set, naming the variable and never its value", () => {
    // The owner's decision on pl-39. The SDK applies this variable to every
    // request, and a header in it can replace the configured key.
    const secret = "x-api-key: sk-ant-STRAY-KEY-FROM-HOST";
    for (const env of [
      { MODEL_PROVIDER: "anthropic", ANTHROPIC_CUSTOM_HEADERS: secret },
      // No colon adds no header in the SDK, but the rule is "set", not "parses".
      { MODEL_PROVIDER: "anthropic", ANTHROPIC_CUSTOM_HEADERS: "garbage" },
    ]) {
      try {
        loadApiConfig({}, env);
        expect.unreachable("anthropic booted with ANTHROPIC_CUSTOM_HEADERS set");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe("AGENT_UNCONFIGURED");
        expect(appError.message).toContain("ANTHROPIC_CUSTOM_HEADERS");
        expect(appError.details).toEqual({ variable: "ANTHROPIC_CUSTOM_HEADERS" });
        expect(
          JSON.stringify({ message: appError.message, details: appError.details }),
        ).not.toContain("STRAY-KEY");
      }
    }

    // The provider named by override rather than by environment refuses too.
    expect(() =>
      loadApiConfig({ modelProvider: "anthropic" }, { ANTHROPIC_CUSTOM_HEADERS: secret }),
    ).toThrow(/ANTHROPIC_CUSTOM_HEADERS is set/u);
  });

  test("a blank ANTHROPIC_CUSTOM_HEADERS is unset, because the SDK adds no header for one", () => {
    // Measured against SDK 0.125.0: it trims the value and treats empty as
    // absent, so these add no header and must not refuse.
    for (const blank of ["", "   ", " \n ", "\t"]) {
      expect(
        loadApiConfig({}, { MODEL_PROVIDER: "anthropic", ANTHROPIC_CUSTOM_HEADERS: blank })
          .modelProvider,
      ).toBe("anthropic");
    }
  });

  test("ANTHROPIC_CUSTOM_HEADERS does not stop the scripted default, which never builds the SDK", () => {
    expect(loadApiConfig({}, { ANTHROPIC_CUSTOM_HEADERS: "x-extra: 1" }).modelProvider).toBe(
      "scripted",
    );
  });

  test("recognises anthropic, and reads its key, model and effort from their own variables", () => {
    const config = loadApiConfig(
      {},
      {
        MODEL_PROVIDER: "Anthropic",
        ANTHROPIC_API_KEY: " sk-ant-test ",
        MODEL: "claude-sonnet-5",
        MODEL_EFFORT: "HIGH",
        MODEL_TIMEOUT_MS: "45000",
      },
    );
    expect(config.modelProvider).toBe("anthropic");
    expect(config.anthropicApiKey).toBe("sk-ant-test");
    expect(config.model).toBe("claude-sonnet-5");
    expect(config.modelEffort).toBe("high");
    expect(config.modelTimeoutMs).toBe(45_000);
  });

  test("defaults the model to claude-opus-5 at effort low, with no key", () => {
    const config = loadApiConfig({}, {});
    expect(config.model).toBe("claude-opus-5");
    expect(config.modelEffort).toBe("low");
    expect(config.modelTimeoutMs).toBe(120_000);
    // No default key, ever, and an empty one is not a key.
    expect(config.anthropicApiKey).toBeUndefined();
    expect(loadApiConfig({}, { ANTHROPIC_API_KEY: "" }).anthropicApiKey).toBeUndefined();
  });

  test("refuses an effort level the API does not have", () => {
    expect(() => loadApiConfig({}, { MODEL_EFFORT: "hgih" })).toThrow(
      /MODEL_EFFORT is "hgih", which is not an effort level/u,
    );
  });

  test("defaults the reply ceiling to 8,000, in both places it is written down", () => {
    // pl-39: a model that thinks by default counts thinking against this, and
    // 2,048 made an ordinary reply a `length` stop and a re-ask.
    expect(API_DEFAULTS.maxOutputTokens).toBe(8_000);
    expect(loadApiConfig({}, {}).maxOutputTokens).toBe(8_000);
    expect(DEFAULT_RUN_BUDGET.maxOutputTokens).toBe(API_DEFAULTS.maxOutputTokens);
  });

  test("defaults grounding to the fixture provider, so a fresh clone needs no key", () => {
    expect(loadApiConfig({}, {}).groundingProvider).toBe("fixtures");
    expect(loadApiConfig({}, {}).maxGroundingCalls).toBe(40);
  });

  test("refuses an unknown grounding provider rather than answering from fixtures", () => {
    // Folded into pl-39 beside `MODEL_PROVIDER`. It used to fall back, on the
    // argument that a user sees unmeasured legs said out loud. The operator who
    // typed `valhala` meant a routing engine, and `createGroundingProvider`
    // already refuses a recognised name with no endpoint — the same mistake one
    // character earlier.
    expect(() => loadApiConfig({}, { GROUNDING_PROVIDER: "osrm" })).toThrow(
      /GROUNDING_PROVIDER is "osrm", which this build does not know/u,
    );
    expect(loadApiConfig({}, { GROUNDING_PROVIDER: "" }).groundingProvider).toBe("fixtures");
  });

  test("recognises valhalla, and keeps its endpoints as written with no default", () => {
    const config = loadApiConfig(
      {},
      {
        GROUNDING_PROVIDER: "Valhalla",
        VALHALLA_URL: " http://valhalla:8002 ",
        GEOCODER_URL: "http://nominatim:8080",
      },
    );
    expect(config.groundingProvider).toBe("valhalla");
    expect(config.groundingEndpoints).toEqual({
      routing: "http://valhalla:8002",
      geocoder: "http://nominatim:8080",
    });
  });

  test("has no endpoint at all when nothing named one", () => {
    // No localhost guess and no public instance: an endpoint is a fact about a
    // deployment, and a default here is a surprise bill or a surprise outage.
    // `VALHALLA_URL=` — what a commented-out line collapses into — is absent
    // rather than an empty string that would reach `new URL()` as a crash.
    const config = loadApiConfig({}, { VALHALLA_URL: "  ", GEOCODER_URL: "" });
    expect(config.groundingEndpoints).toEqual({
      routing: undefined,
      geocoder: undefined,
      discovery: undefined,
    });
  });

  test("carries OVERPASS_URL as written, with no default", () => {
    // pl-29: a third endpoint, and unlike the two above it is genuinely
    // optional — the field this test reads is the same `optionalText` parse
    // as `VALHALLA_URL` and `GEOCODER_URL`, the boot-time requirement is not.
    const config = loadApiConfig({}, { OVERPASS_URL: " http://overpass:8090 " });
    expect(config.groundingEndpoints.discovery).toBe("http://overpass:8090");
  });

  test("discovery has no endpoint when OVERPASS_URL is unset, same as the other two", () => {
    expect(loadApiConfig({}, {}).groundingEndpoints.discovery).toBeUndefined();
  });

  test("bounds a grounding request by a short timeout, from its own variable", () => {
    // A run holds a queue slot while it grounds and `MAX_CONCURRENT_RUNS` is 2,
    // so two hung requests are the whole service.
    expect(loadApiConfig({}, {}).groundingTimeoutMs).toBe(5_000);
    expect(loadApiConfig({}, { GROUNDING_TIMEOUT_MS: "1200" }).groundingTimeoutMs).toBe(1_200);
  });

  test("caches a place for longer than a road, because the facts age differently", () => {
    // The whole of pl-25's title. One number for both would either re-measure
    // every road every week or keep serving a driving time long after the road
    // it describes was rebuilt.
    const ttl = loadApiConfig({}, {}).groundingCacheTtlHours;
    expect(ttl.locate).toBe(8_760);
    expect(ttl.travel).toBe(4_320);
    expect(ttl.locate).toBeGreaterThan(ttl.travel);
  });

  test("takes each grounding TTL from its own variable", () => {
    const ttl = loadApiConfig(
      {},
      { GROUNDING_CACHE_TTL_LOCATE_HOURS: "3", GROUNDING_CACHE_TTL_TRAVEL_HOURS: "9" },
    ).groundingCacheTtlHours;
    expect(ttl).toEqual({ locate: 3, travel: 9 });
  });

  test("honours a grounding TTL of zero, which is how a deployment turns the cache off", () => {
    // Beside `MAX_GROUNDING_CALLS` below and for the same reason: clamping zero
    // up to one would keep an answer somebody explicitly said not to keep.
    const ttl = loadApiConfig(
      {},
      { GROUNDING_CACHE_TTL_LOCATE_HOURS: "0", GROUNDING_CACHE_TTL_TRAVEL_HOURS: "0" },
    ).groundingCacheTtlHours;
    expect(ttl).toEqual({ locate: 0, travel: 0 });
  });

  test("falls back to the default TTL when the value is not a number", () => {
    const ttl = loadApiConfig(
      {},
      { GROUNDING_CACHE_TTL_TRAVEL_HOURS: "a fortnight" },
    ).groundingCacheTtlHours;
    expect(ttl.travel).toBe(4_320);
  });

  test("honours a grounding ceiling of zero rather than treating it as unset", () => {
    // Zero is how a deployment turns grounding off without reconfiguring the
    // provider. Clamping it up to one would spend a call it was told not to.
    expect(loadApiConfig({}, { MAX_GROUNDING_CALLS: "0" }).maxGroundingCalls).toBe(0);
    expect(loadApiConfig({}, { MAX_GROUNDING_CALLS: "not a number" }).maxGroundingCalls).toBe(40);
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

  test("trustProxy defaults off, and TRUST_PROXY is kept as a CIDR rather than coerced to a boolean", () => {
    // pl-38: off by default is load-bearing, not conservative — a limiter keyed
    // on `request.ip` with this on unconditionally would let any client mint
    // its own bucket via `X-Forwarded-For`. Mirrors the downloader's
    // `trustProxy()` in `tools/downloader/api/src/config.ts`.
    expect(loadApiConfig({}, {}).trustProxy).toBe(false);
    expect(loadApiConfig({}, { TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadApiConfig({}, { TRUST_PROXY: "false" }).trustProxy).toBe(false);
    // Not "1"/"true"/"yes"/"on", so it passes through as the CIDR itself —
    // exactly what `Fastify({ trustProxy })` and `compose.planner.prod.yaml`'s
    // `TRUST_PROXY` line both expect.
    expect(loadApiConfig({}, { TRUST_PROXY: "172.30.42.0/24" }).trustProxy).toBe("172.30.42.0/24");
  });

  test("the edits bucket defaults to 30, reads RATE_LIMIT_EDITS_PER_MINUTE, and zero disables it (pl-44)", () => {
    // A second bucket beside the runs one, not a copy of its number: a person
    // rearranging a day makes several edits a minute, and 5 would refuse them.
    expect(loadApiConfig({}, {}).rateLimitEditsPerMinute).toBe(30);
    expect(loadApiConfig({}, {}).rateLimitRunsPerMinute).toBe(5);
    expect(loadApiConfig({}, { RATE_LIMIT_EDITS_PER_MINUTE: "12" }).rateLimitEditsPerMinute).toBe(
      12,
    );
    expect(loadApiConfig({}, { RATE_LIMIT_EDITS_PER_MINUTE: "0" }).rateLimitEditsPerMinute).toBe(0);
    // Its own variable, not its sibling's.
    expect(loadApiConfig({}, { RATE_LIMIT_RUNS_PER_MINUTE: "1" }).rateLimitEditsPerMinute).toBe(30);
  });
});
