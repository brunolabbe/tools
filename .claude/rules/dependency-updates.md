---
paths:
  - "**/package.json"
  - "package-lock.json"
---

# Updating dependencies

**A release is at least seven days old before it enters the lockfile**, unless it
fixes an advisory `npm audit` reports against this tree. A malicious publish to
the registry is usually found and unpublished within days, and a week also lets a
fresh release's regressions surface on someone else's project. The owner chose
the exemption on 2026-10-24: a fix that is old enough sits behind the same week
as everything else, and a known advisory is worse than an unknown one.

npm applies the cutoff itself — `--before` resolves every package, transitive
ones included, to the newest version published before that date:

```bash
npx -y npm@11.21.1 update --before=<today minus 7 days>   # e.g. 2026-10-17
npx -y npm@11.21.1 update <advisory-fixing package>       # the exemption, named
npm audit                                                 # what is left
```

**Use npm 11 for the update, not the npm 10.9.9 Node 22 ships.** 10.9.9's
arborist crashes on this tree with `Cannot read properties of null (reading
'edgesOut')` in `#loadPeerSet` for any `npm update`, and for `npm install` of
vitest; npm 11.21.1 resolves the same request. The lockfile format is the same,
so CI's `npm ci` on npm 10 reads the result unchanged. Pick an npm release that
itself clears the week.

Check what moved before committing: compare each changed lockfile entry's
version against `npm view <name> time --json`, and name every entry younger than
seven days in the pull request with the advisory that exempts it.

A major version is not an update — it is a ticket, because its breaking changes
need reading before anyone builds on it.
