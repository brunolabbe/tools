import { describe, expect, test } from "vitest";
import { createRequestSizeProbe } from "../../src/browser/size-probe.ts";
import type {
  ApiRequestLike,
  ApiRequestOptions,
  ApiResponseLike,
} from "../../src/browser/size-probe.ts";

/**
 * Gate 1 finding B: this probe used to live inline in `browser.ts`, where the
 * only way to reach it was to launch a browser — and no test did, because the
 * suite's fake parsers never set a `bitrateBps`, so the sampler never chose a
 * reference. Extracting it behind `ApiRequestLike` is what makes the Playwright
 * call shape checkable without Playwright.
 */

interface Call {
  method: "head" | "get";
  url: string;
  options: ApiRequestOptions;
}

function response(init: {
  ok?: boolean;
  headers?: Record<string, string>;
  text?: string;
}): ApiResponseLike {
  return {
    ok: () => init.ok ?? true,
    headers: () => init.headers ?? {},
    text: async () => await Promise.resolve(init.text ?? ""),
  };
}

function stubRequest(handler: (call: Call) => ApiResponseLike): {
  request: ApiRequestLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const record =
    (method: "head" | "get") =>
    async (url: string, options: ApiRequestOptions): Promise<ApiResponseLike> => {
      const call: Call = { method, url, options };
      calls.push(call);
      return await Promise.resolve(handler(call));
    };
  return { request: { head: record("head"), get: record("get") }, calls };
}

const HEADERS = { Cookie: "session=abc", Referer: "https://example.net/" };
const FAR = Date.now() + 60_000;
const URL_UNDER_TEST = "https://cdn.example.net/v/seg-00001.m4s";

describe("contentLength over a browser request context", () => {
  test("reads the Content-Length of a HEAD that answers", async () => {
    const { request, calls } = stubRequest(() =>
      response({ headers: { "content-length": "4096" } }),
    );

    expect(await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST)).toBe(
      4096,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("head");
    expect(calls[0]?.options.headers).toEqual(HEADERS);
    // Never throw on a 4xx: the probe decides, not Playwright.
    expect(calls[0]?.options.failOnStatusCode).toBe(false);
  });

  test("falls back to a ranged GET and trusts only Content-Range", async () => {
    const { request, calls } = stubRequest((call) =>
      call.method === "head"
        ? response({ ok: false })
        : response({
            headers: { "content-length": "1", "content-range": "bytes 0-0/4096" },
          }),
    );

    expect(await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST)).toBe(
      4096,
    );
    expect(calls.map((call) => call.method)).toEqual(["head", "get"]);
    expect(calls[1]?.options.headers["Range"]).toBe("bytes=0-0");
    // The replay headers survive alongside the Range.
    expect(calls[1]?.options.headers["Cookie"]).toBe("session=abc");
  });

  test("a refusal, a missing Content-Range and a throw are all just unmeasured", async () => {
    const refusing = stubRequest(() => response({ ok: false }));
    expect(
      await createRequestSizeProbe(refusing.request, HEADERS, FAR).contentLength(URL_UNDER_TEST),
    ).toBeUndefined();

    const noRange = stubRequest((call) =>
      call.method === "head" ? response({ ok: false }) : response({ headers: {} }),
    );
    expect(
      await createRequestSizeProbe(noRange.request, HEADERS, FAR).contentLength(URL_UNDER_TEST),
    ).toBeUndefined();

    const throwing: ApiRequestLike = {
      head: async () => await Promise.reject(new Error("net::ERR_ABORTED")),
      get: async () => await Promise.reject(new Error("net::ERR_ABORTED")),
    };
    expect(
      await createRequestSizeProbe(throwing, HEADERS, FAR).contentLength(URL_UNDER_TEST),
    ).toBeUndefined();
  });

  test("a HEAD that answers 200 with no length still falls through to the range", async () => {
    const { calls, request } = stubRequest((call) =>
      call.method === "head"
        ? response({ headers: {} })
        : response({ headers: { "content-range": "bytes 0-0/77" } }),
    );

    expect(await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST)).toBe(
      77,
    );
    expect(calls.map((call) => call.method)).toEqual(["head", "get"]);
  });
});

describe("text over a browser request context", () => {
  test("returns a playlist body and nothing on a refusal", async () => {
    const ok = stubRequest(() => response({ text: "#EXTM3U\n" }));
    expect(await createRequestSizeProbe(ok.request, HEADERS, FAR).text("u")).toBe("#EXTM3U\n");

    const refused = stubRequest(() => response({ ok: false }));
    expect(await createRequestSizeProbe(refused.request, HEADERS, FAR).text("u")).toBeUndefined();
  });
});

describe("the caller's deadline", () => {
  test("spends nothing once too little of it is left to be worth a request", async () => {
    const spent = stubRequest(() => response({ headers: { "content-length": "4096" } }));
    const probe = createRequestSizeProbe(spent.request, HEADERS, Date.now() + 100);

    expect(await probe.contentLength(URL_UNDER_TEST)).toBeUndefined();
    expect(await probe.text(URL_UNDER_TEST)).toBeUndefined();
    expect(spent.calls).toEqual([]);
  });

  test("what is left of it becomes the request timeout", async () => {
    const { request, calls } = stubRequest(() =>
      response({ headers: { "content-length": "4096" } }),
    );

    await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST);

    // Capped rather than handed the whole 60 s that remains.
    expect(calls[0]?.options.timeout).toBe(4000);
  });
});
