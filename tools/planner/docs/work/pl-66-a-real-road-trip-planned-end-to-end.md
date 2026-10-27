---
id: pl-66
tool: planner
title: The owner plans a real road trip end to end through the page, on a real model, and what hurt is filed
kind: work-package
status: ready
milestone: P5
depends_on: []
difficulty: standard
---

# pl-66 — A real road trip, planned end to end

**Packages:** none expected. The deliverable is this ticket's Log and the
tickets it files. If a step needs a code change to proceed at all, stop: that
change is one of the tickets.

## Why

Every milestone is closed (P1–P4), and every proof behind them is one of two
kinds. Either a scripted model in a browser (pl-13, pl-19, pl-46, pl-48), or a
real model through a harness over fixture briefs (pl-40, pl-58, pl-60, pl-62).
**Nobody has yet planned a trip they are actually taking, through the page, on
a real model.** `compose.planner.prod.yaml` sets `MODEL_PROVIDER: "scripted"`,
so the deployed tool never has either.

The roadmap's rule is that a phase is ticketed only once the phase before has
shown what its briefs need. The four phases taught that through tickets. The
next one has no ticket to learn from, so this one produces them: the owner
uses the tool for real and each problem becomes a filed problem.

**Decided by the owner on 2026-10-27, and not reopened here:**

- **Phase 5 is this trial**, chosen over exports and a share link, grounding
  prices, and reopening opening hours. Those stay on the table, and this trial
  may move them up or down the list.
- **It runs locally** on `npm run dev:planner`. Production is not switched to
  a real model: that puts a paying endpoint online, and it is a ticket of its
  own if the trial shows it is worth doing.
- **The trip is a road trip through several towns**, because that shape covers
  everything built so far: corridor discovery (pl-29), town discovery for
  lodging and food (pl-60, pl-62), travel time (pl-27), and re-planning named
  days (pl-44).

**Measured at filing.** The code default is already Sonnet 5.5 at `low`
(`API_DEFAULTS` in `api/src/config.ts`, set by #464 on pl-40's numbers).
pl-40's set B puts one corridor plan run on that model at about $0.13. A
trial of 10–15 runs, re-plans included, is under $3. The owner's key is the
`PLANNER=` line in `/workspaces/tools/.claude/.keys`.

## Build

The owner drives the page and the agent keeps the record. **The agent never
answers an intake question or picks a revision for the owner.** The point is
what a person does with the tool, not what an agent does with it.

1. **Grounding has to be real, or the trial measures the fixtures.** Under
   `GROUNDING_PROVIDER=fixtures` a real trip locates nothing and discovers
   nothing. The three services run on the deployment host, on the compose
   `planner` network, with no ports published (pl-63). **First measure whether
   this machine can reach them:** Valhalla `/status`, Nominatim `/status`, and
   an Overpass `[out:json];node(1);out;` query, through whatever route the
   owner names. If any of the three cannot be reached, **stop and ask** with the
   measured result, giving these options: a tunnel to the host, the public
   Nominatim and Overpass instances with Valhalla run locally (pl-33 measured
   public Overpass at 149 s on a long corridor), or running the dev stack on the
   host itself. Do not fall back silently: a plan with no discovery looks like a
   thin trip, not like a missing service.
2. **Start the stack with the key outside the tree.** Give the key to the API
   process through its environment, from a mode-600 file outside the worktree,
   and delete that file at the end, as pl-40 did. Never put it in
   `tools/planner/.env`, and never print it: compare it by sha256 prefix. Check
   it first against the free `/v1/models` endpoint. Set the four
   `MODEL_PRICE_*` variables to Sonnet 5.5's rates so the run-cost report is in
   dollars. Start the stack with `setsid nohup` and a pid file. A dev server
   started from an agent's own shell dies with that shell, and stopping one
   with `pkill -f` takes out other sessions' servers too.
3. **The owner plans the trip:** intake, draft, then at least one re-plan of
   named days, one move or remove, one dates or budget edit, and one restore.
   That is the whole revision vocabulary (pl-42, pl-47). While the owner works,
   the agent records one Log row per run, read off the dev database's
   `plan_runs` and the plan's revisions, and totals it with pl-49's cost report
   (`node tools/planner/api/dist/report.js --days 1`). Each row has the run
   kind, which specialists ran, finds handed per kind, `coverage` entries,
   gaps, tokens, dollars and wall-clock. There is no HTTP route that lists a
   plan's runs, so read the database read-only and never write to it.
4. **Debrief.** Ask the owner one question at a time, with options wherever
   the answer is a choice: what was wrong, what was missing, what was slow, and
   what they would not trust without checking. Record every answer in their own
   words, plus the plan id and revision number it is about.
5. **Sort each problem into exactly one bucket:**
   - **defect.** File it with its reproduction: the brief's answers, the
     revision and the run id. A defect is never folded in here, because the
     reproduction is the deliverable.
   - **missing capability.** It goes in the Phase 5 section of the roadmap as
     a candidate, not as a ticket. Phase 5's build tickets are filed together
     after the debrief, and the owner chooses which.
   - **content** (a tree question, a limit in `limits.ts`, a prompt line). File
     it, arguing with the number or the wording rather than adding a branch.
   - **not a problem.** Write down why.
6. **Stop the stack by process group and delete the key file.** Commit the
   Log, the filed tickets, and the roadmap's Phase 5 candidates.

## Done when

- The Log has one row per run from step 3, with its id, kind, specialists,
  tokens, dollars and wall-clock, and the total trial cost.
- Every debrief answer appears in the Log next to its bucket and, where it
  has one, the id of the ticket it became.
- Every defect ticket filed names a plan and revision that reproduce it.
- The roadmap's Phase 5 section lists the missing-capability candidates, and the
  owner has been asked, with options, which become build tickets.
- No key appears anywhere in the diff:
  `git diff origin/main -- . | grep -c 'sk-ant-'` prints `0`. The key file is
  gone, and no planner dev process is left running.

## Log

**2026-10-27 — Filed.** The owner chose "plan Phase 5" over working the
backlog first (pl-64, and repo-131 → pl-65), and "use it on a real trip" as
the phase. Then "locally" over switching production, and "road trip, several
towns" as the shape. Measured at filing: production runs `scripted`
(`compose.planner.prod.yaml`); the code default model is Sonnet 5.5 `low`
(#464); `.claude/.keys` holds a `PLANNER=` line. How this machine reaches the
host's grounding services is not written down anywhere, which is why Build
step 1 measures it before anything else.
