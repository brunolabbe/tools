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
  case "drm": {
    process.stderr.write("ERROR: [brightcove] 6301234567001: This video is DRM protected\n");
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
    process.stdout.write(
      JSON.stringify({
        title: process.argv.slice(3).join(" "),
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
