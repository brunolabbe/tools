/**
 * The page a visitor sees when the home host is down (repo-143).
 *
 * A Cloudflare Worker, deployed by `scripts/cloudflare-setup.mjs`, in front of
 * each tool's hostname. The zone is on the Free plan, which has no Custom Errors
 * (paid plans only) and no way to restyle Cloudflare's own 1033 / 502 page; a
 * Worker is the free thing that sees the failed subrequest and can answer in its
 * place, and it keeps working when the host is unreachable because it does not
 * run there.
 *
 * It is a plain ES module with no build step and no import, because the setup
 * script uploads this file's text as it stands. Everything the page needs is
 * inline: the origin is down, so there is nothing to fetch it from.
 *
 * **Only a page load is replaced.** `/api/*` and the built assets never reach
 * this Worker at all (the setup script routes them to no Worker), and a request
 * that does reach it without `Accept: text/html` passes through untouched, so a
 * `fetch()` from the web app keeps Cloudflare's own response and the app's own
 * handling of a failed request (owner, 2026-11-03: a JSON body would have to
 * match three tools' `AppError` shapes).
 */

/**
 * Statuses that mean "the host is not answering", and nothing wider.
 *
 * 530 is what Cloudflare itself returns (error 1033) when the tunnel has no
 * connector; 502 and 504 are what it returns when the tunnel is up and the
 * service behind it is not answering. They are safe to replace because no tool
 * returns one for an HTML route: the only 502s and 504s the apps produce are
 * `AppError`s on `/api/*` (`tools/downloader/api/src/http-errors.ts`), which
 * this Worker never sees (routed to no Worker) and which a page load would not
 * be asking for. **Do not widen this to every 5xx**: a 500 or a 503 from the app
 * is the app saying something, and a 503 from here must not be mistaken for it.
 */
export const DOWN_STATUSES = new Set([502, 504, 530]);

/**
 * Each tool's palette, light then dark: the values of `--bg`, `--surface`,
 * `--border`, `--text`, `--text-muted` and `--accent` in the tool's own
 * `web/src/styles.css` (`:root`, then the `prefers-color-scheme: dark` block).
 *
 * Copied, not read at deploy time: `packages/ui/src/tokens.css` names the roles
 * but holds no colour value on purpose (palettes are per tool, owner 2026-10-18),
 * so there is nothing there to inline, and a build step would be a second
 * thing to keep working for a page that has to work when everything else is
 * down. `scripts/test/cloudflare-down-page.test.ts` reads the three stylesheets
 * and fails when one of these drifts from its source.
 */
export const PALETTES = {
  downloader: {
    label: "Downloader",
    light: {
      bg: "#f6f7f9",
      surface: "#ffffff",
      border: "#d8dce3",
      text: "#16191f",
      muted: "#5c6472",
      accent: "#2f5fe0",
    },
    dark: {
      bg: "#101317",
      surface: "#181c22",
      border: "#2c333c",
      text: "#e8ebf0",
      muted: "#98a2b3",
      accent: "#7aa2ff",
    },
  },
  planner: {
    label: "Planner",
    light: {
      bg: "#fbfaf8",
      surface: "#ffffff",
      border: "#e3ddd4",
      text: "#201d19",
      muted: "#6b6459",
      accent: "#2f5d50",
    },
    dark: {
      bg: "#17150f",
      surface: "#201d16",
      border: "#35301f",
      text: "#f0ece4",
      muted: "#a49b8a",
      accent: "#7fbfa8",
    },
  },
  ledger: {
    label: "Ledger",
    light: {
      bg: "#f8f9fa",
      surface: "#ffffff",
      border: "#dde1e6",
      text: "#1b1f24",
      muted: "#5d6670",
      accent: "#1f5f8b",
    },
    dark: {
      bg: "#111418",
      surface: "#1a1e23",
      border: "#2c323a",
      text: "#eceff2",
      muted: "#9aa4ae",
      accent: "#7db4dc",
    },
  },
};

/** The tool a hostname belongs to: its first label (`planner.example.com`). */
export function toolFromHostname(hostname) {
  const first = String(hostname).split(".")[0]?.toLowerCase() ?? "";
  return Object.hasOwn(PALETTES, first) ? first : null;
}

/** A page load: a GET or HEAD whose `Accept` asks for HTML. */
export function isPageLoad(method, accept) {
  return (method === "GET" || method === "HEAD") && /text\/html/i.test(accept ?? "");
}

/**
 * Whether to answer with the down page.
 *
 * `outcome` is `{ threw: true }` for a subrequest that rejected, or
 * `{ status }` for one that answered. Both conditions must hold.
 */
export function shouldShowDownPage({ method, accept, outcome }) {
  if (!isPageLoad(method, accept)) return false;
  return outcome.threw === true || DOWN_STATUSES.has(outcome.status);
}

const vars = (p) =>
  `--bg:${p.bg};--surface:${p.surface};--border:${p.border};` +
  `--text:${p.text};--muted:${p.muted};--accent:${p.accent}`;

/**
 * The document. One file of inline CSS and no external request; fits a 360 px
 * phone with no horizontal scroll (`overflow-wrap: anywhere` on the one line
 * that could be long, the hostname). The tool's name is the only varying text,
 * and it comes from a closed table, never from the request, so nothing the
 * visitor sent is written into the page.
 */
export function renderDownPage(hostname) {
  const tool = toolFromHostname(hostname);
  const palette = PALETTES[tool ?? "downloader"];
  const name = tool ? palette.label : "This site";
  const title = `${name} is unavailable`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>
:root{color-scheme:light dark;${vars(palette.light)}}
@media (prefers-color-scheme:dark){:root{${vars(palette.dark)}}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:30rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.5rem}
h1{margin:0 0 .5rem;font-size:1.4rem;line-height:1.25;overflow-wrap:anywhere}
p{margin:0 0 .75rem}
p:last-child{margin:0}
.muted{color:var(--muted);font-size:.9rem}
a{color:var(--accent)}
.bar{height:4px;border-radius:2px;background:var(--accent);margin:0 0 1rem;width:3rem}
</style>
</head>
<body>
<main>
<div class="bar" aria-hidden="true"></div>
<h1>${title}</h1>
<p>The home server this runs on is not answering right now. That is usually short: a restart, or the machine being switched off for a while.</p>
<p>Try again in a few minutes.</p>
<p class="muted">Status 503. <a href="">Reload this page</a></p>
</main>
</body>
</html>
`;
}

/** 503 so a crawler or a cache does not keep the outage, `no-store` for the same reason. */
export function downPageResponse(hostname, method = "GET") {
  return new Response(method === "HEAD" ? null : renderDownPage(hostname), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "60",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const accept = request.headers.get("Accept");
    // Not a page load: do not even look at the outcome. The response is
    // returned as it came, body unread, so a stream stays a stream.
    if (!isPageLoad(request.method, accept)) return fetch(request);

    const { hostname } = new URL(request.url);
    let response;
    try {
      response = await fetch(request);
    } catch {
      return downPageResponse(hostname, request.method);
    }

    if (
      !shouldShowDownPage({ method: request.method, accept, outcome: { status: response.status } })
    ) {
      return response;
    }
    // The error body is Cloudflare's own page; release the connection.
    await response.body?.cancel().catch(() => {});
    return downPageResponse(hostname, request.method);
  },
};
