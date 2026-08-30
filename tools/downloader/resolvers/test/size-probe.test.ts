import { describe, expect, test } from "vitest";
import { createFetchSizeProbe, totalFromContentRange } from "../src/size-probe.ts";

interface Call {
  url: string;
  method: string;
  range: string | undefined;
}

function stub(handler: (call: Call) => Response): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      range: headers.get("range") ?? undefined,
    };
    calls.push(call);
    return await Promise.resolve(handler(call));
  };
  return { fetch, calls };
}

const HEADERS = { "User-Agent": "webtools", Referer: "https://example.net/" };

const throwingFetch: typeof globalThis.fetch = async () => {
  throw new Error("ECONNRESET");
};
const URL_UNDER_TEST = "https://cdn.example.net/v/segment-001.ts";

describe("totalFromContentRange", () => {
  test("takes the total after the slash, which is the only trustworthy figure", () => {
    expect(totalFromContentRange("bytes 0-0/12345")).toBe(12345);
    expect(totalFromContentRange("bytes 0-99/  4096  ")).toBe(4096);
  });

  test("refuses an unknown or malformed total rather than inventing one", () => {
    expect(totalFromContentRange("bytes 0-0/*")).toBeUndefined();
    expect(totalFromContentRange("bytes 0-0")).toBeUndefined();
    expect(totalFromContentRange(null)).toBeUndefined();
  });
});

describe("contentLength", () => {
  test("a HEAD that answers is the whole of it", async () => {
    const { fetch, calls } = stub(
      () => new Response(null, { headers: { "content-length": "6983669" } }),
    );
    const probe = createFetchSizeProbe({ fetch, headers: HEADERS });

    expect(await probe.contentLength(URL_UNDER_TEST)).toBe(6983669);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("HEAD");
  });

  test("a server that rejects HEAD is asked for one byte instead", async () => {
    const { fetch, calls } = stub((call) =>
      call.method === "HEAD"
        ? new Response(null, { status: 405 })
        : new Response("x", {
            status: 206,
            // The Content-Length here describes the range, and believing it
            // would report a 6.9 MB segment as one byte.
            headers: { "content-length": "1", "content-range": "bytes 0-0/6983669" },
          }),
    );
    const probe = createFetchSizeProbe({ fetch, headers: HEADERS });

    expect(await probe.contentLength(URL_UNDER_TEST)).toBe(6983669);
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
    expect(calls[1]?.range).toBe("bytes=0-0");
  });

  test("a 206 with no Content-Range measures nothing rather than one byte", async () => {
    const { fetch } = stub((call) =>
      call.method === "HEAD"
        ? new Response(null, { status: 403 })
        : new Response("x", { status: 206, headers: { "content-length": "1" } }),
    );
    const probe = createFetchSizeProbe({ fetch, headers: HEADERS });

    expect(await probe.contentLength(URL_UNDER_TEST)).toBeUndefined();
  });

  test("a refusal and a thrown request are both just an unmeasured size", async () => {
    const refusing = stub(() => new Response(null, { status: 403 }));
    const refused = createFetchSizeProbe({ fetch: refusing.fetch, headers: HEADERS });
    expect(await refused.contentLength(URL_UNDER_TEST)).toBeUndefined();

    const threw = createFetchSizeProbe({ fetch: throwingFetch, headers: HEADERS });
    expect(await threw.contentLength(URL_UNDER_TEST)).toBeUndefined();
  });

  test("the caller's replay headers ride every request", async () => {
    const calls: Headers[] = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      calls.push(new Headers(init?.headers));
      return await Promise.resolve(new Response(null, { status: 405 }));
    };
    const probe = createFetchSizeProbe({ fetch, headers: { Cookie: "session=abc" } });

    await probe.contentLength(URL_UNDER_TEST);

    expect(calls).toHaveLength(2);
    expect(calls.every((headers) => headers.get("cookie") === "session=abc")).toBe(true);
  });
});

describe("text", () => {
  test("returns a playlist body, and nothing at all on a refusal", async () => {
    const ok = stub(() => new Response("#EXTM3U\n"));
    expect(await createFetchSizeProbe({ fetch: ok.fetch, headers: HEADERS }).text("u")).toBe(
      "#EXTM3U\n",
    );

    const refused = stub(() => new Response("nope", { status: 404 }));
    expect(
      await createFetchSizeProbe({ fetch: refused.fetch, headers: HEADERS }).text("u"),
    ).toBeUndefined();
  });

  test("a body larger than the cap is not a playlist we should be reading", async () => {
    const declared = stub(
      () => new Response("#EXTM3U", { headers: { "content-length": "99999999" } }),
    );
    expect(
      await createFetchSizeProbe({
        fetch: declared.fetch,
        headers: HEADERS,
        maxTextBytes: 1024,
      }).text("u"),
    ).toBeUndefined();

    // And when the server declared nothing, the body itself is still capped.
    const undeclared = stub(() => new Response("x".repeat(2048)));
    expect(
      await createFetchSizeProbe({
        fetch: undeclared.fetch,
        headers: HEADERS,
        maxTextBytes: 1024,
      }).text("u"),
    ).toBeUndefined();
  });
});
