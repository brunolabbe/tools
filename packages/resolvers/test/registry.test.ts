import { AppError } from "@downloader/shared";
import type { ProbeResult, Resolver, ResolveOptions } from "@downloader/shared";
import { describe, expect, test } from "vitest";
import { ResolverRegistry } from "../src/registry.ts";
import { YtDlpResolver } from "../src/resolvers/ytdlp.ts";

function probe(resolver: string): ProbeResult {
  return {
    sourceUrl: "https://example.com/watch",
    resolver,
    title: "A video",
    variants: [
      {
        id: "v0",
        protocol: "hls",
        url: "https://cdn.example.com/master.m3u8",
        hasVideo: true,
        hasAudio: true,
        label: "1080p · H.264 + AAC",
      },
    ],
    subtitles: [],
    requestContext: { headers: {} },
    drm: { protected: false, systems: [] },
    isLive: false,
    probedAt: new Date().toISOString(),
  };
}

interface StubOptions {
  name: string;
  priority: number;
  canHandle?: boolean;
  behaviour: "succeed" | "no-media" | AppError | "never-settles";
}

class StubResolver implements Resolver {
  readonly name: string;
  readonly priority: number;
  readonly calls: string[] = [];
  disposed = 0;

  readonly #canHandle: boolean;
  readonly #behaviour: StubOptions["behaviour"];

  constructor(config: StubOptions) {
    this.name = config.name;
    this.priority = config.priority;
    this.#canHandle = config.canHandle ?? true;
    this.#behaviour = config.behaviour;
  }

  canHandle(): boolean {
    return this.#canHandle;
  }

  async resolve(url: URL, resolveOptions: ResolveOptions): Promise<ProbeResult> {
    this.calls.push(url.href);
    if (this.#behaviour === "succeed") return probe(this.name);
    if (this.#behaviour === "no-media") throw new AppError("NO_MEDIA_FOUND");
    if (this.#behaviour instanceof AppError) throw this.#behaviour;
    // Models a real resolver: it does nothing until its signal aborts.
    await new Promise<never>((_, reject) => {
      resolveOptions.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("aborted by signal"));
        },
        { once: true },
      );
    });
    throw new AppError("INTERNAL", "unreachable");
  }

  async dispose(): Promise<void> {
    this.disposed += 1;
    await Promise.resolve();
  }
}

const URL_UNDER_TEST = new URL("https://example.com/watch");

function options(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  return { timeoutMs: 5000, signal: new AbortController().signal, ...overrides };
}

describe("ordering", () => {
  test("tries resolvers in ascending priority regardless of registration order", async () => {
    const late = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });
    const early = new StubResolver({ name: "yt-dlp", priority: 20, behaviour: "no-media" });
    const registry = new ResolverRegistry([late, early]);

    expect(registry.resolvers.map((resolver) => resolver.name)).toEqual(["yt-dlp", "browser"]);
    const result = await registry.resolve(URL_UNDER_TEST, options());
    expect(result.resolver).toBe("browser");
    expect(early.calls).toHaveLength(1);
  });

  test("register() keeps the chain sorted", () => {
    const registry = new ResolverRegistry([
      new StubResolver({ name: "direct", priority: 90, behaviour: "succeed" }),
    ]);
    registry.register(new StubResolver({ name: "site", priority: 10, behaviour: "succeed" }));
    expect(registry.resolvers.map((resolver) => resolver.name)).toEqual(["site", "direct"]);
  });

  test("resolvers whose canHandle() is false are never called", async () => {
    const skipped = new StubResolver({
      name: "site",
      priority: 10,
      canHandle: false,
      behaviour: "succeed",
    });
    const used = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });
    const result = await new ResolverRegistry([skipped, used]).resolve(URL_UNDER_TEST, options());

    expect(skipped.calls).toEqual([]);
    expect(result.resolver).toBe("browser");
  });

  test("no candidate at all is NO_MEDIA_FOUND", async () => {
    const registry = new ResolverRegistry([
      new StubResolver({ name: "a", priority: 10, canHandle: false, behaviour: "succeed" }),
    ]);
    await expect(registry.resolve(URL_UNDER_TEST, options())).rejects.toMatchObject({
      code: "NO_MEDIA_FOUND",
    });
  });
});

describe("fallthrough versus rethrow", () => {
  test("NO_MEDIA_FOUND continues to the next tier", async () => {
    const first = new StubResolver({ name: "yt-dlp", priority: 20, behaviour: "no-media" });
    const second = new StubResolver({ name: "browser", priority: 50, behaviour: "no-media" });
    const third = new StubResolver({ name: "direct", priority: 90, behaviour: "succeed" });

    const result = await new ResolverRegistry([first, second, third]).resolve(
      URL_UNDER_TEST,
      options(),
    );
    expect(result.resolver).toBe("direct");
    expect([first.calls.length, second.calls.length, third.calls.length]).toEqual([1, 1, 1]);
  });

  test("DRM_PROTECTED stops the chain immediately", async () => {
    const first = new StubResolver({
      name: "yt-dlp",
      priority: 20,
      behaviour: new AppError("DRM_PROTECTED"),
    });
    const second = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });

    await expect(
      new ResolverRegistry([first, second]).resolve(URL_UNDER_TEST, options()),
    ).rejects.toMatchObject({ code: "DRM_PROTECTED" });
    expect(second.calls).toEqual([]);
  });

  test("AUTH_REQUIRED stops the chain immediately", async () => {
    const first = new StubResolver({
      name: "yt-dlp",
      priority: 20,
      behaviour: new AppError("AUTH_REQUIRED"),
    });
    const second = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });

    await expect(
      new ResolverRegistry([first, second]).resolve(URL_UNDER_TEST, options()),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(second.calls).toEqual([]);
  });

  test("a non-AppError from a resolver becomes INTERNAL and stops the chain", async () => {
    class Exploding implements Resolver {
      readonly name = "boom";
      readonly priority = 10;
      canHandle(): boolean {
        return true;
      }
      resolve(): Promise<ProbeResult> {
        return Promise.reject(new TypeError("undefined is not a function"));
      }
    }
    const second = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });

    await expect(
      new ResolverRegistry([new Exploding(), second]).resolve(URL_UNDER_TEST, options()),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(second.calls).toEqual([]);
  });

  test("exhausting the chain is NO_MEDIA_FOUND and lists what was tried", async () => {
    const registry = new ResolverRegistry([
      new StubResolver({ name: "yt-dlp", priority: 20, behaviour: "no-media" }),
      new StubResolver({ name: "browser", priority: 50, behaviour: "no-media" }),
    ]);
    const error = await registry
      .resolve(URL_UNDER_TEST, options())
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("NO_MEDIA_FOUND");
    expect((error as AppError).details?.["attempts"]).toEqual([
      { resolver: "yt-dlp", code: "NO_MEDIA_FOUND" },
      { resolver: "browser", code: "NO_MEDIA_FOUND" },
    ]);
  });
});

describe("the timeout is a budget for the whole chain", () => {
  test("a resolver that hangs past timeoutMs yields TIMEOUT", async () => {
    const registry = new ResolverRegistry([
      new StubResolver({ name: "browser", priority: 50, behaviour: "never-settles" }),
    ]);
    await expect(
      registry.resolve(URL_UNDER_TEST, options({ timeoutMs: 60 })),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  test("time already spent by earlier tiers counts against the budget", async () => {
    const slow = new StubResolver({ name: "yt-dlp", priority: 20, behaviour: "never-settles" });
    const later = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });
    const registry = new ResolverRegistry([slow, later]);

    await expect(
      registry.resolve(URL_UNDER_TEST, options({ timeoutMs: 60 })),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    // The budget was spent, so the next tier is never given a turn.
    expect(later.calls).toEqual([]);
  });

  test("the caller's own signal cancels the chain", async () => {
    const controller = new AbortController();
    const registry = new ResolverRegistry([
      new StubResolver({ name: "browser", priority: 50, behaviour: "never-settles" }),
    ]);
    const pending = registry.resolve(URL_UNDER_TEST, options({ signal: controller.signal }));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "JOB_CANCELED" });
  });
});

describe("dispose", () => {
  test("disposes every registered resolver", async () => {
    const first = new StubResolver({ name: "a", priority: 10, behaviour: "succeed" });
    const second = new StubResolver({ name: "b", priority: 50, behaviour: "succeed" });
    await new ResolverRegistry([first, second]).dispose();
    expect([first.disposed, second.disposed]).toEqual([1, 1]);
  });

  test("one failing dispose does not strand the others", async () => {
    class BadDispose implements Resolver {
      readonly name = "leaky";
      readonly priority = 10;
      canHandle(): boolean {
        return true;
      }
      resolve(): Promise<ProbeResult> {
        return Promise.resolve(probe(this.name));
      }
      dispose(): Promise<void> {
        return Promise.reject(new Error("browser already gone"));
      }
    }
    const healthy = new StubResolver({ name: "b", priority: 50, behaviour: "succeed" });

    await expect(new ResolverRegistry([new BadDispose(), healthy]).dispose()).rejects.toMatchObject(
      { code: "INTERNAL" },
    );
    expect(healthy.disposed).toBe(1);
  });
});

describe("the yt-dlp tier is expendable", () => {
  test("with yt-dlp disabled, resolution still succeeds via the next tier", async () => {
    const ytdlp = new YtDlpResolver({ enabled: false });
    const sniffer = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });
    const registry = new ResolverRegistry([ytdlp, sniffer]);

    expect(ytdlp.canHandle(URL_UNDER_TEST)).toBe(false);
    expect(ytdlp.available).toBe(false);

    const result = await registry.resolve(URL_UNDER_TEST, options());
    expect(result.resolver).toBe("browser");
    expect(result.variants).toHaveLength(1);
  });

  test("a missing yt-dlp binary is a fallthrough, never an error", async () => {
    const ytdlp = new YtDlpResolver({ binaryPath: "yt-dlp-that-is-not-installed-anywhere" });
    const sniffer = new StubResolver({ name: "browser", priority: 50, behaviour: "succeed" });

    expect(ytdlp.canHandle(URL_UNDER_TEST)).toBe(false);
    const result = await new ResolverRegistry([ytdlp, sniffer]).resolve(URL_UNDER_TEST, options());
    expect(result.resolver).toBe("browser");
  });
});
