/**
 * The waits a test passes only when it expects a stream (dl-115).
 *
 * `BrowserResolver`'s quiet phase is held by `minWaitMs` (1200 ms), not by
 * `quietMs`: a normal page's last request lands at least 900 ms before the wait
 * begins, so a `quietMs` of 1200 never decided anything. A test that expects a
 * stream and does not get one fails loudly, which is why it may wait less. A
 * test that expects no media must not take this: a shorter wait only makes
 * `NO_MEDIA_FOUND` easier to reach, and weakens the test.
 *
 * 200 ms is the tick of the wait loop (`waitForQuiet`), the least it can mean.
 * `minWaitMs` only applies once a playable hit is captured; until then
 * `emptyMinWaitMs` holds the wait, and the overlay revisit (which runs only while
 * nothing is captured) rides on that one, so shortening this leaves it alone.
 * `quietMs` moves with it because, with the minimum gone, it is what would hold
 * the wait: left at 1200 it would cost the 300 ms this was meant to save.
 */
export const STREAM_WAITS = { quietMs: 200, minWaitMs: 200 } as const;

/**
 * `STREAM_WAITS` and the two fixed sleeps shortened (dl-129, decision A).
 *
 * `BrowserResolver` pays 500 ms (`LANDING_URL_SETTLE_MS`) after `load` and 900 ms
 * (`PROVOKE_PASS_PAUSE_MS`) between its two provocation passes on every probe. The
 * first proves nothing but a redirect or a router rewrite that lands after `load`
 * (dl-55); the second covers a player that mounts late. A page whose player is on
 * the document at once needs neither, and 200 ms is the wait loop's tick, the
 * least a wait here can mean.
 *
 * **Only a test that expects a stream, whose fixture has no timer, no input-gated
 * mount and no late layer, and that does not assert something was left unpressed
 * or unrequested, may take this.** A not-pressed assertion is what the second pass
 * guards: it runs after the first pass's stream is captured, and a pause too short
 * for the request to land lets a step press what `hasPlayable` would have held
 * back. The tests that prove either sleep, and the negative tests, keep the
 * production values.
 */
export const AT_ONCE_WAITS = {
  ...STREAM_WAITS,
  landingSettleMs: 200,
  passPauseMs: 200,
} as const;
