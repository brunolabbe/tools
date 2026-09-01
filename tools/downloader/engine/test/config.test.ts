/**
 * The engine's environment fallbacks, which only a caller that passes nothing
 * ever reaches.
 *
 * That caller is `scripts/download.ts`, the M1 CLI: it builds an engine with a
 * storage directory, a size cap and a logger, and nothing else. `api` is not one
 * — `server.ts` supplies `tlsCaFile` explicitly wherever it can differ — which
 * is why dl-31 first recorded this fallback as unreachable. It is reachable; it
 * is inert *for `api`*, which is a different sentence.
 */

import { describe, expect, test } from "vitest";
import { loadEngineConfig } from "../src/config.ts";

describe("the CA bundle ffmpeg is given", () => {
  test("an explicit value beats both variables", () => {
    const config = loadEngineConfig(
      { tlsCaFile: "/explicit.pem" },
      { EGRESS_CA_FILE: "/new.pem", FFMPEG_CA_FILE: "/old.pem" },
    );
    expect(config.tlsCaFile).toBe("/explicit.pem");
  });

  test("EGRESS_CA_FILE is read, which is the name dl-31 documents", () => {
    // Before dl-31 this fallback read `FFMPEG_CA_FILE` alone, so an operator
    // following `.env.example` got no operator root in the CLI at all, silently
    // — the one place the rename could have broken somebody.
    expect(loadEngineConfig({}, { EGRESS_CA_FILE: "/new.pem" }).tlsCaFile).toBe("/new.pem");
  });

  test("FFMPEG_CA_FILE still works, and the new name wins over it", () => {
    expect(loadEngineConfig({}, { FFMPEG_CA_FILE: "/old.pem" }).tlsCaFile).toBe("/old.pem");
    expect(
      loadEngineConfig({}, { EGRESS_CA_FILE: "/new.pem", FFMPEG_CA_FILE: "/old.pem" }).tlsCaFile,
    ).toBe("/new.pem");
  });

  test("neither set leaves the system store", () => {
    expect(loadEngineConfig({}, {}).tlsCaFile).toBeUndefined();
  });
});
