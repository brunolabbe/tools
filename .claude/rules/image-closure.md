---
paths:
  - "**/Dockerfile"
  - "**/package.json"
  - "compose*.yaml"
  - ".dockerignore"
---

# What an image has to ship

Lifted out of the root `CLAUDE.md` so it loads when you open a `Dockerfile` or a
`package.json` and costs nothing the rest of the time. The rule is unchanged.

**An image ships every workspace its API resolves**, and **a package declares
every workspace it imports under `src`** — in `dependencies`, not
`devDependencies`, because the runtime stage is built after `npm prune
--omit=dev`. Each `Dockerfile` keeps that list by hand twice, once as manifests
before `npm ci` and once as a `package.json` + `dist` pair per workspace, and the
two fail differently: miss the runtime pair and the container boots and throws on
first use, miss the manifest and `npm ci` never made the symlink at all. Enforced
repo-wide by a scan in `packages/core/test/image-closure.test.ts`, which walks the
graph from each tool's `api` and fails naming the missing line. It does not
replace the per-tool image gate — a scan over text cannot prove a container boots.

The scan finds a tool's service **by name, at `@<tool>/api`**, and expects the two
stages to be `AS build` and `AS runtime`. A tool that names either differently has
to teach the scan; the test fails by name saying so.
