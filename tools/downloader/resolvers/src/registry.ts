/**
 * The priority-ordered resolver chain.
 *
 * Layering, from `tools/downloader/docs/00-ANALYSIS.md` §4: the browser sniffer is
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
import type {
  ProbeResult,
  ProbeStageListener,
  Resolver,
  ResolveOptions,
} from "@downloader/contract";

function byPriority(a: Resolver, b: Resolver): number {
  return a.priority - b.priority;
}

/**
 * One resolver's turn in the chain, win or lose (dl-57).
 *
 * `code` is `null` for the attempt that returned a result — the only way to
 * tell it apart from a `NO_MEDIA_FOUND` fall-through without a separate flag.
 */
export interface ResolverAttempt {
  resolver: string;
  code: string | null;
  durationMs: number;
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
   *
   * `attempts`, when passed, is appended to in place with every resolver this
   * call tries — losers and the eventual winner alike — so a caller building an
   * outcome record has the full timeline whether `resolve()` returns or throws
   * (dl-57). Optional and unused by every caller that predates it.
   */
  async resolve(
    url: URL,
    options: ResolveOptions,
    attempts: ResolverAttempt[] = [],
  ): Promise<ProbeResult> {
    const candidates = this.#resolvers.filter((resolver) => resolver.canHandle(url));
    if (candidates.length === 0) {
      throw new AppError("NO_MEDIA_FOUND", "No resolver can handle that address.", {
        details: { url: url.href },
      });
    }

    const deadline = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, deadline]);
    // dl-43: a listener that throws must not fail the probe it is only
    // narrating. `ResolveOptions.onStage` documents that rule; wrapping here
    // makes it true for every resolver reached through the chain rather than
    // relying on each caller to have read it.
    const listener = options.onStage;
    const onStage: ProbeStageListener | undefined =
      listener === undefined
        ? undefined
        : (event) => {
            try {
              listener(event);
            } catch {
              // Best effort, exactly like the SSE hub's fan-out.
            }
          };
    const chainOptions: ResolveOptions = {
      ...options,
      signal,
      ...(onStage === undefined ? {} : { onStage }),
    };
    for (const resolver of candidates) {
      abortIfNeeded(options.signal, deadline);
      // Before `resolve`, not after: firing on the way out would never announce
      // the tier that succeeds, which is the only one the user waits on.
      onStage?.({ stage: "resolver-start", resolver: resolver.name });
      const startedAt = Date.now();
      try {
        // Sequential on purpose: the point of the chain is that the cheap tiers
        // spare us the expensive ones. Running them in parallel would pay for
        // a browser probe on every request.
        // oxlint-disable-next-line no-await-in-loop
        const result = await resolver.resolve(url, chainOptions);
        attempts.push({ resolver: resolver.name, code: null, durationMs: Date.now() - startedAt });
        return result;
      } catch (cause) {
        // An abort surfaces from inside a resolver in whatever shape its
        // transport chose, so the signals are authoritative, not the error.
        abortIfNeeded(options.signal, deadline);
        const error = AppError.from(cause);
        attempts.push({
          resolver: resolver.name,
          code: error.code,
          durationMs: Date.now() - startedAt,
        });
        if (error.code !== "NO_MEDIA_FOUND") throw error;
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
