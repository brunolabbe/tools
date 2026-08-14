/**
 * Public surface of `@downloader/resolvers`.
 *
 * Consumers get the registry and the resolver implementations, and compose them
 * themselves — the registry deliberately has no built-in default set, because
 * which tiers exist is a deployment choice (`ENABLE_BROWSER_RESOLVER`,
 * `ENABLE_YTDLP_RESOLVER`) rather than a library one.
 */

export { ResolverRegistry } from "./registry.ts";

export { parseHls } from "./manifest/hls.ts";
export { parseDash } from "./manifest/dash.ts";
export type { DashParser, HlsParser, ParsedManifest } from "./manifest/types.ts";

export {
  BROWSER_RESOLVER_NAME,
  BROWSER_RESOLVER_PRIORITY,
  BrowserResolver,
  createBrowserResolver,
} from "./resolvers/browser.ts";
export type { BrowserResolverOptions } from "./resolvers/browser.ts";
export type { BrowserPoolStats } from "./browser/pool.ts";

export { DirectUrlResolver } from "./resolvers/direct.ts";
export type { DirectResolverOptions } from "./resolvers/direct.ts";

export { mapYtDlpInfo, YtDlpResolver } from "./resolvers/ytdlp.ts";
export type {
  YtDlpFormat,
  YtDlpInfo,
  YtDlpResolverOptions,
  YtDlpSubtitle,
} from "./resolvers/ytdlp.ts";
