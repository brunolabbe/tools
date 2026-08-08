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
import type { Resolver } from "@downloader/shared";
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
}

export function buildRegistry(options: BuildRegistryOptions): RegistryBuild {
  const { config, logger } = options;
  const resolvers: Resolver[] = [];

  if (config.enableYtdlpResolver) {
    // No `binaryPath` key at all when unset: the resolver falls back to
    // `YTDLP_PATH` and then to `yt-dlp` on `PATH`, and passing an explicit
    // undefined would defeat that.
    resolvers.push(
      config.ytdlpPath === undefined
        ? new YtDlpResolver()
        : new YtDlpResolver({ binaryPath: config.ytdlpPath }),
    );
  }

  if (config.enableBrowserResolver) {
    // No proxy here: `ResolveOptions.proxyUrl` carries it per call, because the
    // resolver contract makes the proxy a property of the request rather than
    // of the resolver.
    resolvers.push(new BrowserResolver({ maxConcurrentBrowsers: config.maxConcurrentBrowsers }));
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
  });

  if (!config.enableBrowserResolver) {
    logger.warn(
      "the browser sniffer is disabled; coverage is limited to sites with an extractor or a direct media URL",
    );
  }

  return { registry, resolverNames };
}
