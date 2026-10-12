/**
 * What an address Access admits and the household directory does not sees
 * (lg-20): one filed by nobody yet, one since removed, or an admin who is in no
 * household. It names nobody and nothing — not the address, not a household,
 * not who runs the ledger — because whoever reads it holds none of the books.
 */

export function NoHousehold(): React.ReactElement {
  return (
    <section aria-labelledby="no-household">
      <h2 id="no-household">No household</h2>
      <p>
        This address does not belong to a household in the ledger, so there are no books to show.
      </p>
      <p className="muted">
        If it should, ask whoever runs the ledger to add it, then reload this page.
      </p>
    </section>
  );
}
