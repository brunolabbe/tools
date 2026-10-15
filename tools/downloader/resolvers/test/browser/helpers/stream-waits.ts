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
