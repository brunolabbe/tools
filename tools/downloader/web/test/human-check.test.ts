// @vitest-environment jsdom

/**
 * The page's half of dl-50: a fresh Turnstile token for each checked request.
 *
 * Cloudflare's script cannot load here — jsdom has no network and the suite
 * reaches none — so `window.turnstile` is a fake that behaves the way the
 * widget is documented to in `execution: "execute"` mode: `execute` on a
 * widget already holding a token does nothing until it is `reset`. That is the
 * property the "fresh token each time" line rests on, so the fake enforces it
 * rather than handing out a new token on every `execute` regardless.
 *
 * What the real widget does in a real browser is `e2e/turnstile/`, which is
 * opt-in because it reaches Cloudflare — this file proves the page drives the
 * widget correctly.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { ClientConfigResponse } from "@downloader/contract";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createHttpClient } from "../src/api/http.ts";
import {
  createTurnstileCheck,
  HUMAN_CHECK_HOST_CLASS,
  TURNSTILE_SCRIPT_URL,
} from "../src/lib/human-check.ts";
import type {
  HumanCheckFactory,
  TurnstileApi,
  TurnstileRenderOptions,
} from "../src/lib/human-check.ts";
import { job, probe } from "./fixtures.ts";

const SITE_KEY = "1x00000000000000000000AA";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

type Outcome = "token" | "error" | "timeout";

/** A widget that honours the one rule the real one has: no reset, no new token. */
class FakeTurnstile implements TurnstileApi {
  rendered: { container: HTMLElement; options: TurnstileRenderOptions }[] = [];
  executes = 0;
  resets = 0;
  /** What the next `execute` does. */
  next: Outcome = "token";
  #holdsToken = false;
  #minted = 0;

  render(container: HTMLElement, options: TurnstileRenderOptions): string {
    this.rendered.push({ container, options });
    return `widget-${this.rendered.length}`;
  }

  execute(): void {
    this.executes++;
    if (this.#holdsToken) return;
    const options = this.rendered.at(-1)?.options;
    const outcome = this.next;
    queueMicrotask(() => {
      if (outcome === "error") options?.["error-callback"]("300030");
      else if (outcome === "timeout") options?.["timeout-callback"]();
      else {
        this.#holdsToken = true;
        this.#minted++;
        options?.callback(`token-${this.#minted}`);
      }
    });
  }

  reset(): void {
    this.resets++;
    this.#holdsToken = false;
  }
}

function config(humanCheck: ClientConfigResponse["humanCheck"]) {
  return vi.fn(async (): Promise<ClientConfigResponse> => ({ humanCheck }));
}

describe("createTurnstileCheck", () => {
  test("with no check configured, no token and no script", async () => {
    const turnstile = new FakeTurnstile();
    const loadTurnstile = vi.fn(async () => turnstile);
    const tokens = createTurnstileCheck(config(null), { loadTurnstile });

    expect(await tokens.next()).toBeNull();
    expect(await tokens.next()).toBeNull();
    expect(loadTurnstile).not.toHaveBeenCalled();
  });

  test("each call gets its own token: the widget is reset before every execute after the first", async () => {
    const turnstile = new FakeTurnstile();
    const readConfig = config({ siteKey: SITE_KEY });
    const tokens = createTurnstileCheck(readConfig, { loadTurnstile: async () => turnstile });

    const forProbe = await tokens.next();
    const forJob = await tokens.next();

    expect(forProbe).toBe("token-1");
    expect(forJob).toBe("token-2");
    expect(turnstile.resets).toBe(1);
    // Rendered once, read once: one widget serves the life of the page.
    expect(turnstile.rendered).toHaveLength(1);
    expect(readConfig).toHaveBeenCalledTimes(1);
  });

  test("renders invisibly, on demand, with the deployment's site key", async () => {
    const turnstile = new FakeTurnstile();
    const tokens = createTurnstileCheck(config({ siteKey: SITE_KEY }), {
      loadTurnstile: async () => turnstile,
    });

    await tokens.next();

    const [{ container, options }] = turnstile.rendered as [FakeTurnstile["rendered"][number]];
    expect(options.sitekey).toBe(SITE_KEY);
    expect(options.execution).toBe("execute");
    expect(options.appearance).toBe("interaction-only");
    // Where a challenge draws itself if Cloudflare asks for a person.
    expect(container.classList.contains(HUMAN_CHECK_HOST_CLASS)).toBe(true);
    expect(container.isConnected).toBe(true);
  });

  test("a widget error or an unanswered challenge rejects as HUMAN_CHECK_FAILED, and the next call still works", async () => {
    const turnstile = new FakeTurnstile();
    const tokens = createTurnstileCheck(config({ siteKey: SITE_KEY }), {
      loadTurnstile: async () => turnstile,
    });

    turnstile.next = "error";
    await expect(tokens.next()).rejects.toMatchObject({ code: "HUMAN_CHECK_FAILED" });
    turnstile.next = "timeout";
    await expect(tokens.next()).rejects.toMatchObject({ code: "HUMAN_CHECK_FAILED" });

    turnstile.next = "token";
    expect(await tokens.next()).toBe("token-1");
  });

  test("concurrent calls take turns rather than resetting the widget under each other", async () => {
    const turnstile = new FakeTurnstile();
    const tokens = createTurnstileCheck(config({ siteKey: SITE_KEY }), {
      loadTurnstile: async () => turnstile,
    });

    const both = await Promise.all([tokens.next(), tokens.next()]);

    expect(both).toEqual(["token-1", "token-2"]);
  });

  test("a config read that fails sends no token, and is tried again next time", async () => {
    const turnstile = new FakeTurnstile();
    const readConfig = vi
      .fn<() => Promise<ClientConfigResponse>>()
      .mockRejectedValueOnce(new AppError("UNREACHABLE"))
      .mockResolvedValue({ humanCheck: { siteKey: SITE_KEY } });
    const tokens = createTurnstileCheck(readConfig, { loadTurnstile: async () => turnstile });

    // The server decides: if it wanted a token, it answers HUMAN_CHECK_FAILED.
    expect(await tokens.next()).toBeNull();
    expect(await tokens.next()).toBe("token-1");
  });

  test("a script that fails to load rejects, and is tried again next time", async () => {
    const turnstile = new FakeTurnstile();
    const loadTurnstile = vi
      .fn<() => Promise<TurnstileApi>>()
      .mockRejectedValueOnce(new AppError("HUMAN_CHECK_FAILED"))
      .mockResolvedValue(turnstile);
    const tokens = createTurnstileCheck(config({ siteKey: SITE_KEY }), { loadTurnstile });

    await expect(tokens.next()).rejects.toMatchObject({ code: "HUMAN_CHECK_FAILED" });
    expect(await tokens.next()).toBe("token-1");
  });

  test("the default loader asks for Cloudflare's script, explicitly rendered", async () => {
    const tokens = createTurnstileCheck(config({ siteKey: SITE_KEY }));

    const pending = tokens.next();
    await vi.waitFor(() => expect(document.head.querySelector("script")).not.toBeNull());
    const script = document.head.querySelector("script") as HTMLScriptElement;
    expect(script.src).toBe(TURNSTILE_SCRIPT_URL);

    // jsdom will not fetch it. Fail the load the way a blocked script fails.
    script.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toMatchObject({ code: "HUMAN_CHECK_FAILED" });
  });
});

function stubFetch() {
  const fetchSpy = vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    if (path === ROUTES.probe) return Response.json({ probe: probe(), cached: false });
    if (path === ROUTES.config) return Response.json({ humanCheck: { siteKey: SITE_KEY } });
    return Response.json({ job: job("queued") }, { status: 201 });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function bodyOf(fetchSpy: ReturnType<typeof stubFetch>, path: string): Record<string, unknown> {
  const call = fetchSpy.mock.calls.find(([input]) => String(input) === path);
  const init = (call as unknown as [string, RequestInit] | undefined)?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("the HTTP transport", () => {
  test("the probe and the job each carry a token taken for that request", async () => {
    const fetchSpy = stubFetch();
    let minted = 0;
    const humanCheck: HumanCheckFactory = () => ({ next: async () => `token-${++minted}` });
    const client = createHttpClient({ humanCheck });

    await client.probe({ url: "https://example.com/watch" });
    await client.createJob({ url: "https://example.com/watch" });

    expect(bodyOf(fetchSpy, ROUTES.probe)).toMatchObject({ humanCheckToken: "token-1" });
    expect(bodyOf(fetchSpy, ROUTES.jobs)).toMatchObject({ humanCheckToken: "token-2" });
  });

  test("with the real check, the site key comes from GET /api/config, read once", async () => {
    const fetchSpy = stubFetch();
    const turnstile = new FakeTurnstile();
    const client = createHttpClient({
      humanCheck: (readConfig) =>
        createTurnstileCheck(readConfig, { loadTurnstile: async () => turnstile }),
    });

    await client.probe({ url: "https://example.com/watch" });
    await client.createJob({ url: "https://example.com/watch" });

    const configReads = fetchSpy.mock.calls.filter(([input]) => String(input) === ROUTES.config);
    expect(configReads).toHaveLength(1);
    expect(turnstile.rendered[0]?.options.sitekey).toBe(SITE_KEY);
    expect(bodyOf(fetchSpy, ROUTES.probe)["humanCheckToken"]).toBe("token-1");
    expect(bodyOf(fetchSpy, ROUTES.jobs)["humanCheckToken"]).toBe("token-2");
  });

  test("with no check, the bodies are exactly what they were before dl-50", async () => {
    const fetchSpy = stubFetch();
    const client = createHttpClient();

    await client.probe({ url: "https://example.com/watch" });
    await client.createJob({ url: "https://example.com/watch" });

    expect(bodyOf(fetchSpy, ROUTES.probe)).toEqual({ url: "https://example.com/watch" });
    expect(bodyOf(fetchSpy, ROUTES.jobs)).toEqual({ url: "https://example.com/watch" });
    // And nobody asked the server about a check it has no part in.
    expect(fetchSpy.mock.calls.some(([input]) => String(input) === ROUTES.config)).toBe(false);
  });
});

// dl-141: a `GET /api/config` that never answers used to be the memo for every
// later call, and none of them reached the fetch where dl-138's bounds start.
// The figure is pinned here on purpose, as `request-timeout.test.ts` pins its
// two: a change to it should be a change to this line.
const CONFIG_READ_TIMEOUT_MS = 15_000;

describe("a config read that never answers (dl-141)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NEVER = (): Promise<ClientConfigResponse> => new Promise(() => {});

  test("next() sends no token at the bound, not before, and the read is aborted", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const readConfig = vi.fn((given?: AbortSignal) => {
      signal = given;
      return NEVER();
    });
    const tokens = createTurnstileCheck(readConfig, { loadTurnstile: vi.fn() });

    let settled: { token: string | null } | undefined;
    void tokens.next().then((token) => (settled = { token }));

    await vi.advanceTimersByTimeAsync(CONFIG_READ_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ token: null });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("every call waiting on the shared read is freed together, and the next call reads again", async () => {
    vi.useFakeTimers();
    const turnstile = new FakeTurnstile();
    const readConfig = vi
      .fn<(signal?: AbortSignal) => Promise<ClientConfigResponse>>()
      .mockImplementationOnce(NEVER)
      .mockResolvedValue({ humanCheck: { siteKey: SITE_KEY } });
    const tokens = createTurnstileCheck(readConfig, { loadTurnstile: async () => turnstile });

    const waiting = Promise.all([tokens.next(), tokens.next(), tokens.next()]);
    await vi.advanceTimersByTimeAsync(CONFIG_READ_TIMEOUT_MS);
    expect(await waiting).toEqual([null, null, null]);
    expect(readConfig).toHaveBeenCalledTimes(1);

    // Not memoised: the timed-out read is cleared as a rejected one is.
    expect(await tokens.next()).toBe("token-1");
    expect(readConfig).toHaveBeenCalledTimes(2);
  });

  test("a read that answers inside the bound is used, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const turnstile = new FakeTurnstile();
    const tokens = createTurnstileCheck(
      () =>
        new Promise<ClientConfigResponse>((resolve) =>
          setTimeout(
            () => resolve({ humanCheck: { siteKey: SITE_KEY } }),
            CONFIG_READ_TIMEOUT_MS - 1,
          ),
        ),
      { loadTurnstile: async () => turnstile },
    );

    const token = tokens.next();
    await vi.advanceTimersByTimeAsync(CONFIG_READ_TIMEOUT_MS - 1);
    expect(await token).toBe("token-1");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the HTTP transport over a config read that never answers (dl-141)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("two probes and a createJob are freed at the bound, sent with no token, and a later call reads the config again", async () => {
    vi.useFakeTimers();
    let configReads = 0;
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === ROUTES.config) {
        configReads++;
        // The first read stalls for good; the retry is answered.
        if (configReads === 1) return await new Promise<Response>(() => {});
        return Response.json({ humanCheck: null });
      }
      if (path === ROUTES.probe) return Response.json({ probe: probe(), cached: false });
      return Response.json({ job: job("queued") }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createHttpClient({ humanCheck: createTurnstileCheck });

    const pending = Symbol("pending");
    const outcomes: unknown[] = [pending, pending, pending];
    const calls = [
      client.probe({ url: "https://example.com/a" }),
      client.probe({ url: "https://example.com/b" }),
      client.createJob({ url: "https://example.com/c" }),
    ];
    calls.forEach((call, index) => {
      call.then(
        (value) => (outcomes[index] = { resolved: value }),
        (error: unknown) => (outcomes[index] = error),
      );
    });

    // Just short of the bound: all three wait, and the only fetch is the read.
    await vi.advanceTimersByTimeAsync(CONFIG_READ_TIMEOUT_MS - 1);
    expect(outcomes).toEqual([pending, pending, pending]);
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([ROUTES.config]);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcomes.some((outcome) => outcome === pending)).toBe(false);
    // Each went out with no token: the server decides.
    for (const path of [ROUTES.probe, ROUTES.jobs]) {
      expect(bodyOf(fetchSpy as unknown as ReturnType<typeof stubFetch>, path)).not.toHaveProperty(
        "humanCheckToken",
      );
    }

    await client.probe({ url: "https://example.com/d" });
    expect(configReads).toBe(2);
  });

  test("the config fetch is handed a signal, aborted at the bound and not before, so a read given up on is closed (dl-141)", async () => {
    vi.useFakeTimers();
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === ROUTES.config) {
        signals.push(init?.signal);
        return await new Promise<Response>(() => {});
      }
      return Response.json({ probe: probe(), cached: false });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createHttpClient({ humanCheck: createTurnstileCheck });

    const call = client.probe({ url: "https://example.com/a" });

    await vi.advanceTimersByTimeAsync(CONFIG_READ_TIMEOUT_MS - 1);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await call;
  });
});
