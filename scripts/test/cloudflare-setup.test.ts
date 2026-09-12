/**
 * The refusals, and the one drift this script can produce silently.
 *
 * Every case here was watched failing first, against the guard removed.
 *
 * The load-bearing one is `preserves a rule it did not add`. The ingress PUT
 * replaces the tunnel's entire rule list, so the merge is the only thing
 * standing between "add the planner" and "take the downloader off the
 * internet" — and that failure is silent at every layer: the API returns 200,
 * the tunnel re-registers, and the downloader's hostname starts answering with
 * Cloudflare's own error page. A fixture that held only the rule being added
 * would pass whatever the merge did, so the fixture carries a rule the merge
 * must find and keep.
 *
 * The last case is not about this script's logic at all — it reads the compose
 * files and asserts the ports in `TOOLS` are the ports the services actually
 * listen on. A table of ports beside a table of ports is drift waiting to
 * happen, and the symptom is the expensive kind: DNS resolves, Access lets you
 * in, and the origin 502s.
 *
 * **It finds the fragment by the service it defines, not by its filename.**
 * repo-33 renames every one of them — `compose.yaml` becomes
 * `compose.downloader.yaml` — and a test that named them would have gone red on
 * a change that cannot affect what it is checking. The tunnel is immune to that
 * rename for the same underlying reason this test is written this way: ingress
 * points at a *service* on the compose network, and repo-33 moves the project
 * name and the file names, never the service names.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import {
  desiredState,
  planAccess,
  planDns,
  planIngress,
  TOOLS,
  verifyPath,
  applyOrder,
} from "../cloudflare-setup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DOWNLOADER_LIVE = [
  { hostname: "downloader.example.com", service: "http://downloader:8080" },
  { service: "http_status:404" },
];

/**
 * A tunnel that is not only ours.
 *
 * One tunnel per host, and a host runs more than this repo: the tunnel this
 * script was first applied to carried an unrelated hostname pointing at a port
 * on the machine, sharing the tunnel with nothing else of ours. That rule is
 * the one with no other protection — a hostname in `TOOLS` would be re-added by
 * the very next plan run, and the catch-all is asserted separately, but a
 * third-party rule that this merge drops is gone with a 200 and no error
 * anywhere, and the owner finds out when their service stops answering.
 */
const SHARED_TUNNEL = [
  { hostname: "immich.example.com", service: "http://host.docker.internal:2283" },
  { hostname: "downloader.example.com", service: "http://downloader:8080" },
  { service: "http_status:404" },
];

const wantBoth = desiredState("example.com", "you@example.com").ingress;

test("preserves a rule it did not add", () => {
  const plan = planIngress(DOWNLOADER_LIVE, wantBoth);

  expect(plan.ingress).toContainEqual({
    hostname: "downloader.example.com",
    service: "http://downloader:8080",
  });
  expect(plan.added.map((a: { hostname: string }) => a.hostname)).toEqual(["planner.example.com"]);
  expect(plan.kept.map((k: { hostname: string }) => k.hostname)).toEqual([
    "downloader.example.com",
  ]);
});

test("a hostname belonging to nobody in TOOLS survives the merge", () => {
  const plan = planIngress(SHARED_TUNNEL, wantBoth);

  expect(plan.ingress).toContainEqual({
    hostname: "immich.example.com",
    service: "http://host.docker.internal:2283",
  });
  // it is not ours, so it is neither added nor reported as kept — it is simply
  // still there, which is the whole of what this script owes it.
  expect(plan.added.map((a: { hostname: string }) => a.hostname)).toEqual(["planner.example.com"]);
  expect(plan.kept.map((k: { hostname: string }) => k.hostname)).toEqual([
    "downloader.example.com",
  ]);
  expect(plan.conflicts).toEqual([]);
});

test("the merge writes back every rule it was given, plus the one it adds", () => {
  // Stated as a count as well as a membership, so a merge that preserved the
  // foreign rule by *duplicating* something else still fails.
  const plan = planIngress(SHARED_TUNNEL, wantBoth);

  expect(plan.ingress).toHaveLength(SHARED_TUNNEL.length + 1);
  expect(plan.ingress.map((r: { hostname?: string }) => r.hostname)).toEqual([
    "immich.example.com",
    "downloader.example.com",
    "planner.example.com",
    undefined,
  ]);
});

test("keeps the catch-all last, and does not add a second one", () => {
  const plan = planIngress(DOWNLOADER_LIVE, wantBoth);
  const catchAlls = plan.ingress.filter((r: { hostname?: string }) => !r.hostname);

  expect(catchAlls).toHaveLength(1);
  expect(plan.ingress.at(-1)).toEqual({ service: "http_status:404" });
});

test("a tunnel with no configuration at all still gets a catch-all", () => {
  const plan = planIngress([], wantBoth);

  expect(plan.ingress).toHaveLength(3);
  expect(plan.ingress.at(-1)).toEqual({ service: "http_status:404" });
});

test("refuses a hostname already routed somewhere else", () => {
  const taken = [
    { hostname: "planner.example.com", service: "http://something-else:9000" },
    { service: "http_status:404" },
  ];

  const plan = planIngress(taken, wantBoth);

  expect(plan.conflicts).toEqual([
    {
      hostname: "planner.example.com",
      want: "http://planner:8090",
      found: "http://something-else:9000",
    },
  ]);
  // and the foreign rule is still there — a conflict reports, it does not evict.
  expect(plan.ingress).toContainEqual({
    hostname: "planner.example.com",
    service: "http://something-else:9000",
  });
});

test("an occupied DNS name is a conflict, not a replacement", () => {
  const existing = [
    {
      name: "downloader.example.com",
      type: "CNAME",
      content: "abc.cfargotunnel.com",
      proxied: true,
    },
    { name: "planner.example.com", type: "A", content: "203.0.113.10", proxied: false },
  ];

  const plan = planDns(existing, ["downloader.example.com", "planner.example.com"], "abc");

  expect(plan.ok).toEqual(["downloader.example.com"]);
  expect(plan.create).toEqual([]);
  expect(plan.conflicts).toEqual([{ name: "planner.example.com", found: "A 203.0.113.10" }]);
});

test("an unproxied CNAME to the right tunnel is still a conflict", () => {
  // DNS-only means the request never reaches Cloudflare's edge, so Access never
  // runs. It resolves, it looks configured, and the login is simply absent.
  const existing = [
    { name: "planner.example.com", type: "CNAME", content: "abc.cfargotunnel.com", proxied: false },
  ];

  const plan = planDns(existing, ["planner.example.com"], "abc");

  expect(plan.create).toEqual([]);
  expect(plan.conflicts).toHaveLength(1);
});

test("the two downloader applications are told apart by their path", () => {
  const want = desiredState("example.com", "you@example.com").apps;
  const live = [{ id: "1", domain: "downloader.example.com" }];

  const plan = planAccess(live, want);

  expect(plan.ok.map((a: { domain: string }) => a.domain)).toEqual(["downloader.example.com"]);
  expect(plan.create.map((a: { domain: string }) => a.domain)).toEqual([
    "downloader.example.com/api/files/*",
    "planner.example.com",
  ]);
});

test("only the downloader's files path bypasses, and the planner never does", () => {
  const apps = desiredState("example.com", "you@example.com").apps;
  const bypassing = apps.filter((a: { decision: string }) => a.decision === "bypass");

  expect(bypassing.map((a: { domain: string }) => a.domain)).toEqual([
    "downloader.example.com/api/files/*",
  ]);
  expect(bypassing[0]?.include).toEqual([{ everyone: {} }]);

  const planner = apps.filter((a: { domain: string }) => a.domain.startsWith("planner."));
  expect(planner).toHaveLength(1);
  expect(planner[0]?.decision).toBe("allow");
});

test("the ports match the compose fragment that defines each service", () => {
  const fragments = readdirSync(root)
    .filter((f) => /^compose.*\.ya?ml$/.test(f))
    .map((f) => ({ name: f, body: readFileSync(path.join(root, f), "utf8") }));

  expect(fragments.length, "found no compose fragments to check against").toBeGreaterThan(0);

  for (const t of TOOLS as { tool: string; service: string }[]) {
    const port = t.service.split(":").at(-1) ?? "";

    // The fragment that publishes the port, found by the service key it defines
    // at the top level of `services:` — two spaces, the name, a colon.
    const defining = fragments.filter(
      (f) => new RegExp(`^ {2}${t.tool}:$`, "m").test(f.body) && f.body.includes("ports:"),
    );

    expect(
      defining.map((f) => f.name),
      `no compose fragment defines ${t.tool} with ports`,
    ).not.toHaveLength(0);

    for (const f of defining) {
      expect(f.body, `${f.name} should publish ${t.tool} on ${port}`).toContain(
        `127.0.0.1:${port}:${port}`,
      );
    }
  }
});

test("an account-owned token verifies against its account, not against /user", () => {
  // Measured, not assumed: a `cfat`-prefixed token from the dashboard's Account
  // API tokens page answers 401 1000 "Invalid API Token" at /user/tokens/verify
  // and "valid and active" at /accounts/<id>/tokens/verify. The 401 is
  // indistinguishable from a mistyped secret, so the endpoint choice is the
  // difference between a working token and a second trip to the dashboard.
  expect(verifyPath("4f6d6c46")).toBe("/accounts/4f6d6c46/tokens/verify");
  expect(verifyPath(undefined)).toBe("/user/tokens/verify");
});

test("every Access application is created before any hostname resolves", () => {
  const want = desiredState("example.com", "you@example.com");
  const order = applyOrder({
    access: planAccess([], want.apps),
    ingress: planIngress(DOWNLOADER_LIVE, want.ingress),
    dns: planDns([], want.dns, "abc"),
  }) as { kind: string }[];

  const kinds = order.map((o) => o.kind);
  const lastAccess = kinds.lastIndexOf("access");
  const firstRouting = Math.min(
    ...["ingress", "dns"].map((k) => kinds.indexOf(k)).filter((i) => i !== -1),
  );

  expect(lastAccess).toBeLessThan(firstRouting);
  // and the ingress PUT is one call carrying every rule, never one per rule.
  expect(kinds.filter((k) => k === "ingress")).toHaveLength(1);
});

test("two catch-alls in the existing config is a refusal, not a tidy-up", () => {
  // Both were reported by the gate as reachable only through a malformed tunnel
  // config. That is the reason to refuse rather than to repair: the second rule
  // is unreachable either way, and deciding which one was meant is not this
  // script's call to make silently.
  const malformed = [
    { hostname: "downloader.example.com", service: "http://downloader:8080" },
    { service: "http_status:404" },
    { service: "http_status:503" },
  ];

  const plan = planIngress(malformed, wantBoth);

  expect(plan.conflicts).toContainEqual({
    hostname: "(catch-all)",
    want: "exactly one",
    found: "2 rules with no hostname",
  });
});

test("a desired rule with no hostname throws rather than becoming a catch-all", () => {
  // `desiredState` cannot produce one, but `planIngress` is exported, and a
  // hostname-less rule matches everything: it would quietly swallow the tunnel.
  expect(() => planIngress(DOWNLOADER_LIVE, [{ service: "http://x:1" }])).toThrow(/no hostname/);
});
