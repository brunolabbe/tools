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
 * by accident. That is why the downloader's entry below is empty and the live
 * applications it used to have are still there on a host set up earlier: the
 * script cannot remove them, so the owner deletes them on the dashboard (dl-49).
 *
 * Default is a plan. `--apply` is the only thing that writes.
 *
 *   node scripts/cloudflare-setup.mjs --domain example.com --email you@example.com \
 *     --ledger-email them@example.com
 *   node scripts/cloudflare-setup.mjs ... --apply
 *
 * CLOUDFLARE_API_TOKEN needs exactly six permissions, and a token with more
 * is a token doing more than this:
 *   Account · Cloudflare Tunnel  · Edit
 *   Account · Access: Apps and Policies · Edit
 *   Account · Turnstile · Edit   (the downloader's human check, dl-71)
 *   Account · Workers Scripts · Edit   (the down page's Worker, repo-143)
 *   Zone    · DNS · Edit   (scoped to the one zone)
 *   Zone    · Workers Routes · Edit   (the down page's routes, repo-143)
 *
 * The one thing it hands back is the Turnstile widget's secret key, once, on
 * `--apply`, as two `.env` lines to paste. It writes no file — this script never
 * has — so the secret is in the terminal's scrollback and nowhere else.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
 *  - the downloader gets **no application at all** (dl-49). It is public, and
 *    what stands in for a login is the app's own — the human check, the
 *    per-client limits, streaming instead of storing (dl-50 to dl-54). Its
 *    `api/files/*` Bypass went with the login: that path's authorisation is a
 *    256-bit capability token (`tools/downloader/api/src/jobs/tokens.ts`) and
 *    it was only ever a hole through a gate that no longer exists. A host that
 *    has not applied those safeguards puts the login back by hand, from the
 *    dashboard steps in docs/02-DEPLOYMENT.md.
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
    access: [],
    // Files the build writes outside `assets/` (the tool's vite.config.ts), which
    // the down page's routes keep off the Worker too. A test reads the config and
    // fails when this list and the build disagree.
    staticPaths: ["/theme.js"],
    // The human check that replaces the login now Access is off (dl-49). Its
    // one allowed domain is this tool's own hostname, so a site key lifted from
    // the page cannot mint tokens anywhere else. Only a tool with a field here
    // gets a widget, which is why the planner and the ledger need nothing.
    turnstile: { name: "downloader", mode: "managed" },
  },
  {
    tool: "planner",
    subdomain: "planner",
    service: "http://planner:8090",
    staticPaths: [],
    access: [{ suffix: "", name: "planner", decision: "allow" }],
  },
  {
    tool: "ledger",
    subdomain: "ledger",
    service: "http://ledger:8100",
    staticPaths: ["/theme.js"],
    access: [{ suffix: "", name: "ledger", decision: "allow", extraEmailFlag: "ledger-email" }],
  },
];

export const SESSION_DURATION = "168h";

/** The Worker that answers with the down page (repo-143), and the file it is uploaded from. */
export const WORKER_NAME = "down-page";
const WORKER_FILE = new URL("./cloudflare-down-page.mjs", import.meta.url);
const WORKER_MODULE = "worker.mjs";

/**
 * Paths no Worker sees: the API (JSON, SSE, file streams and the edge rate limit
 * on `/api/`) and the build's hashed assets. Each gets a route with no script, the
 * API's way to say "this pattern, and no Worker", which beats `<host>/*` by being
 * the longer match. A page load is the only thing the Worker is for.
 */
export const EDGE_PATHS = ["/api/*", "/assets/*"];

/**
 * A marker line appended to the uploaded source, so a re-run can tell whether the
 * deployed Worker is the file in the checkout without trusting Cloudflare's own
 * etag to be a hash of anything we can reproduce.
 */
const MARKER = "// repo-143-content-sha256:";

/** The checkout's Worker source, its hash, and the text to upload. */
export function workerFromSource(source) {
  const hash = createHash("sha256").update(source).digest("hex");
  return { name: WORKER_NAME, hash, body: `${source}\n${MARKER} ${hash}\n` };
}

/**
 * The hash a deployed script carries, or `null` if it has no marker, which means
 * it is not one this script uploaded. Reads the raw text, so it does not depend on
 * whether Cloudflare hands a module back bare or inside a multipart body.
 */
export function deployedHash(text) {
  return new RegExp(`^${MARKER} ([0-9a-f]{64})\\s*$`, "m").exec(text)?.[1] ?? null;
}

/**
 * Whether the Worker needs uploading. `deployed` is `null` when the account has no
 * script of that name, else `{ hash }` with `hash` null for a script that is not
 * ours: that is a conflict and is never overwritten, the same rule as a route
 * pointing at somebody else's Worker. Identical content is `ok`, so a re-run
 * uploads nothing.
 */
export function planWorker(deployed, want) {
  if (deployed === null) return { create: [want], update: [], ok: [], conflicts: [] };
  if (deployed.hash === null) {
    return {
      create: [],
      update: [],
      ok: [],
      conflicts: [{ name: want.name, found: "a script this tool did not upload" }],
    };
  }
  if (deployed.hash === want.hash) return { create: [], update: [], ok: [want], conflicts: [] };
  return { create: [], update: [want], ok: [], conflicts: [] };
}

/** A route's script as the API reports it: absent, null or empty all mean no Worker. */
const routeScript = (r) => r.script || null;

/**
 * Which Worker routes are missing, which are already as wanted, and which pattern
 * is taken by something else. `desired` entries are `{ pattern, script }` with a
 * null script for an exclusion.
 *
 * A route on the same pattern with a **different** script is a conflict, never
 * replaced; so is an exclusion where a Worker is routed, and a Worker where
 * somebody put an exclusion. Both are somebody's decision about that pattern.
 *
 * **A Worker route is only `ok` when it is also fail open** (owner, 2026-11-08):
 * the create call documents `pattern` and `script` and nothing else, so the flag
 * is a second write (`failOpenBody`), and a route that exists with the flag off is
 * a `repair`, which is how a run that stopped between the two writes is finished.
 * An exclusion has no Worker to fail, so it carries no flag.
 */
export function planRoutes(existing, desired) {
  const create = [];
  const ok = [];
  const repair = [];
  const conflicts = [];

  for (const want of desired) {
    const found = existing.find((r) => r.pattern === want.pattern);
    if (!found) create.push(want);
    else if (routeScript(found) === want.script) {
      if (want.script && found.request_limit_fail_open !== true) {
        repair.push({ ...want, id: found.id });
      } else ok.push(want);
    } else {
      conflicts.push({
        pattern: want.pattern,
        want: want.script ?? "(no Worker)",
        found: routeScript(found) ?? "(no Worker)",
      });
    }
  }

  return { create, ok, repair, conflicts };
}

/**
 * The route body that makes a Worker route fail open: past the Free plan's daily
 * quota the Worker is skipped and the site is served, where the default (fail
 * closed) answers every page load with Cloudflare's 1027. It is a PUT, which
 * replaces the route, so it restates `pattern` and `script`.
 */
export const failOpenBody = (r) =>
  JSON.stringify({ pattern: r.pattern, script: r.script, request_limit_fail_open: true });

/**
 * Whether the Worker's `workers.dev` address needs switching off (owner,
 * 2026-11-08). Every Worker gets a public `workers.dev` route when it is created,
 * and nobody asked to publish this one. `state` is `null` for a script that does
 * not exist yet, which will be created enabled, else `{ enabled }` as read.
 * Already disabled is `ok`, so a re-run changes nothing.
 */
export function planWorkersDev(state, name) {
  if (state === null || state.enabled) return { disable: [name], ok: [] };
  return { disable: [], ok: [name] };
}

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
 * Matched on the application's own domain string, path included — two
 * applications on one host can differ only by that path (the downloader's pair
 * did, before dl-49), and matching on name would treat them as one.
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

  // Exclusions first per tool, so the apply never has a moment with the Worker
  // routed over `/api/*`.
  const routes = tools.flatMap((t) => {
    const host = `${t.subdomain}.${domain}`;
    return [
      ...[...EDGE_PATHS, ...(t.staticPaths ?? [])].map((p) => ({
        pattern: `${host}${p}`,
        script: null,
      })),
      { pattern: `${host}/*`, script: WORKER_NAME },
    ];
  });

  return { ingress, dns, apps, widgets, routes };
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
 * already connected that window is real exposure, and for the planner (one store
 * for every visitor) and the ledger (a household's bank history) the docs are
 * explicit that an open instance is not an acceptable state. The downloader has
 * no application to order, so it is not in this argument (dl-49).
 *
 * Inverted, the failure mode is harmless: a policy guarding a hostname that
 * does not resolve yet.
 *
 * The widget goes last. It exposes nothing, so it has no place in that argument,
 * and last means that if it is the call that fails, the planner's and the
 * ledger's applications are already in place and a re-run retries only the
 * widget.
 *
 * That ordering does not protect the downloader (dl-49). It has no application,
 * so its hostname answers as soon as the ingress and DNS calls land, and its
 * widget guards nothing until the two keys are in the host's `.env` and the
 * container has restarted. The operator puts them there before the downloader
 * is up; docs/02-DEPLOYMENT.md says so under "Steps 2 and 3, in one command"
 * and again in step 4.
 */
export function applyOrder(plan) {
  return [
    ...plan.access.create.map((a) => ({ kind: "access", item: a })),
    ...(plan.ingress.added.length > 0 ? [{ kind: "ingress", item: plan.ingress.ingress }] : []),
    ...plan.dns.create.map((d) => ({ kind: "dns", item: d })),
    // The Worker before the routes that name it, and both before the widget: the
    // widget is last so a failure there retries only the widget.
    ...[...(plan.worker?.create ?? []), ...(plan.worker?.update ?? [])].map((w) => ({
      kind: "worker",
      item: w,
    })),
    // Right after the upload: the script is public on workers.dev from the moment
    // it exists, so the window is the length of the next call.
    ...(plan.workersDev?.disable ?? []).map((n) => ({ kind: "workersdev", item: n })),
    ...(plan.routes?.create ?? []).map((r) => ({ kind: "route", item: r })),
    ...(plan.routes?.repair ?? []).map((r) => ({ kind: "route-repair", item: r })),
    ...(plan.turnstile?.create ?? []).map((w) => ({ kind: "turnstile", item: w })),
  ];
}

// --- the HTTP half ----------------------------------------------------------

async function call(token, path, init = {}) {
  // A multipart body carries its boundary in its own Content-Type, which `fetch`
  // writes only when none is set.
  const type = init.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...type, ...init.headers },
  });

  const body = await res.json().catch(() => ({}));

  // Cloudflare answers 200 with `success: false` often enough that checking the
  // status code alone reads as a pass on a refusal.
  if (!res.ok || body.success === false) throw httpError(init, path, res, body);

  return body.result;
}

/**
 * The status rides on the error so a caller can tell a refused credential from an
 * outage; the message alone is for the operator.
 */
function httpError(init, path, res, body) {
  const detail = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
  return Object.assign(
    new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${detail || "(no detail)"}`),
    { status: res.status },
  );
}

/**
 * A Worker's source is not JSON: Cloudflare returns the uploaded module as it is
 * (or inside a multipart body), so this reads text. `null` is a script that does
 * not exist, which is the one 404 that is an answer rather than a fault.
 */
async function callScript(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw httpError({}, path, res, safeJson(text));
  return text;
}

function safeJson(text) {
  try {
    return JSON.parse(text) ?? {};
  } catch {
    return {};
  }
}

/** The upload: one multipart request, the module and its metadata. */
function workerForm(w) {
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({ main_module: WORKER_MODULE, compatibility_date: "2026-10-01" })], {
      type: "application/json",
    }),
  );
  form.append(
    WORKER_MODULE,
    new Blob([w.body], { type: "application/javascript+module" }),
    WORKER_MODULE,
  );
  return form;
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

  // The down page's two reads, each behind its own permission, for the same reason
  // as the widget list above: a bare 403 reads as a broken token.
  const SCRIPT = `/accounts/${accountId}/workers/scripts/${WORKER_NAME}`;
  const ROUTES = `/zones/${zoneId}/workers/routes`;
  const wantWorker = workerFromSource(readFileSync(WORKER_FILE, "utf8"));
  const scriptText = await callScript(token, SCRIPT).catch((err) => {
    if (err.status !== 401 && err.status !== 403) throw err;
    fail(
      `${err.message}\n\n` +
        "  The down page's Worker needs Account · Workers Scripts · Edit on the token.\n" +
        "  Add that permission to the token and run again.",
    );
  });
  const worker = planWorker(
    scriptText === null ? null : { hash: deployedHash(scriptText) },
    wantWorker,
  );
  // The workers.dev switch is read only for a script this tool uploaded: an absent
  // one will be created enabled, and a foreign one is a conflict that stops the run.
  const subdomain = await (
    deployedHash(scriptText ?? "") === null
      ? Promise.resolve(null)
      : call(token, `${SCRIPT}/subdomain`)
  ).catch((err) => {
    if (err.status !== 401 && err.status !== 403) throw err;
    fail(
      `${err.message}\n\n` +
        "  The down page's workers.dev switch needs Account · Workers Scripts · Edit on the token.\n" +
        "  Add that permission to the token and run again.",
    );
  });
  const workersDev = planWorkersDev(subdomain, WORKER_NAME);
  const routeList = await call(token, ROUTES).catch((err) => {
    if (err.status !== 401 && err.status !== 403) throw err;
    fail(
      `${err.message}\n\n` +
        "  The down page's routes need Zone · Workers Routes · Edit on the token.\n" +
        "  Add that permission to the token and run again.",
    );
  });
  const routes = planRoutes(routeList, want.routes);

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

  for (const c of worker.conflicts) out(`CONFLICT worker ${c.name}: exists as ${c.found}`);
  for (const c of routes.conflicts) {
    out(`CONFLICT route ${c.pattern}: routed to ${c.found}, wanted ${c.want}`);
  }

  const conflicts =
    ingress.conflicts.length +
    dns.conflicts.length +
    turnstile.conflicts.length +
    worker.conflicts.length +
    routes.conflicts.length;
  if (conflicts > 0) {
    out();
    fail(`${conflicts} conflict(s) — nothing was changed. Resolve them in the dashboard.`);
  }

  for (const k of ingress.kept) out(`ok       ingress ${k.hostname} -> ${k.service}`);
  for (const n of dns.ok) out(`ok       dns     ${n}`);
  for (const a of access.ok) out(`ok       access  ${a.domain} (${a.decision})`);
  for (const w of turnstile.ok) out(`ok       turnstile ${w.name} (${w.domains.join(", ")})`);
  for (const w of worker.ok) out(`ok       worker  ${w.name} (sha256 ${w.hash.slice(0, 12)})`);
  for (const n of workersDev.ok) out(`ok       worker  ${n} is off workers.dev`);
  for (const r of routes.ok) out(`ok       route   ${r.pattern} ${routeTarget(r)}`);
  for (const a of ingress.added) out(`ADD      ingress ${a.hostname} -> ${a.service}`);
  for (const d of dns.create) out(`ADD      dns     ${d.name} -> ${d.content} (proxied)`);
  for (const a of access.create) out(`ADD      access  ${a.domain} (${a.decision})`);
  for (const w of turnstile.create) {
    out(`ADD      turnstile ${w.name} (${w.mode}) for ${w.domains.join(", ")}`);
  }
  for (const w of worker.create) out(`ADD      worker  ${w.name} (sha256 ${w.hash.slice(0, 12)})`);
  for (const w of worker.update) {
    out(`UPDATE   worker  ${w.name} (content changed, sha256 ${w.hash.slice(0, 12)})`);
  }
  for (const n of workersDev.disable) out(`DISABLE  worker  ${n} on workers.dev`);
  for (const r of routes.create) out(`ADD      route   ${r.pattern} ${routeTarget(r)}`);
  for (const r of routes.repair) {
    out(`REPAIR   route   ${r.pattern} ${routeTarget(r)} is not fail open`);
  }
  for (const a of unadmitted)
    out(`MISSING  access  ${a.domain} admits a second person: ${a.missing}`);

  const changes =
    ingress.added.length +
    dns.create.length +
    access.create.length +
    turnstile.create.length +
    worker.create.length +
    worker.update.length +
    workersDev.disable.length +
    routes.create.length +
    routes.repair.length;
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

  for (const op of applyOrder({ access, ingress, dns, turnstile, worker, workersDev, routes })) {
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
    } else if (op.kind === "worker") {
      await call(token, SCRIPT, { method: "PUT", body: workerForm(op.item) });
      out(`applied  worker  ${op.item.name}`);
    } else if (op.kind === "workersdev") {
      await call(token, `${SCRIPT}/subdomain`, {
        method: "POST",
        body: JSON.stringify({ enabled: false }),
      });
      out(`applied  worker  ${op.item} off workers.dev`);
    } else if (op.kind === "route") {
      const r = op.item;
      // As documented: `pattern` and `script`, nothing else.
      const created = await call(token, ROUTES, {
        method: "POST",
        body: JSON.stringify(
          r.script ? { pattern: r.pattern, script: r.script } : { pattern: r.pattern },
        ),
      });
      out(`applied  route   ${r.pattern} ${routeTarget(r)}`);
      // Then the flag, as the second write. A failure between the two leaves a
      // fail-closed route, which the next run reports as REPAIR and finishes.
      if (r.script) {
        await call(token, `${ROUTES}/${created.id}`, { method: "PUT", body: failOpenBody(r) });
        out(`applied  route   ${r.pattern} fail open`);
      }
    } else if (op.kind === "route-repair") {
      await call(token, `${ROUTES}/${op.item.id}`, { method: "PUT", body: failOpenBody(op.item) });
      out(`applied  route   ${op.item.pattern} fail open`);
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

const routeTarget = (r) => (r.script ? `-> ${r.script}` : "(no Worker)");

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
