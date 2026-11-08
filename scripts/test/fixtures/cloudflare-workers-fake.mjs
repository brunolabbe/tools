/**
 * The Workers half of a fake Cloudflare account (repo-143): one script slot, its
 * workers.dev switch and the zone's route list, behind the endpoints
 * `scripts/cloudflare-setup.mjs` calls for the down page. Shared by the
 * in-process fake in `cloudflare-turnstile.test.ts`, the process-level one in
 * `cloudflare-fake-fetch.mjs` and `cloudflare-down-page.test.ts`, so the three
 * agree on what an account answers.
 *
 * The shapes follow Cloudflare's published API reference (read 2026-11-08, see
 * the ticket's Log), not a recorded payload: script download answers the module
 * as text and 404 when absent; routes list `{ id, pattern, script,
 * request_limit_fail_open }`; **the create call takes `pattern` and `script`
 * only, so this fake drops anything else on POST** and only a PUT sets the
 * fail-open flag; a script uploaded for the first time is enabled on workers.dev.
 */

const answer = (result, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, errors: [], result }), { status });

/**
 * @typedef {{ pattern: string, script?: string | null, id?: string, request_limit_fail_open?: boolean }} FakeRoute
 * @typedef {{
 *   scripts?: Record<string, string>,
 *   workersDev?: Record<string, boolean>,
 *   routes?: FakeRoute[],
 *   scriptReadStatus?: number,
 *   routeReadStatus?: number,
 *   subdomainReadStatus?: number,
 * }} WorkersInit
 */

/** @param {WorkersInit} [init] */
export function createWorkersFake(init = {}) {
  /** @type {Record<string, string>} */
  const scripts = { ...init.scripts };
  /** @type {Record<string, boolean>} */
  const workersDev = { ...init.workersDev };
  /** @type {FakeRoute[]} */
  const routes = [...(init.routes ?? [])];

  /**
   * @param {string} url
   * @param {string} method
   * @param {RequestInit} [req]
   * @returns {Promise<Response> | undefined} undefined when the URL is not a Workers one
   */
  const handle = (url, method, req = {}) => {
    const sub = /\/accounts\/[^/]+\/workers\/scripts\/([^/?]+)\/subdomain$/.exec(url);
    if (sub) return subdomainCall(sub[1] ?? "", method, req);
    const script = /\/accounts\/[^/]+\/workers\/scripts\/([^/?]+)$/.exec(url);
    if (script) return scriptCall(script[1] ?? "", method, req);
    const route = /\/zones\/[^/]+\/workers\/routes(?:\/([^/?]+))?$/.exec(url);
    if (route) return routeCall(route[1], method, req);
    return undefined;
  };

  /** @param {string} name @param {string} method @param {RequestInit} req */
  const scriptCall = async (name, method, req) => {
    if (method === "PUT") {
      const part = /** @type {FormData} */ (req.body).get("worker.mjs");
      // A new script is public on workers.dev; an upload over an existing one
      // leaves the switch where it was.
      if (scripts[name] === undefined) workersDev[name] = true;
      scripts[name] = typeof part === "string" ? part : await /** @type {File} */ (part).text();
      return answer({ id: name });
    }
    if (init.scriptReadStatus) return answer(null, init.scriptReadStatus);
    const text = scripts[name];
    if (text === undefined) return new Response("not found", { status: 404 });
    // What a module download looks like is unmeasured; the marker is found by
    // searching the raw text, so a multipart wrapper would read the same.
    return new Response(text, { status: 200 });
  };

  /** @param {string} name @param {string} method @param {RequestInit} req */
  const subdomainCall = async (name, method, req) => {
    if (scripts[name] === undefined) return answer(null, 404);
    if (method === "POST") {
      workersDev[name] = JSON.parse(String(req.body)).enabled === true;
      return answer({ enabled: workersDev[name], previews_enabled: false });
    }
    if (init.subdomainReadStatus) return answer(null, init.subdomainReadStatus);
    return answer({ enabled: workersDev[name] ?? false, previews_enabled: false });
  };

  /** @param {string | undefined} id @param {string} method @param {RequestInit} req */
  const routeCall = async (id, method, req) => {
    if (method === "POST") {
      const body = JSON.parse(String(req.body));
      // Documented: `pattern` and `script`. Anything else is not read.
      const route = {
        id: String(routes.length),
        pattern: body.pattern,
        ...(body.script ? { script: body.script } : {}),
        request_limit_fail_open: false,
      };
      routes.push(route);
      return answer({ id: route.id, pattern: route.pattern, script: route.script });
    }
    if (method === "PUT") {
      const at = routes.findIndex((r) => r.id === id);
      if (at === -1) return answer(null, 404);
      const body = JSON.parse(String(req.body));
      routes[at] = {
        id,
        pattern: body.pattern,
        ...(body.script ? { script: body.script } : {}),
        request_limit_fail_open: body.request_limit_fail_open === true,
      };
      return answer(routes[at]);
    }
    if (init.routeReadStatus) return answer(null, init.routeReadStatus);
    return answer(routes);
  };

  return { handle, scripts, workersDev, routes };
}
