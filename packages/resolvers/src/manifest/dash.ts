import { AppError } from "@downloader/shared";
import type { ParsedManifest } from "./types.ts";

/**
 * Scaffold stub — WP-1 owns this file and replaces the body.
 * The signature is fixed (see `./types.ts`); consumers already code against it.
 */
export function parseDash(_xml: string, _baseUrl: string): ParsedManifest {
  throw new AppError("INTERNAL", "DASH parser not implemented yet");
}
