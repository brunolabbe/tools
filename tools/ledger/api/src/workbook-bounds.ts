/**
 * The two bounds on what a workbook's sheets hold that `xlsx.ts` enforces while it
 * reads them, before a sheet's grid is built (lg-96). They sit here and not in
 * `workbook-describe.ts` so the reader does not import the route's module, which
 * hands the reader in as a dependency.
 */

/** Rows over every sheet, as `xlsx.ts` reads them: `lg37`, the largest measured, holds 320. */
export const MAX_WORKBOOK_ROWS = 20_000;

/**
 * The places a workbook's sheets build, over every sheet: each row is a place of its
 * own and each cell along it another, a row counting as wide as its last cell that
 * holds a value. 2 000 000 is about 22 MB at the 11 MB per million places that a far
 * column was measured to cost; the one real workbook measured holds 11 196 (14
 * sheets, 1 719 rows, the largest sheet 121 rows by 13 columns).
 */
export const MAX_WORKBOOK_SLOTS = 2_000_000;
