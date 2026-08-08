/**
 * Which variant a job downloads.
 *
 * Split out from the orchestrator because it is pure, and because the
 * re-probe makes it subtle: the variant a client picked was chosen from a
 * *previous* probe, and the fresh probe may not contain that id at all.
 * Resolvers do not promise stable ids across probes — the browser sniffer's ids
 * come from what the page happened to request this time.
 */

import { AppError } from "@downloader/shared";
import type { JobOptions, MediaVariant, ProbeResult } from "@downloader/shared";

/**
 * Ranks by what a user means by "best": pixels first, then bitrate, then
 * whether the rendition carries its own audio.
 *
 * Resolvers already return variants best-first, so this only has to break ties
 * the resolver left and provide an order when a resolver did not sort.
 */
function pixels(variant: MediaVariant): number {
  return (variant.width ?? 0) * (variant.height ?? 0);
}

function bitrate(variant: MediaVariant): number {
  return variant.bitrateBps ?? 0;
}

function audioScore(variant: MediaVariant): number {
  return variant.hasAudio ? 1 : 0;
}

export function compareQuality(a: MediaVariant, b: MediaVariant): number {
  if (pixels(a) !== pixels(b)) return pixels(b) - pixels(a);
  if (bitrate(a) !== bitrate(b)) return bitrate(b) - bitrate(a);
  // A rendition with sound beats a silent one of identical size.
  return audioScore(b) - audioScore(a);
}

export interface VariantChoice {
  variant: MediaVariant;
  /** True when the requested id was absent and something else was substituted. */
  substituted: boolean;
}

/**
 * Picks the variant to download from a *fresh* probe.
 *
 * When the client asked for an id that the fresh probe no longer offers, the
 * choice is between failing and substituting. Substituting wins: the id was
 * always an implementation detail of a probe the client cannot see, and failing
 * a download because a CDN renumbered its renditions would be inexplicable from
 * the outside. The substitution is reported so the caller can log and surface
 * it rather than pretending nothing happened.
 */
export function chooseVariant(probe: ProbeResult, options: JobOptions): VariantChoice {
  const candidates = filterByIntent(probe.variants, options);
  if (candidates.length === 0) {
    throw new AppError(
      "NO_MEDIA_FOUND",
      "That page has no downloadable stream matching the request.",
      {
        details: { resolver: probe.resolver },
      },
    );
  }

  const requestedId = options.variantId;
  if (requestedId !== undefined) {
    const exact = candidates.find((variant) => variant.id === requestedId);
    if (exact !== undefined) return { variant: exact, substituted: false };
    // Fall through to the best available, flagged.
    const best = candidates.toSorted(compareQuality)[0];
    if (best === undefined) {
      throw new AppError("NO_MEDIA_FOUND", undefined, { details: { variantId: requestedId } });
    }
    return { variant: best, substituted: true };
  }

  const best = candidates.toSorted(compareQuality)[0];
  if (best === undefined) throw new AppError("NO_MEDIA_FOUND");
  return { variant: best, substituted: false };
}

/**
 * Narrows to variants that can satisfy the request at all.
 *
 * `audioOnly` is the only intent that can make an otherwise-fine variant
 * useless: a video-only rendition has nothing to extract.
 */
function filterByIntent(
  variants: readonly MediaVariant[],
  options: JobOptions,
): readonly MediaVariant[] {
  if (options.audioOnly !== true) return variants;
  const withAudio = variants.filter((variant) => variant.hasAudio);
  // If nothing declares audio, hand back everything rather than refusing:
  // `hasAudio` is a resolver's best guess, and ffmpeg will find the track or
  // fail with a message that says so.
  return withAudio.length > 0 ? withAudio : variants;
}
