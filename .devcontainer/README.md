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
`api.github.com/meta`), and the A records of every name in the allowlist. The
copy it reads is `/usr/local/share/devcontainer/allowed-domains.txt`, baked
into the image by the `Dockerfile` and owned by root — **not** the
`.devcontainer/allowed-domains.txt` you edit. It verifies both directions before exiting — that
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

**That re-run is not how you add a host, and the difference has cost time.** It
rebuilds the ipset from scratch, but from the baked copy — so it re-resolves the
same names and picks up nothing you edited in the repo. The two copies drift
silently and stay drifted: a container built before `download.docker.com` was
added ran that script at every start for weeks without ever holding it. To see
which list is actually in force, diff them:

```bash
diff /usr/local/share/devcontainer/allowed-domains.txt \
     .devcontainer/allowed-domains.txt
```

Only a rebuild re-bakes it. That is the point of the design, not a wrinkle in
it — `sudo` here is `NOPASSWD` for `init-firewall.sh` and `fix-mounts.sh` and
nothing else, so an agent can re-apply the allowlist it was given and cannot
write itself a new one.

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

## Docker, and why there is no daemon

The image carries the docker **CLI** and the compose plugin, and no daemon. So
this works:

```bash
docker compose -f compose.yaml -f compose.prod.yaml config
```

which merges the deployment overlay and checks it against the schema — worth
doing before a deploy, because `compose.prod.yaml` pins a subnet and sets
`TRUST_PROXY` to name it, and the two drifting apart takes every rate limit in
the API back to a single shared bucket without any visible symptom. Merging
files needs nothing to be running.

Anything that needs a daemon — `docker compose build`, `up`, `ps` — will fail
here, and is meant to. Docker-in-Docker needs `--privileged`, and mounting the
host's socket is the same authority reached the long way; either one ends the
premise that the container is the boundary, which is the entire reason
`--dangerously-skip-permissions` is defensible in here. A nested daemon would
also insert its own ACCEPT rule into `FORWARD` after `init-firewall.sh` had set
that chain to DROP, giving anything it started the unrestricted egress the
allowlist exists to prevent.

Building the real image and running it is a CI gate on a clean machine — see
`.github/workflows/downloader.yml` — which is a better test of the container
than a nested daemon on a working tree would be. Locally,
`npm run e2e:downloader` already drives the whole stack without one.

## node_modules

The Windows checkout's `node_modules` holds win32 binaries (esbuild, rollup,
`better-sqlite3`) that a Linux container cannot load. Named volumes are mounted
over `node_modules` and `tools/downloader/web/node_modules` so the two installs never see
each other. Neither host nor container needs cleaning when you switch between
them.

If a future dependency change makes npm nest another `node_modules` under a
workspace, add that path to `mounts` in `devcontainer.json` — otherwise it
lands on the host tree and the two builds start fighting.

## Host uid

The checkout lives on a Linux filesystem (WSL), so the workspace bind mount
keeps its real ownership — Docker does not synthesise it the way it does for a
Windows drive. The container user is therefore built at the host owner's ids:
`USER_UID` / `USER_GID` in `devcontainer.json`, both 1000, which is the first
user account on a stock WSL distro.

If `id -u` on the host says something else, change both and rebuild. The symptom
of a mismatch is `postCreateCommand` dying with `Permission denied` on the first
file it writes into the workspace — the tree is readable but not writable, so
`npm ci` (which installs into named volumes) succeeds first and hides the cause.

Changing the ids strands the `node_modules` volumes, which outlive the image and
are still full of files owned by the previous uid — `npm ci` then fails with
`EACCES` unlinking one of them. `fix-mounts.sh` repairs that on the next create,
so a rebuild is enough; the volumes do not need deleting.

## Versions to keep in step

- `PLAYWRIGHT_VERSION` in `devcontainer.json` ↔ `playwright` in
  `package-lock.json`. A mismatch makes Playwright download a browser on first
  use — a failure the firewall will get blamed for.
- `NODE_MAJOR` ↔ `node-version` in `.github/workflows/ci.yml` and `engines` in
  `package.json`. The point of the container is that a green run in here means
  a green run in CI.
