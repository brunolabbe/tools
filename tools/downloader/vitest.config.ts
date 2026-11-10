import { defineConfig } from "vitest/config";
import { splitProject } from "../../vitest.isolation.ts";

export default defineConfig(
  splitProject({
    name: "downloader",
    parent: "tools/downloader",
    // Not a pattern the scan can see (repo-129 Build 3): these files launch
    // Chromium through `BrowserPool`, and some patch prototypes
    // (`provoke.test.ts` patches `Frame.click`), which a worker would carry
    // into the next file it ran.
    stayIsolated: {
      "tools/downloader/resolvers/test/browser/":
        "launches Chromium through BrowserPool; patches prototypes",
    },
    test: {
      // Browser-sniffer probes launch Chromium and wait for network quiet,
      // which legitimately takes tens of seconds. A short default would
      // fail honest tests.
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  }),
);
