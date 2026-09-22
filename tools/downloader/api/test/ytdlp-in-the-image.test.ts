/**
 * The image ships yt-dlp, at one version, and the bot that moves that version
 * opens a pull request release-please will actually ship (dl-72).
 *
 * Why this is a scan and not trust. The released image went out without yt-dlp
 * because `INSTALL_YTDLP` defaulted to `false` and no build passed it, and the
 * pull-request container gate set it to `false` on purpose — so nothing that
 * ran ever built what shipped, and YouTube found no video in production. The
 * pin it would have used was stale as well: `2025.09.26` fails on YouTube with
 * "The page needs to be reloaded", while `2026.08.19` resolves the same video.
 * Neither fact is visible to `npm run check`, and the first is visible to the
 * container gate only if the gate builds the same image the release does.
 *
 * It reads files as text and names the file it disagrees with, in the shape of
 * `packages/core/test/image-closure.test.ts`. It never runs yt-dlp and never
 * reaches the network: whether the binary works is the container gate's
 * question (`.github/workflows/downloader.yml` asks it), and whether a release
 * exists upstream is the bump workflow's.
 */

import { execFileSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * A pin is `YTDLP_VERSION` followed by an assignment and a dated release, in
 * each spelling the repo uses: a Dockerfile `ARG NAME=value`, a JSON
 * `"NAME": "value"`, a compose `NAME: "value"` and a shell or build-arg
 * `NAME=value`. yt-dlp tags are `YYYY.MM.DD`, with a fourth part on the rare
 * same-day re-release.
 */
const PIN = /YTDLP_VERSION["']?\s*[=:]\s*["']?(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/g;

/**
 * Where a pin can live. Markdown is excluded because the ticket Logs quote
 * historical versions on purpose — dl-39 records a `--build-arg` for the old
 * pin as the command it measured — and a record of what was run is not a pin.
 * Fixtures are excluded for the same reason: they are captured output.
 */
const SKIPPED_DIRS = new Set([".git", ".claude", "node_modules", "dist", "fixtures", "coverage"]);
const SCANNED = /(^Dockerfile|\.json|\.jsonc|\.ya?ml|\.sh|\.mjs|\.ts|\.toml|^\.env.*)$/;

function scannedFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relative = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) scannedFiles(relative, out);
    } else if (entry.isFile() && SCANNED.test(entry.name)) {
      out.push(relative);
    }
  }
  return out;
}

function pins(): { file: string; version: string }[] {
  const found: { file: string; version: string }[] = [];
  for (const file of scannedFiles("")) {
    for (const match of read(file).matchAll(PIN)) {
      found.push({ file, version: match[1] ?? "" });
    }
  }
  return found;
}

/** The build configurations that decide what image is built. */
function buildConfigurations(): string[] {
  const workflows = readdirSync(path.join(REPO_ROOT, ".github", "workflows"))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `.github/workflows/${name}`);
  const compose = readdirSync(REPO_ROOT).filter((name) => /^compose.*\.ya?ml$/.test(name));
  return [...workflows, ...compose];
}

describe("the downloader image installs yt-dlp", () => {
  test("the Dockerfile's default installs it, so a build that passes nothing ships it", () => {
    // The release workflow passes no build-args, and neither does its rebuild
    // escape hatch — the default is what ships, so the default is what is
    // asserted.
    expect(read("tools/downloader/Dockerfile")).toMatch(/^ARG INSTALL_YTDLP=true$/m);
  });

  test("no workflow or compose file builds it with INSTALL_YTDLP turned off", () => {
    const offenders: string[] = [];
    for (const file of buildConfigurations()) {
      for (const match of read(file).matchAll(/INSTALL_YTDLP["']?\s*[=:]\s*["']?([\w-]+)/g)) {
        if (match[1] !== "true") offenders.push(`${file}: INSTALL_YTDLP=${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every yt-dlp pin agrees", () => {
  test("the pins the image and the devcontainer are built from are all found", () => {
    // A scan that finds nothing agrees with itself. These three are the pins
    // dl-72 found; a new one is welcome, a missing one means the scan broke.
    const files = new Set(pins().map((pin) => pin.file));
    expect([...files]).toEqual(
      expect.arrayContaining([
        "tools/downloader/Dockerfile",
        ".devcontainer/Dockerfile",
        ".devcontainer/devcontainer.json",
      ]),
    );
  });

  test("every pin names the same release", () => {
    const found = pins();
    const versions = new Set(found.map((pin) => pin.version));
    expect(
      versions.size,
      `yt-dlp pins disagree: ${found.map((pin) => `${pin.file} ${pin.version}`).join(", ")}`,
    ).toBe(1);
  });

  test("the pin is at least 2026.08.19, the first release measured to resolve YouTube again", () => {
    // `2025.09.26` fails on the video in dl-72's reproduction. A string
    // comparison is an order comparison for zero-padded dates.
    const [pin] = pins();
    expect(pin?.version.localeCompare("2026.08.19")).toBeGreaterThanOrEqual(0);
  });
});

describe("the bump workflow opens a pull request that releases", () => {
  // Read inside each test, never at collection: a missing workflow is a
  // finding, and a throw here would take every test in the file down with it.
  function workflow(): string {
    try {
      return read(".github/workflows/ytdlp-bump.yml");
    } catch {
      return "";
    }
  }

  function title(): string {
    const match = /^\s*title="([^"]+)"\s*$/m.exec(workflow());
    return (match?.[1] ?? "").replace("${latest}", "2099.01.01");
  }

  test("its title passes the commit-message rule the pr-title check enforces", () => {
    expect(title()).not.toBe("");
    // Run as `pr-title.yml` runs it, so the two cannot disagree about the rule.
    const run = () =>
      execFileSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", "commit-message.mjs"), "--text", title()],
        { stdio: "pipe" },
      );
    expect(run).not.toThrow();
  });

  test("its type is one release-please does not hide, so the new binary ships", () => {
    // A `chore` or `build` bump would merge and never produce an image — the
    // pin would be current on `main` and stale in production.
    const config = JSON.parse(read("release-please-config.json")) as {
      "changelog-sections": { type: string; hidden?: boolean }[];
    };
    const releasing = config["changelog-sections"]
      .filter((section) => section.hidden !== true)
      .map((section) => section.type);
    const type = /^(\w+)\(/.exec(title())?.[1];
    expect(releasing).toContain(type);
    expect(title()).toMatch(/^\w+\(downloader\)/);
  });

  test("it rewrites the downloader Dockerfile, which is what routes the release to the tool", () => {
    // release-please routes by path, never by scope: a bump that touched only
    // `.devcontainer/` would release nothing. The pins are found with the same
    // shape this file scans for, so asserting a pin lives under the tool is
    // asserting the bump lands there.
    expect(pins().some((pin) => pin.file.startsWith("tools/downloader/"))).toBe(true);
    expect(workflow()).toMatch(/^\s*pin="YTDLP_VERSION/m);
    expect(workflow()).toMatch(/grep -lE "\$\{pin\}/);
  });
});
