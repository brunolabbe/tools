/**
 * The down page (repo-143): the Worker's decision, the page, the routes that put
 * the Worker in front of a page load and nothing else, and the setup script's
 * handling of both.
 *
 * Its own file, like `cloudflare-turnstile.test.ts`, so a block added here moves
 * no line another record cites. Fixtures only: nothing reaches Cloudflare, and
 * the payload shapes the fake answers with are the ticket's reading of the API,
 * not a recording (see the ticket's Log).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CliError,
  EDGE_PATHS,
  TOOLS,
  WORKER_NAME,
  applyOrder,
  deployedHash,
  desiredState,
  main,
  planRoutes,
  planWorker,
  planWorkersDev,
  workerFromSource,
} from "../cloudflare-setup.mjs";
import worker, {
  DOWN_STATUSES,
  PALETTES,
  downPageResponse,
  isPageLoad,
  renderDownPage,
  shouldShowDownPage,
  toolFromHostname,
} from "../cloudflare-down-page.mjs";
import { createWorkersFake } from "./fixtures/cloudflare-workers-fake.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- the Worker's decision ----------------------------------------------------

describe("the decision over (outcome x Accept x method)", () => {
  const outcomes: [string, { threw: true } | { status: number }, boolean][] = [
    ["a thrown subrequest", { threw: true }, true],
    ["530, no connector", { status: 530 }, true],
    ["502, service not answering", { status: 502 }, true],
    ["504", { status: 504 }, true],
    ["200", { status: 200 }, false],
    ["304", { status: 304 }, false],
    ["404", { status: 404 }, false],
    // the app's own server errors are the app speaking; only the three above are ours
    ["500", { status: 500 }, false],
    ["503", { status: 503 }, false],
    ["501", { status: 501 }, false],
  ];

  for (const method of ["GET", "HEAD"]) {
    for (const [label, outcome, down] of outcomes) {
      test(`${method} for HTML, ${label}: ${down ? "down page" : "passes through"}`, () => {
        expect(shouldShowDownPage({ method, accept: HTML, outcome })).toBe(down);
      });
    }
  }

  test("a request that is not a page load never gets the page, whatever failed", () => {
    for (const [, outcome] of outcomes) {
      for (const accept of ["application/json", "*/*", "text/event-stream", "", null]) {
        expect(shouldShowDownPage({ method: "GET", accept, outcome }), `${accept}`).toBe(false);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        expect(shouldShowDownPage({ method, accept: HTML, outcome }), method).toBe(false);
      }
    }
  });

  test("the replaced statuses are exactly 502, 504 and 530", () => {
    expect([...DOWN_STATUSES].toSorted()).toEqual([502, 504, 530]);
  });

  test("isPageLoad reads Accept case-insensitively", () => {
    expect(isPageLoad("GET", "Text/HTML")).toBe(true);
    expect(isPageLoad("GET", "application/json")).toBe(false);
  });
});

// --- the Worker, end to end over a stubbed fetch ------------------------------

const asPage = (url: string, method = "GET") =>
  new Request(url, { method, headers: { Accept: HTML } });

describe("the Worker's fetch handler", () => {
  test("a thrown subrequest on a page load answers 503 with the headers that stop caching", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const res = await worker.fetch(asPage("https://planner.example.com/"));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain("Planner is unavailable");
  });

  test("a 530 on a page load is replaced, and the origin's error body is not leaked", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("error code: 1033", { status: 530 })),
    );
    const res = await worker.fetch(asPage("https://ledger.example.com/"));

    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("1033");
  });

  test("a 200 passes through as the very same response, so a stream stays a stream", async () => {
    const origin = new Response("<html>app</html>", { status: 200 });
    vi.stubGlobal("fetch", () => Promise.resolve(origin));

    expect(await worker.fetch(asPage("https://downloader.example.com/"))).toBe(origin);
  });

  test("a 500 and a 503 from the app pass through untouched", async () => {
    for (const status of [500, 503]) {
      const origin = new Response("app says no", { status });
      vi.stubGlobal("fetch", () => Promise.resolve(origin));
      expect(await worker.fetch(asPage("https://downloader.example.com/"))).toBe(origin);
    }
  });

  test("a failed request that is not a page load keeps the origin's own answer", async () => {
    const origin = new Response("error code: 1033", { status: 530 });
    vi.stubGlobal("fetch", () => Promise.resolve(origin));
    const api = new Request("https://downloader.example.com/x", {
      headers: { Accept: "application/json" },
    });

    expect(await worker.fetch(api)).toBe(origin);
  });

  test("a throw on a request that is not a page load is not turned into a page", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const post = new Request("https://downloader.example.com/x", {
      method: "POST",
      headers: { Accept: HTML },
      body: "x",
    });

    await expect(worker.fetch(post)).rejects.toThrow("fetch failed");
  });

  test("HEAD gets the status and headers with no body", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const res = await worker.fetch(asPage("https://planner.example.com/", "HEAD"));

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
  });
});

// --- the page -----------------------------------------------------------------

describe("the page", () => {
  test("names the tool from the first label, and nothing from the request", () => {
    expect(toolFromHostname("planner.example.com")).toBe("planner");
    expect(toolFromHostname("LEDGER.example.com")).toBe("ledger");
    expect(toolFromHostname("evil.example.com")).toBeNull();
    expect(renderDownPage("downloader.example.com")).toContain("Downloader is unavailable");
    expect(renderDownPage("planner.example.com")).toContain("Planner is unavailable");
    expect(renderDownPage("ledger.example.com")).toContain("Ledger is unavailable");

    // an unknown host is named generically; the hostname is never written into the markup
    const unknown = renderDownPage("<script>x</script>.example.com");
    expect(unknown).toContain("This site is unavailable");
    expect(unknown).not.toContain("<script>x");
  });

  test("is self-contained: no request leaves it, no font, no script", () => {
    const html = renderDownPage("planner.example.com");

    expect(html).not.toMatch(/<script|<link|@import|url\(|src=|https?:\/\//i);
    expect(html).toContain('name="viewport"');
  });

  test("switches to dark values under prefers-color-scheme, and says what to do", () => {
    const html = renderDownPage("ledger.example.com");

    expect(html).toContain("@media (prefers-color-scheme:dark)");
    expect(html).toContain(PALETTES.ledger.light.bg);
    expect(html).toContain(PALETTES.ledger.dark.bg);
    expect(html).toMatch(/try again in a few minutes/i);
  });

  test("its response is a 503, never cached", () => {
    const res = downPageResponse("planner.example.com");
    expect([res.status, res.headers.get("Retry-After"), res.headers.get("Cache-Control")]).toEqual([
      503,
      "60",
      "no-store",
    ]);
  });
});

describe("the palettes are the tools' own", () => {
  const roles = {
    bg: "--bg",
    surface: "--surface",
    border: "--border",
    text: "--text",
    muted: "--text-muted",
    accent: "--accent",
  } as const;

  /** Declarations of the first `:root {}` block at or after `from`. */
  function rootBlock(css: string, from: number) {
    const start = css.indexOf(":root {", from);
    const end = css.indexOf("}", start);
    return css.slice(start, end);
  }

  for (const tool of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
    test(`${tool}: light and dark equal web/src/styles.css`, () => {
      const css = readFileSync(path.join(root, `tools/${tool}/web/src/styles.css`), "utf8");
      const light = rootBlock(css, 0);
      const dark = rootBlock(css, css.indexOf("@media (prefers-color-scheme: dark)"));

      for (const [key, prop] of Object.entries(roles)) {
        const re = new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`);
        expect(PALETTES[tool].light[key as keyof typeof roles], `${tool} light ${prop}`).toBe(
          re.exec(light)?.[1],
        );
        expect(PALETTES[tool].dark[key as keyof typeof roles], `${tool} dark ${prop}`).toBe(
          re.exec(dark)?.[1],
        );
      }
    });
  }

  test("every tool in TOOLS has a palette", () => {
    expect(Object.keys(PALETTES).toSorted()).toEqual(
      (TOOLS as { subdomain: string }[]).map((t) => t.subdomain).toSorted(),
    );
  });
});

// --- the route plan -----------------------------------------------------------

const wanted = desiredState("example.com", "you@example.com").routes as {
  pattern: string;
  script: string | null;
}[];

describe("the route plan", () => {
  test("every tool gets a Worker route and the API and assets excluded", () => {
    for (const t of TOOLS as { subdomain: string }[]) {
      const host = `${t.subdomain}.example.com`;
      expect(wanted).toContainEqual({ pattern: `${host}/*`, script: WORKER_NAME });
      for (const p of EDGE_PATHS) {
        expect(wanted).toContainEqual({ pattern: `${host}${p}`, script: null });
      }
    }
    expect(EDGE_PATHS).toEqual(["/api/*", "/assets/*"]);
  });

  test("the files each build writes outside assets/ are excluded, and only those", () => {
    for (const t of TOOLS as { tool: string; subdomain: string; staticPaths: string[] }[]) {
      const config = readFileSync(path.join(root, `tools/${t.tool}/web/vite.config.ts`), "utf8");
      // The build's fixed-path entry (`theme.js`) is the one non-hashed file; a
      // config that moved `assets/` would make the exclusion miss it.
      expect(config, `${t.tool} moves assetsDir`).not.toMatch(/assetsDir/);
      expect(t.staticPaths.includes("/theme.js"), t.tool).toBe(/theme\.js/.test(config));
      for (const p of t.staticPaths) {
        expect(wanted).toContainEqual({
          pattern: `${t.subdomain}.example.com${p}`,
          script: null,
        });
      }
    }
  });

  test("an exclusion comes before the Worker route on its host", () => {
    for (const t of TOOLS as { subdomain: string }[]) {
      const host = `${t.subdomain}.example.com`;
      const mine = wanted.filter((r) => r.pattern.startsWith(host));
      expect(mine.at(-1)).toEqual({ pattern: `${host}/*`, script: WORKER_NAME });
      expect(mine.slice(0, -1).every((r) => r.script === null)).toBe(true);
    }
  });

  test("an empty zone: every route is added", () => {
    const plan = planRoutes([], wanted);
    expect(plan.create).toEqual(wanted);
    expect([plan.ok, plan.conflicts]).toEqual([[], []]);
  });

  test("routes already as wanted are kept, with the API's null, empty or absent script", () => {
    const live = wanted.map((r, i) => ({
      id: String(i),
      pattern: r.pattern,
      ...(r.script
        ? { script: r.script, request_limit_fail_open: true }
        : [{}, { script: null }, { script: "" }][i % 3]),
    }));
    const plan = planRoutes(live, wanted);

    expect(plan.create).toEqual([]);
    expect(plan.ok).toHaveLength(wanted.length);
    expect(plan.repair).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  test("a Worker route that exists fail closed is a repair, not 'nothing to do'", () => {
    const live = wanted.map((r, i) => ({
      id: String(i),
      pattern: r.pattern,
      ...(r.script ? { script: r.script } : {}),
      // absent, false: the API's default is fail closed
      ...(r.script && i % 2 ? { request_limit_fail_open: false } : {}),
    }));
    const plan = planRoutes(live, wanted);
    const workerRoutes = wanted.filter((r) => r.script);

    expect(plan.repair.map((r: { pattern: string }) => r.pattern)).toEqual(
      workerRoutes.map((r) => r.pattern),
    );
    // carries the id the repair PUT goes to, and no repair is an exclusion
    expect(plan.repair.every((r: { id?: string }) => r.id !== undefined)).toBe(true);
    expect(plan.ok.map((r: { script: string | null }) => r.script)).not.toContain(WORKER_NAME);
    expect(plan.create).toEqual([]);
  });

  test("a Worker route already fail open is nothing to do", () => {
    const live = [
      {
        id: "1",
        pattern: "planner.example.com/*",
        script: WORKER_NAME,
        request_limit_fail_open: true,
      },
    ];
    const plan = planRoutes(live, wanted);

    expect(plan.repair).toEqual([]);
    expect(plan.ok).toContainEqual({ pattern: "planner.example.com/*", script: WORKER_NAME });
  });

  test("a pattern pointing at a different Worker is a conflict, never replaced", () => {
    const live = [{ id: "1", pattern: "planner.example.com/*", script: "someone-elses" }];
    const plan = planRoutes(live, wanted);

    expect(plan.conflicts).toEqual([
      { pattern: "planner.example.com/*", want: WORKER_NAME, found: "someone-elses" },
    ]);
    expect(plan.create.map((r) => r.pattern)).not.toContain("planner.example.com/*");
  });

  test("an exclusion where a Worker is routed, and a Worker where an exclusion is, both conflict", () => {
    const live = [
      { id: "1", pattern: "downloader.example.com/api/*", script: WORKER_NAME },
      { id: "2", pattern: "ledger.example.com/*" },
    ];
    expect(planRoutes(live, wanted).conflicts).toEqual([
      { pattern: "downloader.example.com/api/*", want: "(no Worker)", found: WORKER_NAME },
      { pattern: "ledger.example.com/*", want: WORKER_NAME, found: "(no Worker)" },
    ]);
  });

  test("other zones' routes are neither touched nor reported", () => {
    const live = [{ id: "1", pattern: "immich.example.com/*", script: "other" }];
    const plan = planRoutes(live, wanted);
    expect(plan.conflicts).toEqual([]);
    expect(plan.create).toEqual(wanted);
  });
});

// --- the Worker plan ----------------------------------------------------------

describe("the Worker upload plan", () => {
  const want = workerFromSource("export default {};\n");

  test("the marker round-trips, and a script without one is not ours", () => {
    expect(deployedHash(want.body)).toBe(want.hash);
    expect(deployedHash(`--boundary\n${want.body}\n--boundary--`)).toBe(want.hash);
    expect(deployedHash("export default {};\n")).toBeNull();
    // a marker quoted inside code is not at the start of a line
    expect(deployedHash(`const s = "// repo-143-content-sha256: ${want.hash}";`)).toBeNull();
  });

  test("absent: create. Identical: nothing. Changed: update. Foreign: conflict", () => {
    expect(planWorker(null, want).create).toEqual([want]);
    expect(planWorker({ hash: want.hash }, want)).toEqual({
      create: [],
      update: [],
      ok: [want],
      conflicts: [],
    });
    expect(planWorker({ hash: "0".repeat(64) }, want).update).toEqual([want]);
    expect(planWorker({ hash: null }, want).conflicts).toHaveLength(1);
    expect(planWorker({ hash: null }, want).update).toEqual([]);
  });

  test("the hash follows the content", () => {
    expect(workerFromSource("a").hash).not.toBe(workerFromSource("b").hash);
    expect(workerFromSource("a").hash).toBe(workerFromSource("a").hash);
  });

  test("the Worker is applied before the routes that name it, and exclusions first", () => {
    const order = applyOrder({
      access: { create: [] },
      ingress: { added: [] },
      dns: { create: [] },
      worker: planWorker(null, want),
      routes: planRoutes([], wanted),
    }) as { kind: string; item: { script?: string | null } }[];

    const kinds = order.map((o) => o.kind);
    expect(kinds[0]).toBe("worker");
    expect(kinds.slice(1).every((k) => k === "route")).toBe(true);
    const firstWorkerRoute = order.findIndex((o) => o.item.script === WORKER_NAME);
    const lastExclusionOfFirstHost = order.findIndex((o) => o.item.script === null);
    expect(lastExclusionOfFirstHost).toBeLessThan(firstWorkerRoute);
  });
});

// --- the whole run, against a fake account ------------------------------------

type Init = Parameters<typeof createWorkersFake>[0];

/** A bare account: a tunnel, nothing else. Writes are recorded as `METHOD /path`. */
function fakeAccount(workers: Init = {}) {
  const w = createWorkersFake(workers);
  const writes: string[] = [];
  const forms: FormData[] = [];
  const bodies: { write: string; body: Record<string, unknown> }[] = [];
  const apps: { id: string; domain: string }[] = [];
  const records: unknown[] = [];
  const widgets: unknown[] = [];
  let ingress: unknown[] = [{ service: "http_status:404" }];
  const ok = (result: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify({ success: status < 400, errors: [], result }), { status }),
    );

  const fetchFake = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    if (method !== "GET")
      writes.push(`${method} ${url.replace(/^.*\/client\/v4/, "").split("?")[0]}`);
    if (init.body instanceof FormData) forms.push(init.body);
    const json = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (json) bodies.push({ write: writes.at(-1) ?? "", body: json });

    const workersAnswer = w.handle(url, method, init);
    if (workersAnswer) return workersAnswer;
    if (url.endsWith("/tokens/verify")) return ok({ status: "active" });
    if (url.includes("/cfd_tunnel?")) return ok([{ id: "abc", name: "home" }]);
    if (url.endsWith("/configurations")) {
      if (method === "PUT") ingress = json.config.ingress;
      return ok({ config: { ingress } });
    }
    if (url.includes("/dns_records")) {
      if (method === "POST") records.push(json);
      return ok(records);
    }
    if (url.endsWith("/access/apps")) {
      if (method === "POST") apps.push({ id: String(apps.length), domain: json.domain });
      return ok(apps);
    }
    if (url.includes("/challenges/widgets")) {
      if (method === "POST") {
        widgets.push({ sitekey: "0xFAKE-SITE", name: json.name, domains: json.domains });
        return ok({ sitekey: "0xFAKE-SITE", secret: "0xFAKE-SECRET" });
      }
      return ok(widgets);
    }
    return ok(null, 404);
  };

  return { fetchFake, writes, forms, bodies, workers: w };
}

async function run(account: ReturnType<typeof fakeAccount>, ...extra: string[]) {
  const lines: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  vi.stubGlobal("fetch", account.fetchFake);
  try {
    await main(
      [
        "--domain",
        "example.com",
        "--email",
        "you@example.com",
        "--zone",
        "Z",
        "--account",
        "A",
        "--ledger-email",
        "them@example.com",
        ...extra,
      ],
      { CLOUDFLARE_API_TOKEN: "fake-token" },
    );
    return { out: lines.join(""), error: undefined as unknown };
  } catch (error) {
    return { out: lines.join(""), error };
  } finally {
    write.mockRestore();
  }
}

describe("cloudflare-setup with the down page", () => {
  test("a plan lists the Worker and every route, and writes nothing", async () => {
    const account = fakeAccount();
    const { out, error } = await run(account);

    expect(error).toBeUndefined();
    expect(out).toMatch(/ADD {6}worker {2}down-page \(sha256 [0-9a-f]{12}\)/);
    expect(out).toContain("ADD      route   planner.example.com/* -> down-page");
    expect(out).toContain("ADD      route   planner.example.com/api/* (no Worker)");
    expect(out).toContain("ADD      route   downloader.example.com/theme.js (no Worker)");
    expect(out).toContain("ADD      route   ledger.example.com/assets/* (no Worker)");
    expect(account.writes).toEqual([]);
  });

  test("--apply uploads once and adds each route once; the second run has nothing to do", async () => {
    const account = fakeAccount();

    const first = await run(account, "--apply");
    expect(first.error).toBeUndefined();
    expect(
      account.writes.filter((w) => w === "PUT /accounts/A/workers/scripts/down-page"),
    ).toHaveLength(1);
    expect(account.writes.filter((w) => w === "POST /zones/Z/workers/routes")).toHaveLength(
      wanted.length,
    );

    // and each Worker route gets its second write, the fail-open PUT
    expect(account.writes.filter((w) => w.startsWith("PUT /zones/Z/workers/routes/"))).toHaveLength(
      TOOLS.length,
    );

    const written = account.writes.length;
    const second = await run(account, "--apply");
    expect(second.error).toBeUndefined();
    expect(second.out).toContain("ok       worker  down-page");
    expect(second.out).toContain("nothing to do.");
    // Re-uploading identical content must not count as a change: no PUT at all.
    expect(account.writes).toHaveLength(written);
  });

  test("the upload is multipart with the module as main_module, and the Worker is the file in the tree", async () => {
    const account = fakeAccount();
    await run(account, "--apply");

    const form = account.forms.at(0) as FormData;
    expect(form).toBeDefined();
    const metadata = JSON.parse(await (form.get("metadata") as File).text());
    expect(metadata.main_module).toBe("worker.mjs");
    const uploaded = await (form.get("worker.mjs") as File).text();
    const source = readFileSync(path.join(root, "scripts/cloudflare-down-page.mjs"), "utf8");
    expect(uploaded.startsWith(source)).toBe(true);
    expect(deployedHash(uploaded)).toBe(workerFromSource(source).hash);
  });

  test("a Worker whose content differs is uploaded again, and nothing else is", async () => {
    const stale = `export default {};\n// repo-143-content-sha256: ${"a".repeat(64)}\n`;
    const account = fakeAccount({
      scripts: { [WORKER_NAME]: stale },
      workersDev: { [WORKER_NAME]: false },
      routes: wanted.map((r, i) => ({
        id: String(i),
        ...r,
        ...(r.script ? { request_limit_fail_open: true } : {}),
      })),
    });
    const { out, error } = await run(account, "--apply");

    expect(error).toBeUndefined();
    expect(out).toContain("UPDATE   worker  down-page");
    expect(account.writes.filter((w) => w.includes("/workers/"))).toEqual([
      "PUT /accounts/A/workers/scripts/down-page",
    ]);
  });

  test("a route on a foreign Worker refuses with a conflict and writes nothing", async () => {
    const account = fakeAccount({
      routes: [{ id: "1", pattern: "ledger.example.com/*", script: "someone-elses" }],
    });
    const { out, error } = await run(account, "--apply");

    expect(error).toBeInstanceOf(CliError);
    expect(String(error)).toContain("conflict");
    expect(out).toContain(
      "CONFLICT route ledger.example.com/*: routed to someone-elses, wanted down-page",
    );
    expect(account.writes).toEqual([]);
  });

  test("a script of that name that this tool did not upload is a conflict, not an overwrite", async () => {
    const account = fakeAccount({ scripts: { [WORKER_NAME]: "export default {};" } });
    const { out, error } = await run(account, "--apply");

    expect(error).toBeInstanceOf(CliError);
    expect(out).toContain("CONFLICT worker down-page");
    expect(account.writes).toEqual([]);
  });

  test("a token without Workers Scripts, or without Workers Routes, is told which", async () => {
    for (const status of [401, 403]) {
      const scripts = fakeAccount({ scriptReadStatus: status });
      const a = await run(scripts, "--apply");
      expect(a.error).toBeInstanceOf(CliError);
      expect(String(a.error)).toContain("Account · Workers Scripts · Edit");
      expect(scripts.writes).toEqual([]);

      const routes = fakeAccount({ routeReadStatus: status });
      const b = await run(routes, "--apply");
      expect(b.error).toBeInstanceOf(CliError);
      expect(String(b.error)).toContain("Zone · Workers Routes · Edit");
      expect(routes.writes).toEqual([]);
    }
  });

  test("a failure of the route list that is not a refused credential is not blamed on the token", async () => {
    const account = fakeAccount({ routeReadStatus: 500 });
    const { error } = await run(account, "--apply");

    expect(error).not.toBeInstanceOf(CliError);
    expect(String((error as Error).message)).toContain("-> 500");
    expect(String((error as Error).message)).not.toContain("Workers Routes");
  });

  test("an exclusion is created with no script, a Worker route with fail-open", async () => {
    const account = fakeAccount();
    await run(account, "--apply");

    const routes = account.workers.routes as {
      pattern: string;
      script?: string;
      request_limit_fail_open?: boolean;
    }[];
    expect(routes.find((r) => r.pattern === "planner.example.com/api/*")).not.toHaveProperty(
      "script",
    );
    expect(routes.find((r) => r.pattern === "planner.example.com/*")).toMatchObject({
      script: WORKER_NAME,
      request_limit_fail_open: true,
    });
  });

  // --- fail open: POST as documented, then a PUT (owner, 2026-11-08) ----------

  test("a plan names no fail-open step of its own and writes nothing", async () => {
    const account = fakeAccount();
    const { out } = await run(account);

    expect(out).toContain("DISABLE  worker  down-page on workers.dev");
    expect(out).not.toContain("REPAIR");
    expect(account.writes).toEqual([]);
  });

  test("a Worker route is POSTed as documented, then PUT with the flag", async () => {
    const account = fakeAccount();
    await run(account, "--apply");

    const post = account.bodies.find(
      (b) =>
        b.write === "POST /zones/Z/workers/routes" && b.body.pattern === "planner.example.com/*",
    );
    // the create call takes `pattern` and `script`; the flag is not on it
    expect(post?.body).toEqual({ pattern: "planner.example.com/*", script: WORKER_NAME });

    const put = account.bodies.filter((b) => b.write.startsWith("PUT /zones/Z/workers/routes/"));
    expect(put).toHaveLength(TOOLS.length);
    expect(put.map((p) => p.body)).toContainEqual({
      pattern: "planner.example.com/*",
      script: WORKER_NAME,
      request_limit_fail_open: true,
    });
    // the PUT follows its POST, and exclusions never get one
    const order = account.writes.filter((w) => w.includes("/workers/routes"));
    order.forEach((w, i) => {
      if (w.startsWith("PUT /zones/")) expect(order[i - 1]).toBe("POST /zones/Z/workers/routes");
    });
    expect(put.every((p) => p.body.script === WORKER_NAME)).toBe(true);
  });

  test("a run that fails between the POST and the PUT is finished by the next run", async () => {
    const account = fakeAccount();
    const real = account.fetchFake;
    let failed = 0;
    const flaky: typeof real = (input, init) => {
      if (init?.method === "PUT" && String(input).includes("/workers/routes/") && failed++ === 0) {
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return real(input, init);
    };

    const first = await run({ ...account, fetchFake: flaky }, "--apply");
    expect(first.error).toBeInstanceOf(Error);
    // the route exists and is fail closed, as the documented POST leaves it
    const closed = account.workers.routes.filter((r) => r.script && !r.request_limit_fail_open);
    expect(closed.length).toBeGreaterThan(0);

    const second = await run(account, "--apply");
    expect(second.error).toBeUndefined();
    expect(second.out).toMatch(/REPAIR {3}route {3}\S+\/\* -> down-page is not fail open/);
    expect(second.out).toMatch(/applied {2}route {3}\S+ fail open/);
    expect(account.workers.routes.filter((r) => r.script && !r.request_limit_fail_open)).toEqual(
      [],
    );
    // only repairs were written: no second POST of an existing route
    const before = account.writes.length;
    const third = await run(account, "--apply");
    expect(third.out).toContain("nothing to do.");
    expect(account.writes).toHaveLength(before);
  });

  // --- workers.dev: off, once (owner, 2026-11-08) ------------------------------

  test("a new Worker is switched off workers.dev once, after the routes", async () => {
    const account = fakeAccount();
    await run(account, "--apply");

    const sub = "POST /accounts/A/workers/scripts/down-page/subdomain";
    expect(account.writes.filter((w) => w === sub)).toHaveLength(1);
    expect(account.bodies.find((b) => b.write === sub)?.body).toEqual({ enabled: false });
    expect(account.workers.workersDev[WORKER_NAME]).toBe(false);
    const order = account.writes.filter((w) => w.includes("/workers/"));
    // the owner's order (2026-11-08): the upload, every route write, then the switch
    expect(order.indexOf("PUT /accounts/A/workers/scripts/down-page")).toBe(0);
    expect(order.indexOf(sub)).toBe(order.length - 1);
  });

  test("a Worker already off workers.dev is nothing to do; one that is on is switched off", async () => {
    const wantRoutes = wanted.map((r, i) => ({
      id: String(i),
      ...r,
      ...(r.script ? { request_limit_fail_open: true } : {}),
    }));
    const { body } = workerFromSource(
      readFileSync(path.join(root, "scripts/cloudflare-down-page.mjs"), "utf8"),
    );

    const off = fakeAccount({
      scripts: { [WORKER_NAME]: body },
      workersDev: { [WORKER_NAME]: false },
      routes: wantRoutes,
    });
    const quiet = await run(off, "--apply");
    expect(quiet.out).toContain("ok       worker  down-page is off workers.dev");
    expect(quiet.out).not.toContain("DISABLE");
    expect(off.writes.filter((w) => w.includes("/workers/"))).toEqual([]);

    const on = fakeAccount({
      scripts: { [WORKER_NAME]: body },
      workersDev: { [WORKER_NAME]: true },
      routes: wantRoutes,
    });
    const loud = await run(on, "--apply");
    expect(loud.out).toContain("DISABLE  worker  down-page on workers.dev");
    expect(on.writes.filter((w) => w.includes("/workers/"))).toEqual([
      "POST /accounts/A/workers/scripts/down-page/subdomain",
    ]);
    expect(on.workers.workersDev[WORKER_NAME]).toBe(false);
  });

  // --- the workers.dev endpoint answering something else (gate 1's F1) --------
  //
  // Unmeasured: what `/subdomain` says for an account with no workers.dev
  // subdomain registered. Whatever it says, the page must still be made.

  test("a /subdomain answer that is not 2xx does not keep the routes from being made", async () => {
    const account = fakeAccount({ subdomainStatus: 404 });
    const { out, error } = await run(account, "--apply");

    expect(account.writes.filter((w) => w === "POST /zones/Z/workers/routes")).toHaveLength(
      wanted.length,
    );
    expect(out).toContain("applied  route   planner.example.com/* fail open");
    expect(out).toMatch(/FAILED {3}worker {2}down-page workers\.dev: POST \S+\/subdomain -> 404/);
    // non-zero at the end, not an abort in the middle
    expect(error).toBeInstanceOf(CliError);
    expect(String(error)).toContain("FAILED");
    expect(out.indexOf("FAILED")).toBeGreaterThan(out.lastIndexOf("applied  route"));
  });

  test("a re-run past that failure prints its plan, keeps the routes ok, and still fails", async () => {
    const account = fakeAccount({ subdomainStatus: 404 });
    await run(account, "--apply");
    const written = account.writes.length;

    const { out, error } = await run(account, "--apply");

    expect(out).toContain("ok       route   planner.example.com/* -> down-page");
    expect(out).toMatch(/FAILED {3}worker {2}down-page workers\.dev: GET \S+\/subdomain -> 404/);
    expect(error).toBeInstanceOf(CliError);
    expect(account.writes).toHaveLength(written);
  });

  test("a dry run past that failure still prints the whole plan, then exits non-zero", async () => {
    const { body } = workerFromSource(
      readFileSync(path.join(root, "scripts/cloudflare-down-page.mjs"), "utf8"),
    );
    const account = fakeAccount({
      scripts: { [WORKER_NAME]: body },
      workersDev: { [WORKER_NAME]: true },
      subdomainStatus: 404,
    });
    const { out, error } = await run(account);

    expect(out).toContain("ADD      route   planner.example.com/* -> down-page");
    expect(out).toContain("ADD      ingress planner.example.com");
    expect(out).toMatch(/FAILED {3}worker {2}down-page workers\.dev: GET/);
    expect(out).toMatch(/change\(s\)\. Re-run with --apply/);
    expect(error).toBeInstanceOf(CliError);
    expect(account.writes).toEqual([]);
  });

  test("a token that cannot read the workers.dev switch is told which permission", async () => {
    const { body } = workerFromSource(
      readFileSync(path.join(root, "scripts/cloudflare-down-page.mjs"), "utf8"),
    );
    const account = fakeAccount({
      scripts: { [WORKER_NAME]: body },
      subdomainReadStatus: 403,
    });
    const { error } = await run(account, "--apply");

    expect(error).toBeInstanceOf(CliError);
    expect(String(error)).toContain("Account · Workers Scripts · Edit");
    expect(account.writes).toEqual([]);
  });
});

describe("the workers.dev plan and the apply order", () => {
  test("planWorkersDev: absent or on is a disable, off is ok", () => {
    expect(planWorkersDev(null, WORKER_NAME)).toEqual({ disable: [WORKER_NAME], ok: [] });
    expect(planWorkersDev({ enabled: true }, WORKER_NAME)).toEqual({
      disable: [WORKER_NAME],
      ok: [],
    });
    expect(planWorkersDev({ enabled: false }, WORKER_NAME)).toEqual({
      disable: [],
      ok: [WORKER_NAME],
    });
  });

  test("order: upload, then routes, then repairs, then workers.dev off", () => {
    const want = workerFromSource("x");
    const live = [
      {
        id: "9",
        pattern: "ledger.example.com/*",
        script: WORKER_NAME,
        request_limit_fail_open: false,
      },
    ];
    const kinds = (
      applyOrder({
        access: { create: [] },
        ingress: { added: [] },
        dns: { create: [] },
        worker: planWorker(null, want),
        workersDev: planWorkersDev(null, WORKER_NAME),
        routes: planRoutes(live, wanted),
      }) as { kind: string }[]
    ).map((o) => o.kind);

    expect(kinds[0]).toBe("worker");
    expect(kinds.at(-1)).toBe("workersdev");
    expect(kinds.indexOf("route-repair")).toBeGreaterThan(kinds.lastIndexOf("route"));
    expect(kinds.indexOf("workersdev")).toBeGreaterThan(kinds.indexOf("route-repair"));
  });
});

describe("the workers.dev call's two failure shapes (gate 2's N1)", () => {
  test("a refused credential on the switch is told which permission, and the other statuses are not", async () => {
    const refused = await run(fakeAccount({ subdomainStatus: 403 }), "--apply");
    expect(refused.out).toMatch(
      /FAILED {3}worker {2}down-page workers\.dev: POST \S+\/subdomain -> 403 .*\(the token needs Account · Workers Scripts · Edit\)/,
    );

    const missing = await run(fakeAccount({ subdomainStatus: 404 }), "--apply");
    expect(missing.out).toContain("FAILED   worker  down-page workers.dev");
    expect(missing.out).not.toContain("the token needs");
  });

  test("a refused connection on the switch read is the run's error, not a FAILED line", async () => {
    const { body } = workerFromSource(
      readFileSync(path.join(root, "scripts/cloudflare-down-page.mjs"), "utf8"),
    );
    const account = fakeAccount({
      scripts: { [WORKER_NAME]: body },
      workersDev: { [WORKER_NAME]: true },
    });
    const refusing = {
      ...account,
      fetchFake: (input: string | URL | Request, init: RequestInit = {}) =>
        String(input).endsWith("/subdomain") && (init.method ?? "GET") === "GET"
          ? Promise.reject(new TypeError("fetch failed"))
          : account.fetchFake(input, init),
    };
    const { out, error } = await run(refusing);

    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toContain("fetch failed");
    expect(out).not.toContain("FAILED");
  });
});
