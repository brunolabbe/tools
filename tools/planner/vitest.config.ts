import { defineConfig } from "vitest/config";
import { splitProject } from "../../vitest.isolation.ts";

export default defineConfig(
  splitProject({
    name: "planner",
    parent: "tools/planner",
    test: {
      // No browser, no ffmpeg, and a suite that talks to a model provider
      // uses a fake rather than waiting on one. The timeout is not about
      // any of that: it is about SQLite (repo-93). `migrate` sets
      // `busy_timeout = 5000`, the same number as vitest's default, so a
      // test opening a fresh database *file* that something else on the
      // host briefly holds — two did, on windows-latest, each running
      // past 5 s where its whole file usually takes under one — is killed at the instant SQLite would have
      // answered, and the log says "timed out" instead of SQLITE_BUSY or
      // how long it really took. 20 s outlasts three 5 s busy waits back to
      // back — grounding-cache's "on boot" opens the same file twice — and
      // is still a third of the downloader's minute: a case that needs all
      // of it is hung, not slow.
      testTimeout: 20_000,
    },
  }),
);
