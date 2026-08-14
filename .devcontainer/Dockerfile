# Dev container image: everything an agent needs to build, test and *run* the
# tools in this repo, so that "npm run check", "npm test" and each tool's e2e
# suite all work on a fresh clone with no host setup and no permission prompts.
#
# Repo-scoped, not tool-scoped — one sandbox serves every tool under `tools/`.
# It currently carries ffmpeg and yt-dlp because the downloader needs them; a
# tool needing something else adds it here rather than getting its own image.
#
# The base is Playwright's own image for the same reason the downloader's
# production Dockerfile uses it: the browser sniffer is a first-class tier, and
# Chromium needs some seventy shared libraries no Node image carries. Keep
# PLAYWRIGHT_VERSION in step with the `playwright` / `@playwright/test` version
# in package-lock.json — a mismatch makes Playwright try to download a browser
# on first use, which the egress firewall will then be blamed for.
ARG PLAYWRIGHT_VERSION=1.62.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG USERNAME=pwuser
ARG NODE_MAJOR=22
ARG YTDLP_VERSION=2025.09.26
ARG TZ=Etc/UTC

ENV TZ="${TZ}"
ENV DEBIAN_FRONTEND=noninteractive

# iptables/ipset/dnsutils are for init-firewall.sh; ffmpeg is what the engine
# shells out to (FFMPEG_PATH below points at it, so the ffmpeg-static download
# is never used); python3/make/g++ are the node-gyp fallback for better-sqlite3
# on the days its prebuild is missing.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git git-lfs less nano vim \
      procps psmisc lsof \
      ripgrep jq unzip zip \
      sudo iptables ipset iproute2 dnsutils \
      ffmpeg python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Node from NodeSource rather than whatever the Playwright image happens to
# ship. The repo pins Node 22 on purpose (see CLAUDE.md on type stripping), and
# an image that silently moved to 24 would make the container disagree with CI.
#
# The base image already carries a newer Node from NodeSource, so a plain
# `apt-get install nodejs` is a downgrade: apt reports "already the newest
# version", installs nothing, and the container quietly runs the wrong major.
# Hence the explicit version and --allow-downgrades — and the assertion, so the
# next time the base image moves the build fails here instead of in CI.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource.sh \
  && bash /tmp/nodesource.sh \
  && apt-get install -y --no-install-recommends --allow-downgrades "nodejs=${NODE_MAJOR}.*" \
  && rm -rf /var/lib/apt/lists/* /tmp/nodesource.sh \
  && node --version \
  && test "$(node --version | cut -d. -f1)" = "v${NODE_MAJOR}"

# gh, so an agent can open PRs and read issues without a browser.
RUN mkdir -p -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp is a latency optimisation, never a dependency — but the resolver tier
# that uses it only has tests worth running when the binary exists, so it is
# present here even though the production image defaults it off.
RUN curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
  && chmod 0755 /usr/local/bin/yt-dlp

# The workspace is a bind mount from a real Linux filesystem (the checkout lives
# in WSL, not on a Windows drive), so its ownership comes through as-is — uid
# 1000 for a first user account. Playwright's pwuser is 1001, which makes the
# whole working tree read-only to the agent: postCreateCommand dies on the first
# file it writes, and every later edit would too. So renumber pwuser to match.
# Ubuntu's stock `ubuntu` account squats on 1000 and is unused here, so it goes.
# Override USER_UID/USER_GID from devcontainer.json if `id -u` on the host
# differs.
ARG USER_UID=1000
ARG USER_GID=1000
RUN if [ "$(id -u "${USERNAME}")" != "${USER_UID}" ] || [ "$(id -g "${USERNAME}")" != "${USER_GID}" ]; then \
      squatter="$(getent passwd "${USER_UID}" | cut -d: -f1)" \
      && if [ -n "${squatter}" ] && [ "${squatter}" != "${USERNAME}" ]; then userdel -r "${squatter}" 2>/dev/null || userdel "${squatter}"; fi \
      && squatgroup="$(getent group "${USER_GID}" | cut -d: -f1)" \
      && if [ -n "${squatgroup}" ] && [ "${squatgroup}" != "${USERNAME}" ]; then groupdel "${squatgroup}"; fi \
      && groupmod --gid "${USER_GID}" "${USERNAME}" \
      && usermod --uid "${USER_UID}" --gid "${USER_GID}" "${USERNAME}"; \
    fi \
  && test "$(id -u "${USERNAME}")" = "${USER_UID}" \
  && test "$(id -g "${USERNAME}")" = "${USER_GID}"

# Mount points, created here with the right owner so the named volumes that
# land on them are not root-owned. fix-mounts.sh repairs the ones Docker
# creates fresh anyway; this just keeps the common case quiet. The `chown -R`
# also repairs the home directory after the renumbering above.
RUN mkdir -p /commandhistory /workspaces \
      "/home/${USERNAME}/.claude" \
      "/home/${USERNAME}/.config/gh" \
      "/home/${USERNAME}/.npm-global" \
  && touch /commandhistory/.bash_history \
  && chown -R "${USERNAME}:${USERNAME}" /commandhistory /workspaces "/home/${USERNAME}"

# The egress allowlist is baked into the image, root-owned, rather than read
# from the workspace: the workspace is writable by the agent, so an allowlist
# living there would be one an agent could widen and re-apply by itself. The
# source of truth is .devcontainer/allowed-domains.txt in git; changing it
# takes a rebuild, which is a human action and shows up in a diff.
COPY allowed-domains.txt /usr/local/share/devcontainer/allowed-domains.txt
COPY init-firewall.sh fix-mounts.sh /usr/local/bin/
RUN chown root:root \
      /usr/local/bin/init-firewall.sh \
      /usr/local/bin/fix-mounts.sh \
      /usr/local/share/devcontainer/allowed-domains.txt \
  && chmod 0755 /usr/local/bin/init-firewall.sh /usr/local/bin/fix-mounts.sh \
  && chmod 0644 /usr/local/share/devcontainer/allowed-domains.txt \
  # Two commands, no arguments. Not blanket sudo: the point of the firewall is
  # that the thing it constrains cannot trivially take it down.
  && echo "${USERNAME} ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh, /usr/local/bin/fix-mounts.sh" \
       > /etc/sudoers.d/devcontainer \
  && chmod 0440 /etc/sudoers.d/devcontainer

# Globals into the user's home so `claude update` works without root.
ENV NPM_CONFIG_PREFIX="/home/${USERNAME}/.npm-global"
ENV PATH="/home/${USERNAME}/.npm-global/bin:${PATH}"
ENV SHELL=/bin/bash
ENV EDITOR=nano

USER ${USERNAME}

RUN npm install -g @anthropic-ai/claude-code

# History survives a rebuild, because the volume behind it does. `history -a`
# flushes per command, so a container killed mid-session still leaves a trail.
RUN printf '%s\n' \
      'export HISTFILE=/commandhistory/.bash_history' \
      'export HISTSIZE=20000' \
      'export HISTFILESIZE=40000' \
      'export PROMPT_COMMAND="history -a"' \
      >> "/home/${USERNAME}/.bashrc"

WORKDIR /workspaces
