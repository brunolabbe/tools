/**
 * Composes the resolver registry from configuration.
 *
 * `@downloader/resolvers` ships no default set on purpose — which tiers exist
 * is a deployment choice, not a library one — so this is the file that decides,
 * and it is the first code in the repo that assembles the whole chain. That
 * makes it where **M2** is finally demonstrable.
 *
 * The ordering rule from `docs/02-ROADMAP.md`, restated because it is the one
 * thing here that is easy to get subtly wrong:
 *
 *   The browser sniffer is the *foundation*. yt-dlp is a latency optimisation
 *   layered on top of it. Removing yt-dlp must not remove coverage — with
 *   `ENABLE_YTDLP_RESOLVER=false`, or with the binary simply absent, every
 *   request falls through to the sniffer and still works. Any code path that
 *   turns a missing yt-dlp into an *error* rather than a fallthrough is a bug.
 *
 * Priorities come from the resolvers themselves (yt-dlp 20, browser 50, direct
 * 90) and the registry sorts by them, so this function only decides membership.
 */

import {
  BrowserResolver,
  DirectUrlResolver,
  ResolverRegistry,
  YtDlpResolver,
} from "@downloader/resolvers";
import type { Resolver } from "@downloader/contract";
import type { ApiConfig } from "./config.ts";
import type { GuardedFetch } from "./guarded-fetch.ts";
import type { AppLogger } from "./logger.ts";

export interface BuildRegistryOptions {
  config: ApiConfig;
  logger: AppLogger;
  /**
   * Redirect-checking fetch. Handed to the direct resolver, which follows
   * redirects to manifests and would otherwise be an SSRF hole.
   */
  fetchImpl: GuardedFetch;
}

export interface RegistryBuild {
  registry: ResolverRegistry;
  /** What actually got registered, for `/api/health` and for the boot log. */
  resolverNames: string[];
  /**
   * The two tiers with runtime state worth reporting, kept as their concrete
   * types rather than as `Resolver`. `/api/health` needs the browser pool's
   * occupancy and whether yt-dlp's binary was actually found, and neither is on
   * the `Resolver` interface — nor should be, since it is the *registry* that
   * is general and these two that happen to own a process pool and a binary.
   * Null means the tier is not registered at all.
   */
  ytdlp: YtDlpResolver | null;
  browser: BrowserResolver | null;
}

export function buildRegistry(options: BuildRegistryOptions): RegistryBuild {
  const { config, logger } = options;
  const resolvers: Resolver[] = [];
  let ytdlp: YtDlpResolver | null = null;
  let browser: BrowserResolver | null = null;

  if (config.enableYtdlpResolver) {
    // No `binaryPath` key at all when unset: the resolver falls back to
    // `YTDLP_PATH` and then to `yt-dlp` on `PATH`, and passing an explicit
    // undefined would defeat that.
    ytdlp =
      config.ytdlpPath === undefined
        ? new YtDlpResolver()
        : new YtDlpResolver({ binaryPath: config.ytdlpPath });
    resolvers.push(ytdlp);
  }

  if (config.enableBrowserResolver) {
    // No proxy here: `ResolveOptions.proxyUrl` carries it per call, because the
    // resolver contract makes the proxy a property of the request rather than
    // of the resolver.
    browser = new BrowserResolver({ maxConcurrentBrowsers: config.maxConcurrentBrowsers });
    resolvers.push(browser);
  }

  if (config.enableDirectResolver) {
    resolvers.push(new DirectUrlResolver({ fetch: options.fetchImpl }));
  }

  const registry = new ResolverRegistry(resolvers);
  const resolverNames = registry.resolvers.map((resolver) => resolver.name);

  logger.info("resolver chain composed", {
    resolvers: resolverNames,
    // Logged explicitly because "why did this site stop working" is almost
    // always answered by which tiers were enabled at the time.
    ytdlpEnabled: config.enableYtdlpResolver,
    browserEnabled: config.enableBrowserResolver,
    // Enabled and *present* are different things, and only the second one
    // affects behaviour.
    ytdlpAvailable: ytdlp?.available ?? false,
  });

  if (!config.enableBrowserResolver) {
    logger.warn(
      "the browser sniffer is disabled; coverage is limited to sites with an extractor or a direct media URL",
    );
  }

  return { registry, resolverNames, ytdlp, browser };
}
