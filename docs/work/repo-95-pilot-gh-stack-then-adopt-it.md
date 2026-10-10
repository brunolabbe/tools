---
id: repo-95
tool: repo
title: Pilot the `gh stack` extension on the next chain, then adopt it for stacked branches
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-95 — Pilot `gh stack` on the next chain, then adopt it

## Why

On 2026-10-06 the owner reversed part of [repo-48](./repo-48-should-this-repo-adopt-a-stacked-branch-tool.md),
which chose process only ("Option 1": cut B from A, open it as a draft against
A) plus one pilot of GitHub's native stacks through the website, and ruled out
the `github/gh-stack` extension. **The decision now: pilot with the extension,
and adopt it if the pilot holds.** That was the recommended option. The others
were adopting it outright, and keeping Option 1 with the website pilot.

The case comes from tools-79's batch (dl-78 to dl-83, 2026-10-06). That batch
stacked five pull requests by hand, every one based on `main`. Measured from
`gh pr view <n> --json mergedAt` and the session's own board:

| PR   | Ticket | Merged (UTC)   |
| ---- | ------ | -------------- |
| #371 | dl-78  | 10-06 03:19    |
| #373 | dl-79  | 10-06 03:41    |
| #370 | dl-82  | 10-06 12:39    |
| #372 | dl-80  | 10-06 23:11    |
| #374 | dl-83  | open at filing |

After each merge the orchestrator merged `main` into the next branch, cleared
the artificial conflicts the squash creates, read CI again (around 15 minutes)
and only then marked the next PR ready. That is one owner round trip per PR.
On #370 the step also needed a repair: a Haiku builder's merge came out broken,
and a second fixer had to prove the merged test file by content. A native stack is merged once from its top. That merges every
PR below it, one squash commit each, and GitHub rebases what is left itself.

**What a stack does not fix**, so nobody adopts it expecting this: the
overnight stall in the same batch (04:49 to 12:10) waited on a decision, not
on a merge. dl-80's 9 s floor pushed one of dl-83's tests to 23.3 s against a
25 s budget. [repo-96](./repo-96-an-away-owner-does-not-stall-a-reversible-choice.md)
covers that. Merging also stays the owner's: `gh stack merge` merges, and the
existing `Bash(gh pr merge *)` deny does not match it.

## Build

1. **Guard before install.** Add `Bash(gh stack merge*)` to the `deny` list
   in `.claude/settings.json`. Confirm it binds by running `gh stack merge
--help` and watching it be refused. This step happens first, before
   anything can merge.
2. **Install, durably.** `gh extension install github/gh-stack`, pinned to a
   release tag (v0.1.1 was current at repo-48). Add the same pinned install to
   `.devcontainer/Dockerfile`, and add `release-assets.githubusercontent.com`
   to `.devcontainer/allowed-domains.txt`. At filing that host answered
   (`curl` got an HTTP 404 back) only because the firewall was down, and it is
   not in the allowlist. A rebuild picks up the allowlist; re-running
   `init-firewall.sh` does not. The owner does the rebuild.
3. **Run the pilot on the next real chain**, meaning two batch branches the
   seam map says must share a file. Do not build a synthetic one. Record in
   this ticket's Log, each with the command and its output:
   - whether a stack exists on this personal repository at all (`gh stack
link <A> <B>`, then `gh pr view <B> --json baseRefName`);
   - **linear history.** Builders currently `git merge origin/main` into
     their branches, and tools-79 chose merge over rebase on purpose so no
     gated commit was force-pushed. Does a merged-in `main` block the stack's
     merge? If it does, the builder roles switch to rebase plus force-push,
     and gate records must then name the rebased sha;
   - **a live worktree.** After a server-side "Rebase stack", or the automatic
     rebase that follows a bottom merge, what does a builder whose worktree
     still holds the old branch see on its next push? Write down the recovery
     command;
   - whether a squash-merged stack still gives one changelog line per ticket
     (release-please reads squash subjects, so check each squash subject
     against `scripts/commit-message.mjs`).
4. **Adopt, or stop.** If all four hold, rewrite the "stack them on purpose,
   as a draft" procedure in
   `.claude/skills/orchestrate-tickets/reference/concurrency.md` around
   `gh stack`, and delete the website-pilot paragraph. Update the builder and
   fixer role pages wherever they say to merge `main` in. If any point fails,
   leave Option 1 standing. Remove the extension, its allowlist entry and its
   `Dockerfile` line, keep the deny rule, and record why here. Either way, add
   a Log line to repo-48 pointing here.

## Done when

1. `gh stack merge` is refused by a deny rule in `.claude/settings.json`,
   shown by the refusal.
2. The extension is installed at a pinned tag by `.devcontainer/Dockerfile`,
   and its download host is in `.devcontainer/allowed-domains.txt`. Or, if the
   pilot failed, neither is.
3. This ticket's Log answers the four questions in Build step 3, each from a
   command run on a real chain in this repository.
4. `concurrency.md` describes the procedure the pilot supports, and repo-48's
   Log points here.

## Log

- 2026-10-06 — filed by tools-b2 from the owner's answer to "How should
  repo-48's decision change toward gh stack?". Options: pilot with gh stack,
  then adopt (recommended, chosen); adopt outright; keep Option 1 with the
  website pilot. The timings above come from `gh pr view` at filing, and the
  stall reading comes from tools-79's transcript.
  Rated `hard`: step 3 has to happen inside a live batch, and its result
  decides how the builder roles handle `main`.
- 2026-10-10 — builder, branch `repo-95-pilot-gh-stack-extension` off `7709411e`.
  **Stopped after step 1, before any install: the deny rule this branch adds
  does not bind for anyone until it merges.** Build step 1 asks to watch
  `gh stack merge --help` be refused on the branch that adds the rule, and that
  cannot happen. A session loads its permission rules and hooks from the shared
  checkout's `.claude/settings.json`, which is on `main`, and not from its
  worktree. The same thing was recorded for hooks in
  `.claude/skills/orchestrate-tickets/reference/history.md` (repo-22) and in
  `check-main-writes.sh`'s header (repo-42). Measured in one session, with
  `Bash(gh stack merge*)` added to this worktree's `.claude/settings.json`:
  - `gh stack merge --help` was **not refused by the harness**. It reached gh,
    which printed its own message for an extension that is not installed, and
    exited 1:
    `gh stack is available as an official extension. To install it, run: gh extension install github/gh-stack`.
  - Control: `gh api --help`, held by `main`'s `Bash(gh api *)`, printed
    `Permission to use Bash with command gh api --help has been denied.`
    So deny rules do bind in this session, but only the ones on `main`.
  - `gh pr merge --help` was refused by the shared checkout's
    `check-main-writes.sh` hook (`PreToolUse:Bash hook error: … Merging a pull
request is the owner's decision`). The hook fires before the deny list is
    consulted, so this probe cannot tell the two layers apart.

  So nothing stands between `gh stack merge` and a merge until the rule reaches
  `main`. The extension is the only thing that does, by being absent:
  `gh extension list` printed nothing. Step 2 (install, `Dockerfile`,
  allowlist) is therefore not done, and the next move is the owner's. Steps 3
  and 4 are `unproven (scope)`.

  Also wrong in the brief: v0.1.1 is no longer the current tag. The releases page
  (github.com/github/gh-stack/releases, read 2026-10-10) lists v0.2.1
  (2026-10-09) and v0.2.0 (2026-10-02) above it, and v0.2.1 has a
  `linux-amd64` asset. gh here is 2.101.0.
