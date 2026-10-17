/**
 * The settlement between any number of people (lg-23, Question 1 A): the
 * matching rule, generalised. Every name, salary and amount is invented.
 */

import { describe, expect, test } from "vitest";
import {
  asPair,
  cumulativeHouseholdSettlement,
  netsOf,
  ratioFromSalaries,
  settleHousehold,
  settleStretches,
} from "../src/index.ts";
import type { Charge, HouseholdSettlement, PersonCents, Share, Stretch } from "../src/index.ts";
import { settleStretchesV3 } from "./helpers/two-person-v3.ts";

/** A small, seeded generator, so a failure names a mix that can be re-run. */
function generator(seed: number): (below: number) => number {
  let state = seed;
  return (below) => {
    state = (state * 48_271) % 2_147_483_647;
    return state % below;
  };
}

const NAMES = ["alex", "blair", "casey", "dana", "eli"];

/** A ratio from salaries the generator varies, every share more than nothing unless `zero` allows it. */
function variedRatio(next: (below: number) => number, people: readonly string[]): Share[] {
  for (;;) {
    const ratio = ratioFromSalaries(
      people.map((personId) => ({
        personId,
        // From a token wage to a large one, so shares run from a few parts per
        // million to nearly all of them.
        amountCents: next(4) === 0 ? 1 + next(5_000) : 100_000 + next(20_000_000),
      })),
    );
    if (ratio.every((share) => share.partsPerMillion > 0)) return ratio;
  }
}

/** Shared spending and charges between anyone named, in any direction. */
function variedStretch(
  next: (below: number) => number,
  people: readonly string[],
  ratio: readonly Share[],
): Stretch {
  const contributions: PersonCents[] = [];
  const charges: Charge[] = [];
  for (let index = 0; index < 1 + next(12); index++) {
    const who = people[next(people.length)] ?? "alex";
    const cents = 1 + next(200_000);
    if (next(4) === 0) {
      const other = people[next(people.length)] ?? "alex";
      if (other !== who) charges.push({ owedBy: other, owedTo: who, cents });
    } else contributions.push({ personId: who, cents });
  }
  return { ratio, contributions, charges };
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** What `deposits` leaves each net at once weighed in at the closing ratio, in millionths of a cent. */
function standingAfter(
  stretches: readonly Stretch[],
  ratio: readonly Share[],
  settled: HouseholdSettlement,
): Map<string, bigint> {
  const paid = (settled.deposits ?? []).map((deposit) => ({
    personId: deposit.personId,
    cents: deposit.depositCents,
  }));
  return netsOf([...stretches, { ratio, contributions: paid, charges: [] }]);
}

describe("between two people it is lg-6's settlement, to the cent", () => {
  // Done when 2. The existing settlement tests (`settlement.test.ts`) run,
  // unchanged, against `settleStretches`, which is now this rule read in the
  // two-person shape; here the rule is compared with lg-6's formula as it stood,
  // kept as an oracle in `helpers/two-person-v3.ts`.
  test("over 5 000 histories of varied salaries, stretches, ratio changes and charges", () => {
    const next = generator(23);
    const people = ["alex", "sam"];
    let owing = 0;
    let direct = 0;
    for (let trial = 0; trial < 5_000; trial++) {
      const ratios = Array.from({ length: 1 + next(4) }, (): Share[] => {
        if (next(10) !== 0) {
          return ratioFromSalaries(
            people.map((personId) => ({ personId, amountCents: 1 + next(20_000_000) })),
          );
        }
        // A share of zero now and then, so the direct-only case is drawn too.
        const alex = next(2) === 0 ? 0 : 1_000_000;
        return [
          { personId: "alex", partsPerMillion: alex },
          { personId: "sam", partsPerMillion: 1_000_000 - alex },
        ];
      });
      const stretches = ratios.map((ratio) => variedStretch(next, people, ratio));
      const closing = ratios.at(-1) ?? [];
      const expected = settleStretchesV3(stretches, closing);

      expect(asPair(settleHousehold(stretches, closing)), `trial ${String(trial)}`).toEqual(
        expected,
      );
      expect(settleStretches(stretches, closing), `trial ${String(trial)}`).toEqual(expected);
      if (expected.payerId !== null) owing++;
      if (expected.depositCents === null) direct++;
    }
    // The draw reaches every branch: someone owing, and only a direct transfer.
    expect(owing).toBeGreaterThan(4_000);
    expect(direct).toBeGreaterThan(50);
  });
});

describe("between three, four and five people", () => {
  // Done when 3. 3 000 histories for each size, each of one to four stretches
  // at varied ratios, with charges between anyone.
  test.each([3, 4, 5])(
    "for %i people the nets sum to zero, nobody deposits a negative amount, and after the deposits everyone stands at their share to within a cent",
    (size) => {
      const next = generator(100 + size);
      const people = NAMES.slice(0, size);
      let deposited = 0;
      for (let trial = 0; trial < 3_000; trial++) {
        const ratios = Array.from({ length: 1 + next(4) }, () => variedRatio(next, people));
        const stretches = ratios.map((ratio) => variedStretch(next, people, ratio));
        const closing = ratios.at(-1) ?? [];
        const where = `${String(size)} people, trial ${String(trial)}`;

        const nets = netsOf(stretches);
        expect([...nets.values()].reduce((sum, net) => sum + net, 0n), where).toBe(0n);

        const settled = settleHousehold(stretches, closing);
        expect(settled.deposits, where).not.toBeNull();
        for (const deposit of settled.deposits ?? []) {
          expect(deposit.depositCents, where).toBeGreaterThan(0);
        }
        // The one furthest ahead for their share deposits nothing.
        expect((settled.deposits ?? []).length, where).toBeLessThan(size);
        deposited += (settled.deposits ?? []).length;

        for (const [personId, net] of standingAfter(stretches, closing, settled)) {
          expect(abs(net), `${where}, ${personId}`).toBeLessThanOrEqual(1_000_000n);
        }

        // The transfers pay each net to within half a cent per transfer.
        expect(settled.transfers.length, where).toBeLessThan(size);
        const paid = new Map<string, number>();
        for (const { fromId, toId, cents } of settled.transfers) {
          paid.set(fromId, (paid.get(fromId) ?? 0) + cents);
          paid.set(toId, (paid.get(toId) ?? 0) - cents);
        }
        for (const [personId, net] of nets) {
          const off = abs(net - BigInt(paid.get(personId) ?? 0) * 1_000_000n);
          expect(off, `${where}, ${personId}`).toBeLessThanOrEqual(
            BigInt(settled.transfers.length) * 500_000n,
          );
        }
      }
      // Several deposits a close, not one: the draw is not two people in disguise.
      expect(deposited).toBeGreaterThan(3_000 * (size - 2));
    },
  );

  test("rounding each deposit alone would leave a person more than a cent off; rounded together, none is", () => {
    // Found by search over skewed five-person salaries (lg-23's Log): dana's
    // share is tiny and furthest ahead, so everyone else tops up a great deal,
    // and three of the four deposits round up at once under half-up.
    const ratio = ratioFromSalaries([
      { personId: "alex", amountCents: 8_376_323 },
      { personId: "blair", amountCents: 48_916 },
      { personId: "casey", amountCents: 15_556 },
      { personId: "dana", amountCents: 31 },
      { personId: "eli", amountCents: 174_040 },
    ]);
    const amounts = [36_574, 30_483, 16_382, 36_413, 2_957];
    const stretch: Stretch = {
      ratio,
      contributions: NAMES.map((personId, index) => ({ personId, cents: amounts[index] ?? 0 })),
      charges: [],
    };
    const settled = settleHousehold([stretch], ratio);

    expect(settled.deposits).toEqual([
      { personId: "alex", depositCents: 8_851_144_434 },
      { personId: "blair", depositCents: 51_657_771 },
      { personId: "casey", depositCents: 16_424_087 },
      { personId: "eli", depositCents: 183_900_899 },
    ]);
    const worst = (after: Map<string, bigint>): bigint =>
      [...after.values()].reduce((most, net) => (abs(net) > most ? abs(net) : most), 0n);
    expect(worst(standingAfter([stretch], ratio, settled))).toBeLessThanOrEqual(1_000_000n);
    // casey's and eli's deposits each rounded up instead, as half-up alone would.
    const halfUp: HouseholdSettlement = {
      ...settled,
      deposits: (settled.deposits ?? []).map((deposit) =>
        deposit.personId === "casey" || deposit.personId === "eli"
          ? { ...deposit, depositCents: deposit.depositCents + 1 }
          : deposit,
      ),
    };
    expect(worst(standingAfter([stretch], ratio, halfUp))).toBeGreaterThan(1_000_000n);
  });
});

describe("a worked example", () => {
  test("three equal shares: everyone short tops up to the one furthest ahead", () => {
    const ratio = [
      { personId: "alex", partsPerMillion: 333_334 },
      { personId: "casey", partsPerMillion: 333_333 },
      { personId: "sam", partsPerMillion: 333_333 },
    ];
    // casey put in 60.00, sam 30.00, alex nothing.
    const settled = settleHousehold(
      [
        {
          ratio,
          contributions: [
            { personId: "casey", cents: 6_000 },
            { personId: "sam", cents: 3_000 },
          ],
          charges: [],
        },
      ],
      ratio,
    );

    expect(settled).toEqual({
      formula: "v3",
      people: ["alex", "casey", "sam"],
      deposits: [
        { personId: "alex", depositCents: 6_000 },
        { personId: "sam", depositCents: 3_000 },
      ],
      // alex owes 30.00 of the 90.00 at a third: 30.00 to casey. sam's third
      // is 30.00, which sam put in.
      transfers: [{ fromId: "alex", toId: "casey", cents: 3_000 }],
    });
  });
});

describe("a person who joins or leaves at a boundary", () => {
  const before = [
    { personId: "alex", partsPerMillion: 600_000 },
    { personId: "sam", partsPerMillion: 400_000 },
  ];
  const after = [
    { personId: "alex", partsPerMillion: 500_000 },
    { personId: "casey", partsPerMillion: 500_000 },
  ];

  test("is in no stretch they were not part of, so what they were owed stays theirs", () => {
    // sam spent 100.00 at 0.6/0.4 and left; casey joined and spent nothing.
    const settled = settleHousehold(
      [
        { ratio: before, contributions: [{ personId: "sam", cents: 10_000 }], charges: [] },
        { ratio: after, contributions: [], charges: [] },
      ],
      after,
    );

    // alex owes sam 60.00. sam has no share of the buffer now, so a deposit into
    // it could never reach sam: only the direct transfer settles it.
    expect(settled).toEqual({
      formula: "v3",
      people: ["alex", "casey", "sam"],
      deposits: null,
      transfers: [{ fromId: "alex", toId: "sam", cents: 6_000 }],
    });
  });

  test("owing nothing, they are no reason to pay directly", () => {
    const settled = settleHousehold(
      [
        {
          ratio: before,
          contributions: [
            { personId: "alex", cents: 6_000 },
            { personId: "sam", cents: 4_000 },
          ],
          charges: [],
        },
        { ratio: after, contributions: [{ personId: "casey", cents: 1_000 }], charges: [] },
      ],
      after,
    );

    expect(settled.deposits).toEqual([{ personId: "alex", depositCents: 1_000 }]);
    expect(settled.transfers).toEqual([{ fromId: "alex", toId: "casey", cents: 500 }]);
  });

  test("cumulativeHouseholdSettlement weighs each period at its own people", () => {
    const settled = cumulativeHouseholdSettlement(
      [
        { start: null, end: "2027-01-31", ratio: before },
        { start: "2027-02-01", end: "2027-02-28", ratio: after },
      ],
      [{ personId: "sam", date: "2027-01-10", amountCents: 10_000, chargedTo: null }],
      [],
    );

    expect(settled.deposits).toBeNull();
    expect(settled.transfers).toEqual([{ fromId: "alex", toId: "sam", cents: 6_000 }]);
  });
});
