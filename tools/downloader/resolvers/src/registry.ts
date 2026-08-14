/**
 * The priority-ordered resolver chain.
 *
 * Layering, from `docs/00-STREAM-CAPTURE-ANALYSIS.md` §4: the browser sniffer is
 * the foundation and everything ahead of it is a latency optimisation. Deleting
 * every optional tier must leave a working system, which is why the registry
 * knows nothing about the individual resolvers beyond their priority.
 *
 * Fallthrough rule: `NO_MEDIA_FOUND` means "this technique did not work" and
 * moves to the next resolver. Every other `AppError` — `DRM_PROTECTED`,
 * `AUTH_REQUIRED`, `GEO_BLOCKED` — is a fact about the *source*, so retrying
 * with a different technique only burns the caller's time budget.
 */

import { AppError } from "@downloader/contract";
import type { ProbeResult, Resolver, ResolveOptions } from "@downloader/contract";

function byPriority(a: Resolver, b: Resolver): number {
  return a.priority - b.priority;
}

export class ResolverRegistry {
  #resolvers: readonly Resolver[];

  constructor(resolvers: readonly Resolver[] = []) {
    this.#resolvers = resolvers.toSorted(byPriority);
  }

  /** Ascending priority — the order `resolve()` will try them in. */
  get resolvers(): readonly Resolver[] {
    return this.#resolvers;
  }

  register(resolver: Resolver): void {
    this.#resolvers = [...this.#resolvers, resolver].toSorted(byPriority);
  }

  /**
   * Runs the chain and returns the first usable answer.
   *
   * `options.timeoutMs` is a budget for the *whole chain*, not per resolver: a
   * caller that waited 45 s does not care that three resolvers each stayed
   * under their own limit.
   */
  async resolve(url: URL, options: ResolveOptions): Promise<ProbeResult> {
    const candidates = this.#resolvers.filter((resolver) => resolver.canHandle(url));
    if (candidates.length === 0) {
      throw new AppError("NO_MEDIA_FOUND", "No resolver can handle that address.", {
        details: { url: url.href },
      });
    }

    const deadline = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, deadline]);
    const chainOptions: ResolveOptions = { ...options, signal };
    const attempts: Array<{ resolver: string; code: string }> = [];

    for (const resolver of candidates) {
      abortIfNeeded(options.signal, deadline);
      try {
        // Sequential on purpose: the point of the chain is that the cheap tiers
        // spare us the expensive ones. Running them in parallel would pay for
        // a browser probe on every request.
        // oxlint-disable-next-line no-await-in-loop
        return await resolver.resolve(url, chainOptions);
      } catch (cause) {
        // An abort surfaces from inside a resolver in whatever shape its
        // transport chose, so the signals are authoritative, not the error.
        abortIfNeeded(options.signal, deadline);
        const error = AppError.from(cause);
        if (error.code !== "NO_MEDIA_FOUND") throw error;
        attempts.push({ resolver: resolver.name, code: error.code });
      }
    }

    abortIfNeeded(options.signal, deadline);
    throw new AppError("NO_MEDIA_FOUND", undefined, {
      details: { url: url.href, attempts },
    });
  }

  /**
   * Releases every registered resolver's browsers, temp dirs and sockets.
   * All resolvers are disposed even when one throws; failures are reported
   * afterwards so a leaky resolver cannot strand the rest.
   */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled(
      this.#resolvers.map(async (resolver) => {
        await resolver.dispose?.();
      }),
    );
    const failed = results
      .map((result, index) => ({ result, name: this.#resolvers[index]?.name ?? "unknown" }))
      .filter((entry) => entry.result.status === "rejected");
    if (failed.length > 0) {
      throw new AppError("INTERNAL", "Some resolvers failed to shut down cleanly.", {
        details: { resolvers: failed.map((entry) => entry.name) },
      });
    }
  }
}

function abortIfNeeded(caller: AbortSignal, deadline: AbortSignal): void {
  if (deadline.aborted) {
    throw new AppError("TIMEOUT", "Analysing that page took too long.");
  }
  if (caller.aborted) {
    if (caller.reason instanceof AppError) throw caller.reason;
    // `CANCELED`, not `JOB_CANCELED`: resolvers know nothing about jobs, and a
    // registry embedded in a CLI or a test has no job to have canceled. The
    // orchestrator translates this into job vocabulary at its own layer.
    throw new AppError("CANCELED");
  }
}
