/**
 * The Cloudflare half of a deployment, as calls instead of dashboard clicks.
 *
 * `docs/02-DEPLOYMENT.md` steps 2 and 4 — the public hostname and the Access
 * application — were a screenshot walkthrough, once per tool per host, and the
 * second tool's walkthrough is a delta on the first that says "not a copy of
 * the downloader's" three times. That is a procedure with a correctness
 * argument in it, which is the kind that should be executable.
 *
 * **It is additive and it refuses rather than overwrites.** The one call here
 * that can break a live host is the ingress PUT: it replaces the tunnel's
 * whole rule list, so adding the planner means reading the downloader's rule
 * and writing it back. A merge that silently dropped it would take the
 * downloader off the internet with a 200 response and no error anywhere. So
 * `planIngress` never removes a rule it did not add, and a desired hostname
 * that already points somewhere else is a refusal with an exit code, not an
 * overwrite. Same for DNS: a name that resolves to something other than this
 * tunnel is reported, never replaced.
 *
 * Nothing here deletes. Widening or removing an Access policy is the operator's
 * decision — see "When you want it genuinely public" in 02-DEPLOYMENT.md — and
 * a script that can take the login off is a script that can take the login off
 * by accident.
 *
 * Default is a plan. `--apply` is the only thing that writes.
 *
 *   node scripts/cloudflare-setup.mjs --domain example.com --email you@example.com
 *   node scripts/cloudflare-setup.mjs --domain example.com --email you@example.com --apply
 *
 * CLOUDFLARE_API_TOKEN needs exactly three permissions, and a token with more
 * is a token doing more than this:
 *   Account · Cloudflare Tunnel  · Edit
 *   Account · Access: Apps and Policies · Edit
 *   Zone    · DNS · Edit   (scoped to the one zone)
 */

const API = "https://api.cloudflare.com/client/v4";

/**
 * What each tool publishes, and under what policy.
 *
 * The ports are also in the compose files and `scripts/test/cloudflare-setup.test.ts`
 * asserts the two agree — a port that drifts here would produce a tunnel that
 * registers, resolves, and 502s, which is a long way to travel for a typo.
 *
 * The `access` shapes are the part that is a decision rather than a fact, and
 * each one is argued in docs/02-DEPLOYMENT.md:
 *
 *  - the downloader gets a **second** application on `api/files/*` with a
 *    Bypass policy, because that path's authorisation is a 256-bit capability
 *    token (`tools/downloader/api/src/jobs/tokens.ts`) and gating it would
 *    defeat the shareable link it exists to be.
 *  - the planner gets **no** bypass. It has no capability tokens and no owner
 *    model at all, so every visitor shares one store. The allowlist is not a
 *    precaution around that data model; it is the only configuration in which
 *    that model is coherent.
 */
export const TOOLS = [
  {
    tool: "downloader",
    subdomain: "downloader",
    service: "http://downloader:8080",
    access: [
      { suffix: "", name: "downloader", decision: "allow" },
      { suffix: "/api/files/*", name: "downloader download links", decision: "bypass" },
    ],
  },
  {
    tool: "planner",
    subdomain: "planner",
    service: "http://planner:8090",
    access: [{ suffix: "", name: "planner", decision: "allow" }],
  },
];

export const SESSION_DURATION = "168h";

/** A rule with no `hostname` is the tunnel's catch-all, and it must stay last. */
const isCatchAll = (rule) => !rule.hostname;

/**
 * Merge the desired hostnames into the tunnel's existing ingress.
 *
 * Returns `{ ingress, added, kept, conflicts }`. A conflict is a hostname that
 * is already routed somewhere other than where we want it: reported, never
 * rewritten, because the other destination is something somebody deployed.
 */
export function planIngress(existing, desired) {
  const rules = existing.filter((r) => !isCatchAll(r));
  const catchAll = existing.find(isCatchAll) ?? { service: "http_status:404" };

  const added = [];
  const kept = [];
  const conflicts = [];

  for (const want of desired) {
    const found = rules.find((r) => r.hostname === want.hostname && !r.path);
    if (!found) {
      rules.push({ hostname: want.hostname, service: want.service });
      added.push(want);
    } else if (found.service === want.service) {
      kept.push(want);
    } else {
      conflicts.push({ hostname: want.hostname, want: want.service, found: found.service });
    }
  }

  return { ingress: [...rules, catchAll], added, kept, conflicts };
}

/**
 * Which CNAMEs are missing, which already point at this tunnel, and which names
 * are occupied by something else.
 */
export function planDns(existingRecords, desiredNames, tunnelId) {
  const target = `${tunnelId}.cfargotunnel.com`;
  const create = [];
  const ok = [];
  const conflicts = [];

  for (const name of desiredNames) {
    const found = existingRecords.find((r) => r.name === name);
    if (!found) create.push({ name, content: target });
    else if (found.type === "CNAME" && found.content === target && found.proxied) ok.push(name);
    else conflicts.push({ name, found: `${found.type} ${found.content}` });
  }

  return { create, ok, conflicts };
}

/**
 * Which Access applications are missing.
 *
 * Matched on the application's own domain string, path included — the two
 * downloader applications differ only by that path, and matching on name would
 * treat them as one.
 */
export function planAccess(existingApps, desiredApps) {
  const create = [];
  const ok = [];

  for (const want of desiredApps) {
    const found = existingApps.find((a) => a.domain === want.domain);
    if (found) ok.push({ ...want, id: found.id });
    else create.push(want);
  }

  return { create, ok };
}

/** Everything the tools table wants, resolved against one domain and address. */
export function desiredState(domain, email, tools = TOOLS) {
  const ingress = tools.map((t) => ({
    hostname: `${t.subdomain}.${domain}`,
    service: t.service,
    tool: t.tool,
  }));

  const dns = tools.map((t) => `${t.subdomain}.${domain}`);

  const apps = tools.flatMap((t) =>
    t.access.map((a) => ({
      name: a.name,
      domain: `${t.subdomain}.${domain}${a.suffix}`,
      decision: a.decision,
      include: a.decision === "bypass" ? [{ everyone: {} }] : [{ email: { email } }],
    })),
  );

  return { ingress, dns, apps };
}

// --- the HTTP half ----------------------------------------------------------

async function call(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const body = await res.json().catch(() => ({}));

  // Cloudflare answers 200 with `success: false` often enough that checking the
  // status code alone reads as a pass on a refusal.
  if (!res.ok || body.success === false) {
    const detail = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${detail || "(no detail)"}`);
  }

  return body.result;
}

export function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else throw new Error(`unexpected argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!token) fail("CLOUDFLARE_API_TOKEN is not set");
  if (!args.domain) fail("--domain is required");
  if (!args.email) fail("--email is required — the address the Allow policies admit");

  await call(token, "/user/tokens/verify");

  const zones = await call(token, `/zones?name=${encodeURIComponent(args.domain)}`);
  if (zones.length !== 1) fail(`expected one zone named ${args.domain}, found ${zones.length}`);
  const zone = zones[0];
  const accountId = args.account ?? zone.account.id;

  const tunnels = (await call(token, `/accounts/${accountId}/cfd_tunnel?is_deleted=false`)).filter(
    (t) => !args.tunnel || t.name === args.tunnel || t.id === args.tunnel,
  );
  if (tunnels.length !== 1) {
    fail(
      `expected one tunnel, found ${tunnels.length}` +
        (tunnels.length > 1 ? ` (${tunnels.map((t) => t.name).join(", ")}) — pass --tunnel` : ""),
    );
  }
  const tunnel = tunnels[0];

  const want = desiredState(args.domain, args.email);

  const config = await call(token, `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`);
  const ingress = planIngress(config?.config?.ingress ?? [], want.ingress);

  const records = await call(token, `/zones/${zone.id}/dns_records?per_page=500`);
  const dns = planDns(records, want.dns, tunnel.id);

  const apps = await call(token, `/accounts/${accountId}/access/apps`);
  const access = planAccess(apps, want.apps);

  out(`zone    ${args.domain} (${zone.id})`);
  out(`account ${accountId}`);
  out(`tunnel  ${tunnel.name} (${tunnel.id})`);
  out();

  for (const c of ingress.conflicts) {
    out(`CONFLICT ingress ${c.hostname}: routed to ${c.found}, wanted ${c.want}`);
  }
  for (const c of dns.conflicts) out(`CONFLICT dns ${c.name}: exists as ${c.found}`);

  const conflicts = ingress.conflicts.length + dns.conflicts.length;
  if (conflicts > 0) {
    out();
    fail(`${conflicts} conflict(s) — nothing was changed. Resolve them in the dashboard.`);
  }

  for (const k of ingress.kept) out(`ok       ingress ${k.hostname} -> ${k.service}`);
  for (const n of dns.ok) out(`ok       dns     ${n}`);
  for (const a of access.ok) out(`ok       access  ${a.domain} (${a.decision})`);
  for (const a of ingress.added) out(`ADD      ingress ${a.hostname} -> ${a.service}`);
  for (const d of dns.create) out(`ADD      dns     ${d.name} -> ${d.content} (proxied)`);
  for (const a of access.create) out(`ADD      access  ${a.domain} (${a.decision})`);

  const changes = ingress.added.length + dns.create.length + access.create.length;
  out();

  if (changes === 0) {
    out("nothing to do.");
    return;
  }

  if (!args.apply) {
    out(`${changes} change(s). Re-run with --apply to make them.`);
    return;
  }

  if (ingress.added.length > 0) {
    // The whole array, every time — including the rules we did not add. This is
    // the call the refusals above are protecting.
    await call(token, `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`, {
      method: "PUT",
      body: JSON.stringify({ config: { ...config?.config, ingress: ingress.ingress } }),
    });
    out(`applied  ingress (${ingress.ingress.length} rules)`);
  }

  for (const d of dns.create) {
    await call(token, `/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "CNAME", name: d.name, content: d.content, proxied: true }),
    });
    out(`applied  dns     ${d.name}`);
  }

  for (const a of access.create) {
    await call(token, `/accounts/${accountId}/access/apps`, {
      method: "POST",
      body: JSON.stringify({
        name: a.name,
        type: "self_hosted",
        domain: a.domain,
        session_duration: SESSION_DURATION,
        policies: [{ name: a.name, decision: a.decision, include: a.include, precedence: 1 }],
      }),
    });
    out(`applied  access  ${a.domain}`);
  }
}

/** Plans are read in a terminal, so they go to stdout as lines, not as a log. */
function out(s = "") {
  process.stdout.write(`${s}\n`);
}

function fail(message) {
  process.stderr.write(`cloudflare-setup: ${message}\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => fail(err.message));
}
