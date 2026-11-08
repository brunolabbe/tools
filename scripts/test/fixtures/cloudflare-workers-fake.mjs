/**
 * The Workers half of a fake Cloudflare account (repo-143): one script slot and
 * the zone's route list, behind the two endpoints `scripts/cloudflare-setup.mjs`
 * calls for the down page. Shared by the in-process fake in
 * `cloudflare-turnstile.test.ts`, the process-level one in
 * `cloudflare-fake-fetch.mjs` and `cloudflare-down-page.test.ts`, so the three
 * agree on what an account answers.
 *
 * The shapes are the ticket's reading of the API (script download answers the
 * module as text, 404 when absent; routes list `{ id, pattern, script }` with no
 * `script` on an exclusion), not a recorded payload: repo-143's builder could not
 * reach Cloudflare to record one.
 */

const answer = (result, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, errors: [], result }), { status });

/**
 * @typedef {{ pattern: string, script?: string | null, id?: string }} FakeRoute
 * @typedef {{
 *   scripts?: Record<string, string>,
 *   routes?: FakeRoute[],
 *   scriptReadStatus?: number,
 *   routeReadStatus?: number,
 * }} WorkersInit
 */

/** @param {WorkersInit} [init] */
export function createWorkersFake(init = {}) {
  /** @type {Record<string, string>} */
  const scripts = { ...init.scripts };
  /** @type {FakeRoute[]} */
  const routes = [...(init.routes ?? [])];

  /**
   * @param {string} url
   * @param {string} method
   * @param {RequestInit} [req]
   * @returns {Promise<Response> | undefined} undefined when the URL is not a Workers one
   */
  const handle = (url, method, req = {}) => {
    const script = /\/accounts\/[^/]+\/workers\/scripts\/([^/?]+)$/.exec(url);
    if (script) return scriptCall(script[1] ?? "", method, req);
    if (/\/zones\/[^/]+\/workers\/routes$/.test(url)) return routeCall(method, req);
    return undefined;
  };

  /** @param {string} name @param {string} method @param {RequestInit} req */
  const scriptCall = async (name, method, req) => {
    if (method === "PUT") {
      const part = /** @type {FormData} */ (req.body).get("worker.mjs");
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

  /** @param {string} method @param {RequestInit} req */
  const routeCall = async (method, req) => {
    if (method === "POST") {
      const body = JSON.parse(String(req.body));
      routes.push({ id: String(routes.length), ...body });
      return answer({ id: String(routes.length - 1) });
    }
    if (init.routeReadStatus) return answer(null, init.routeReadStatus);
    return answer(routes);
  };

  return { handle, scripts, routes };
}
