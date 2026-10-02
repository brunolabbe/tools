/**
 * The Turnstile widget, as a call instead of a dashboard click (dl-71).
 *
 * Its own file rather than the end of `cloudflare-setup.test.ts`, because that
 * suite's line numbers are cited by merged records (pl-2's) and a block added
 * there moves the ones below it. The two share nothing but the script.
 *
 * Every case below was watched failing first, against the guard removed.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, vi } from "vitest";

import {
  applyOrder,
  CliError,
  desiredState,
  envLines,
  main,
  planAccess,
  planDns,
  planIngress,
  planTurnstile,
  TOOLS,
} from "../cloudflare-setup.mjs";

// --- dl-71: the downloader's Turnstile widget ---------------------------------
//
// Fixtures only. Nothing below reaches Cloudflare, and every key is a string made
// up for this file: the runs are driven through a fake `fetch`.

const DOWNLOADER_WIDGET = {
  name: "downloader",
  domains: ["downloader.example.com"],
  mode: "managed",
};

test("the widget is planned for the downloader's hostname and for nobody else's", () => {
  const { widgets } = desiredState("example.com", "you@example.com");

  expect(widgets).toEqual([DOWNLOADER_WIDGET]);
  // The planner's and the ledger's entries carry no `turnstile` at all, so there
  // is no widget for either by construction rather than by a filter on a name.
  const without = TOOLS.filter((t) => !t.turnstile);
  expect(without.map((t) => t.tool)).toEqual(["planner", "ledger"]);
  expect(desiredState("example.com", "you@example.com", without).widgets).toEqual([]);
});

test("a widget that is absent is created, and one that is present is left alone", () => {
  expect(planTurnstile([], [DOWNLOADER_WIDGET])).toEqual({
    create: [DOWNLOADER_WIDGET],
    ok: [],
    conflicts: [],
  });

  const live = [
    { sitekey: "0xFAKE-SITE", name: "downloader", domains: ["downloader.example.com"] },
  ];
  const plan = planTurnstile(live, [DOWNLOADER_WIDGET]);

  expect(plan.create).toEqual([]);
  expect(plan.conflicts).toEqual([]);
  expect(plan.ok.map((w: { sitekey: string }) => w.sitekey)).toEqual(["0xFAKE-SITE"]);
});

test("a same-named widget guarding other domains is a conflict, never an edit", () => {
  const widened = [
    {
      sitekey: "0xFAKE-SITE",
      name: "downloader",
      domains: ["downloader.example.com", "evil.test"],
    },
  ];
  const elsewhere = [
    { sitekey: "0xFAKE-SITE", name: "downloader", domains: ["other.example.com"] },
  ];

  for (const live of [widened, elsewhere]) {
    const plan = planTurnstile(live, [DOWNLOADER_WIDGET]);
    expect(plan.create).toEqual([]);
    expect(plan.ok).toEqual([]);
    expect(plan.conflicts).toEqual([
      { name: "downloader", found: live[0]?.domains, want: ["downloader.example.com"] },
    ]);
  }
});

test("the env lines carry the keys, and a response without a secret throws", () => {
  expect(envLines({ sitekey: "0xFAKE-SITE", secret: "0xFAKE-SECRET" })).toEqual([
    "TURNSTILE_SITE_KEY=0xFAKE-SITE",
    "TURNSTILE_SECRET_KEY=0xFAKE-SECRET",
  ]);
  // Not an empty `TURNSTILE_SECRET_KEY=`: the widget exists by then, so a re-run
  // would call it present and the check would stay silently off.
  expect(() => envLines({ sitekey: "0xFAKE-SITE" })).toThrow(/no site key and secret/);
  expect(() => envLines(undefined)).toThrow(/no site key and secret/);
});

test("the widget is created after every Access application and routing call", () => {
  const want = desiredState("example.com", "you@example.com");
  const kinds = (
    applyOrder({
      access: planAccess([], want.apps),
      ingress: planIngress([], want.ingress),
      dns: planDns([], want.dns, "abc"),
      turnstile: planTurnstile([], want.widgets),
    }) as { kind: string }[]
  ).map((o) => o.kind);

  expect(kinds.filter((k) => k === "turnstile")).toHaveLength(1);
  expect(kinds.at(-1)).toBe("turnstile");
});

const answer = (result: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify({ success: status < 400, errors: [], result }), { status }),
  );

/**
 * A Cloudflare account in memory, behind `fetch`, with the routes `main` calls.
 *
 * Its widget list leaves `secret` out on purpose, so a run is proven not to need
 * a later read to return one. Whether the real list, or a real GET of one widget,
 * returns the secret was not measured (dl-71's Log).
 */
function fakeAccount(
  initial: { widgets?: Record<string, unknown>[]; widgetListStatus?: number } = {},
) {
  const widgets = [...(initial.widgets ?? [])];
  const apps: Record<string, unknown>[] = [];
  const records: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const base = "https://api.cloudflare.com/client/v4/accounts/A";
  let ingress: unknown[] = [{ service: "http_status:404" }];

  const fetchFake = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") writes.push(`${method} ${url.replace(base, "").split("?")[0]}`);

    if (url.endsWith("/tokens/verify")) return answer({ status: "active" });
    if (url.startsWith(`${base}/cfd_tunnel?`)) return answer([{ id: "abc", name: "home" }]);
    if (url.endsWith("/cfd_tunnel/abc/configurations")) {
      if (method === "PUT") ingress = body.config.ingress;
      return answer({ config: { ingress } });
    }
    if (url.includes("/dns_records")) {
      if (method === "POST") records.push(body);
      return answer(records);
    }
    if (url.endsWith("/access/apps")) {
      if (method === "POST") apps.push({ id: String(apps.length), domain: body.domain });
      return answer(apps);
    }
    if (url.includes("/challenges/widgets")) {
      if (initial.widgetListStatus) return answer(null, initial.widgetListStatus);
      if (method === "POST") {
        widgets.push({ sitekey: "0xFAKE-SITE", name: body.name, domains: body.domains });
        return answer({ sitekey: "0xFAKE-SITE", secret: "0xFAKE-SECRET", ...body });
      }
      return answer(widgets);
    }
    return answer(null, 404);
  };

  return { fetchFake, writes };
}

async function runSetup(account: ReturnType<typeof fakeAccount>, ...extra: string[]) {
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
    vi.unstubAllGlobals();
  }
}

test("plan mode proposes the widget and never calls the create endpoint", async () => {
  const account = fakeAccount();
  const run = await runSetup(account);

  expect(run.error).toBeUndefined();
  expect(run.out).toContain("ADD      turnstile downloader (managed) for downloader.example.com");
  expect(run.out).not.toContain("0xFAKE");
  expect(account.writes).toEqual([]);
});

test("--apply creates the widget once and prints the keys; a second run has nothing to do", async () => {
  const account = fakeAccount();

  const first = await runSetup(account, "--apply");
  expect(first.error).toBeUndefined();
  expect(account.writes.filter((w) => w === "POST /challenges/widgets")).toHaveLength(1);
  expect(first.out).toContain("TURNSTILE_SITE_KEY=0xFAKE-SITE\n");
  expect(first.out).toContain("TURNSTILE_SECRET_KEY=0xFAKE-SECRET\n");

  // The fake's list leaves the secret out, as a later GET might: the second run
  // must neither need it nor print one, and must write nothing at all.
  const written = account.writes.length;
  const second = await runSetup(account, "--apply");
  expect(second.error).toBeUndefined();
  expect(second.out).toContain("ok       turnstile downloader (downloader.example.com)");
  expect(second.out).toContain("nothing to do.");
  expect(second.out).not.toContain("0xFAKE-SECRET");
  expect(account.writes).toHaveLength(written);
});

test("a same-named widget with different domains refuses, and nothing is written", async () => {
  const account = fakeAccount({
    widgets: [{ sitekey: "0xFAKE-SITE", name: "downloader", domains: ["other.example.com"] }],
  });
  const run = await runSetup(account, "--apply");

  expect(run.error).toBeInstanceOf(CliError);
  expect(String(run.error)).toContain("conflict");
  expect(run.out).toContain("CONFLICT turnstile downloader");
  expect(account.writes).toEqual([]);
});

test("a token without the Turnstile permission is told which one it lacks", async () => {
  // Under --apply, so "before anything is written" is asserted of a run that
  // would have written, not only of a plan that never does.
  for (const status of [401, 403]) {
    const account = fakeAccount({ widgetListStatus: status });
    const run = await runSetup(account, "--apply");

    expect(run.error).toBeInstanceOf(CliError);
    expect(String(run.error)).toContain(`-> ${status}`);
    expect(String(run.error)).toContain("Account · Turnstile · Edit");
    expect(account.writes).toEqual([]);
  }
});

test("a failure of the widget list that is not a refused credential is not blamed on the token", async () => {
  // The hint names a permission; under a 500 it would send the operator to the
  // wrong place. The original error is what is left.
  const account = fakeAccount({ widgetListStatus: 500 });
  const run = await runSetup(account, "--apply");

  expect(run.error).toBeInstanceOf(Error);
  expect(run.error).not.toBeInstanceOf(CliError);
  expect(String((run.error as Error).message)).toContain("-> 500");
  expect(String((run.error as Error).message)).not.toContain("Turnstile · Edit");
  expect(account.writes).toEqual([]);
});

test("a create answer with no secret prints no heading", async () => {
  const account = fakeAccount();
  const create = account.fetchFake;
  const withoutSecret: typeof create = async (input, init) => {
    const res = await create(input, init);
    if (init?.method !== "POST" || !String(input).includes("/challenges/widgets")) return res;
    return answer({ sitekey: "0xFAKE-SITE" });
  };
  const run = await runSetup({ ...account, fetchFake: withoutSecret }, "--apply");

  expect(run.error).toBeInstanceOf(Error);
  expect(String(run.error)).toContain("no site key and secret");
  expect(run.out).not.toContain("Paste these two lines");
});

// --- the exit code is the contract --------------------------------------------
//
// `fail` throws and only the entry point exits, so nothing above can see a run
// end with the wrong status. These start the script as a process, with a fake
// `fetch` preloaded by `--import`, and read the status the shell would.

const SCRIPT = path.resolve(import.meta.dirname, "../cloudflare-setup.mjs");
const FAKE_FETCH = pathToFileURL(
  path.resolve(import.meta.dirname, "fixtures/cloudflare-fake-fetch.mjs"),
).href;

function runAsProcess(scenario: "conflict" | "forbidden") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-setup-"));
  const writes = path.join(dir, "writes");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        FAKE_FETCH,
        SCRIPT,
        ...["--domain", "example.com", "--email", "you@example.com"],
        ...["--zone", "Z", "--account", "A", "--ledger-email", "them@example.com", "--apply"],
      ],
      {
        encoding: "utf8",
        shell: false,
        env: {
          PATH: process.env.PATH,
          CLOUDFLARE_API_TOKEN: "fake-token",
          FAKE_CF_SCENARIO: scenario,
          FAKE_CF_WRITES: writes,
        },
      },
    );
    return { ...result, writes: fs.existsSync(writes) ? fs.readFileSync(writes, "utf8") : "" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("run as a process, a same-named widget guarding other domains exits 1 and writes nothing", () => {
  const run = runAsProcess("conflict");

  expect(run.stdout).toContain("CONFLICT turnstile downloader");
  expect(run.stderr).toContain("conflict(s)");
  expect(run.status).toBe(1);
  expect(run.writes).toBe("");
});

test("run as a process, a 403 on the widget list exits 1 and writes nothing", () => {
  const run = runAsProcess("forbidden");

  expect(run.stderr).toContain("Account · Turnstile · Edit");
  expect(run.status).toBe(1);
  expect(run.writes).toBe("");
});
