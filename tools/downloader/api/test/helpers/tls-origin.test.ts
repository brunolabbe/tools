/**
 * dl-36: the fixture certificates' serial numbers encoded as *negative* DER
 * integers, which RFC 5280 §4.1.2.2 forbids.
 *
 * The value under test is a hex string, so that is what this asserts. Nine
 * 2048-bit keypairs would be slow and would prove less — the certificate is not
 * where the encoding can go wrong. What the certificate *does* add is the
 * writer, so each case also goes through `node-forge`'s own ASN.1 encoder, the
 * one `forge.pki.createCertificate()` reaches: it is what proves the `00`
 * prefix survives to the DER rather than being minimised back off.
 *
 * The counters below are the ones a real run never reaches. The suite has nine
 * `createFixtureCertificate` call sites and the counter is per-process, so
 * nothing observed the defect — which is why it is worth a test and not a bug
 * report.
 */

import forge from "node-forge";
import { describe, expect, test } from "vitest";
import { fixtureSerialNumberHex } from "./tls-origin.ts";

/**
 * Measured, not derived: each row is what `node-forge` actually writes. The
 * `expected` hex is asserted exactly so that a fix which pads correctly but
 * changes the number is caught by the same test that checks the padding.
 */
const CASES = [
  { counter: 1, expected: "01", der: "020101" },
  { counter: 127, expected: "7f", der: "02017f" },
  { counter: 128, expected: "0080", der: "02020080" },
  { counter: 200, expected: "00c8", der: "020200c8" },
  { counter: 255, expected: "00ff", der: "020200ff" },
  { counter: 256, expected: "0100", der: "02020100" },
  { counter: 4095, expected: "0fff", der: "02020fff" },
  { counter: 4096, expected: "1000", der: "02021000" },
  { counter: 32768, expected: "008000", der: "0203008000" },
  { counter: 65535, expected: "00ffff", der: "020300ffff" },
  { counter: 65536, expected: "010000", der: "0203010000" },
] as const;

/** The serial hex through the ASN.1 writer `createCertificate()` uses. */
function derOfSerial(hex: string): string {
  const integer = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.INTEGER,
    false,
    forge.util.hexToBytes(hex),
  );
  return forge.util.bytesToHex(forge.asn1.toDer(integer).getBytes());
}

/** DER `INTEGER` content read the way a parser does: signed, two's complement. */
function readSignedDerInteger(derHex: string): bigint {
  const content = derHex.slice(4);
  const magnitude = BigInt(`0x${content}`);
  const negative = Number.parseInt(content.slice(0, 2), 16) >= 0x80;
  return negative ? magnitude - (1n << BigInt((content.length / 2) * 8)) : magnitude;
}

describe("the serial number a fixture certificate carries", () => {
  test.each(CASES)("counter $counter encodes as a positive integer", ({ counter, expected }) => {
    const hex = fixtureSerialNumberHex(counter);

    expect(hex).toBe(expected);
    // Even-length, so the string is a whole number of bytes.
    expect(hex.length % 2).toBe(0);
    // High bit clear on the leading byte, so the integer is not negative.
    expect(Number.parseInt(hex.slice(0, 2), 16)).toBeLessThan(0x80);
    // And it is still the number it came from: padding must not renumber.
    expect(Number.parseInt(hex, 16)).toBe(counter);
  });

  test.each(CASES)("counter $counter survives forge's DER writer", ({ counter, der }) => {
    const written = derOfSerial(fixtureSerialNumberHex(counter));

    expect(written).toBe(der);
    expect(readSignedDerInteger(written)).toBe(BigInt(counter));
  });

  test("every counter up to 70000 holds both properties", () => {
    const violations: number[] = [];
    for (let counter = 0; counter <= 70_000; counter += 1) {
      const hex = fixtureSerialNumberHex(counter);
      if (
        hex.length % 2 !== 0 ||
        Number.parseInt(hex.slice(0, 2), 16) >= 0x80 ||
        Number.parseInt(hex, 16) !== counter
      ) {
        violations.push(counter);
      }
    }

    // Summarised rather than asserted whole: the unfixed encoder violates this
    // for tens of thousands of counters, and a diff that long hides which.
    expect({ count: violations.length, first: violations.slice(0, 5) }).toEqual({
      count: 0,
      first: [],
    });
  });
});
