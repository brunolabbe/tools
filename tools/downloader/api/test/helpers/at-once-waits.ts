/**
 * `BrowserResolver`'s shortened waits for an api test whose page fetches its
 * manifest at once (dl-134).
 *
 * A copy of `AT_ONCE_WAITS` in
 * `tools/downloader/resolvers/test/browser/helpers/stream-waits.ts`, which
 * carries the reasoning and the rule: **only a test that cannot pass unless the
 * stream is captured may take it.** A test that asserts something was not
 * requested or not pressed keeps the production waits, because a shorter wait
 * only makes it easier to pass. It is copied, not imported, since `api` tests
 * do not reach into another package's `test/`; lift it to one shared file if a
 * third package wants it.
 */
export const AT_ONCE_WAITS = {
  quietMs: 200,
  minWaitMs: 200,
  landingSettleMs: 200,
  passPauseMs: 200,
} as const;
