// @vitest-environment jsdom

/**
 * dl-138 at the level of the page: what the client's two timeouts do to the
 * counts the page keeps (`app.test.tsx`'s F1 and gate 2 N1 cases are the rule
 * for a request that settles; these are the request that does not).
 *
 * **The client is the real `createHttpClient`**, over a stubbed `fetch` that
 * models the server, so the bound the page meets is the one the transport
 * enforces and not a fake's. Only the three browser-only members (the two
 * `EventSource` openers and the link click) are replaced, because jsdom has no
 * `EventSource`.
 *
 * **How the clock is stepped.** Fake timers, and `advanceTimersByTimeAsync`
 * inside `act`, in steps that end on the reading: to one millisecond short of
 * the bound, then to the bound plus one second. dl-138's gate measured that a
 * single 30-minute jump reads a later failure and not the fix, because a
 * request started at the bound times out at twice it. Here nothing started at
 * the bound is allowed to reach its own, so the reading is the first one.
 *
 * The file is separate from `app.test.tsx` on purpose: those cases must stay
 * green unchanged, and the harness here differs (a real client, not a fake).
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ROUTES } from "@downloader/contract";
import type { HttpClientOptions } from "../src/api/http.ts";
import type { ApiClient } from "../src/api/types.ts";
import { createTurnstileCheck } from "../src/lib/human-check.ts";
import { JOB_WAITING, PROBE_WAITING } from "../src/lib/probe-stages.ts";
import { NOW, job, probe } from "./fixtures.ts";

const PROBE_TIMEOUT_MS = 90_000;
const CREATE_JOB_TIMEOUT_MS = 30_000;

/** One POST the model server holds, until it is answered or its socket closes. */
interface Post {
  url: string;
  open: boolean;
  answer: (response: Response) => void;
}

interface Server {
  /** The probe POSTs received, in order, each one's `open` live. */
  probes: Post[];
  /** The job POSTs received, in order. */
  jobs: Post[];
  /** Slots the server holds for this client: probes still open. */
  heldProbes: () => number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function titleOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

/**
 * The server's per-client probe rule as `routes/probe.ts` holds it: a slot per
 * unfinished POST, released when its handler ends, a third refused. This model
 * frees the slot when the POST is answered or its socket is aborted, which the
 * line it serves specifies; the real server does not free it on an abort (gate
 * 1 measured the slot still held 3 s later, 10 of 10 runs), and keeps it until
 * its own handler ends. `autoAnswer` answers each POST on arrival,
 * which is the server being quick; unset, a POST is held until the test
 * answers it or the socket closes.
 */
function modelServer(
  options: {
    answerProbes?: boolean;
    /** Which job POSTs are answered on arrival, by their order from 0. */
    answerJob?: (index: number) => boolean;
  } = {},
): Server {
  const probes: Post[] = [];
  const jobs: Post[] = [];

  function hold(post: Post[], url: string, init: RequestInit | undefined): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const entry: Post = {
        url,
        open: true,
        answer: (response) => {
          entry.open = false;
          resolve(response);
        },
      };
      init?.signal?.addEventListener("abort", () => {
        entry.open = false;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      post.push(entry);
    });
  }

  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const url = (JSON.parse(String(init?.body ?? "{}")) as { url?: string }).url ?? "";
      if (path === ROUTES.probe) {
        if (probes.filter((post) => post.open).length >= 2) {
          return Promise.resolve(
            json(
              {
                error: {
                  code: "RATE_LIMITED",
                  message: "You already have as many analyses running as this server allows.",
                  retryable: true,
                },
              },
              429,
            ),
          );
        }
        const pending = hold(probes, url, init);
        if (options.answerProbes === true) {
          probes.at(-1)?.answer(json({ probe: probe({ title: titleOf(url) }), cached: false }));
        }
        return pending;
      }
      if (path === ROUTES.jobs) {
        const index = jobs.length;
        const pending = hold(jobs, url, init);
        if (options.answerJob?.(index) === true) {
          jobs.at(-1)?.answer(json({ job: job("queued", { id: `job-${String(index + 1)}` }) }));
        }
        return pending;
      }
      return Promise.reject(new TypeError(`unexpected request ${path}`));
    }),
  );

  return { probes, jobs, heldProbes: () => probes.filter((post) => post.open).length };
}

async function mountApp(options: HttpClientOptions = {}): Promise<ApiClient> {
  vi.resetModules();
  const { createHttpClient } = await import("../src/api/http.ts");
  const client: ApiClient = {
    ...createHttpClient(options),
    openJobEvents: vi.fn(() => ({ close: vi.fn() })),
    openProbeEvents: vi.fn(() => ({ close: vi.fn() })),
    openLink: vi.fn(),
  };
  vi.doMock("../src/api/client.ts", () => ({ USING_MOCK_API: false, api: client }));
  const { App } = await import("../src/App.tsx");
  render(<App />);
  return client;
}

/** Moves the clock, with React allowed to render what the timers cause. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle(): Promise<void> {
  await advance(0);
}

async function answerPost(post: Post | undefined, response: Response): Promise<void> {
  await act(async () => {
    post?.answer(response);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  globalThis.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/api/client.ts");
  vi.resetModules();
});

function analyse(name: string): void {
  fireEvent.change(screen.getByLabelText("Page address"), {
    target: { value: `https://videos.example.com/watch/${name}` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
}

function boxes(): HTMLElement[] {
  const list = screen.queryByRole("list", { name: "Analyses" });
  if (list === null) return [];
  return Array.from(list.querySelectorAll<HTMLElement>(":scope > li"));
}

function box(index: number): HTMLElement {
  const found = boxes()[index];
  if (found === undefined) throw new Error(`no box at ${String(index)}`);
  return found;
}

function lineIn(element: HTMLElement): string {
  return element.querySelector(".stage")?.textContent ?? "";
}

function headingIn(element: HTMLElement): string {
  return element.querySelector("h2, h3")?.textContent ?? "";
}

function titled(title: string): HTMLElement {
  const found = boxes().find((candidate) => within(candidate).queryByText(title) !== null);
  if (found === undefined) throw new Error(`no box titled ${title}`);
  return found;
}

test("two closed analyses' POSTs that never settle give their slots back at 90 s, and the waiting two start (N2)", async () => {
  const server = modelServer();
  await mountApp();

  // Two running, two waiting behind them. Boxes sit newest first.
  for (const name of ["first", "second", "third", "fourth"]) {
    analyse(name);
    await settle();
  }
  expect(server.probes).toHaveLength(2);
  expect(headingIn(box(0))).toBe("Waiting");
  expect(headingIn(box(1))).toBe("Waiting");
  expect(lineIn(box(0))).toBe(PROBE_WAITING);

  // Both running analyses are closed while their POSTs are out.
  for (const index of [3, 2]) {
    fireEvent.click(within(box(index)).getByRole("button", { name: "Stop waiting" }));
    await settle();
  }
  expect(boxes()).toHaveLength(2);

  // Just short of the bound the server still holds both slots, and so does the page.
  await advance(PROBE_TIMEOUT_MS - 1);
  expect(server.probes).toHaveLength(2);
  expect(headingIn(box(0))).toBe("Waiting");
  expect(headingIn(box(1))).toBe("Waiting");

  // The bound plus one second after the closes: the timeouts have aborted both
  // POSTs, the model's slots are free, and both waiting boxes are on the wire.
  await advance(1_001);
  expect(server.probes).toHaveLength(4);
  expect(server.probes.slice(0, 2).map((post) => post.open)).toEqual([false, false]);
  expect(headingIn(box(0))).toBe("Analysing");
  expect(headingIn(box(1))).toBe("Analysing");
  expect(within(box(0)).queryByRole("alert")).toBeNull();

  // Every POST still out is answered, and the page is then settled: three new
  // analyses start two at once, the third waiting.
  await answerPost(server.probes[2], json({ probe: probe({ title: "Third" }), cached: false }));
  await answerPost(server.probes[3], json({ probe: probe({ title: "Fourth" }), cached: false }));
  expect(server.heldProbes()).toBe(0);

  for (const name of ["fifth", "sixth", "seventh"]) {
    analyse(name);
    await settle();
  }
  expect(server.probes).toHaveLength(6);
  expect(headingIn(box(0))).toBe("Waiting");
  expect(headingIn(box(1))).toBe("Analysing");
  expect(headingIn(box(2))).toBe("Analysing");
});

test("a Download whose job POST never settles is released at 30 s, and the Download waiting behind it starts (N3)", async () => {
  // Two job slots (`maxJobsPerClient`): the first Download's POST stalls, the
  // second's is answered, so the page holds two jobs and the third waits.
  const server = modelServer({ answerProbes: true, answerJob: (index) => index === 1 });
  const client = await mountApp();

  for (const name of ["first", "second", "third"]) {
    analyse(name);
    await settle();
  }
  const download = async (title: string): Promise<HTMLElement> => {
    const found = titled(title);
    fireEvent.click(within(found).getByRole("button", { name: "Download" }));
    await settle();
    return found;
  };
  const first = await download("first");
  await download("second");
  const third = await download("third");
  expect(server.jobs).toHaveLength(2);
  expect(lineIn(third)).toBe(JOB_WAITING);

  // Just short of the bound the box has no way out and keeps its count.
  await advance(CREATE_JOB_TIMEOUT_MS - 1);
  for (const name of ["Starting…", "Analyse again", "Dismiss"]) {
    expect(within(first).getByRole("button", { name })).toHaveProperty("disabled", true);
  }
  expect(server.jobs).toHaveLength(2);
  expect(lineIn(third)).toBe(JOB_WAITING);

  // The bound plus one second: the box shows the failure and offers its buttons
  // again, and the job count has fallen by one, which is read through the page
  // as the waiting Download going out.
  await advance(1_001);
  // The failure panel carries a Dismiss of its own beside the box's, so each
  // name is read as every button that bears it.
  for (const name of ["Download", "Analyse again", "Dismiss"]) {
    const buttons = within(first).getAllByRole("button", { name });
    expect(buttons.map((button) => button.hasAttribute("disabled"))).not.toContain(true);
  }
  expect(within(first).getByRole("alert")).toBeDefined();
  expect(server.jobs).toHaveLength(3);
  expect(server.jobs[2]?.url).toBe("https://videos.example.com/watch/third");
  expect(lineIn(third)).not.toBe(JOB_WAITING);
  expect(client.openLink).not.toHaveBeenCalled();
});

// dl-141. Pinned here as in `human-check.test.ts`: the figure is part of what
// the page does.
const CONFIG_READ_TIMEOUT_MS = 15_000;

test("on a deployment that wants the check, a stalled config read ends in the human-check message, not in Analysing (dl-141)", async () => {
  // The server wants a token. Its config read never answers; a probe that
  // arrives without a token is refused as `routes/probe.ts` refuses one.
  const probeBodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      if (path === ROUTES.config) return new Promise<Response>(() => {});
      if (path === ROUTES.probe) {
        probeBodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          json(
            {
              error: {
                code: "HUMAN_CHECK_FAILED",
                message: "The automatic check did not pass.",
                retryable: false,
              },
            },
            403,
          ),
        );
      }
      return Promise.reject(new TypeError(`unexpected request ${path}`));
    }),
  );
  await mountApp({ humanCheck: createTurnstileCheck });

  analyse("check");
  await settle();
  expect(headingIn(box(0))).toBe("Analysing");

  await advance(CONFIG_READ_TIMEOUT_MS - 1);
  expect(headingIn(box(0))).toBe("Analysing");
  expect(probeBodies).toHaveLength(0);

  await advance(1);
  expect(probeBodies).toHaveLength(1);
  expect(probeBodies[0]).toMatchObject({ url: "https://videos.example.com/watch/check" });
  expect(probeBodies[0]).not.toHaveProperty("humanCheckToken");
  expect(headingIn(box(0))).toBe("Could not confirm you are a person");
  expect(within(box(0)).getByRole("alert").textContent).toContain(
    "Repeat what you just did to take a fresh one",
  );
});
