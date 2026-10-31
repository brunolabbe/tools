---
id: lg-82
tool: ledger
title: Unseen characters in a household or person name reach the host's output
kind: fix
status: ready
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

The commands under Reproduction are quoted as they were run on `main` at `c7bdef21`.
Every other `file:line` in this ticket is on `main` at `d7cd223f`, after lg-77 merged
(#686): its `renameHousehold` made `directory.ts` longer, so the Build names symbols and
the lines below were re-resolved by symbol on 2026-10-31 by the builder.

There are two kinds of name, and they are in different states:

- **A person's name is writable on main.** A member adds a person with `person` to
  `POST /api/households/:id/members` (`contract/src/api.ts:28`,
  `api/src/routes/households.ts:176`); the operator does the same with
  `household:ledger add` and `household:ledger member`. The paths reach `#readMember`
  (`directory.ts:1048`), through `#readNamedMember` (`directory.ts:992`) from
  `addMemberByName` and `createHousehold`, which checks the trim and the length of
  `person`, and no character. `addPerson` (`directory.ts:937`) and `renamePerson`
  (`directory.ts:617`) check the same and no more.
- **A household's name is not changeable on main.** `createHousehold` names every
  new household `NEW_HOUSEHOLD_NAME`, "Home" (lg-71), and `addHousehold`
  (`directory.ts:791`) has no caller under `api/src` on main; its callers are tests.
  lg-77's Why says a household's name "is set once, when it is created". A household
  made before lg-71 kept the name its admin typed, and `addHousehold`'s name checks
  (`directory.ts:791-808`) look at the trimmed length and no character, so such a row
  may hold an unseen character. Whether one does is not measured (Decision,
  question 2). lg-77's Build 2 adds `renameHousehold` "with the same name rule
  `addHousehold` applies (trimmed, 1 to 80 characters)", so a rename becomes a second
  way to write one when lg-77 merges. This ticket depends on lg-77 for that half.

The owner decided on 2026-10-31 to file one ticket covering both kinds of name,
rather than to fix it inside lg-77 now or to record it only. Which remedy is the open
decision below.

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

4. `sed -n 626,643p tools/ledger/api/src/directory.ts`, the household-name checks in `addHousehold`, through the length test

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
    if (!isHouseholdId(id)) notAnId(`"${id}"`);
    if (name === "" || name.length > 80) notAName();
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
tools/ledger/api/src/main.ts:74:      reason: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
tools/ledger/api/src/import-command.ts:135:    found.people.find((person) => shownName(found.names, person) === typed) ??
tools/ledger/api/src/import-command.ts:141:export function membersListed(found: DirectoryPeople): string {
tools/ledger/api/src/import-command.ts:142:  return found.people.map((person) => shownName(found.names, person)).join(", ");
tools/ledger/api/src/import-command.ts:164:        directory.heldPeople(household).map((person) => [person, shownName(names, person)]),
tools/ledger/api/src/import-command.ts:245:        `--as names "${as}", who is not a member of ${household} in the household directory (${membersListed(found) || "it has none"}).`,
tools/ledger/api/src/spending-backfill-command.ts:109:        `--as names "${as}", who is not a member of ${household} in the household directory (${membersListed(found) || "it has none"}).`,
tools/ledger/api/src/routes/rules.ts:57:  const shown = new Map(people.map((person) => [person, shownName(names, person)]));
```

The `main.ts:74` line is an Error's class name and text in a startup failure, not a
stored name; the grep prints it because `.name}` matches.

7. The trim check, `unseen-trim.mjs`, run with `node`. The source is below so the check runs anywhere.

```js
// unseen-trim.mjs: does the UNSEEN set refuse these names after String.prototype.trim()?
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
const samples = ["\u001b", "\u0007", "\u0000", "\u200b", "\ufeff", "a\nb", "a\tb"];
const rows = samples.map((text) => {
  const trimmed = text.trim();
  return [trimmed.length, UNSEEN.test(trimmed)];
});
console.log(JSON.stringify(rows));
```

```
$ node unseen-trim.mjs
[[1,true],[1,true],[1,true],[1,true],[0,false],[3,true],[3,true]]
```

The rows are ESC, BEL, NUL, U+200B, U+FEFF, `a` LF `b` and `a` TAB `b`. `trim()`
keeps ESC, BEL, NUL and U+200B, so each survives the length rule and the set refuses
it. U+FEFF is removed by `trim()` and then fails the length rule as an empty name.
An interior newline and an interior tab are refused by the set, because both are in
`\u0000-\u001f`.

8. `grep -rn "dangerouslySetInnerHTML\|innerHTML" tools/ledger/web/src; echo "exit=$?"`

```
exit=1
```

The `list` reproduction, `npm run household:ledger -- list` after a rename, needs a
build of `api`'s `dist` and was not run here.

9. `grep -n "CREATE TRIGGER \(households\|person_names\)_never" tools/ledger/api/src/db/directory-schema.ts`, the immutability triggers on main

```
102:  CREATE TRIGGER households_never_updated BEFORE UPDATE ON households
104:  CREATE TRIGGER households_never_deleted BEFORE DELETE ON households
117:  CREATE TRIGGER households_never_replaced BEFORE INSERT ON households
216:  CREATE TRIGGER person_names_never_updated BEFORE UPDATE ON person_names
218:  CREATE TRIGGER person_names_never_deleted BEFORE DELETE ON person_names
220:  CREATE TRIGGER person_names_never_replaced BEFORE INSERT ON person_names
378:  CREATE TRIGGER households_never_updated BEFORE UPDATE ON households
380:  CREATE TRIGGER households_never_deleted BEFORE DELETE ON households
382:  CREATE TRIGGER households_never_replaced BEFORE INSERT ON households
```

The `people` table has the same three kinds (`people_never_updated`,
`people_never_deleted`, `people_never_replaced`, lines 424–428), and `memberships`
has `memberships_never_updated` and `memberships_never_deleted` (lines 98 and 100).
Those lines are in the `CREATE TRIGGER` listing of `directory-schema.ts` that the
Reproduction's command 9 was taken from; the listing was run for this round.

10. `grep -n "addMemberByName\|#admitByName(\|this.#admit(\|#refuseTaken(\|  #admit(\|#readNamedMember(\|#readMember(" tools/ledger/api/src/directory.ts`, the write path from the host command down to the sentences

```
656:   * The first person is a new one, as `addMemberByName` makes one (lg-76): a
670:    const draft = this.#readNamedMember(household);
677:        const member = this.#admitByName({ household: made.id, ...draft }, household);
703:   * command call `addMemberByName`. It stays, as `addHousehold` stays for lg-71,
717:    const draft = this.#readMember(member);
723:        return this.#admit({ household: member.household, ...draft }, member);
742:  addMemberByName(
750:    const draft = this.#readNamedMember(member);
756:        return this.#admitByName({ household: member.household, ...draft }, member);
764:   * `person`, as `addMemberByName` makes a new person (lg-76). The person and
769:   * `addMemberByName` under the name they are shown by, or `addMember` under
813:  #readNamedMember(member: { address: unknown; person?: unknown }): {
823:    const { address, person } = this.#readMember({
836:  #admitByName(
848:      if (found !== undefined) return this.#admit({ household, address, person: found }, change);
858:    const added = this.#admit({ household, address, person }, change);
869:  #readMember(member: { address: unknown; person: unknown }): { address: string; person: string } {
884:  #admit(member: Member, change: Change): Member {
887:    if (standing !== undefined) this.#refuseTaken(standing);
975:        if (taken !== undefined) this.#refuseTaken(taken);
989:  #refuseTaken(standing: Membership): never {
```

`#readMember` is reached directly by `addMember` (line 717) and through
`#readNamedMember` (lines 670 and 750) by `createHousehold` and `addMemberByName`.
`addMember` has no caller under `api/src` (command 11), so the last two are live.
`#admit` (884) is reached by `addMemberByName` for a found person (848) and a new one
(858), and it refuses an address already in a household through `#refuseTaken`
(887).

11. `grep -rn "addMember(" tools/ledger/api/src`

```
tools/ledger/api/src/directory.ts:706:  addMember(member: { household: string; address: string; person: string } & Change): Member {
```

12. `grep -n "retiring at the next close\|retired from the books\|Another person in this household\|is shown as" tools/ledger/api/src/directory.ts`, the refusal sentences that quote a name

```
475:            `Another person in this household is shown as "${name}", or has it as their id.`,
489:  /** Whether anyone but `person` is shown as `name` now or has it as their id. */
583:            refuse(`${shown} is already retired, or retiring at the next close.`);
895:          `Another person in this household is shown as "${person}". Pick them from the list to add an email for them.`,
906:          ? `${shown} is retiring at the next close. Keep them in first, then add the email.`
907:          : `${shown} is retired from the books. Bring them back, and add the email once the next close has applied the return.`,
```

Line 489 is a comment. Line 895 is in `#admit`'s branch for a person not yet held,
which only `addMember` reaches, so it is not live (command 11). Lines 906–907 are in
`#admit` for a held person who is retiring or retired, which `household:ledger member`
reaches for a found person (command 10).

13. `grep -n "shown(\|map(shown)\|, shown)" tools/ledger/api/src/workbook-import.ts`, every line that reads the report's `shown`

```
544:    label: `${shown(first.personId)} − ${shown(second.personId)}`,
558:    rows.push([`mortgage: ${shown(person.personId)}'s own money`, person.ownCents, found]);
560:  const gapExpected = gapOf(expected.mortgage.own, shown);
561:  const gapLedger = gapOf(ledger.own, shown);
593:    const payer = shown(deposit?.personId ?? only?.fromId ?? "");
600:      (transfer) => `${shown(transfer.fromId)} to ${shown(transfer.toId)} ${money(transfer.cents)}`,
606:      : `${deposits.map((each) => `${shown(each.personId)} deposits ${money(each.depositCents)}`).join(", ")} (net ${direct === "" ? "nothing" : direct})`;
661:      `--as names "${options.personId}", who is not one of the household (${people.map(shown).join(", ") || "nobody is in the directory"}).`,
710:      `  corrected: ${movement.sheet} row ${String(movement.row)}, ${was.bucket} ${was.personId === null ? "joint" : shown(was.personId)} → ${movement.bucket} ${movement.personId === null ? "joint" : shown(movement.personId)}: ${movement.correction ?? ""}`,
729:          : `${settlement.formula}, ${shown(settlement.payerId)} deposited ${money(settlement.depositCents)}`;
733:        : `, settled at ${period.ratio.map((share) => `${shown(share.personId)} ${percent(share.partsPerMillion)}`).join(", ")}`;
742:        ? `  not paid in the workbook: ${deposit.sheet} asked ${shown(deposit.payerId)} for ${money(deposit.askedCents)}, and no deposit of that amount by ${shown(deposit.payerId)} is in the year sheets from ${deposit.from}; check it before --write`
743:        : `  paid: ${deposit.sheet}'s ${money(deposit.askedCents)} by ${shown(deposit.payerId)}, ${deposit.paid.sheet} row ${String(deposit.paid.row)}, ${deposit.paid.date}`,
753:      `  salaries (Accueil): ${reading.salaries.map((salary) => `${shown(salary.personId)} ${money(salary.amountCents)}`).join(", ")}`,
769:        `  ratio from ${ratio.from}: ${ratio.shares.map((share) => `${shown(share.personId)} ${percent(share.partsPerMillion)}`).join(", ")} (${ratio.accueil ? "Accueil's salaries" : "the corrections file"})`,
783:    const { lines, failed } = compare(expected, ledger, shown);
801:            `The stored row ${describeStored(row)} is filed ${row.bucket} ${row.person_id === null ? "joint" : shown(row.person_id)}; the workbook files it ${movement.bucket} ${movement.personId === null ? "joint" : shown(movement.personId)}.`,
820:        `  books (cumulative, the catch-up folded in): ${describeSettlement(open.settlement, shown)}`,
825:          `  workbook (${reading.open?.sheet ?? ""}, this period alone, ${asked.formula}): ${asked.payerId === null ? "nobody owes" : `${shown(asked.payerId)} deposits ${money(asked.depositCents)}`}`,
833:      say(`  mortgage: ${shown(person.personId)}'s own money  ${money(person.ownCents)}`);
```

That is 20 lines, and all of them read the closure declared at line 643
(`const shown: Shown = (person) => shownName(names, person)`). Lines 560, 561, 783 and
820 pass it to `gapOf`, `compare` and `describeSettlement`, which format the names
they are given. Line 661 is a problem line, and the report prints every problem as
`FAILED` (`workbook-import.ts:841`), so it reaches the import's stdout.

14. `sed -n 134,146p tools/ledger/api/src/spending-backfill.ts`, the backfill report

```
function reportOf(result: Omit<BackfillResult, "report">): string {
  const lines: string[] = [];
  const total = result.filled.reduce((sum, one) => sum + one.count, 0);
  lines.push(`Filled: ${String(total)}`);
  for (const one of result.filled) {
    lines.push(`  ${String(one.count)} ${where(one.kind)} "${one.text}" -> ${one.category}`);
  }
  lines.push("", "Left uncategorised, for a person to place:");
  for (const one of result.left) {
    lines.push(`  ${String(one.count)} ${where(one.kind)} "${one.text}"`);
  }
  lines.push(`  ${String(result.bareLines)} card lines with no text`);
  return `${lines.join("\n")}\n`;
```

It prints counts, a bank row's or card line's text and a category, and no person's
name. A bank row's text is not a name, so it is outside this ticket's scope.

15. `grep -rnE "\blog(ger)?\.(info|warn|error|debug|trace|fatal)" tools/ledger/api/src`, every log call

```
tools/ledger/api/src/books.ts:172:      this.#logger.warn("a new member's name could not be enrolled yet; the next request retries", {
tools/ledger/api/src/books.ts:189:        this.#logger.error("a household's books could not be opened", {
tools/ledger/api/src/books.ts:246:      this.#logger.warn("a household's names could not be enrolled yet; the next request retries", {
tools/ledger/api/src/main.ts:20:  context.logger.info("listening", {
tools/ledger/api/src/main.ts:31:      context.logger.warn("second signal received; exiting immediately", { signal });
tools/ledger/api/src/main.ts:35:    context.logger.info("signal received", { signal });
tools/ledger/api/src/main.ts:38:      context.logger.error("shutdown timed out; exiting", { graceMs: SHUTDOWN_GRACE_MS });
tools/ledger/api/src/main.ts:50:        context.logger.error("shutdown failed", { error: String(error) });
tools/ledger/api/src/routes/workbook.ts:72:      context.logger.info("a workbook was described", {
tools/ledger/api/src/routes/workbook.ts:91:      context.logger.info("a described CSV was stored", {
tools/ledger/api/src/routes/workbook.ts:95:    } else context.logger.info("a described workbook was imported");
tools/ledger/api/src/server.ts:145:    logger.warn(
tools/ledger/api/src/server.ts:250:      logger.info("shutting down");
tools/ledger/api/src/server.ts:254:      logger.info("shutdown complete");
tools/ledger/api/src/server.ts:271:    logger.info("no receipt reader: ANTHROPIC_API_KEY is not set, so receipts are typed by hand");
tools/ledger/api/src/server.ts:274:  logger.info("receipts are read by a model when a person asks", { model });
tools/ledger/api/src/server.ts:291:    logger.info("no layout describer: ANTHROPIC_API_KEY is not set, so no workbook is described");
tools/ledger/api/src/server.ts:294:  logger.info("a workbook's layout is described by a model when a person asks", {
tools/ledger/api/src/server.ts:326:    if (status >= 500) context.logger.error("request failed", fields);
tools/ledger/api/src/server.ts:327:    else context.logger.info("request rejected", fields);
tools/ledger/api/src/rate-limit.ts:105:    logger.warn("rate limited", {
tools/ledger/api/src/routes/periods.ts:109:      context.logger.warn(
tools/ledger/api/src/routes/web.ts:51:    context.logger.warn("WEB_DIR is set but holds no index.html; the UI will not be served", {
tools/ledger/api/src/routes/web.ts:76:  context.logger.info("serving the web UI", { webDir: root });
tools/ledger/api/src/access.ts:229:      this.#logger.warn("access keys could not be fetched", { reason, ...fields });
tools/ledger/api/src/access.ts:304:      logger.info("access identity is in no household", { email });
tools/ledger/api/src/access.ts:316:    logger.warn("DEV_IDENTITY is set; every request is this address and no token is read");
tools/ledger/api/src/access.ts:322:    logger.warn("ACCESS_TEAM and ACCESS_AUD are not set; every API route but health is refused");
tools/ledger/api/src/access.ts:325:        logger.info("access token refused", { reason: "not-configured" satisfies Refusal });
tools/ledger/api/src/access.ts:387:        logger.info("access token refused", { reason: error.reason });
```

Most fields are ids, counts, codes, flags and paths. Three calls carry the text of an
error or a token's address: `books.ts:189` (`error.message`), `main.ts:50`
(`String(error)`) and `access.ts:304` (`email`). `server.ts:326–327` logs `fields`,
which include the request's `url`. `main.ts:67–74` writes a JSON startup failure with
the error's `reason`, which this ticket does not trace further. None of these reads a
stored person or household name. The one that does is `rate-limit.ts:105`, in
command 16.

16. `sed -n 57,69p tools/ledger/api/src/rate-limit.ts`, the key a rate-limited person's request logs

```
/**
 * A person's id, which is the household's own name for them and no secret,
 * and so is safe in a log line where an address or a token is not — behind
 * their household's id, so two households' people with the same name do not
 * share a bucket (lg-21). A household id is a lowercase word or a UUID
 * (lg-71), neither of which holds a colon, so the first colon is always the one
 * written here.
 */
function personKey(request: FastifyRequest): BucketKey {
  const person = personOf(request);
  const key = `${person.household}:${person.id}`;
  return { key, logged: key };
}
```

and `sed -n 103,109p tools/ledger/api/src/rate-limit.ts`, the warning that logs it

```

    reply.header("Retry-After", String(decision.retryAfterSec));
    logger.warn("rate limited", {
      scope,
      ...(logged === undefined ? {} : { key: logged }),
      retryAfterSec: decision.retryAfterSec,
    });
```

The comment calls a person's id "the household's own name for them and no secret",
which is safe in a log line. That is true of a UUID, which a person added since lg-76
has as its id. A person added before lg-76 has the name typed then as the same field
(lg-76's Why), so the warning carries that name. It is logged at `warn` for every
rate-limited person request.

17. `git show origin/lg-77-rename-a-household:tools/ledger/api/src/db/directory-schema.ts | grep -n "household_names" | head -12`, lg-77's append-only table on its head

```
490:  CREATE TABLE household_names (
499:  CREATE INDEX household_names_household ON household_names (household_id, id);
503:  CREATE VIEW current_household_names AS
505:    FROM household_names
507:      SELECT max(id) FROM household_names later
508:      WHERE later.household_id = household_names.household_id
511:  CREATE TRIGGER household_names_never_updated BEFORE UPDATE ON household_names
513:  CREATE TRIGGER household_names_never_deleted BEFORE DELETE ON household_names
515:  CREATE TRIGGER household_names_never_replaced BEFORE INSERT ON household_names
516:    WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM household_names WHERE id = NEW.id)
```

18. `git show origin/lg-77-rename-a-household:tools/ledger/api/src/directory.ts | grep -n "readMember(\|renameHousehold(\|addHousehold("`, the methods the Build names, at lg-77's head

```
413:  renameHousehold(rename: { household: string; name: string } & Change): Household {
698:  addHousehold(household: Household & Change): Household {
789:    const draft = this.#readMember(member);
895:    const { address, person } = this.#readMember({
941:  #readMember(member: { address: unknown; person: unknown }): { address: string; person: string } {
```

The lines moved by 72 from main's `addHousehold` (626) and `#readMember` (869). The
gate measured the same shift on lg-77's head `aaf6828c`.

19. `node --no-warnings check-carry.mjs`, whether a SQL `CHECK` can carry the set. The script builds the CHECK from GLOB classes and a search for a NUL byte, and compares its verdict with the regex on 15 samples. Source:

```js
// check-carry.mjs: can a SQLite CHECK carry the UNSEEN set? Builds the CHECK from
// GLOB classes and a byte-count NUL guard, then compares it with the regex on
// 15 samples. Run: node --no-warnings check-carry.mjs
import { DatabaseSync } from "node:sqlite";

const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
const c = (code) => String.fromCharCode(code);
// GLOB and length() stop at a NUL, so the NUL is checked on the bytes instead.
const classes = [
  `[${c(1)}-${c(31)}]`,
  `[${c(127)}-${c(159)}]`,
  `[${c(0x200b)}-${c(0x200d)}]`,
  `[${c(0xfeff)}]`,
];
const globs = classes.map((cls) => `name NOT GLOB '*${cls}*'`).join(" AND ");
const db = new DatabaseSync(":memory:");
db.exec(
  `CREATE TABLE t (name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND name = trim(name)` +
    ` AND instr(CAST(name AS BLOB), x'00') = 0 AND ${globs}))`,
);

const samples = [
  ["ok", "Alex"],
  ["accent", `Zo${c(0xe9)}`],
  ["ESC", `a${c(27)}b`],
  ["BEL", `a${c(7)}b`],
  ["NUL", `a${c(0)}b`],
  ["LF", "a\nb"],
  ["TAB", "a\tb"],
  ["DEL", `a${c(127)}b`],
  ["C1 0x85", `a${c(0x85)}b`],
  ["ZWSP", `a${c(0x200b)}b`],
  ["ZWNJ", `a${c(0x200c)}b`],
  ["ZWJ", `a${c(0x200d)}b`],
  ["BOM interior", `a${c(0xfeff)}b`],
  ["lone ZWSP", c(0x200b)],
  ["U+2028", `a${c(0x2028)}b`],
];
let agree = 0;
for (const [label, text] of samples) {
  let stored = true;
  try {
    db.prepare("INSERT INTO t (name) VALUES (?)").run(text);
  } catch {
    stored = false;
  }
  const regex = UNSEEN.test(text.trim());
  const check = !stored;
  if (regex === check) agree += 1;
  console.log(
    `${label.padEnd(14)} regex-refuses=${String(regex).padEnd(5)} check-refuses=${String(check).padEnd(5)} ${regex === check ? "agree" : "DIFFER"}`,
  );
}
console.log(`agree ${String(agree)} of ${String(samples.length)}`);
```

```
ok             regex-refuses=false check-refuses=false agree
accent         regex-refuses=false check-refuses=false agree
ESC            regex-refuses=true  check-refuses=true  agree
BEL            regex-refuses=true  check-refuses=true  agree
NUL            regex-refuses=true  check-refuses=true  agree
LF             regex-refuses=true  check-refuses=true  agree
TAB            regex-refuses=true  check-refuses=true  agree
DEL            regex-refuses=true  check-refuses=true  agree
C1 0x85        regex-refuses=true  check-refuses=true  agree
ZWSP           regex-refuses=true  check-refuses=true  agree
ZWNJ           regex-refuses=true  check-refuses=true  agree
ZWJ            regex-refuses=true  check-refuses=true  agree
BOM interior   regex-refuses=true  check-refuses=true  agree
lone ZWSP      regex-refuses=true  check-refuses=true  agree
U+2028         regex-refuses=false check-refuses=false agree
agree 15 of 15
```

20. `node zwj-probe.mjs`, which legitimate names the set refuses. Source and output:

```js
// zwj-probe.mjs: which legitimate names does the UNSEEN set refuse?
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
const samples = {
  "family emoji (ZWJ sequence)": "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}",
  "Persian word with ZWNJ": "می\u200cخواهم",
  "accented Latin name": "Zoé",
};
for (const [label, text] of Object.entries(samples)) {
  console.log(`${label}: UNSEEN.test = ${String(UNSEEN.test(text))}`);
}
```

```
family emoji (ZWJ sequence): UNSEEN.test = true
Persian word with ZWNJ: UNSEEN.test = true
accented Latin name: UNSEEN.test = false
```

## Sinks

Each sink is a place a stored or typed name is written out. The sinks are numbered so
the Build and the Done when can count them.

**Terminal sinks**: a host command writes the name to stdout or stderr.

- **T1** `household-command.ts:68–70`, `list`: each person's shown name, with the id
  beside it when they differ.
- **T2** `household-command.ts:73`, `list`: each household's name. A household made on
  main is "Home"; one made before lg-71 keeps the name it was given, and a rename after
  lg-77 writes another.
- **T3** `household-command.ts:146`, `add`: the household's name and the first
  person's shown name.
- **T4** `household-command.ts:156`, `member`: the shown name.
- **T5** `household-command.ts:165`, `remove`: the shown name.
- **T6** `household-command.ts:125`, `:179`, `:182`: stderr, `appError.message`. It
  carries M1–M5 when the directory refuses. `member` reaches M4 and M5.
- **T7** `import-command.ts:245` and `spending-backfill-command.ts:109`: `membersListed`
  (`import-command.ts:141–142`) names every member in the `--as` refusal, on stderr
  through `usage` (`import-command.ts:75`, `spending-backfill-command.ts:43`).
- **T8** `import-command.ts:275` and `:301`: the import report. Its 20 name lines
  (command 13) all read the one closure at `workbook-import.ts:650`, so escaping that
  closure covers them. **The brief had this wrong (found by the build, 2026-10-31):**
  the report also prints names that `@ledger/books` builds, in `People.shown` (four
  lines of `books/src/workbook.ts`: the sheet-total checks, the second-salary problem
  and the ratio problem) and in its `#listed` household list (two problems), and the
  closure does not reach them. They are escaped inside `books`. The `--as` problem at
  `workbook-import.ts:668` is among the closure's lines. T7 is a separate path.

**Message sinks**: sentences that quote a name. Each reaches T6 on stderr, or the
admin's JSON as `message`, which the web displays.

- **M1** `directory.ts:639–640`, `renamePerson`: `PERSON_NAME_TAKEN` quotes the typed
  name. No host command calls `renamePerson`; the admin's rename route does.
- **M2** `directory.ts:952–955`, `addPerson`: `PERSON_NAME_TAKEN` quotes the typed
  name. `addAs` in `routes/households.ts` reaches it; no host command does.
- **M3** `directory.ts:745–754`, the retire refusals: `${shown}`. Reached through the
  admin's retire route.
- **M4** `directory.ts:1085–1086`, `#admit`'s retirement sentences: `${shown} is retiring
  at the next close …` and `${shown} is retired from the books …`. Reached by
  `household:ledger member` through `addMemberByName` (command 10) and by the admin's
  `adminMembers` route.
- **M5** `directory.ts:1168–1175`, `#refuseTaken`: `as ${shown}`, the taken-address
  sentence. Reached by `household:ledger member` through `#admit` (`directory.ts:1066`), and by
  the admin's member routes. lg-77's Build 7 changes the household named in it from its
  id to its name.

**Log sink**

- **L1** `rate-limit.ts:105`, the `rate limited` warning: its `key` is
  `household:person-id` (`personKey`, `rate-limit.ts:57–69`). For a person added before
  lg-76 the id is the name typed then (command 16).

**Excluded, with the reason**

- `directory.ts:1073–1074`: the `#admit` branch for a person not yet held. Only `addMember`
  reaches it, and `addMember` has no caller under `api/src` (command 11). Test-only.
- `spending-backfill-command.ts:120` and `:127`: the backfill report prints counts,
  bank-row and card-line text, and categories (command 14). No person's name.
- `main.ts:74`: an Error's class name and text in a startup failure.
- `household-command.ts:50`, `usage`: echoes what the operator typed. A typed argument
  is not a stored name.
- The other log calls (command 15): ids, counts, codes, flags and paths. `books.ts:189`,
  `main.ts:50` and `access.ts:304` carry error text or a token's email, and none reads
  a stored name.

**Not terminal, and not a name sink by the same test**

- JSON: `routes/households.ts:86, 91, 109, 132, 317`, `routes/rules.ts:57` and
  `routes/workbook.ts:34`. JSON escapes the C0 controls, so ESC, BEL and NUL come out
  as `\u` escapes. It passes DEL, the C1 controls and the zero-width characters raw
  (checked with `JSON.stringify` on each: DEL, U+0085, U+009B, U+200B, U+200D and U+FEFF
  are raw, ESC, BEL, NUL and LF escaped).
- `web/src`: no `innerHTML` and no `dangerouslySetInnerHTML` (command 8), so the text is
  rendered as text. The web is a display question for a zero-width name, not an
  injection one.

## Decision — answered 2026-10-31 by the owner

Two questions. Each is marked on its own line, `open` until an answer names who gave
it and when. Both are answered, at intake on 2026-10-31, and the answers are recorded
under **Build orders** below; the options and their costs stay as they were put.

**1. Which remedy — answered 2026-10-31 by the owner: (a).**

- **(a) Refuse the population at write time.** The set is `readAddress`'s, at
  `directory.ts:53` on `c7bdef21`. Costs: a check in each of the five write methods the Build names,
  and a refusal sentence for each, raised as `BAD_REQUEST` as the name rules are. Or the
  same set as a SQL `CHECK`, in the table rebuild question 2 may need. Command 19 builds
  one from GLOB classes and a search for a NUL byte, and it agrees with the regex on 15
  of 15 samples. Rows already stored keep their characters until question 2 is acted
  on. The set also refuses an interior newline and tab (command 7), and U+200C and
  U+200D, which some names carry legitimately: a family emoji written as a ZWJ sequence
  and a Persian word with a ZWNJ are refused, and an accented Latin name is not
  (command 20). The owner should see that before choosing (a) with the address set
  whole.
- **(b) Escape at every text sink.** The sinks are T1–T8, M1–M5 and L1, fourteen in
  all. Costs: an escape helper, one call at each sink, and every new sink has to
  remember it. It stops terminal injection, which is what `list` does with ESC and BEL.
  The rate-limit log line is JSON from pino, which escapes ESC, BEL, NUL and LF already
  and passes DEL, the C1 controls and the zero-width characters raw, so for a pre-lg-76
  name L1 is a sink for those raw characters (U+009B is a control sequence introducer on
  a terminal that honours C1). It does not stop an invisible
  name from reading as a blank or as another name, which is what a zero-width character
  does on a screen; the web would need its own rule. For M1–M5 the owner also chooses
  where the escape sits: in the sentence builders in `directory.ts`, which also changes
  the admin's web text, or at the host command's stderr (T6), which does not.
- **Both.** (a) for new writes, and (b) for the rows already stored.

The gate recommends (a).

**2. What the stored rows hold — answered 2026-10-31 by the owner: (i). Not measured, and under (i) not needed.** A stored row cannot be changed
in place: the triggers refuse every UPDATE and DELETE (command 9, and command 17 for
`household_names`). Whether a live directory holds a row with an unseen character
decides which of these is needed.

- **(i)** Leave the rows, and escape at display (the (b) sinks). Fits either answer to
  question 1.
- **(ii)** A migration that rebuilds the table with the CHECK, as migration 7 rebuilt
  `households` (`db/directory-schema.ts`, the comment from line 322): the rows are
  copied aside, the table is dropped, made again, and the rows copied back. The copy
  back goes through the new CHECK, so one stored row it refuses stops the migration.
  Nothing can be cleaned in place first, so the owner must say what such a row becomes.
- **(iii)** Rewrite each such row, under an owner decision. A rewrite changes the name
  the books show and the history, and the triggers have to be lifted for it.

The measurement, taken on a copy of each live directory, reads every row of each of
these. A zero from a shorter list is a false all-clear:

- `households.name`, every row, including households made before lg-71;
- `household_names.name`, every row, once lg-77 has merged (the current name is the
  latest row, and the history shows all of them);
- `person_names.name`, every row;
- `people.person` and `memberships.person`, every row. A person's id prints as their
  name when no `person_names` row exists (`shownName`, `directory.ts:155–157` on `c7bdef21`), and
  before lg-76 the id was the name typed (lg-76's Why).

## Build

Not dispatchable until both questions are answered. Each answer is recorded on this
ticket first, with who gave it, the date and the options it was chosen from. The
commit that records the second answer also sets `status` to `ready`, before any
source change.

### Build orders — the owner's answers, 2026-10-31, given at intake

- **Question 1, "Which remedy"**: chosen from (a) refuse at write time, (b) escape at
  the 14 sinks, and Both. The owner chose **(a)**, the gate's recommendation, having
  been shown that (a) refuses U+200C and U+200D (the ZWJ emoji family name and the
  Persian ZWNJ word).
- **Question 2, "What the stored rows hold"**: chosen from (i) leave the rows and
  escape at display, (ii) a migration rebuilding the table with a CHECK, and (iii)
  rewrite each row under an owner decision. The owner chose **(i)**, the
  orchestrator's recommendation (the ticket gave none).
- **Consequence, put to the owner.** The ticket defines (i) as escaping at display
  "(the (b) sinks)", so (a) with (i) is the ticket's **Both**: the "Under (a)" and the
  "Under (b)" lines of Build and of Done when both apply. Build 5 (the CHECK) does not:
  (a) is enforced in `directory.ts`, and (i) changes no row, so there is no migration.
- **(b)'s sub-choice for M1–M5**, chosen from "in the `directory.ts` sentence builders
  (the admin's web text changes)" and "at the host command's stderr (T6) (the web text
  does not change)": the owner chose **at the host command's stderr (T6)**, the
  orchestrator's recommendation. The admin's web text does not change.
- **The measurement line** of Done when ("The stored rows are handled as question 2's
  answer says, with a test, and the measurement's counts, one per table listed under
  question 2, are in the Log"), chosen from "reword: not needed under (i)" and "the
  owner runs it after merge, as an `awaiting:` line": the owner chose **reword**, the
  orchestrator's recommendation. Under (i) the stored rows are left, and the (b) sink
  tests prove that a stored row prints escaped. No measurement is taken.
- **Second round, 2026-10-31, the owner's answers to the builder's two open decisions.**
  - **M1–M3 escaped nowhere**, chosen from "leave them; reword the line" (the builder's and
    the orchestrator's recommendation) and "escape in the `directory.ts` sentence builders"
    (the option declined at intake): the owner chose **leave them; reword the line**. The
    Done when clause is reworded above. It follows from the T6 answer.
  - **Addresses printed raw** (`list`, `remove` and M5 print `member.address`
    unescaped), chosen from "fold into lg-82" (the orchestrator's recommendation, which
    overrode the builder's), "file a ticket with a reproduction" (the builder's) and
    "leave it unrecorded": the owner chose **fold into lg-82**. Build: reproduce first, on
    `d7cd223f`, with a failing test per sink and an address holding a character of P stored
    the way an older row would be; then escape at the three call sites. If no stored
    address can hold one, stop and report. A Done when line is added above.
- **Rating**: the ticket's `difficulty: standard` was a placeholder for the owner. The
  owner rated it **standard**, the orchestrator's recommendation.

The population **P** is the 32 C0 characters U+0000 to U+001F, DEL (U+007F), the 32 C1
characters U+0080 to U+009F, U+200B, U+200C, U+200D, and an interior U+FEFF, each
written as `a` + character + `b`. A lone U+FEFF is removed by `trim()` and refused as an
empty name, so it does not test the set. P has 69 characters.

Under (a), in `api/src/directory.ts`, five write methods:

1. Move the set in `UNSEEN` (command 1) into a helper that the address rule and the
   name rules both call. Keep the lg-52 and lg-57 comment with it.
2. `addHousehold`, and `renameHousehold` once lg-77 has merged: after the trim and the
   1-to-80 check, refuse a name that matches the set.
3. `addPerson`, `renamePerson` and `#readMember`, after the trim and the length check.
   `#readMember` covers `addMember`, `addMemberByName` and `createHousehold`.
4. Tests, as Done when 2 says.
5. If question 1 chose the CHECK, it goes into the table rebuild question 2 requires.

Under (b):

6. One escape helper that writes each character of P as its six-character escape
   text, applied at:
   - T1–T5: the host command's `io` calls, which print the names through the helper.
   - T6 and M1–M5: at the place question 1 chooses.
   - T7: `membersListed` (`import-command.ts:141–142`).
   - T8: the closure at `workbook-import.ts:650`, once, for all 20 lines; and
     `People.shown` and `People`'s `#listed` in `books/src/workbook.ts`, for the lines
     `books` builds (the brief missed them).
   - L1: the logged key in `rate-limit.ts`.
7. Tests, as Done when 2 says.

Under question 2, the build is what the answer names: (i) changes no row; (ii) a
migration with the rebuild, with a test that a stored row the CHECK refuses stops it;
(iii) what the owner's decision says.

The web is not in the build. Its sinks are JSON and React-escaped, so a web change
waits for a separate answer.

## Done when

- The `## Decision` heading reads `answered <date> by <who>` once both questions are
  answered (`docs/01-TICKETS.md` keeps one heading and marks each question on its own
  line), with the options each was chosen from, and `status` is `ready` in the commit
  that records the second answer.
- Under (a): each of the five write methods in Build 2–3 refuses every character of P,
  with one test per method in `api/test/directory.test.ts`, beside the address refusal
  tests: `addHousehold`, `renameHousehold` (once lg-77 has merged), `addPerson`,
  `renamePerson`, and `#readMember` through `addMemberByName` and `createHousehold`.
  Each refusal is `BAD_REQUEST`, and the row is unchanged.
- Under (b): each of the fourteen sinks, T1–T8, M1–M5 and L1, prints no character of P
  raw, with one test per sink at the function that writes it: T1–T6 through
  `runHouseholdCommand` with a captured `io` (`household-command.test.ts`), T7 through
  the two commands' `--as` refusal, T8 through the import report, M1–M5 through the
  directory methods that build them, and L1 through the rate limit's logged key.
  - **Superseded 2026-10-31 by the owner's answer to (b)'s sub-choice** (the clause
    "M1–M5 through the directory methods that build them"). It now reads: M1–M5 are
    proven where the answer puts the escape, at T6, through `runHouseholdCommand` with
    a captured `io` and a stored name that holds a character of P. That follows from
    the owner's choice of the host command's stderr over the sentence builders.
  - **Superseded again 2026-10-31 by the owner's second answer (below), for M1–M3
    only.** M1, M2 and M3 are unreachable at T6 and are neither escaped nor tested. The
    proof: `grep -n "renamePerson\|addPerson\|retirePerson\|addPeople" *.ts routes/*.ts`
    in `tools/ledger/api/src`, leaving out `directory.ts`, finds `renamePerson`,
    `addPerson` and `retirePerson` called only from `routes/households.ts` (lines 111,
    344 and 363), so no host command builds M1, M2 or M3; and the (a) refusal tests in
    `directory.test.ts` ("renamePerson refuses each as BAD_REQUEST…" and "addPerson
    refuses each as BAD_REQUEST…") show that M1 and M2, which quote the typed name,
    cannot carry a character of P, since the name is refused before the sentence is
    built. M4 and M5 stay proven at T6. This follows from the T6 answer.
- ~~The stored rows are handled as question 2's answer says, with a test, and the
  measurement's counts, one per table listed under question 2, are in the Log.~~
  **Superseded 2026-10-31 by the owner's answer ("reword").** It now reads: the stored
  rows are left as question 2's answer (i) says, and the (b) sink tests prove that a
  stored row prints escaped. No measurement is taken, so the Log carries no counts.
- **Added 2026-10-31 by the owner's second answer (below).** The stored address printed
  at `list`, `remove` and M5 prints no character of P raw, with one test per sink
  through `runHouseholdCommand` and an address stored past `Directory`, as a pre-lg-52 or
  pre-lg-57 row holds one; each test red against `d7cd223f`, and green with the escape.
- lg-77 has merged before the build starts (`depends_on`).
- `npm run check` and `npm test -- --project ledger` pass on the build's branch.

## Log

- **2026-10-31, filed.** Filed by a maintenance builder from lg-77's gate 1 finding,
  on main `c7bdef21`. The owner's decision of 2026-10-31 is one ticket covering both
  kinds of name. The other options were to record only, or to fix inside lg-77 now.
  The facts under Reproduction were read on main with grep, sed and scratch scripts.
  No build was run, and the `list` reproduction was not re-run; the gate ran it on
  `a87da359`.
- **Corrected before the gate.** The first draft said every household on main is
  named "Home". That holds for households made on main; one made before lg-71 keeps
  the name its admin typed, as lg-71's Why and lg-77's Why both say. The check on the
  path that writes a name today does not look at unseen characters
  (`directory.ts:626-643`). Whether such a row holds one is measured under question 2.
- **Depends on lg-77** (PR #686, not merged at filing). Its Build 2 and Build 7 are
  quoted from `tools/ledger/docs/work/lg-77-rename-a-household.md` on main. Its head
  was read this round (commands 17 and 18) as `origin/lg-77-rename-a-household`.
- **Gate 1 round 1 (narrow, on `2b2c298f`, CONCERNS, ten findings), applied.** F1: the
  split is removed. Decision has two questions, the scope question and option (ii) are
  gone, the last Why paragraph and the Log no longer name the split, and Build 3 is
  unconditional. F2: Done when 2 defines the population P, which the precedent's loops
  already cover, and counts the tests (five methods under (a), fourteen sinks under
  (b)). F3: question 2 lists the four tables and the id fallback, the three rebuild
  options name the immutability triggers, and migration 7 is the rebuild precedent. F4:
  the sinks now include the `#admit` retirement sentences (M4), `renamePerson` (M1),
  and all 20 report lines (T8, through one closure). F5: the backfill report is removed
  from the sinks; the logger paragraph is command 15. F6: the CHECK claim is corrected,
  and the probe is command 19. F7: command 4 runs through the length test, and command
  6's list is the fresh 25 lines. F8: line numbers are on `c7bdef21` and the Build
  names symbols. F9: one `## Decision` heading, and `ready` comes with the second
  answer. F10: the ZWJ and ZWNJ cost is in question 1, command 20.
- **Found this round, not in the gate's list.** L1: the `rate limited` warning logs
  `household:person-id`, and a person added before lg-76 has the typed name as its id,
  so the log carries a stored name (`rate-limit.ts:57–69`, `:105`). It is a sink.
- **Outside this ticket.** The backfill report prints bank-row and card-line text
  (command 14). That text is not a name, so it is not in scope; it may need its own
  ticket if it can carry an unseen character.
- **Gate records.** This pull request only files the ticket, so no `## Review` section is
  committed. Gate 1 (CONCERNS, on `2b2c298f`) and gate 2 (PASS, on `a20d919e`) are
  posted in full on the pull request thread, #688, gate 1 first.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, F6 — "say a search for a NUL
  byte and drop the same guard the id column uses". Command 19 and question 1 (a) now
  say "a search for a NUL byte", and the `id` column clause is gone. The proof is the
  count of removed lines holding the clause, from `git diff a20d919e` on the ticket,
  `grep -c '^-.*the same guard the'` → `1`. The script's own comment in command 19's
  source still says "byte-count NUL guard", quoted as it ran; the lander left it.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, F11 — "say which characters of
  P reach the log raw". Question 1 (b) now says the log line is pino JSON, which escapes
  ESC, BEL, NUL and LF and passes DEL, the C1 controls and the zero-width characters raw,
  so L1 is a sink for those. The proof is the same diff,
  `grep -c '^-.*what the rate-limit log does with a pre-lg-76 name'` → `1`.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, F12 — "change the range to the
  one that prints the block". The range is now `sed -n 57,69p` in command 16, in L1 and
  in the Log. `sed -n 57,69p tools/ledger/api/src/rate-limit.ts` prints the quoted
  block, doc comment to closing brace, and `sed -n 56,68p` printed a blank line first.
  The proof is the same diff, `grep -c '^-.*sed -n 56,68p'` → `1`.
- **2026-10-31, answered.** The owner's answers are under Build, "Build orders": (a), (i),
  the host command's stderr (T6) for M1–M5, the measurement line reworded, and the
  rating `standard` (the placeholder note is removed; the frontmatter stays `standard`).
  `status` is `ready` in the commit that records them, before any source change.
- **2026-10-31, built (a) and (i), which is the ticket's Both.** Refusal: `hasUnseen` in
  the five write methods (`addHousehold`, `renameHousehold`, `addPerson`, `renamePerson`,
  `#readMember`, so `addMemberByName` and `createHousehold` too), after the trim and the
  length check, as `BAD_REQUEST`, with a sentence of its own for a household and for a
  person. No CHECK and no migration (Build 5 does not apply under (i)); no row is changed.
  Escape: `escapeUnseen` writes each of the 69 characters as `\uXXXX`, at T1, T2, T3, T4,
  T5, T6 (all three `io.stderr` sites of `household-command.ts`), T7 (`membersListed`), T8
  and L1 (`rate-limit.ts`, at the log call, so every `logged` key is covered). The helper
  is `books/src/unseen.ts`, exported by `@ledger/books`; `api` imports it from there, not
  from a file of its own, because `books` needed it too (below).
- **What the brief had wrong, 1: T8 is not one closure.** The report also prints names
  that `@ledger/books` builds, in `People.shown` and in `People`'s `#listed`. With the
  closure at `workbook-import.ts` escaped and nothing else, the T8 test failed on
  `ok $ (Avril-Août): [ ][]…'s lines add up to the sheet's total` printed raw. The fix is
  in `books/src/workbook.ts`, and the helper moved to `books` so there is one definition.
  The T8 count of "20 lines" is therefore 20 plus the `books` lines (four in `People.shown`,
  two problems through `#listed`).
- **What the brief had wrong, 2: M1–M5 at T6 is not five sinks.** The owner chose to escape
  M1–M5 at the host command's stderr. What the stderr can show is what a host command
  reaches, and: `household:ledger` reaches **M4** (both sentences, through `member` naming
  a held person by id) and **M5** (through `member` or `add` for an address already in a
  household), and no host command reaches **M1**, **M2** or **M3** (`renamePerson`,
  `addPerson` and `retirePerson` have no caller under `command` code, only the admin's
  routes). M1 and M2 quote the typed name, which (a) now refuses a character in before the
  sentence is built, so they cannot carry one. M3 quotes a stored shown name and is reached
  only through the admin's retire route. So under this answer **M1, M2 and M3 are escaped
  nowhere and have no test**, and the admin's web text is as it was. The fourteen-sink count
  does not mean fourteen tests: M4 and M5 are proven at T6 (`T6 and M4`, `T6 and M5`), and
  T6 is not a separate test beyond those two. The tests are T1+T2 (one, `list`), T3, T4, T5,
  T6 with M4 (retiring and retired), T6 with M5, T7 (two: the import command, the backfill
  command), T8, and L1, plus one `books` test for `#listed` and one for the helper.
- **What the brief had wrong, 3: T3 and T4 are reachable by no data.** `add` names every
  household "Home" and refuses a person's name with a character in it, and `member` finds a
  person by the name or id typed, which (a) refuses a character in. So no stored row
  reaches the shown name printed at T3 or T4; their tests stub `Directory.prototype`'s
  `createHousehold` and `addMemberByName` to return a name with one. The escape is defence
  in depth there.
- **Consequence of (a) with (i), recorded for the owner.** A person added before lg-76
  has the name typed then as their id. If that name held a character, they cannot be named
  by it to `household:ledger member`, nor by the admin's member routes, because the id is
  typed and read as a name is. They stay in `list`, escaped. The test is `member cannot name
  a person by an id that holds one, and the person is still listed`, the last in
  `household-command.test.ts`. No stored row is known to hold one: nothing was measured (the
  owner chose not to).
- **A sixth write path, folded in.** The import screen's Confirm adds new people through
  `addPeople`, and `answersFor` in `workbook-describe.ts` mirrors `addPerson`'s name rule
  (its 1-to-64 check) so a bad answer is a `WORKBOOK_IMPORT_REFUSED` problem and nothing is
  written. With (a) in `addPerson` alone, a name with a control character passed the mirror
  and was refused later, inside `beforeCommit`, as a bare 400. The mirror now refuses it
  too, as a problem. Test: `workbook-names.test.ts`, "an answer as a new person under a name
  with a control character is refused, adding no one", 422 `WORKBOOK_IMPORT_REFUSED`; with
  the check disabled it fails `expected 400 to be 422`.
- **Not folded in the first round (superseded: folded in the second, below).** `list`, `remove` and M5 print `member.address` raw, and an
  address stored before lg-52 or lg-57 may hold a control or a zero-width character
  (`readStoredAddress` admits it so the row can be removed). That is the same class of
  defect for another field, found by reading, not run; it needs its own reproduction and a
  question about whether the address is escaped or only shown, so it is not folded.
- **Verification.** Red then green: 16 of the new tests (every one of them but the
  population count) fail on the base sources (`git checkout d7cd223f -- <the six source
  files>`, `books` rebuilt, and `escapeUnseen` absent from `books/dist/workbook.js`, then
  restored from `4ae0e27e`) and pass on the build. The two tests added after that run (the
  id one and the Confirm one) were not run against the base, except the Confirm one against
  its check disabled.
  After the last commit: `npm run check` exit 0; `npm test -- --project ledger` exit 0, 92 files,
  2018 tests (2016 before the id and the Confirm tests).
- **2026-10-31, second round: M1–M3 left, addresses folded in.** The owner's answers are
  under Build orders. **M1–M3:** the `Done when` clause is reworded (above), and nothing in
  the source changes for them. **Addresses (the fold-in), reproduced first.** `list` and
  `remove` print a stored address raw. Two tests were written first, in
  `household-command.test.ts`, with an address stored past `Directory` (the character after
  the `@`, because the schema's `GLOB '?*@?*'` stops at a NUL before it; 69 households, one
  address each): `list prints a stored address with each character of the 69 escaped` and
  `remove prints the address it removed with each character of the 69 escaped`. Red on
  the base sources (`git checkout d7cd223f -- <the seven source files>`, `books` rebuilt,
  `grep -c escapeUnseen books/dist/workbook.js` → `0`):
  `npx vitest run tools/ledger/api/test/household-command.test.ts -t "stored address|address it removed"`
  → two failures, first `AssertionError: \u0000: expected 'Directory: …' to contain '  u0
  u0@ex\u0000z.test\n'`. Also red at the branch head before the fix. Then `escapeUnseen`
  at the two call sites, `list`'s address column and `remove`'s `Removed ${removed.address}`,
  and both are green (33 of 33 in the file).
- **What the owner's reading had wrong, 1: M5 prints no address.** `#refuseTaken` says
  `That email already belongs to the household "…", as …. Remove it first.` and names no
  address, so M5 is not an address sink (the name and the household name in it were
  escaped in the first round, at T6). The sinks that print an address are `list` and
  `remove`. `Created…with ${member.address}` and `Added ${member.address}` also print one,
  but it is the address typed, which `readAddress` has refused a character in, so those two
  are reachable by no data and are left unescaped.
- **What the reading had wrong, 2: not all 69 reach `remove`.** `removeMember` reads the
  typed address with `readStoredAddress`, whose `ADDRESS_SHAPE` refuses `\s`. Six of the
  69 are in `\s` (TAB, LF, VT, FF, CR and U+FEFF), so a stored address holding one is
  listed and cannot be removed by the command at all, answering `That is not an email
  address.` The test asserts that for the six and the escape for the other 63. That is an
  existing defect, not this ticket's (a row nobody can remove); it is not fixed here and is
  named in the report.
- **Second round, verification.** `npm test -- --project ledger` exit 0, 92 files, 2020 tests (2018 before the two address tests); `npm run check` exit 0 at the final head, and `npx oxfmt --check` on this ticket reports `All matched files use the correct format.`
