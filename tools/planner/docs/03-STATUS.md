# Status — planner

Where the planner stands. The tables below are written from the tickets'
frontmatter by `node scripts/status.mjs --write`, which runs on `main` after a
merge — so this page cannot disagree with the tickets, and a branch never edits
it. `npm run status` prints the same thing without opening a file.

Nothing else here is state. If you are about to write a paragraph, it belongs
somewhere that something keeps true:

| What you want to say                          | Where it goes                                              |
| --------------------------------------------- | ---------------------------------------------------------- |
| A ticket is done, or blocked, or open         | its own frontmatter. The tables below are the view         |
| What a piece of work did, and got wrong       | that ticket's `## Log`, in [work/](./work/)                |
| A gap the tool still has                      | the ticket that closes it — and if there is none, file one |
| Why the code is shaped the way it is          | a comment beside the code                                  |
| Where the design was overruled by building it | an amendment in [00-ANALYSIS.md](./00-ANALYSIS.md)         |
| A decision that binds more than one tool      | an [ADR](../../../docs/adr/)                               |
| What a phase or a milestone means             | [02-ROADMAP.md](./02-ROADMAP.md)                           |

The reasoning is in [adr/003](../../../docs/adr/003-the-status-page-is-generated.md):
a status page restating what the tickets already record is a file every branch
edits and no branch owns, and it goes wrong quietly rather than loudly. This
page had grown to 439 lines of it, touched by thirty-seven commits.

**Read [00-ANALYSIS.md](./00-ANALYSIS.md) and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) as design, not as description.** They
lead the code, and the open tickets below are the distance.

## Where things stand

<!-- generated:tickets -->

<!-- Written by `node scripts/status.mjs --write`, which runs on `main` after a merge.
     Do not edit this region: a ticket's frontmatter is what it is generated from, and a
     branch that edits it here is the merge conflict ADR 003 exists to end. -->

### Milestones

| Milestone      | Done | Open | Dropped | State       |
| -------------- | ---- | ---- | ------- | ----------- |
| P1             | 5    | 0    | 0       | complete    |
| P2             | 7    | 0    | 0       | complete    |
| P3             | 1    | 5    | 0       | in progress |
| _no milestone_ | 9    | 1    | 1       | in progress |

### Open tickets

| Ticket                                                    | Kind         | Status    | Milestone | What it is                                                                  |
| --------------------------------------------------------- | ------------ | --------- | --------- | --------------------------------------------------------------------------- |
| [pl-2](./work/pl-2-container-image.md)                    | chore        | in-flight | —         | Ship the planner as a released image on its own subdomain                   |
| [pl-25](./work/pl-25-grounding-cache.md)                  | work-package | ready     | P3        | Cache grounding with a TTL that varies by kind                              |
| [pl-26](./work/pl-26-lift-the-ssrf-guard.md)              | work-package | ready     | P3        | Lift the SSRF guard to packages/core when a second tool actually fetches    |
| [pl-27](./work/pl-27-travel-time-reaches-the-composer.md) | work-package | ready     | P3        | Measure the legs, pack under them, and stop naming travel time as unchecked |
| [pl-28](./work/pl-28-valhalla-adapter.md)                 | work-package | ready     | P3        | A real routing backend behind the seam, self-hosted                         |
| [pl-29](./work/pl-29-detours-along-a-leg.md)              | work-package | ready     | P3        | Find what is worth stopping for along a leg                                 |

<details>
<summary>Closed — 23 tickets</summary>

| Ticket                                                      | Kind         | Status  | What it was                                                                       |
| ----------------------------------------------------------- | ------------ | ------- | --------------------------------------------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md)                    | work-package | dropped | The conversation loop, end to end                                                 |
| [pl-3](./work/pl-3-trip-brief-contract.md)                  | work-package | done    | The trip brief, in the contract                                                   |
| [pl-4](./work/pl-4-plan-document-contract.md)               | work-package | done    | The plan document — candidates, days, revisions, pinning                          |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md)             | work-package | done    | The orchestrator and the specialist fan-out                                       |
| [pl-6](./work/pl-6-question-tree-and-engine.md)             | work-package | done    | The question tree, and the engine that walks it                                   |
| [pl-7](./work/pl-7-intake-persistence-and-wizard.md)        | work-package | done    | The intake — persistence, routes, and the wizard over them                        |
| [pl-8](./work/pl-8-model-provider-seam.md)                  | chore        | done    | Rename the chat seam to a model seam                                              |
| [pl-9](./work/pl-9-composer-and-critic.md)                  | work-package | done    | The composer and the critic — the itinerary package                               |
| [pl-10](./work/pl-10-plan-view-and-provenance.md)           | work-package | done    | The plan view — days, gaps, and what was actually verified                        |
| [pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) | chore        | done    | Retire the conversation vocabulary, and name an unknown endpoint properly         |
| [pl-12](./work/pl-12-render-the-wizard-in-tests.md)         | chore        | done    | Render the wizard's components in tests, not only the routes under them           |
| [pl-13](./work/pl-13-drive-the-intake-end-to-end.md)        | chore        | done    | Drive the intake end to end, and gate it in CI                                    |
| [pl-14](./work/pl-14-tree-content-review.md)                | work-package | done    | Review the question tree as content — budget, drive appetite, vehicle             |
| [pl-15](./work/pl-15-candidate-legs.md)                     | work-package | done    | A candidate is at a place or runs between two                                     |
| [pl-16](./work/pl-16-the-plan-run.md)                       | work-package | done    | The plan run — a job, its progress, and the plan it writes                        |
| [pl-17](./work/pl-17-dockerfile-workspace-scan.md)          | chore        | done    | A Dockerfile's workspace list is maintained by memory                             |
| [pl-18](./work/pl-18-destination-asked-early.md)            | work-package | done    | Ask where they are going third, and let it be blank                               |
| [pl-19](./work/pl-19-pin-through-the-browser.md)            | work-package | done    | Prove pinning through the browser, not at a mocked seam                           |
| [pl-20](./work/pl-20-intake-fixture-builders.md)            | chore        | done    | One builder for a saved intake, instead of three copies of its SQL                |
| [pl-21](./work/pl-21-name-the-bare-fields.md)               | chore        | done    | Four field kinds render an input a screen reader cannot name                      |
| [pl-22](./work/pl-22-pin-scoped-to-the-revision-shown.md)   | fix          | done    | A pin is scoped to the plan, not to the revision the reader was looking at        |
| [pl-23](./work/pl-23-pinned-out-of-season-currency.md)      | chore        | done    | A pinned out-of-season candidate's currency changed meaning, and nothing tests it |
| [pl-24](./work/pl-24-grounding-seam-and-fixtures.md)        | work-package | done    | The grounding seam, its fixture default, and the state a run grounds in           |

</details>

<!-- /generated:tickets -->

## Running things

```bash
npm run dev:planner            # API (8090) + web (5183), both in watch mode
npm run dev:planner:api        # just the API
npm run dev:planner:web        # just the UI
npm test -- --project planner
npm run check

npm run e2e:install            # once, for the browser
npm run e2e:planner            # the intake, in Chromium, against the built bundle
```

Ports are 8090/5183 rather than 8080/5173 so both tools can run at once. The e2e
suite takes 8098 and its own database under `e2e/.artifacts/`, so it does not
collide with either, and it starts the API itself — there is nothing to have
running first.

The repo-wide CI runs the unit suite on every push;
`.github/workflows/planner.yml` carries the two slow gates — the e2e suite in a
real browser, and the image, which is built, started and asked for both
`/api/health` and the page. Both are path-filtered, so downloader work does not
pay for them.
