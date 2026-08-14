#!/usr/bin/env bash
#
# Default-deny egress for the dev container.
#
# The agent inside this container runs with permission prompts turned off, so
# the container is the only thing standing between a bad instruction and the
# open internet. This narrows "the open internet" to: loopback, the Docker host
# network, DNS, GitHub's published ranges, and the names in
# allowed-domains.txt.
#
# Run at every container start (postStartCommand) — iptables rules live in the
# network namespace and do not survive a restart. Safe to re-run by hand:
#
#   sudo /usr/local/bin/init-firewall.sh
#
# which is the fix when a CDN rotates addresses out from under the ipset.
#
# What this is not: a defence against a determined process inside the
# container. It has no sudo to change these rules, but a firewall keyed on
# resolved addresses is a guardrail against drift and mistakes, not a jail.

set -euo pipefail
IFS=$'\n\t'

readonly ALLOWLIST=/usr/local/share/devcontainer/allowed-domains.txt
readonly SET=allowed-domains

log() { printf '[firewall] %s\n' "$*"; }
die() {
  printf '[firewall] ERROR: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"
[ -r "$ALLOWLIST" ] || die "allowlist not readable at $ALLOWLIST"

# ---------------------------------------------------------------------------
# Start from open. Resolution below needs egress, and on a re-run the previous
# invocation's rules would otherwise block the DNS lookups that build the new
# ones.
# ---------------------------------------------------------------------------
for chain in INPUT OUTPUT FORWARD; do iptables -P "$chain" ACCEPT; done
iptables -F
iptables -X
for table in nat mangle; do
  iptables -t "$table" -F
  iptables -t "$table" -X
done
ipset destroy "$SET" 2>/dev/null || true
ipset create "$SET" hash:net family inet

added=0
add_cidr() {
  local cidr="$1"
  [[ "$cidr" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$ ]] || return 0
  ipset add -exist "$SET" "$cidr"
  added=$((added + 1))
}

# ---------------------------------------------------------------------------
# GitHub, from its own published ranges. git, gh, release tarballs and Actions
# all live behind addresses that change often enough that pinning A records
# would be a support burden.
# ---------------------------------------------------------------------------
meta="$(curl -fsSL --max-time 20 https://api.github.com/meta || true)"
if [ -n "$meta" ]; then
  before=$added
  while read -r cidr; do add_cidr "$cidr"; done < <(
    printf '%s' "$meta" | jq -r '((.web // []) + (.api // []) + (.git // []) + (.packages // []))[]' 2>/dev/null || true
  )
  log "github: $((added - before)) ranges"
else
  log "github: api.github.com/meta unreachable — github access will be limited to whatever resolves below"
fi

# ---------------------------------------------------------------------------
# Everything else, by name.
# ---------------------------------------------------------------------------
while read -r host; do
  host="${host%%#*}"
  host="$(printf '%s' "$host" | tr -d '[:space:]')"
  [ -n "$host" ] || continue

  ips="$(dig +short +time=3 +tries=2 A "$host" 2>/dev/null | grep -E '^[0-9]+\.' || true)"
  if [ -z "$ips" ]; then
    # Non-fatal on purpose: one unreachable name should not leave the container
    # with no firewall at all, which is the strictly worse outcome.
    log "warn: $host did not resolve — traffic to it will be dropped"
    continue
  fi
  while read -r ip; do add_cidr "$ip"; done <<<"$ips"
done <"$ALLOWLIST"

log "allowlist holds $added entries"
[ "$added" -gt 0 ] || die "nothing resolved; refusing to install a firewall that blocks everything"

# ---------------------------------------------------------------------------
# The host side of the bridge. VS Code's port forwarding and every
# `localhost:8080` from Windows arrive from this subnet, and the dev servers
# have to be able to answer.
# ---------------------------------------------------------------------------
iface="$(ip route show default | awk '/default/ {print $5; exit}')"
route_args=(-o -f inet route show scope link)
if [ -n "$iface" ]; then route_args+=(dev "$iface"); fi
host_net="$(ip "${route_args[@]}" | awk '{print $1; exit}')"
[ -n "$host_net" ] || die "could not determine the container's own subnet"
log "host network: $host_net (via ${iface:-unknown})"

# ---------------------------------------------------------------------------
# Rules.
# ---------------------------------------------------------------------------
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# DNS. Docker's embedded resolver sits on 127.0.0.11 and is covered by the
# loopback rule, but a container on a user-defined network may be pointed at
# the host's resolver instead.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

iptables -A INPUT -s "$host_net" -j ACCEPT
iptables -A OUTPUT -d "$host_net" -j ACCEPT

iptables -A OUTPUT -m set --match-set "$SET" dst -j ACCEPT

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# IPv6 is off rather than filtered: nothing here needs it, and a half-filtered
# stack is a way around an IPv4 allowlist.
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -F 2>/dev/null || true
  for chain in INPUT OUTPUT FORWARD; do ip6tables -P "$chain" DROP 2>/dev/null || true; done
  ip6tables -A INPUT -i lo -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Prove both halves, because a firewall that quietly failed open and one that
# quietly blocked everything look identical until something needs the network.
# ---------------------------------------------------------------------------
if curl -fsS --max-time 5 -o /dev/null https://example.com 2>/dev/null; then
  die "example.com is still reachable — the deny rule is not in effect"
fi
log "verified: unlisted hosts are blocked"

for probe in https://api.anthropic.com/v1/models https://registry.npmjs.org/npm; do
  if curl -sS --max-time 15 -o /dev/null "$probe" 2>/dev/null; then
    log "verified: reachable — ${probe}"
  else
    log "warn: ${probe} is NOT reachable; check its entry in allowed-domains.txt"
  fi
done

log "done"
