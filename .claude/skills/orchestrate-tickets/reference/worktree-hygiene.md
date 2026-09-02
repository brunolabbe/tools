# Worktree hygiene

Worktrees auto-clean only when unchanged. A reviewer that writes into its worktree
leaves it dirty, so it never cleans. The reference session leaked **7.0 GB across
20 worktrees**.

Two rules, both required:

- Reviewers **return** their section as text; they never write it to a file.
- Remove each worktree once its ticket is **finished** — merged, or abandoned —
  not when its PR opens: `git worktree remove --force <path>`, then
  `git worktree prune`, then delete the `review-*` branch.

Audit with `git worktree list` and `du -sh .claude/worktrees` when a batch feels
long. Before removing, check `git status --porcelain` and `git log @{u}..` in each.

**Branch refs leak even when the directories do not.** Removing a worktree leaves
its `worktree-agent-*` branch behind, and they accumulate across sessions — the
second session found **51** of them while its own disk usage was back at the 4 KB
baseline. Sweep them at the end of a batch, but **check each for unmerged commits
first** and delete only those with none:

```bash
for b in $(git branch --list 'worktree-*' | sed 's/^[* ]*//'); do
  [ "$(git log --oneline origin/main.."$b" | wc -l)" -eq 0 ] && git branch -D "$b"
done
```

Of those 51, seven carried real commits — including one belonging to a *live
worktree in another session*, which `git branch -D` refuses to delete, so the
guard is belt-and-braces rather than the only protection. Never blanket-delete by
name pattern.

**Removing a worktree also makes its agent unresumable**, which is why the second
rule waits for the ticket rather than the PR. A follow-up sent to a builder whose
worktree is gone is refused — *its worktree no longer exists* — and the only way
forward is a fresh agent with the whole context rebuilt by hand, which costs far
more than the disk did. An open PR still takes review comments, a rebase and
follow-ups, and every one of those wants the agent that wrote it. Removing earlier
is sometimes the right trade for 7 GB; make it a choice rather than discover it an
hour later. The third session held every builder worktree to merge and paid almost nothing for it — 105 MB peak across a five-ticket batch, against the 7 GB above, because reviewers returned text and finished tickets were swept promptly. It is worth being precise that this is evidence about **cost, not about timing**: every branch in that batch opened its PR in its final builder round, so none was ever resumed afterwards and the trade was never actually tested. Holding to merge is cheap insurance; that batch did not have to collect on it.

**Split the rule by role: hold builders, retire reviewers early.** The unresumable
cost is real for a *builder*, whose branch may still need a rebase or a follow-up.
It is near zero for a *reviewer* the moment its record is safe, and the test for
that is one condition, not three: **the record is pushed** — in the ticket commit
and on the PR thread — somewhere you do not have to be alive to recover it. The
copy you saved when it returned is redundancy, and the least durable of the three.
At that point the worktree holds nothing you cannot get back, and reviewer trees
are the ones that never auto-clean, because reviewing dirties them.

The fourth session ran this deliberately: it retired each reviewer tree as its
record landed and held all four builder trees, going 133 MB → 61 MB mid-batch with
no loss of optionality. (Held *to merge* is the intent; nothing had merged when
that was written, so like the third session's figure this is evidence about cost,
not about whether holding ever paid.) It kept exactly one reviewer alive past its
report — the one whose builder had been told to *reproduce* a finding before
accepting it, because a builder that comes back "this does not reproduce" is a
question only that reviewer can answer. That is the test: **hold a reviewer only
while a specific open question could go back to it.**

**"Alive" is the wrong word, and it misled the first run of this loop.** No agent
sits listening between messages; both end their turn after sending, and
`SendMessage` wakes a `completed` sibling back into its own context. What has to
survive is therefore the **agent record and its worktree**, so a wake has
something to resume into — removing a reviewer's tree while the builder may still
answer it is what actually closes the channel.

**That exception is now the common case, not the rare one.** The reviewer sends
its findings to the builder directly and fields the pushback itself, so "a
specific open question could go back to it" is true for every gate until the
builder is done answering. Retire a reviewer when its record is pushed **and** the
exchange has ended — not on the record alone. The fourth session's 133 MB → 61 MB
saving came from retiring four reviewers at report time; expect to keep them a
round longer now and to give some of that back. That is the price of the hop this
removes, and it is disk rather than context.

Before removing any of them, confirm what the tree actually holds. A reviewer that
checked out the builder's branch shows commits ahead of `main` — those are the
*builder's*, already pushed, not review work. One command settles it:
`git merge-base --is-ancestor "$(git -C "$w" rev-parse HEAD)" origin/<builder-branch>`.
Sweep the leftover `worktree-agent-*` ref at the same time; removal leaves it
behind, and that is the leak that reached 51 stale branches in the second session.

### When every agent dies at once

A session usage limit killed all five in-flight gates simultaneously in the fourth
session, and the fifth ended mid-batch on a deliberate machine shutdown. It is worth planning for because the recovery is cheap and the wrong
recovery is expensive.

- **A snapshot of a live worktree is a moment, not a state — and it goes stale
  while you write it.** Facing a shutdown, the fifth session's orchestrator captured
  each builder's uncommitted diff into a handover file. Both were wrong within
  minutes: one builder was recorded with **one** dirty file and had **three**,
  because it kept working after the capture; the other was written up as "assume
  the work is lost" when it was in fact complete. **The worktree is the artefact;
  a transcription of it is a second thing to keep true.** So capture *pointers* —
  the worktree path, the branch, the pushed tip — and re-read the tree on the way
  back in. Copy content out only for what dies with the session and exists nowhere
  else: a reviewer's returned report is the clear case, an uncommitted diff is not.
- **Prefer pushing over describing.** The best thing that happened under that
  shutdown was a builder told to secure its work choosing to commit and push the
  **gate record first**, ahead of its own half-finished code fixes, under a `docs`
  type so it released nothing. That is the right instinct to name in the message:
  *push the thing that exists nowhere else; the code you can rewrite.*
- **Check for damage before resuming anything.** Agents die at an arbitrary
  instant, so one may have been mid-mutation with a source file still mutated, or
  one step from pushing a scratch branch. Confirm the shared checkout is clean,
  every builder branch is intact at its reported tip, and nothing stray reached
  `origin` (`git ls-remote --heads origin`). All four checks were clean that time;
  the point is that they are four commands and you do not get to assume.
- **Resume by message, do not re-dispatch.** A message resumes the agent from its
  own transcript and keeps its partial work — one gate was on its final confirming
  run, another had already reached "found something". Re-dispatching pays a fresh
  context reload and throws that away.
- **Every resume must re-establish the positive control.** This is the part that
  matters: a gate that died mid-mutation may be sitting on a mutated tree, so any
  result it was holding is worthless. Say it explicitly — *a result carried across
  an interruption is not evidence* — and have it restore to the branch tip and
  re-run the control before continuing.
- **Tighten the destructive step on the way back in.** The gate authorised to push
  a scratch branch was told to delete it as its *immediate next action* after
  capturing output rather than at the end of its review, so a second interruption
  could not strand it on `origin`.

### Give a new worktree its dependencies without installing them

A fresh worktree has no `node_modules`, so every agent pays `npm install` plus
`npm run build` before it can read a test result — minutes each, and in the
reference session two dozen agents each paid it. A **selective symlink farm**
built from the shared checkout's `node_modules` removes the install half in well
under a second and costs tens of kilobytes instead of hundreds of megabytes. The
build still has to run.

The shape, and the whole of it is *why*:

- **Symlink each third-party entry individually**, absolute, into the worktree's
  own real `node_modules` directory.
- **Include the dotfiles** — `.bin` above all. A `*` glob silently misses it and
  every binary the scripts call disappears with it; enumerate with `ls -A`.
- **But create the workspace scopes — `@planner`, `@downloader`, `@webtools` —
  as real directories**, re-creating each inner link with its *original relative
  target*.

That last rule is the load-bearing one. npm writes workspace links relatively
(`@planner/api -> ../../tools/planner/api`), and a relative link resolves from
where it **physically** lives. Inside a real directory in the worktree it lands
on the worktree's own `tools/planner/api`, which is the point. Hence the first
trap:

- **Do not symlink `node_modules` wholesale.** One command, silently wrong: the
  worktree's `node_modules` *is* the shared one, so every workspace link resolves
  into the **shared checkout** — an agent editing a contract then typechecks
  against the other tree's copy of it, and the suite goes green on the wrong code.
  Verified: under a wholesale link `@planner/api` resolves to
  `/workspaces/tools/tools/planner/api` rather than into the worktree.
- **Hard links are not the escape either.** In this container `node_modules` is
  its own mount, so `cp -al` fails on the first file with
  `Invalid cross-device link`. Check with `df` before assuming otherwise; the
  mount layout is specific to this environment, while the relative-link reasoning
  above is not.

Verify a farm the same way rather than trusting it: resolve one workspace link
with `readlink -f` and confirm it points inside the worktree, then run one real
suite there. A farm that is wrong is wrong *quietly*, which is the only reason it
needs a check at all.
