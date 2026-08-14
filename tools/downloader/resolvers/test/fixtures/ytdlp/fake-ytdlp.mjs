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
