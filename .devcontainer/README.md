# Dev container

A Linux sandbox with the whole toolchain in it — Node 22, ffmpeg, yt-dlp,
Chromium, `gh`, and the Claude Code CLI — so an agent can build, test and run
any tool in this repo end to end without asking permission for anything and
without touching the Windows host.

One sandbox for the whole repo, not one per tool: it is named `webtools`, and
its named volumes are `webtools-*`. The `downloader:local` image that
`compose.yaml` builds is a different thing entirely — that one ships the
downloader as a product, and each tool gets its own.

## Getting started

1. Docker Desktop running, and the **Dev Containers** VS Code extension.
2. `F1` → **Dev Containers: Reopen in Container**. The first build takes a
   while (the Playwright base image is ~2 GB) and ends with `npm ci`.
3. In the container's terminal, `claude` and follow the login. It is stored in
   a named volume, so this is once per machine, not once per rebuild.
4. `gh auth login` if the agent should open PRs.

Then `npm run dev` (API on 8080, UI on 5173, both forwarded to Windows),
`npm test`, `npm run e2e:downloader`, `npm run check` — all work with no further setup.

## What is where

| File                  | Does                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `devcontainer.json`   | mounts, ports, capabilities, VS Code wiring                                 |
| `Dockerfile`          | the image: Node 22 on Playwright's base, plus ffmpeg / yt-dlp / gh / claude |
| `post-create.sh`      | runs once on create: `npm ci`, `.env.local`, sanity checks                  |
| `init-firewall.sh`    | runs on every start: default-deny egress                                    |
| `allowed-domains.txt` | the egress allowlist — **edit this, not the script**                        |
| `fix-mounts.sh`       | gives the container user its named volumes                                  |

## Running agents without prompts

Inside the container:

```bash
claude --dangerously-skip-permissions
```

That flag is only reasonable because of what surrounds it: no host filesystem
beyond this repo, no host credentials, no ambient cloud tokens, and egress
limited to an allowlist. Do not use it on the Windows side.

The workspace bind mount is the one thing an agent can affect outside the
container's lifetime — it is your real working tree. Commit often, or point the
container at a dedicated clone.

## The firewall

`init-firewall.sh` sets the default policy to DROP and then allows: loopback,
the Docker host subnet, DNS, GitHub's published address ranges (fetched from
`api.github.com/meta`), and the A records of every name in
`allowed-domains.txt`. It verifies both directions before exiting — that
`example.com` is blocked and that `api.anthropic.com` is not — so a rule set
that failed open or closed says so at startup rather than three hours later.

**To open a host:** add it to `allowed-domains.txt`, then **Rebuild
Container**. The list is baked into the image and owned by root on purpose; an
allowlist the agent could widen and re-apply in place would not be worth much.

**When something that used to work stops:** big CDNs rotate addresses, and the
ipset holds whatever they resolved to at container start. Re-run it:

```bash
sudo /usr/local/bin/init-firewall.sh
```

**Consequence worth knowing:** the resolver tiers exist to probe arbitrary
third-party sites, and in here they can reach none of them. Every unit test and
the e2e suite run against local fixtures by design, so the test suites are
unaffected. Probing a real site from the container needs its hostname _and_ its
media CDN's in the allowlist.

`sudo` is restricted to `init-firewall.sh` and `fix-mounts.sh`, with no
arguments. So `apt-get install` inside a running container will not work — add
the package to the `Dockerfile` and rebuild, which is the reproducible fix
anyway.

This is a guardrail against a mistake or a bad instruction, not a jail. It is
not a defence against a process actively trying to get out.

## node_modules

The Windows checkout's `node_modules` holds win32 binaries (esbuild, rollup,
`better-sqlite3`) that a Linux container cannot load. Named volumes are mounted
over `node_modules` and `tools/downloader/web/node_modules` so the two installs never see
each other. Neither host nor container needs cleaning when you switch between
them.

If a future dependency change makes npm nest another `node_modules` under a
workspace, add that path to `mounts` in `devcontainer.json` — otherwise it
lands on the host tree and the two builds start fighting.

## Versions to keep in step

- `PLAYWRIGHT_VERSION` in `devcontainer.json` ↔ `playwright` in
  `package-lock.json`. A mismatch makes Playwright download a browser on first
  use — a failure the firewall will get blamed for.
- `NODE_MAJOR` ↔ `node-version` in `.github/workflows/ci.yml` and `engines` in
  `package.json`. The point of the container is that a green run in here means
  a green run in CI.
