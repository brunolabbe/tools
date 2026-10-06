/*
 * dl-79: the loader behind the untyped-manifest pages. A hand-rolled `fetch`
 * chain with no MediaSource, like hls.html: it fetches a playlist from a route
 * with no extension and a type that says nothing, then the segments it names.
 *
 * Each page calls this with literal routes. Taking them from `location.search`
 * instead made CodeQL report a client-side request forgery, which is true of any
 * page that fetches what its own url tells it to.
 */
window.playUntyped = (playlistUrl, segmentUrls) => {
  const status = document.getElementById("status");
  status.textContent = "loading";
  fetch(playlistUrl)
    .then((response) => response.text())
    .then(() =>
      Promise.all(segmentUrls.map((url) => fetch(url).then((response) => response.arrayBuffer()))),
    )
    .then(() => {
      status.textContent = "segments fetched";
      return true;
    })
    .catch(() => {});
};
