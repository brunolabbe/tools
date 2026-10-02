/**
 * The Cloudflare half of a deployment, as calls instead of dashboard clicks.
 *
 * `docs/02-DEPLOYMENT.md` steps 2 and 3 — the Access application and the public
 * hostname — were a screenshot walkthrough, once per tool per host, and the
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
 *   node scripts/cloudflare-setup.mjs --domain example.com --email you@example.com \
 *     --ledger-email them@example.com
 *   node scripts/cloudflare-setup.mjs ... --apply
 *
 * CLOUDFLARE_API_TOKEN needs exactly four permissions, and a token with more
 * is a token doing more than this:
 *   Account · Cloudflare Tunnel  · Edit
 *   Account · Access: Apps and Policies · Edit
 *   Account · Turnstile · Edit   (the downloader's human check, dl-71)
 *   Zone    · DNS · Edit   (scoped to the one zone)
 *
 * The one thing it hands back is the Turnstile widget's secret key, once, on
 * `--apply`, as two `.env` lines to paste. It writes no file — this script never
 * has — so the secret is in the terminal's scrollback and nowhere else.
 */

import { pathToFileURL } from "node:url";

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
 *  - the ledger gets no bypass either, and its one policy admits **two**
 *    addresses: the household's shared account is used by both people it
 *    belongs to. The second comes from its own flag, `extraEmailFlag`, rather
 *    than from a repeatable `--email`, because `--email` is every tool's
 *    policy — a second address there would hand that person the downloader
 *    and the planner as well.
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
    // The human check that replaces the login when Access comes off (dl-49). Its
    // one allowed domain is this tool's own hostname, so a site key lifted from
    // the page cannot mint tokens anywhere else. Only a tool with a field here
    // gets a widget, which is why the planner and the ledger need nothing.
    turnstile: { name: "downloader", mode: "managed" },
  },
  {
    tool: "planner",
    subdomain: "planner",
    service: "http://planner:8090",
    access: [{ suffix: "", name: "planner", decision: "allow" }],
  },
  {
    tool: "ledger",
    subdomain: "ledger",
    service: "http://ledger:8100",
    access: [{ suffix: "", name: "ledger", decision: "allow", extraEmailFlag: "ledger-email" }],
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
 * More than one catch-all in the existing config is a conflict too — see below
 * for why that is a refusal rather than a tidy-up.
 */
export function planIngress(existing, desired) {
  const rules = existing.filter((r) => !isCatchAll(r));
  const catchAlls = existing.filter(isCatchAll);
  const catchAll = catchAlls[0] ?? { service: "http_status:404" };

  const added = [];
  const kept = [];
  const conflicts = [];

  // A rule with no hostname matches everything, so a second one is unreachable
  // and the tunnel's real behaviour depends on an order nobody chose. Keeping
  // the first and dropping the rest would be this function removing a rule it
  // did not add, which is the one thing it says it never does — so it refuses
  // and lets a person decide which was meant.
  if (catchAlls.length > 1) {
    conflicts.push({
      hostname: "(catch-all)",
      want: "exactly one",
      found: `${catchAlls.length} rules with no hostname`,
    });
  }

  // Not reachable from the CLI — `desiredState` builds every hostname from a
  // subdomain and a domain — but this is exported and general, and the failure
  // it would otherwise produce is a second catch-all silently swallowing the
  // tunnel. Loud beats subtle.
  const unnamed = desired.find((d) => !d.hostname);
  if (unnamed) {
    throw new Error(`desired ingress rule has no hostname: ${JSON.stringify(unnamed)}`);
  }

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

/** The same set of domains, in any order. */
const sameDomains = (a, b) => a.toSorted().join("\n") === b.toSorted().join("\n");

/**
 * Which Turnstile widgets are missing, which already exist, and which name is
 * taken by a widget guarding different domains.
 *
 * Matched on name — the site key is generated by Cloudflare, so there is nothing
 * else of ours to match on. A same-named widget whose domains differ is a
 * conflict and is never edited: its domain list decides where its site key can
 * mint tokens, and widening it is the operator's call. Its `mode` is not
 * compared; that is a preference, not a boundary.
 *
 * An existing widget's secret is not read here and is not needed: it is handed
 * over once, at creation, by `envLines`.
 */
export function planTurnstile(existingWidgets, desiredWidgets) {
  const create = [];
  const ok = [];
  const conflicts = [];

  for (const want of desiredWidgets) {
    const found = existingWidgets.find((w) => w.name === want.name);
    if (!found) create.push(want);
    else if (sameDomains(found.domains ?? [], want.domains)) {
      ok.push({ ...want, sitekey: found.sitekey });
    } else conflicts.push({ name: want.name, found: found.domains ?? [], want: want.domains });
  }

  return { create, ok, conflicts };
}

/**
 * The two `.env` lines a created widget turns into.
 *
 * Throws on a response with no secret rather than printing an empty assignment:
 * by then the widget exists and a re-run would call it "already there", so an
 * empty `TURNSTILE_SECRET_KEY=` that looked like success is how the check ends
 * up silently off.
 */
export function envLines(widget) {
  if (!widget?.sitekey || !widget?.secret) {
    throw new Error(
      "the widget was created but the response carried no site key and secret — " +
        "rotate its secret in the dashboard (Turnstile, the widget, Rotate secret key) to get one",
    );
  }
  return [`TURNSTILE_SITE_KEY=${widget.sitekey}`, `TURNSTILE_SECRET_KEY=${widget.secret}`];
}

/**
 * Everything the tools table wants, resolved against one domain and address.
 *
 * `extraEmails` maps an application's `extraEmailFlag` to the address given
 * for it. An application whose flag was not given keeps `missing`, so the
 * caller can refuse to *create* it half-admitting — an existing one is only
 * ever reported, so a run that adds nothing needs no flag.
 */
export function desiredState(domain, email, tools = TOOLS, extraEmails = {}) {
  const ingress = tools.map((t) => ({
    hostname: `${t.subdomain}.${domain}`,
    service: t.service,
    tool: t.tool,
  }));

  const dns = tools.map((t) => `${t.subdomain}.${domain}`);

  const apps = tools.flatMap((t) =>
    t.access.map((a) => {
      const extra = a.extraEmailFlag ? extraEmails[a.extraEmailFlag] : undefined;
      return {
        name: a.name,
        domain: `${t.subdomain}.${domain}${a.suffix}`,
        decision: a.decision,
        include:
          a.decision === "bypass"
            ? [{ everyone: {} }]
            : [{ email: { email } }, ...(extra ? [{ email: { email: extra } }] : [])],
        ...(a.extraEmailFlag && !extra ? { missing: `--${a.extraEmailFlag}` } : {}),
      };
    }),
  );

  const widgets = tools
    .filter((t) => t.turnstile)
    .map((t) => ({
      name: t.turnstile.name,
      domains: [`${t.subdomain}.${domain}`],
      mode: t.turnstile.mode,
    }));

  return { ingress, dns, apps, widgets };
}

/**
 * Where a token verifies, which is not the same endpoint for every token.
 *
 * A token made on the dashboard's **Account API tokens** page is account-owned
 * (it carries a `cfat` prefix) and is not a user token at all: `/user/tokens/verify`
 * answers `401 1000 Invalid API Token` for it, which reads exactly like a
 * mistyped secret and sends you back to the dashboard to make another one. It
 * was the first thing this script did, so a perfectly good token failed at the
 * only call that could not be skipped.
 *
 * The new UI makes account-owned the default, so this is the common case rather
 * than the exotic one.
 */
export function verifyPath(accountId) {
  return accountId ? `/accounts/${accountId}/tokens/verify` : "/user/tokens/verify";
}

/**
 * The writes, in the only order that is safe to make them.
 *
 * **Access first, then routing.** Ingress plus a proxied DNS record is what
 * makes a hostname answer; the Access application is what makes it ask for a
 * login. Do those in the obvious order and the endpoint is live and open for
 * however long the remaining calls take — seconds on a good day, indefinitely
 * if one of them fails and someone walks away. On a host whose cloudflared is
 * already connected that window is real exposure, and for the downloader the
 * docs are explicit about what an open instance is for: a machine that will
 * fetch any URL a stranger names.
 *
 * Inverted, the failure mode is harmless: a policy guarding a hostname that
 * does not resolve yet.
 *
 * The widget goes last. It exposes nothing, so it has no place in that argument,
 * and last means that if it is the call that fails, everything that guards the
 * host is already in place and a re-run retries only the widget.
 */
export function applyOrder(plan) {
  return [
    ...plan.access.create.map((a) => ({ kind: "access", item: a })),
    ...(plan.ingress.added.length > 0 ? [{ kind: "ingress", item: plan.ingress.ingress }] : []),
    ...plan.dns.create.map((d) => ({ kind: "dns", item: d })),
    ...(plan.turnstile?.create ?? []).map((w) => ({ kind: "turnstile", item: w })),
  ];
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
    // The status rides on the error so a caller can tell a refused credential
    // from an outage; the message alone is for the operator.
    throw Object.assign(
      new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${detail || "(no detail)"}`),
      { status: res.status },
    );
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

/** A refusal with a message for the operator, as opposed to a bug. */
export class CliError extends Error {}

/**
 * Exported, with its argv and environment as parameters, so a test can drive a
 * whole run against a fake `fetch` — plan, apply and the re-run are properties
 * of this function, not of the pure planners above it.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const token = env.CLOUDFLARE_API_TOKEN;

  if (!token) fail("CLOUDFLARE_API_TOKEN is not set");
  if (!args.domain) fail("--domain is required");
  if (!args.email) fail("--email is required — the address the Allow policies admit");

  // `GET /zones` is a convenience, not a requirement. A token scoped to one
  // zone's DNS can usually still see that zone in the list — but "usually" is
  // the token's business, not ours, and a token without Zone:Read is a correct
  // token for what this script does. So --zone and --account skip the lookup
  // entirely rather than making the caller widen a credential to be listed.
  let zoneId = args.zone;
  let accountId = args.account;

  await call(token, verifyPath(accountId)).catch((err) => {
    fail(
      `${err.message}\n\n` +
        "  If the token came from the dashboard's Account API tokens page it is\n" +
        "  account-owned, and it can only be verified against its own account.\n" +
        "  Pass --account <Account ID> (the domain's Overview page, right-hand column).",
    );
  });

  if (!zoneId || !accountId) {
    const zones = await call(token, `/zones?name=${encodeURIComponent(args.domain)}`).catch(
      (err) => {
        fail(
          `${err.message}\n\n` +
            "  The token cannot list zones. That is fine — pass the two ids from the\n" +
            "  dashboard instead, both on your domain's Overview page, right-hand column:\n" +
            "    --zone <Zone ID> --account <Account ID>",
        );
      },
    );

    if (zones.length !== 1) {
      fail(
        `expected one zone named ${args.domain}, found ${zones.length}` +
          " — pass --zone and --account from the domain's Overview page",
      );
    }

    zoneId ??= zones[0].id;
    accountId ??= zones[0].account.id;
  }

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

  const extraEmails = Object.fromEntries(
    TOOLS.flatMap((t) => t.access)
      .filter((a) => a.extraEmailFlag && args[a.extraEmailFlag])
      .map((a) => [a.extraEmailFlag, args[a.extraEmailFlag]]),
  );
  const want = desiredState(args.domain, args.email, TOOLS, extraEmails);

  const config = await call(token, `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`);
  const ingress = planIngress(config?.config?.ingress ?? [], want.ingress);

  const PER_PAGE = 500;
  const records = await call(token, `/zones/${zoneId}/dns_records?per_page=${PER_PAGE}`);

  // One page, deliberately — but a zone at the ceiling means a record we are
  // about to "add" might already exist on a page nobody read, and the plan
  // would say ADD for something that is already there. The API would refuse
  // the duplicate, so nothing breaks; the plan would just have been wrong,
  // which is worse in a document people approve before running --apply.
  if (records.length >= PER_PAGE) {
    fail(`zone has ${PER_PAGE}+ DNS records; this script reads only the first page`);
  }

  const dns = planDns(records, want.dns, tunnel.id);

  const apps = await call(token, `/accounts/${accountId}/access/apps`);
  const access = planAccess(apps, want.apps);

  // The widget list is the one read that needs the fourth permission, and a host
  // set up before dl-71 has a token without it. Name the permission: the bare
  // 403 reads as a broken token, and nothing in the script's own output would
  // explain one.
  const WIDGETS = `/accounts/${accountId}/challenges/widgets`;
  const PER_WIDGETS = 1000;
  const widgetList = await call(token, `${WIDGETS}?per_page=${PER_WIDGETS}`).catch((err) => {
    // Only a refused credential is the missing permission; a 5xx or a refused
    // connection under that hint would send the operator to the wrong place.
    if (err.status !== 401 && err.status !== 403) throw err;
    fail(
      `${err.message}\n\n` +
        "  The downloader's human check needs Account · Turnstile · Edit on the token.\n" +
        "  Add that permission to the token and run again.",
    );
  });
  if (widgetList.length >= PER_WIDGETS) {
    fail(`account has ${PER_WIDGETS}+ Turnstile widgets; this script reads only the first page`);
  }
  const turnstile = planTurnstile(widgetList, want.widgets);

  // Checked against what would be *created*, not against the table: an
  // application that already exists is never rewritten here, so its second
  // address is whatever the dashboard says, and a run that adds nothing
  // should not need a flag it would ignore. A plan still prints — a host that
  // does not run the ledger can check itself without naming a second person —
  // and only `--apply` refuses, below.
  const unadmitted = access.create.filter((a) => a.missing);

  out(`zone    ${args.domain} (${zoneId})`);
  out(`account ${accountId}`);
  out(`tunnel  ${tunnel.name} (${tunnel.id})`);
  out();

  for (const c of ingress.conflicts) {
    out(`CONFLICT ingress ${c.hostname}: routed to ${c.found}, wanted ${c.want}`);
  }
  for (const c of dns.conflicts) out(`CONFLICT dns ${c.name}: exists as ${c.found}`);

  for (const c of turnstile.conflicts) {
    out(`CONFLICT turnstile ${c.name}: guards ${c.found.join(", ")}, wanted ${c.want.join(", ")}`);
  }

  const conflicts = ingress.conflicts.length + dns.conflicts.length + turnstile.conflicts.length;
  if (conflicts > 0) {
    out();
    fail(`${conflicts} conflict(s) — nothing was changed. Resolve them in the dashboard.`);
  }

  for (const k of ingress.kept) out(`ok       ingress ${k.hostname} -> ${k.service}`);
  for (const n of dns.ok) out(`ok       dns     ${n}`);
  for (const a of access.ok) out(`ok       access  ${a.domain} (${a.decision})`);
  for (const w of turnstile.ok) out(`ok       turnstile ${w.name} (${w.domains.join(", ")})`);
  for (const a of ingress.added) out(`ADD      ingress ${a.hostname} -> ${a.service}`);
  for (const d of dns.create) out(`ADD      dns     ${d.name} -> ${d.content} (proxied)`);
  for (const a of access.create) out(`ADD      access  ${a.domain} (${a.decision})`);
  for (const w of turnstile.create) {
    out(`ADD      turnstile ${w.name} (${w.mode}) for ${w.domains.join(", ")}`);
  }
  for (const a of unadmitted)
    out(`MISSING  access  ${a.domain} admits a second person: ${a.missing}`);

  const changes =
    ingress.added.length + dns.create.length + access.create.length + turnstile.create.length;
  out();

  if (changes === 0) {
    out("nothing to do.");
    return;
  }

  if (!args.apply) {
    if (turnstile.create.length > 0) {
      out("The widget's site key and secret are printed once, on --apply, and written nowhere.");
    }
    out(`${changes} change(s). Re-run with --apply to make them.`);
    return;
  }

  // Created with the owner alone, the policy would lock the other person out
  // with nothing saying why, and no later run repairs an existing one.
  if (unadmitted.length > 0) {
    fail(unadmitted.map((a) => `${a.missing} is required with --apply`).join("\n"));
  }

  for (const op of applyOrder({ access, ingress, dns, turnstile })) {
    if (op.kind === "access") {
      const a = op.item;
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
    } else if (op.kind === "ingress") {
      // The whole array, every time — including the rules we did not add. This
      // is the call the refusals above are protecting.
      await call(token, `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`, {
        method: "PUT",
        body: JSON.stringify({ config: { ...config?.config, ingress: op.item } }),
      });
      out(`applied  ingress (${op.item.length} rules)`);
    } else if (op.kind === "dns") {
      const d = op.item;
      await call(token, `/zones/${zoneId}/dns_records`, {
        method: "POST",
        body: JSON.stringify({ type: "CNAME", name: d.name, content: d.content, proxied: true }),
      });
      out(`applied  dns     ${d.name}`);
    } else {
      const w = op.item;
      const created = await call(token, WIDGETS, {
        method: "POST",
        body: JSON.stringify({ name: w.name, domains: w.domains, mode: w.mode }),
      });
      out(`applied  turnstile ${w.name}`);
      // Validated before the heading prints, so an answer with no secret is an
      // error and not a heading over nothing.
      const lines = envLines(created);
      // Printed the moment it exists, before anything else can fail. This script
      // never asks for the secret again, so this is the only copy it makes.
      out();
      out("Paste these two lines into the host's .env — the secret is shown once:");
      for (const line of lines) out(line);
    }
  }
}

/** Plans are read in a terminal, so they go to stdout as lines, not as a log. */
function out(s = "") {
  process.stdout.write(`${s}\n`);
}

/** Throws instead of exiting, so a test can see the refusal; the entry point exits. */
function fail(message) {
  throw new CliError(message);
}

// `pathToFileURL`, never `file://` + the path: on Windows `argv[1]` is `D:\a\...`
// and the concatenation never matches `import.meta.url`, so `main` never runs and
// the script exits 0 for every invocation — a refusal included. A space or a %-encoded
// character does it on Linux too; a symlink still mismatches. See `commit-message.mjs`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`cloudflare-setup: ${err.message}\n`);
    process.exit(1);
  });
}
