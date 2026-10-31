---
id: lg-82
tool: ledger
title: Unseen characters in a household or person name reach the host's output
kind: fix
status: needs-decision
milestone: null
depends_on: [lg-77]
difficulty: standard
---

# lg-82 — Unseen characters in a household or person name reach the host's output

## Why

An address is checked against the characters no one can see or type back: the C0
controls and DEL (lg-52), the C1 controls and the zero-width characters (lg-57).
That set is `UNSEEN` in `tools/ledger/api/src/directory.ts`, and `readAddress` is
its only user. A name is checked for its trimmed length and for nothing else, on
every path that writes one, so a name can carry any of those characters, and the
host command prints it raw.

There are two kinds of name, and they are in different states:

- **A person's name is writable on main.** A member adds a person with `person` to
  `POST /api/households/:id/members` (`contract/src/api.ts:28`,
  `api/src/routes/households.ts:176`); the operator does the same with
  `household:ledger add` and `household:ledger member`. Every such path reaches
  `#readMember` (`directory.ts:869`), which checks the trim and the length of
  `person`, and no character. `addPerson` (`directory.ts:772`) and `renamePerson`
  (`directory.ts:452`) check the same and no more. `createHousehold`'s first person
  takes this path too, through `#readNamedMember` (`directory.ts:813`).
- **A household's name is not changeable on main.** `createHousehold` names every
  new household `NEW_HOUSEHOLD_NAME`, "Home" (lg-71), and `addHousehold`
  (`directory.ts:626`) has no caller under `api/src` on main; its callers are tests.
  lg-77's Why says a household's name "is set once, when it is created". A household
  made before lg-71 kept the name its admin typed, and `addHousehold`'s name checks
  (`directory.ts:626-641`) look at the trimmed length and no character, so such a row
  may hold an unseen character. Whether one does is not measured (Decision,
  question 3). lg-77's Build 2 adds `renameHousehold` "with the same name rule
  `addHousehold` applies (trimmed, 1 to 80 characters)", so a rename becomes a second
  way to write one when lg-77 merges. This ticket depends on lg-77 for that half.

The owner decided on 2026-10-31 to file one ticket covering both kinds of name,
rather than to fix it inside lg-77 now or to record it only. Which remedy, and for
which names, is the open decision below.

## Reproduction

The finding is lg-77's gate 1, pasted as the gate wrote it (severity low, lens
`nfr:security`). The gate ran it on lg-77's head `a87da359` (PR #686). **It was not
re-run for this ticket.** The commands below are run on main at `c7bdef21`.

> - **low** · no `Done when` line depends on it · `nfr:security` — a household's name takes any character after the trim: ESC, BEL, NUL, a newline, a name that is one U+200B. A member can now set it, and `household:ledger list` prints it raw: as ALEX, a rename to `ESC[2J ESC]0;pwned BEL Home` answers 200 and the `list` output holds the raw ESC byte. The same sink already takes a member-typed person name (`POST /members` with `person` starting with ESC answers 200, and `list` prints the ESC), so this ticket adds a second member-writable field to an existing path and opens none. The admin's taken-address sentence quotes the name too. **Open decision** (two remedies, not a `Done when`): (a) refuse the characters `UNSEEN` already names for addresses, in `renameHousehold` and `addHousehold`, which leaves person names as they are; (b) escape at the sinks, `list` and the sentence. Recommend (a) for household names now and a ticket for person names. Neither was run.

The same gate report also records, relayed here and not re-run: an interior
newline, a zero-width space, a NUL, a lone zero-width space and an HTML string are
each accepted with 200 and stored as typed through the rename routes. The HTML was
not rendered.

### Commands on main

Each command is run from the repository root; its output follows it.

1. `grep -rn UNSEEN tools/ledger/api/src`

```
tools/ledger/api/src/directory.ts:53:const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
tools/ledger/api/src/directory.ts:63:  return address !== undefined && !UNSEEN.test(address) ? address : undefined;
```

`UNSEEN` is not exported and is read only by `readAddress`. Nothing that checks a
name uses it.

2. `grep -rn "addHousehold(" tools/ledger/api/src`

```
tools/ledger/api/src/directory.ts:626:  addHousehold(household: Household & Change): Household {
```

3. `sed -n 869,877p tools/ledger/api/src/directory.ts`, the person-name reader

```
  #readMember(member: { address: unknown; person: unknown }): { address: string; person: string } {
    if (typeof member.address !== "string") refuse("The address is not a string.");
    if (typeof member.person !== "string") refuse("The person's name is not a string.");
    const address = readAddress(member.address);
    if (address === undefined) refuse(NOT_AN_ADDRESS);
    const person = member.person.trim();
    if (person === "" || person.length > 64) refuse("A person's name is 1 to 64 characters.");
    return { address, person };
  }
```

4. `sed -n 626,641p tools/ledger/api/src/directory.ts`, the household-name checks in `addHousehold`

```
  addHousehold(household: Household & Change): Household {
    const notAnId = (shown: string): never =>
      refuse(
        `A household id is a lowercase UUID, or one lowercase word of a to z, at most 32 letters, and not con, prn, aux or nul; ${shown} is not.`,
      );
    const notAName = (): never => refuse("A household's name is 1 to 80 characters.");
    // Typed strings, but a caller past the request schema can pass null, which
    // reached `.trim()` as a TypeError rather than these refusals (lg-24).
    // The type, not the value: String() throws on Object.create(null) and on an
    // object whose toString throws, and prints nothing useful for an array.
    if (typeof household.id !== "string") notAnId(typeof (household.id as unknown));
    if (typeof household.name !== "string") notAName();
    // lg-25: checked before the transaction opens, as the id and name are above.
    refuseUnlessChange(household);
    const id = household.id.trim();
    const name = household.name.trim();
```

5. `grep -rn "io.stdout\|io.stderr\|process.stdout.write\|process.stderr.write" tools/ledger/api/src`, every text output site

```
tools/ledger/api/src/household-command.ts:50:  io.stderr(`${message}\n\n${USAGE}`);
tools/ledger/api/src/household-command.ts:97:    io.stdout(USAGE);
tools/ledger/api/src/household-command.ts:119:    io.stdout(`Directory: ${config.directoryPath}\n\n`);
tools/ledger/api/src/household-command.ts:125:    io.stderr(`${appError.message}${reason}\n`);
tools/ledger/api/src/household-command.ts:145:        io.stdout(
tools/ledger/api/src/household-command.ts:155:        io.stdout(
tools/ledger/api/src/household-command.ts:164:        io.stdout(
tools/ledger/api/src/household-command.ts:171:        io.stdout(list(directory));
tools/ledger/api/src/household-command.ts:179:      io.stderr(`${appError.message}${cause instanceof Error ? ` (${cause.message})` : ""}\n`);
tools/ledger/api/src/household-command.ts:182:    io.stderr(`${appError.message}\n`);
tools/ledger/api/src/main.ts:67:  process.stderr.write(
tools/ledger/api/src/import-command.ts:75:  io.stderr(`${message}\n\n${USAGE}`);
tools/ledger/api/src/import-command.ts:211:    io.stdout(USAGE);
tools/ledger/api/src/import-command.ts:275:      io.stdout(
tools/ledger/api/src/import-command.ts:311:    io.stderr(`${appError.message}${reason}\n`);
tools/ledger/api/src/household-ledger.ts:11:  stdout: (text) => process.stdout.write(text),
tools/ledger/api/src/household-ledger.ts:12:  stderr: (text) => process.stderr.write(text),
tools/ledger/api/src/spending-backfill-command.ts:43:  io.stderr(`${message}\n\n${USAGE}`);
tools/ledger/api/src/spending-backfill-command.ts:79:    io.stdout(USAGE);
tools/ledger/api/src/spending-backfill-command.ts:120:      io.stdout(heading + run(booksPath, personId, io));
tools/ledger/api/src/spending-backfill-command.ts:127:      io.stdout(heading + run(copy, personId, io));
tools/ledger/api/src/spending-backfill-command.ts:137:    io.stderr(`${appError.message}${reason}\n`);
tools/ledger/api/src/import-ledger.ts:11:  stdout: (text) => process.stdout.write(text),
tools/ledger/api/src/import-ledger.ts:12:  stderr: (text) => process.stderr.write(text),
tools/ledger/api/src/spending-backfill-ledger.ts:11:  stdout: (text) => process.stdout.write(text),
tools/ledger/api/src/spending-backfill-ledger.ts:12:  stderr: (text) => process.stderr.write(text),
```

6. `grep -rn "shownName(\|membersListed(\|\.name}" tools/ledger/api/src`, every read of a shown name into text

```
tools/ledger/api/src/household-command.ts:68:        const shown = shownName(names, member.person);
tools/ledger/api/src/household-command.ts:73:        `${household.id}  ${household.name}`,
tools/ledger/api/src/household-command.ts:131:    shownName(directory.names(member.household), member.person);
tools/ledger/api/src/household-command.ts:146:          `Created the household ${household.id}, "${household.name}", with ${member.address} as ${shown(member)}.\n` +
tools/ledger/api/src/workbook-import.ts:643:  const shown: Shown = (person) => shownName(names, person);
tools/ledger/api/src/directory.ts:155:export function shownName(names: ReadonlyMap<string, string>, person: string): string {
tools/ledger/api/src/directory.ts:168:    shownName(names, one).localeCompare(shownName(names, other)) ||
tools/ledger/api/src/directory.ts:580:        const shown = shownName(this.names(request.household), person);
tools/ledger/api/src/directory.ts:785:        if (held.some((one) => one === name || shownName(names, one) === name)) {
tools/ledger/api/src/directory.ts:846:        held.find((person) => shownName(names, person) === typed) ??
tools/ledger/api/src/directory.ts:850:    const shownAs = new Set(held.map((person) => shownName(names, person)));
tools/ledger/api/src/directory.ts:903:      const shown = shownName(this.names(household), person);
tools/ledger/api/src/directory.ts:990:    const shown = shownName(this.names(standing.household), standing.person);
tools/ledger/api/src/routes/households.ts:86:    .map(({ address, person }) => ({ address, person, name: shownName(names, person) }));
tools/ledger/api/src/routes/households.ts:91:  const name = shownName(directory.names(member.household), member.person);
tools/ledger/api/src/routes/households.ts:132:      name: shownName(names, person),
tools/ledger/api/src/routes/households.ts:317:      name: shownName(directory.names(id), person),
tools/ledger/api/src/import-command.ts:135:    found.people.find((person) => shownName(found.names, person) === typed) ??
tools/ledger/api/src/import-command.ts:141:export function membersListed(found: DirectoryPeople): string {
tools/ledger/api/src/import-command.ts:142:  return found.people.map((person) => shownName(found.names, person)).join(", ");
tools/ledger/api/src/import-command.ts:164:        directory.heldPeople(household).map((person) => [person, shownName(names, person)]),
tools/ledger/api/src/import-command.ts:245:        `--as names "${as}", who is not a member of ${household} in the household directory (${membersListed(found) || "it has none"}).`,
tools/ledger/api/src/spending-backfill-command.ts:109:        `--as names "${as}", who is not a member of ${household} in the household directory (${membersListed(found) || "it has none"}).`,
tools/ledger/api/src/routes/rules.ts:57:  const shown = new Map(people.map((person) => [person, shownName(names, person)]));
```

7. The trim check. `unseen-trim.mjs` is written to the scratch directory and run with `node`; its
   source is below so the check can be run anywhere.

```js
// unseen-trim.mjs: does the UNSEEN set refuse these names after String.prototype.trim()?
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
const samples = ["\u001b", "\u0007", "\u0000", "\u200b", "\ufeff", "a\nb"];
const rows = samples.map((text) => {
  const trimmed = text.trim();
  return [trimmed.length, UNSEEN.test(trimmed)];
});
console.log(JSON.stringify(rows));
```

```
$ node unseen-trim.mjs
[[1,true],[1,true],[1,true],[1,true],[0,false],[3,true]]
```

The rows are ESC, BEL, NUL, U+200B, U+FEFF and `a` LF `b`. `trim()` keeps ESC, BEL,
NUL and U+200B, so each survives the length rule and the set refuses it. U+FEFF
is removed by `trim()` and then fails the length rule as an empty name. An interior
newline is refused by the set, because LF is in `\u0000-\u001f`.

8. `grep -rn "dangerouslySetInnerHTML\|innerHTML" tools/ledger/web/src; echo "exit=$?"`

```
exit=1
```

The `list` reproduction, `npm run household:ledger -- list` after a rename, needs a
build of `api`'s `dist` and was not run here.

### Sinks

Each sink is a place a stored or typed name is written out. "Terminal" means the
host command writes it to stdout or stderr, where an escape byte does its harm.

Terminal, from the output sites in command 5 and the name reads in command 6:

- `household-command.ts:68-70`, `list`: each person's shown name, with the id beside
  it when they differ.
- `household-command.ts:73`, `list`: each household's name. A household made on main
  is "Home"; one made before lg-71 keeps the name it was given, and a rename after
  lg-77 writes another.
- `household-command.ts:146`, `add`: the household's name and the first person's
  shown name.
- `household-command.ts:156`, `member`: the shown name.
- `household-command.ts:165`, `remove`: the shown name.
- `household-command.ts:125`, `:179`, `:182`: stderr, `appError.message`, which carries
  the directory's sentences below.
- `directory.ts:990-995`, `#refuseTaken`: the admin's taken-address sentence, `as
  ${shown}`. The admin's routes do not catch it: `adminMembers`
  (`routes/households.ts:231`) and `adminMemberAddress` (`:262`) return the message,
  and `packages/core/src/errors.ts:263-270` sends it as `message`. lg-77's Build 7
  changes the household named in it from its id to its name.
- `directory.ts:785-788`, `addPerson`: `PERSON_NAME_TAKEN` quotes the typed name.
- `directory.ts:580-589`, the retire refusals: `${shown}`. Reached through the
  admin's retire route, not a host command.
- `import-command.ts:141-142` and `:245`, and `spending-backfill-command.ts:109`:
  `membersListed` names every member in the `--as` refusal, on stderr through `usage`.
- `import-command.ts:275` and `:301`: the import report. `workbook-import.ts:643`
  builds it with `shown` at many lines, for example 544, 593, 600, 606, 710, 729,
  742, 753, 801 and 833.
- `spending-backfill-command.ts:120` and `:127`: stdout of the backfill report. I did
  not check whether that report names a person; it names categories where I read it.

Not terminal:

- `routes/households.ts:86, 91, 109, 132, 317`, `routes/rules.ts:57` and
  `routes/workbook.ts:34`: JSON. JSON escapes the C0 controls, so ESC, BEL and NUL
  come out as `\u` escapes, and it passes DEL, the C1 controls and the zero-width
  characters raw.
- `web/src`: no `innerHTML` and no `dangerouslySetInnerHTML` (command 8), so the
  text is rendered as text. The web is a display question for a zero-width name, not
  an injection one.

Not in scope: `household-command.ts:50`, `usage`, echoes what the operator typed as
the command (`There is no command "…"`). A typed argument is not a stored name.

## Decision — open

Three questions. Each is marked on its own line, `open` until an answer names who
gave it and when.

**1. Which remedy — open.**

- **(a) Refuse the unseen characters at write time.** The set is the one
  `readAddress` already uses (`directory.ts:53`). Costs: one check in each write path
  the answer to question 2 covers, and a refusal sentence for each, raised as
  `BAD_REQUEST` as the name rules already are. Rows already stored keep their
  characters, so the sinks still print them until question 3 is acted on. A SQL
  `CHECK` cannot carry the set: `db/directory-schema.ts` lines 33–35 note that `GLOB`
  stops at a NUL. The set also refuses an interior newline and tab (command 7), which
  a name may never need.
- **(b) Escape at every text sink.** The sinks are listed above. Costs: an escape
  helper and one call at each text sink, and every new sink has to remember it. It
  stops terminal injection, which is what `list` does with ESC and BEL. It does not
  stop an invisible name from reading as a blank or as another name, which is what a
  zero-width character does on a screen; the web would need a rule of its own.
- **Both.** (a) for new writes, and (b) for the rows already stored.

The gate's recommendation, recorded as the gate's and not as an answer: (a) for
household names now, when lg-77 lands, and a ticket for person names.

**2. Which names this ticket's build covers — open.** The owner's decision of
2026-10-31 is one ticket for both kinds of name. What is open is whether its build
ships both halves together, or whether the household half ships when lg-77 lands and
the person half ships as a ticket of its own. The gate recommends the split, which
the one-ticket decision does not. Options: (i) one build for both kinds of name, after
lg-77; (ii) the household half after lg-77, and the person names in a ticket filed
then. Neither is chosen.

**3. What the stored rows hold — open, not measured.** Whether a live directory
already holds a name with an unseen character decides whether (b), or a read-side
check on stored rows, is needed beside (a). It is not measured: the live directories
are the owner's data, and this filing had no access to them. The measurement reads
each `households.name` and `person_names.name` row of the live directory, and tests
it against the set at `directory.ts:53`.

## Build

Not dispatchable until questions 1 and 2 are answered. The answer is recorded on
this ticket first, with who gave it, the date and the options it was chosen from,
and `status` becomes `ready` in that commit, before any source change.

Under (a), in `api/src/directory.ts`:

1. Move the set in `UNSEEN` into a helper that the address rule and the name rules
   both call. Keep the lg-52 and lg-57 comment with it.
2. `renameHousehold` (lg-77, once merged) and `addHousehold`: after the trim and the
   1-to-80 check, refuse a name that matches the set.
3. If question 2 covers person names: `addPerson`, `renamePerson` and `#readMember`,
   after the trim and the 1-to-64 check. `#readMember` is what `addMember`,
   `addMemberByName` and `createHousehold`'s first person all reach.
4. One test per path, in `api/test/directory.test.ts`, beside the existing address
   refusal tests. `households.test.ts` and `household-command.test.ts` cover the
   routes and the host command.

Under (b):

5. One escape helper that writes each unseen character as a visible `\uXXXX`, called
   at each terminal sink under Sinks.
6. A test that `household:ledger list` prints no raw C0 or DEL byte for a name with
   ESC, in `api/test/household-command.test.ts`, and a test for the admin's sentence in
   `api/test/households.test.ts`.

Under question 3: a migration or a read-side check, whichever the answer names.

The web is not in the build. Its sinks are JSON and React-escaped, so a web change
waits for a separate answer.

## Done when

- The Decision heading reads `answered <date> by <who>` for each of the three
  questions that are answered, with the options it was chosen from, and `status` is
  `ready` in the commit that records the first answer.
- Each name path the answer covers refuses or escapes an ESC, a BEL, a NUL, a U+200B
  and an interior newline, with one test per path named in the Build.
- A stored row that holds an unseen character behaves as the answer to question 3
  says, with a test.
- lg-77 has merged before the build starts (`depends_on`).
- `npm run check` and `npm test -- --project ledger` pass on the build's branch.

## Log

- **2026-10-31, filed.** Filed by a maintenance builder from lg-77's gate 1 finding,
  on main `c7bdef21`. The owner's decision of 2026-10-31 is one ticket covering both
  kinds of name. The other options were to record only, or to fix inside lg-77 now.
  The facts under Reproduction were read on main with grep, sed and one scratch
  script. No build was run, and the `list` reproduction was not re-run; the gate ran
  it on `a87da359`.
- **The gate's recommendation is recorded, not answered.** (a) for household names
  now, and a ticket for person names. It disagrees with the owner's one-ticket
  decision about the split, so question 2 carries it.
- **Placeholder.** `difficulty: standard` is a placeholder. The owner rates it.
- **Depends on lg-77** (PR #686, not merged at filing). Its Build 2 and Build 7 are
  quoted from `tools/ledger/docs/work/lg-77-rename-a-household.md` on main. The PR's
  head was not read.
- **Corrected before the gate.** The first draft said every household on main is
  named "Home". That holds for households made on main; one made before lg-71 keeps
  the name its admin typed, as lg-71's Why and lg-77's Why both say. The check on
  the path that writes a name today does not look at unseen characters
  (`directory.ts:626-641`); the pre-lg-71 path was not read. Whether such a row holds
  one is measured by question 3, not here.
