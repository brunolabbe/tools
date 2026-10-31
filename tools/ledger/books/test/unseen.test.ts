/**
 * The characters no one can see or type back (lg-52, lg-57, lg-82): which text holds
 * one, and how it is printed instead. The characters are built, never typed.
 */

import { describe, expect, test } from "vitest";
import { escapeUnseen, hasUnseen } from "../src/index.ts";

const at = (code: number): string => String.fromCharCode(code);

describe("hasUnseen", () => {
  test("is true at the edges of each range and false just outside them", () => {
    for (const code of [0x00, 0x1f, 0x7f, 0x80, 0x9f, 0x200b, 0x200c, 0x200d, 0xfeff]) {
      expect(hasUnseen(`a${at(code)}b`), code.toString(16)).toBe(true);
    }
    for (const code of [0x20, 0x7e, 0xa0, 0x200a, 0x200e, 0x2028, 0xfefe]) {
      expect(hasUnseen(`a${at(code)}b`), code.toString(16)).toBe(false);
    }
    expect(hasUnseen("Zoé")).toBe(false);
  });
});

describe("escapeUnseen", () => {
  test("writes each as its six-character escape and leaves other text as it was", () => {
    expect(escapeUnseen(`a${at(0x1b)}b`)).toBe("a\\u001bb");
    expect(escapeUnseen(`${at(0)}${at(0x9b)}${at(0x200d)}${at(0xfeff)}`)).toBe(
      "\\u0000\\u009b\\u200d\\ufeff",
    );
    expect(escapeUnseen("Zoé 山田")).toBe("Zoé 山田");
    expect(escapeUnseen("")).toBe("");
  });

  test("is not applied twice to what it wrote", () => {
    const once = escapeUnseen(`a${at(0x1b)}b`);

    expect(escapeUnseen(once)).toBe(once);
  });
});
