/**
 * The two bounds on what a workbook's sheets hold that `xlsx.ts` enforces while it
 * reads them, before a sheet's grid is built (lg-96). They sit here and not in
 * `workbook-describe.ts` so the reader does not import the route's module, which
 * hands the reader in as a dependency.
 */

/**
 * The last row a cell may be stored in, **in each sheet**: `xlsx.ts` refuses a sheet
 * with a value below it (`details.bound` `rows`). The route also sums the rows over
 * every sheet against this same number once they are read, which the import command
 * does not, so the command's workbook-wide rows are bounded only by `MAX_WORKBOOK_SLOTS`.
 * `lg37`, the largest measured, holds 320.
 */
export const MAX_WORKBOOK_ROWS = 20_000;

/**
 * The places a workbook's sheets build, over every sheet: each row is a place of its
 * own and each cell along it another, a row counting as wide as its last cell that
 * holds a value (`details.bound` `slots`). The one real workbook measured holds 11 196
 * (14 sheets, 1 719 rows, the largest sheet 121 rows by 13 columns).
 *
 * **What 2 000 000 costs depends on the shape, and it is not 22 MB.** The 22 MB was
 * case 4's 11 MB a million places, which is the widest rows alone; measured at the
 * cap, with SheetJS's parse of the file counted, one process at a time and growth of
 * the peak RSS over a baseline of about 85 MB: 122 rows with a cell at `XFD`, +39.6 MB;
 * 105 sheets of a cell at `A1` and one at `A19000`, whose gap rows are a place each,
 * +109.3 and +109.9 MB (peak 194 MB); and the worst built, a sheet of 1 400 rows by 100
 * numbers (140 000 cells) beside 97 such sheets, 1 983 000 places from a 3.9 MB file,
 * +127.1 and +129.0 MB (peak 217 MB). The container holds 512 MB. **These are the
 * worst measured for sheets that are each a part of their own, not the worst that gets
 * here**: SheetJS parses a part once for every sheet that names it, and that parse is
 * paid before anything here can charge it, so `xlsx.ts` refuses the rest first, by
 * SheetJS's own sheet list checked against `workbook-parts.ts` (round 1 refused only
 * the spellings that file knew, and 14 listings of one part with later ones spelled
 * `sheet_x0031_` read +375.1 MB through `readSheets`, gate 2's F2). That check still
 * judges distinct parts by a copy of SheetJS's rules, and gate 3 read +367.5 MB (peak
 * 448.9 MB) through a zip entry whose local-header name differs from its central one,
 * and +352.5 MB through a comments part that 14 sheets' `.rels` all name. lg-104 owns
 * those; this cap is not measured against them.
 */
export const MAX_WORKBOOK_SLOTS = 2_000_000;
