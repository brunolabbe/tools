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

describe("bytes (dl-64)", () => {
  const FILE = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);

  function ranged(call: Call): Response {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/u.exec(call.range ?? "") ?? [];
    const start = Number(from);
    const end = Math.min(Number(to), FILE.byteLength - 1);
    return new Response(FILE.slice(start, end + 1), {
      status: 206,
      headers: {
        "content-range": `bytes ${String(start)}-${String(end)}/${String(FILE.byteLength)}`,
      },
    });
  }

  test("answers the range asked for, with the total the server named, replaying headers", async () => {
    const seen: Headers[] = [];
    const served = stub((call) => ranged(call));
    const fetch: typeof globalThis.fetch = async (input, init) => {
      seen.push(new Headers(init?.headers));
      return await served.fetch(input, init);
    };
    const probe = createFetchSizeProbe({ fetch, headers: HEADERS });

    const answer = await probe.bytes(URL_UNDER_TEST, 100, 199);

    expect(served.calls).toEqual([{ url: URL_UNDER_TEST, method: "GET", range: "bytes=100-199" }]);
    expect(answer?.totalBytes).toBe(1000);
    expect(answer?.bytes).toEqual(FILE.slice(100, 200));
    expect(seen[0]?.get("referer")).toBe(HEADERS.Referer);

    // A range running past the end comes back short, not refused.
    expect((await probe.bytes(URL_UNDER_TEST, 900, 1999))?.bytes.byteLength).toBe(100);
  });

  test("a server that ignores Range is read no further than the range, and from byte zero only", async () => {
    let pulled = 0;
    let canceled = false;
    const endless = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(4096));
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "content-length": "9999999999" } },
      );
    const ignoring = stub(() => endless());
    const probe = createFetchSizeProbe({ fetch: ignoring.fetch, headers: HEADERS });

    const prefix = await probe.bytes(URL_UNDER_TEST, 0, 9999);
    expect(prefix?.bytes.byteLength).toBe(10_000);
    expect(prefix?.totalBytes).toBe(9_999_999_999);
    expect(canceled).toBe(true);
    // Three 4 KiB chunks cover the range; a stream may be pulled ahead a little.
    expect(pulled).toBeLessThan(10);

    // From anywhere else, a whole-file body is the wrong bytes.
    expect(await probe.bytes(URL_UNDER_TEST, 40, 99)).toBeUndefined();
  });

  test("a 206 for another range, a refusal, a throw, or a request over the cap is no answer", async () => {
    const elsewhere = stub(
      () =>
        new Response(FILE.slice(0, 60), {
          status: 206,
          headers: { "content-range": "bytes 0-59/1000" },
        }),
    );
    const wrongRange = createFetchSizeProbe({ fetch: elsewhere.fetch, headers: HEADERS });
    expect(await wrongRange.bytes("u", 40, 99)).toBeUndefined();

    const refused = stub(() => new Response(null, { status: 416 }));
    const refusing = createFetchSizeProbe({ fetch: refused.fetch, headers: HEADERS });
    expect(await refusing.bytes("u", 0, 9)).toBeUndefined();

    const threw = createFetchSizeProbe({ fetch: throwingFetch, headers: HEADERS });
    expect(await threw.bytes("u", 0, 9)).toBeUndefined();

    const counted = stub((call) => ranged(call));
    const capped = createFetchSizeProbe({
      fetch: counted.fetch,
      headers: HEADERS,
      maxRangeBytes: 64,
    });
    expect(await capped.bytes("u", 0, 64)).toBeUndefined();
    expect(await capped.bytes("u", -1, 10)).toBeUndefined();
    expect(await capped.bytes("u", 10, 9)).toBeUndefined();
    expect(counted.calls).toEqual([]);
  });
});
