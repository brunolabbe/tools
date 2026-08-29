import path from "node:path";
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

  test("falls back to the scripted provider when the name is unknown", () => {
    // Visibly scripted is a safe failure — health reports it by name — so a
    // typo should not stop the process the way a bad egress setting would.
    expect(loadApiConfig({}, { MODEL_PROVIDER: "gpt-9" }).modelProvider).toBe("scripted");
  });

  test("defaults grounding to the fixture provider, so a fresh clone needs no key", () => {
    expect(loadApiConfig({}, {}).groundingProvider).toBe("fixtures");
    expect(loadApiConfig({}, {}).maxGroundingCalls).toBe(40);
  });

  test("falls back to the fixture provider when the grounding name is unknown", () => {
    // Beside the `MODEL_PROVIDER` case above and for the same reason: a typo
    // here cannot send a request anywhere, so the worst case is a plan whose
    // legs are unmeasured and which says so — reported by name at
    // `/api/health`. Refusing to boot would trade that for no plan at all.
    //
    // The example used to be `valhalla`, which pl-28 made a real name. Anything
    // this list does not hold does the same thing; the assertion is about the
    // fallback, not about that word.
    expect(loadApiConfig({}, { GROUNDING_PROVIDER: "osrm" }).groundingProvider).toBe("fixtures");
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
});
