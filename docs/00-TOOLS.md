# Where the documentation lives

This directory holds only what is true of the **repo**. Everything that is true
of one tool lives under that tool, next to its code — the same split the
`CLAUDE.md` files already make, for the same reason: a document that mixes two
tools is the first place they start to fuse.

## Per tool

| Tool         | Docs                                                | What it is                                                |
| ------------ | --------------------------------------------------- | --------------------------------------------------------- |
| `downloader` | [tools/downloader/docs/](../tools/downloader/docs/) | Page URL in, video stream found and downloaded, link out  |
| `planner`    | [tools/planner/docs/](../tools/planner/docs/)       | Describe a trip, plan it with an assistant, keep the plan |

Each tool's `docs/` has the same spine, so an agent that has read one tool knows
where to look in the next:

```
00-ANALYSIS.md      the research the design rests on — the "why it is hard"
01-ARCHITECTURE.md  packages, pipeline, the decisions that shape them
02-ROADMAP.md       phases and milestones for this tool only
work/               one file per ticket — the brief and its outcome together
```

There is no status page in the spine, and `03-STATUS.md` is not a free number
waiting to be reused. Both tools had one; `repo-2` deleted them, because a
projection of the tickets kept in version control needs a writer and none of the
available writers was safe — see
[adr/003](./adr/003-the-status-page-is-generated.md)'s amendment. **Where a tool
stands is `npm run status`**, and how to run it is that tool's `CLAUDE.md`.

A tool is not obliged to have all four on day one. The downloader has the full
set; a young tool may have only a roadmap and an empty `work/`, and that is an
honest description of a young tool rather than a gap to fill with guesses.

## Repo-wide

| File                                   | What it is                                                        |
| -------------------------------------- | ----------------------------------------------------------------- |
| [`README.md`](../README.md)            | The front door: what the tools are and how to run them            |
| [`CLAUDE.md`](../CLAUDE.md)            | The conventions every tool follows. The rules, not the plan       |
| [`SECURITY.md`](../SECURITY.md)        | How to report a vulnerability, and what counts as one             |
| [01-TICKETS.md](./01-TICKETS.md)       | How work is written down: the ticket format and its life          |
| [02-DEPLOYMENT.md](./02-DEPLOYMENT.md) | Putting a tool on a public subdomain from a host behind a router  |
| [03-RELEASING.md](./03-RELEASING.md)   | Commit conventions, versions, changelogs, and the images they cut |
| [adr/](./adr/)                         | Decisions binding more than one tool                              |
| [work/](./work/)                       | Repo-wide tickets, `repo-` prefixed — the toolchain and the rules |

Deployment and releasing are here rather than under a tool because the tunnel,
the login policy, `compose.prod.yaml` and the version scheme are one story for
whatever gets published; the downloader is their worked example, not their
subject.

A tool's generated `CHANGELOG.md` sits at the root of the tool rather than in
its `docs/` spine — the spine is written by hand and read by agents, and a file
release-please rewrites on every release does not belong in the middle of it.

### Decision records

- [001 — Documentation and tickets live under the tool](./adr/001-per-tool-docs-and-tickets.md)
- [002 — Each tool releases itself, from conventional commits](./adr/002-releases-from-conventional-commits.md)
- [003 — The status tables are generated from the tickets](./adr/003-the-status-page-is-generated.md)
- [004 — One compose fragment per tool, merged on the host](./adr/004-one-compose-fragment-per-tool.md)
- [005 — Excusing a code-scanning finding, in the code it excuses](./adr/005-excusing-a-code-scanning-finding.md)

An ADR belongs here only when the decision constrains **two or more tools** —
what earns a place in `packages/core`, which runtime the repo targets, how CI is
split. A decision inside one tool goes in that tool's `01-ARCHITECTURE.md`.
