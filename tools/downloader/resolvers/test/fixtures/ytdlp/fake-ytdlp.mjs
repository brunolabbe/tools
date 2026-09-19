// A stand-in for the yt-dlp binary so the spawn path — argument arrays, exit
// codes, stderr classification and process-tree kill — is exercised without a
// network call or a real install. `mode` is argv[2]; everything after it is
// whatever YtDlpResolver decided to pass, and is deliberately ignored.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "youtube-like";
const here = dirname(fileURLToPath(import.meta.url));

switch (mode) {
  case "hang": {
    // Never exits: the resolver must kill the tree when the signal aborts.
    setInterval(() => {}, 1000);
    break;
  }
  case "unsupported": {
    process.stderr.write("ERROR: Unsupported URL: https://intranet.example.org/lecture/17\n");
    process.exitCode = 1;
    break;
  }
  // dl-67. Echoes back whatever URL the resolver actually passed on argv —
  // the last argument — verbatim, the way yt-dlp's real "Unsupported URL"
  // line does. Lets a test put a source-fact marker (`drm`, …) in the request
  // URL's own text and assert it is not read as a fact about the page.
  case "unsupported-echo": {
    const requestUrl = process.argv.at(-1) ?? "";
    process.stderr.write(`ERROR: Unsupported URL: ${requestUrl}\n`);
    process.exitCode = 1;
    break;
  }
  // dl-67. Same shape, but percent-normalises the URL the way the real
  // binary does before echoing it: only an escape whose byte is an
  // unreserved character (RFC 3986 §6.2.2.2) is decoded; every other escape
  // is left exactly as given. **Measured**, not assumed — run against
  // `/usr/local/bin/yt-dlp` 2025.09.26 on 2026-09-19, a request for
  // `http://127.0.0.1:PORT/%41%7e%2d%5f%2e/%c3%a9/%2f%3F%20/x?a=%64rm&b=%2F`
  // came back in `Unsupported URL: …` as
  // `…/A~-_./%c3%a9/%2f%3F%20/x?a=drm&b=%2F` — `%41 %7e %2d %5f %2e %64`
  // (all unreserved) decoded, `%2f %3F %20` and the multi-byte `%c3%a9` left
  // alone. Deliberately not `decodeURI`, which also decodes `%20` and
  // multi-byte UTF-8 escapes and so disagrees with the real binary on
  // exactly those cases — an earlier draft used it here and the mismatch
  // went unnoticed until a gate reproduced this against the real binary.
  case "unsupported-echo-unreserved-decode": {
    const requestUrl = process.argv.at(-1) ?? "";
    const echoed = requestUrl.replaceAll(/%[0-9A-Fa-f]{2}/gu, (escape) => {
      const char = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      return /^[A-Za-z0-9\-._~]$/u.test(char) ? char : escape;
    });
    process.stderr.write(`ERROR: Unsupported URL: ${echoed}\n`);
    process.exitCode = 1;
    break;
  }
  // dl-67 gate finding. Text immediately abuts the URL on both sides with no
  // separator, the way stripping-then-fusing could turn into an accidental
  // marker ("dr" + "" + "m" reading as "drm") if the mask joined the pieces
  // back together with the empty string instead of a space.
  case "adjacent-text-fusion": {
    const requestUrl = process.argv.at(-1) ?? "";
    process.stderr.write(`ERROR: dr${requestUrl}m is unsupported\n`);
    process.exitCode = 1;
    break;
  }
  case "drm": {
    process.stderr.write("ERROR: [brightcove] 6301234567001: This video is DRM protected\n");
    process.exitCode = 1;
    break;
  }
  // dl-67. A genuine DRM diagnosis *and* an echoed request URL in the same
  // stderr, so a test can prove masking the URL substring does not also
  // swallow a real marker that sits outside it.
  case "drm-and-url-echo": {
    const requestUrl = process.argv.at(-1) ?? "";
    process.stderr.write(
      `ERROR: [brightcove] 6301234567001: This video is DRM protected\nERROR: Unsupported URL: ${requestUrl}\n`,
    );
    process.exitCode = 1;
    break;
  }
  case "login": {
    process.stderr.write(
      "ERROR: [youtube] xyz: Private video. Sign in if you've been granted access to this video\n",
    );
    process.exitCode = 1;
    break;
  }
  case "geo": {
    process.stderr.write(
      "ERROR: [generic] The uploader has not made this video available in your country\n",
    );
    process.exitCode = 1;
    break;
  }
  // Verbatim. Produced on 2026-09-03 by running the real yt-dlp (2025.09.26,
  // default `urllib` backend) against a self-signed loopback HTTPS origin, and
  // pasted rather than paraphrased: dl-34's classifier matches on these
  // substrings, so a fixture that reworded them would be testing the fixture.
  // The line carries all three of the measured markers at once, which is what
  // yt-dlp actually emits — `[SSL: CERTIFICATE_VERIFY_FAILED]`, `certificate
  // verify failed` and `CertificateVerifyError` are one message, not three.
  case "tls": {
    process.stderr.write(
      "ERROR: [generic] Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate (_ssl.c:1032) (caused by CertificateVerifyError('[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate (_ssl.c:1032)')); please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U\n",
    );
    process.exitCode = 1;
    break;
  }
  // The same refusal from libcurl's vocabulary, which is what yt-dlp prints on
  // the `curl_cffi` backend. **Not measured**: neither `curl_cffi` nor
  // `requests` is installed where this fixture was written, so only the default
  // backend above could be provoked. Kept so the second marker is exercised at
  // all rather than being a line nothing reaches.
  case "tls-curl": {
    process.stderr.write(
      "ERROR: [generic] Unable to download webpage: SSL certificate problem: self-signed certificate\n",
    );
    process.exitCode = 1;
    break;
  }
  // A gate finding on dl-34, produced rather than reasoned. Verbatim, from a
  // real two-level chain (root -> intermediate -> leaf) served with only the
  // leaf, against the real yt-dlp binary on 2026-09-03 — deliberately distinct
  // from "tls" above, whose reason is "self-signed certificate" rather than
  // this one's "unable to get local issuer certificate". The two look almost
  // identical on the wire and mean different things: this is an *incomplete
  // chain*, which a browser can frequently repair itself (AIA chasing) and
  // urllib's default validation cannot. It must NOT classify as
  // TLS_VERIFICATION_FAILED — see `ytdlpCertificateMarker`'s exclusion list.
  case "tls-incomplete-chain": {
    process.stderr.write(
      "ERROR: [generic] Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1032) (caused by CertificateVerifyError('[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1032)')); please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U\n",
    );
    process.exitCode = 1;
    break;
  }
  // A refusal whose stderr also trips every looser branch in `classifyFailure`.
  // Contrived on purpose: it pins the *order* of the checks, which is the part
  // a later edit could silently undo.
  case "tls-and-drm": {
    process.stderr.write(
      "ERROR: [generic] Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed; the video is DRM protected, not available in your country, and you must sign in. HTTP Error 429: Too Many Requests\n",
    );
    process.exitCode = 1;
    break;
  }
  case "garbage": {
    process.stdout.write("this is not json\n");
    break;
  }
  case "echo-args": {
    // Reports the arguments it was invoked with as the video title, which is the
    // shortest path from "what did the resolver decide to pass" to an assertion.
    //
    // `SSL_CERT_FILE` is appended because dl-37's trust plumbing is half an
    // argument and half an environment variable, and only asserting the half in
    // argv would pass with the other half missing — which is the exact state
    // that leaves yt-dlp reading its bundled `certifi` and failing every origin
    // behind a terminating proxy.
    process.stdout.write(
      JSON.stringify({
        title: `${process.argv.slice(3).join(" ")} SSL_CERT_FILE=${process.env.SSL_CERT_FILE ?? ""}`,
        formats: [
          {
            format_id: "1",
            url: "https://cdn.example/v.mp4",
            protocol: "https",
            ext: "mp4",
            vcodec: "avc1.640028",
            acodec: "mp4a.40.2",
          },
        ],
      }),
    );
    break;
  }
  default: {
    process.stdout.write(readFileSync(join(here, `${mode}.json`), "utf8"));
  }
}
