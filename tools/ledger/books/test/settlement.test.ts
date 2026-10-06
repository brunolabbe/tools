/**
 * The settlement (lg-6): the matching rule, cumulative, with charges, rounded
 * once (`docs/00-ANALYSIS.md` §5). alex is the analysis's A and sam its B, so
 * alex's share is r. Every amount is invented.
 */

import { describe, expect, test } from "vitest";
import { cumulativeSettlement, settleStretches, settlement } from "../src/index.ts";
import type { Charge, PersonCents, Share, WeighedPeriod } from "../src/index.ts";

function ratio(alex: number): Share[] {
  return [
    { personId: "alex", partsPerMillion: alex },
    { personId: "sam", partsPerMillion: 1_000_000 - alex },
  ];
}

const R60 = ratio(600_000);

function spent(personId: string, cents: number): PersonCents {
  return { personId, cents };
}

/**
 * What a person bears, in millionths of a cent: their cash out, less their share
 * of what is left in the buffer, which is shared money owned at the ratio.
 */
function bears(cashOutCents: number, bufferCents: number, partsPerMillion: number): bigint {
  return BigInt(cashOutCents) * 1_000_000n - BigInt(bufferCents) * BigInt(partsPerMillion);
}

const DOLLARS = 100_000_000n; // one dollar, in millionths of a cent

describe("settlement, the analysis's §5 table", () => {
  test("at r = 0.6, B spends 100 and A nothing, so A deposits 150.00", () => {
    const result = settlement([spent("sam", 10_000)], [], R60);

    expect(result).toEqual({
      formula: "v3",
      payerId: "alex",
      recipientId: "sam",
      depositCents: 15_000,
      // v2's amount, which is right only for a direct payment.
      netCents: 6_000,
    });
  });

  test("the three ways of settling: only the direct payment and the matching deposit are exact", () => {
    // The buffer starts at 1 000, funded at the ratio; B buys 100 of groceries;
    // A settles; then the buffer buys a 500 snowblower. Fair: A bears 360, B 240.
    const { depositCents, netCents } = settlement([spent("sam", 10_000)], [], R60);
    const outcome = (alexDeposit: number, alexToSam: number) => {
      const buffer = 100_000 + alexDeposit - 50_000;
      return {
        alex: bears(60_000 + alexDeposit + alexToSam, buffer, 600_000),
        sam: bears(40_000 + 10_000 - alexToSam, buffer, 400_000),
      };
    };

    expect(outcome(netCents, 0)).toEqual({ alex: 324n * DOLLARS, sam: 276n * DOLLARS });
    expect(outcome(0, netCents)).toEqual({ alex: 360n * DOLLARS, sam: 240n * DOLLARS });
    expect(outcome(depositCents ?? 0, 0)).toEqual({ alex: 360n * DOLLARS, sam: 240n * DOLLARS });
  });

  test("the matching rule in the other direction: B deposits −net / r", () => {
    // A spent 100 and B nothing: B owes 40 directly, or 40 / 0.6 into the buffer.
    expect(settlement([spent("alex", 10_000)], [], R60)).toMatchObject({
      payerId: "sam",
      recipientId: "alex",
      netCents: 4_000,
      depositCents: 6_667,
    });
  });

  test("two contributions already at the ratio owe nothing", () => {
    expect(settlement([spent("alex", 15_000), spent("sam", 10_000)], [], R60)).toEqual({
      formula: "v3",
      payerId: null,
      recipientId: null,
      depositCents: 0,
      netCents: 0,
    });
  });
});

describe("charges", () => {
  test("a charge is owed in full, and goes into the buffer divided by the recipient's share", () => {
    // alex paid 50 for something that was entirely sam's.
    const charge: Charge = { owedBy: "sam", owedTo: "alex", cents: 5_000 };

    expect(settlement([], [charge], R60)).toMatchObject({
      payerId: "sam",
      recipientId: "alex",
      netCents: 5_000,
      depositCents: 8_333,
    });
  });

  test("charges in both directions net against each other and against the shared imbalance", () => {
    const charges: Charge[] = [
      { owedBy: "alex", owedTo: "sam", cents: 3_000 },
      { owedBy: "sam", owedTo: "alex", cents: 1_000 },
    ];
    // Shared: 0.6 × 100 − 0 = 60 owed by alex; charges: +30 − 10.
    expect(settlement([spent("sam", 10_000)], charges, R60)).toMatchObject({
      payerId: "alex",
      netCents: 8_000,
      depositCents: 20_000,
    });
  });
});

describe("rounding", () => {
  test("happens once, half-up, on the final figure and never per stretch", () => {
    // Each stretch alone asks 1.5 cents of alex, which would round to 2 each.
    const stretch = { ratio: R60, contributions: [spent("sam", 1)], charges: [] };
    const result = settleStretches([stretch, stretch, stretch], R60);

    expect(result.depositCents).toBe(5); // 4.5, rounded once
    expect(result.netCents).toBe(2); // 1.8
  });

  test("a half cent rounds up, whichever person owes", () => {
    const half = ratio(500_000);
    expect(settlement([spent("sam", 1)], [], half).netCents).toBe(1);
    expect(settlement([spent("alex", 1)], [], half).netCents).toBe(1);
  });
});

describe("a ratio change at a period boundary", () => {
  test("carries what was owed over as money, and divides it at the new ratio", () => {
    // Under 0.6, sam spent 100: alex owed sam 60, directly.
    const before = { ratio: R60, contributions: [spent("sam", 10_000)], charges: [] };
    const fifty = ratio(500_000);
    const result = settleStretches(
      [before, { ratio: fifty, contributions: [], charges: [] }],
      fifty,
    );

    // Still 60 owed: the debt did not change when the ratio did. Reweighing the
    // whole history at 0.5 would have made it 50.
    expect(result.netCents).toBe(6_000);
    // Into a buffer now owned 50:50, 60 of debt takes 120.
    expect(result.depositCents).toBe(12_000);
  });

  test("a long stretch at one ratio settles the same as the same stretch cut into pieces", () => {
    const lines = [spent("sam", 12_345), spent("alex", 3_001), spent("sam", 999), spent("alex", 7)];
    const ratioNow = ratio(604_877);
    const whole = settlement(lines, [], ratioNow);
    const pieces = settleStretches(
      lines.map((one) => ({ ratio: ratioNow, contributions: [one], charges: [] })),
      ratioNow,
    );

    expect(pieces).toEqual(whole);
  });
});

describe("refusals", () => {
  test("a contribution from someone the ratio does not name", () => {
    expect(() => settlement([spent("casey", 100)], [], R60)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });

  test("a recipient whose share is zero can only be paid directly", () => {
    const allAlex = ratio(1_000_000);
    expect(settlement([spent("sam", 10_000)], [], allAlex)).toMatchObject({
      payerId: "alex",
      recipientId: "sam",
      netCents: 10_000,
      depositCents: null,
    });
  });
});

/** A closed or closing period. */
function period(start: string | null, end: string, alexShare = 600_000): WeighedPeriod {
  return { start, end, ratio: ratio(alexShare) };
}

function line(
  personId: string,
  date: string,
  amountCents: number,
  chargedTo: string | null = null,
) {
  return { personId, date, amountCents, chargedTo };
}

describe("cumulative, over periods", () => {
  test("a settlement that asked too little is caught up by the next close, which then stands exactly at the ratio", () => {
    const first = period(null, "2026-03-31");
    const second = period("2026-04-01", "2026-06-30");
    const third = period("2026-07-01", "2026-09-30");
    const lines = [line("sam", "2026-02-10", 10_000), line("sam", "2026-05-03", 5_000)];
    // The first period was settled with v2's amount, 60, where 150 was owed.
    const deposits = [{ personId: "alex", date: "2026-04-03", amountCents: 6_000 }];

    const next = cumulativeSettlement([first, second], lines, deposits);

    // Alone, the second period would ask 50 × 1.5 = 75; the 90 left short is
    // caught up with it in one deposit.
    expect(next.depositCents).toBe(16_500);
    expect(next.payerId).toBe("alex");

    // After that deposit the two contributions, 225 and 150, stand at 0.6 to
    // the part per million: exactly, with no remainder.
    const paid = [...deposits, { personId: "alex", date: "2026-07-02", amountCents: 16_500 }];
    const alex = 6_000 + 16_500;
    const total = alex + 15_000;
    expect((alex * 1_000_000) % total).toBe(0);
    expect((alex * 1_000_000) / total).toBe(600_000);
    // And the next close, with nothing new, settles at nothing.
    expect(cumulativeSettlement([first, second, third], lines, paid)).toMatchObject({
      payerId: null,
      depositCents: 0,
    });
  });

  test("at a ratio with four decimals of a percent, the catch-up lands within a part per million", () => {
    const share = 604_877;
    const periods = [period(null, "2026-03-31", share), period("2026-04-01", "2026-06-30", share)];
    const lines = [
      line("sam", "2026-01-15", 412_345),
      line("alex", "2026-02-02", 98_765),
      line("sam", "2026-05-20", 377_701),
      line("alex", "2026-06-11", 51_003),
    ];
    // An under-asked first settlement: a deposit that was a third of what it should have been.
    const deposits = [{ personId: "alex", date: "2026-04-02", amountCents: 150_000 }];

    const { depositCents, payerId } = cumulativeSettlement(periods, lines, deposits);
    expect(payerId).toBe("alex");

    const alex = 98_765 + 51_003 + 150_000 + (depositCents ?? 0);
    const total = alex + 412_345 + 377_701;
    expect(Math.round((alex * 1_000_000) / total)).toBe(share);
  });

  test("leaves out what is dated before the first period's start, or after the closing period's end", () => {
    const periods = [period("2026-01-01", "2026-03-31")];
    const lines = [
      line("sam", "2025-12-31", 99_999),
      line("sam", "2026-02-01", 10_000),
      line("sam", "2026-04-01", 99_999),
    ];

    expect(cumulativeSettlement(periods, lines, []).depositCents).toBe(15_000);
  });

  test("weighs each period at its own ratio, and divides at the closing period's", () => {
    const periods = [
      period(null, "2026-03-31", 600_000),
      period("2026-04-01", "2026-06-30", 500_000),
    ];

    const result = cumulativeSettlement(periods, [line("sam", "2026-03-01", 10_000)], []);

    expect(result).toMatchObject({ netCents: 6_000, depositCents: 12_000 });
  });

  test("a line charged to the other person is a charge, not a contribution", () => {
    const periods = [period(null, "2026-03-31")];

    const result = cumulativeSettlement(periods, [line("alex", "2026-03-01", 5_000, "sam")], []);

    expect(result).toMatchObject({ payerId: "sam", netCents: 5_000 });
  });
});

/** A small, seeded generator, so a failure names a mix that can be re-run. */
function generator(seed: number): (below: number) => number {
  let state = seed;
  return (below) => {
    state = (state * 48_271) % 2_147_483_647;
    return state % below;
  };
}

describe("the settlement's promise, simulated", () => {
  // Random mixes of card spending, charges in both directions, buffer deposits
  // off the ratio and payments out of the buffer. After the computed deposit,
  // with the buffer owned at the ratio, each person's cash out less their share
  // of the buffer is what they consumed, to the cent (§5, _Charges between the
  // two_). Amounts are exact, in millionths of a cent.
  function simulate(seed: number, settle: "matching" | "v2") {
    const next = generator(seed);
    const share = 100_000 + next(800_001);
    const shares = { alex: BigInt(share), sam: BigInt(1_000_000 - share) };
    const people = ["alex", "sam"] as const;
    const card = { alex: 0, sam: 0 };
    const deposited = { alex: 0, sam: 0 };
    const charged = { alex: 0, sam: 0 }; // what each paid for the other
    let payments = 0;
    for (let index = 0; index < 5 + next(30); index++) {
      const who = people[next(2)] ?? "alex";
      const cents = 1 + next(80_000);
      const kind = next(4);
      if (kind === 0) card[who] += cents;
      else if (kind === 1) deposited[who] += cents;
      else if (kind === 2) charged[who] += cents;
      else payments += cents;
    }
    const contributions = people.map((personId) =>
      spent(personId, card[personId] + deposited[personId]),
    );
    const charges: Charge[] = [
      { owedBy: "sam", owedTo: "alex", cents: charged.alex },
      { owedBy: "alex", owedTo: "sam", cents: charged.sam },
    ];
    const result = settlement(contributions, charges, ratio(share));
    const amount = settle === "matching" ? (result.depositCents ?? 0) : result.netCents;
    if (result.payerId === "alex" || result.payerId === "sam") deposited[result.payerId] += amount;

    const buffer = deposited.alex + deposited.sam - payments;
    const sharedSpending = BigInt(card.alex + card.sam + payments);
    const consumed = {
      alex: shares.alex * sharedSpending + 1_000_000n * BigInt(charged.sam),
      sam: shares.sam * sharedSpending + 1_000_000n * BigInt(charged.alex),
    };
    return people.map((personId) => {
      const cashOut = card[personId] + deposited[personId] + charged[personId];
      return bears(cashOut, buffer, Number(shares[personId])) - consumed[personId];
    });
  }

  test("each person's cash out less their buffer share equals what they consumed, to the cent", () => {
    for (let seed = 1; seed <= 500; seed++) {
      for (const difference of simulate(seed, "matching")) {
        // Within half a cent: the one rounding there is.
        expect(
          difference < 0n ? -difference : difference,
          `seed ${String(seed)}`,
        ).toBeLessThanOrEqual(500_000n);
      }
    }
  });

  test("and the simulation can fail: v2's direct amount, deposited into the buffer, misses", () => {
    let missed = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const [alex = 0n] = simulate(seed, "v2");
      if ((alex < 0n ? -alex : alex) > 1_000_000n) missed++;
    }
    expect(missed).toBeGreaterThan(450);
  });
});

// Gate 1, med 2: paying exactly what was asked leaves less than half a cent,
// which must not name a payer at 0.00.
describe("after the asked deposit is paid", () => {
  test("a figure that did not divide evenly still settles the next close at nothing", () => {
    const first = period(null, "2026-09-30");
    const next = period("2026-10-01", "2026-12-31");
    const lines = [line("sam", "2026-09-10", 10_001)];

    const asked = cumulativeSettlement([first], lines, []);
    // 100.01 × 1.5 = 150.015, asked as 150.02.
    expect(asked.depositCents).toBe(15_002);
    const paid = [{ personId: "alex", date: "2026-10-02", amountCents: 15_002 }];

    expect(cumulativeSettlement([first, next], lines, paid)).toEqual({
      formula: "v3",
      payerId: null,
      recipientId: null,
      depositCents: 0,
      netCents: 0,
    });
  });

  test("over many odd amounts and ratios, the next close never names a payer at 0.00", () => {
    const next = generator(11);
    for (let trial = 0; trial < 2_000; trial++) {
      const share = 1 + next(999_999);
      const ratioNow = ratio(share);
      const who = next(2) === 0 ? "alex" : "sam";
      const lines = [spent(who, 1 + next(500_000))];
      const asked = settlement(lines, [], ratioNow);
      if (asked.payerId === null || asked.depositCents === null) continue;
      const after = settlement([...lines, spent(asked.payerId, asked.depositCents)], [], ratioNow);
      if (after.payerId !== null) {
        expect(after.depositCents, `trial ${String(trial)}`).toBeGreaterThan(0);
      }
    }
  });
});
