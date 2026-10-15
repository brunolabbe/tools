/**
 * dl-125 probe. DO NOT MERGE. Reads one iteration's trace (see trace.mjs) and
 * prints it per engine ffmpeg: `compact` gives one line each, with the lines
 * the engine's dl-103 verdict reads (`partial file`, `Stream ends
 * prematurely`, `Will reconnect`), ffmpeg's own output size, and when stderr
 * ended, the process exited and its pipes closed; `full` prints every stderr
 * line with its time.
 *
 * Usage: node summarize.mjs <trace.jsonl> compact|full
 */
import { existsSync, readFileSync } from "node:fs";

const [file, mode = "compact"] = process.argv.slice(2);
if (file === undefined || !existsSync(file)) {
  process.stdout.write(`  (no trace at ${String(file)})\n`);
  process.exit(0);
}

const events = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line));

for (const event of events.filter((e) => e.event === "fixture")) {
  process.stdout.write(`  fixture: ${event.text}\n`);
}

const byProcess = new Map();
for (const event of events.filter((e) => e.event !== "fixture")) {
  const key = `${event.worker}/${event.ffmpeg}`;
  if (!byProcess.has(key)) byProcess.set(key, []);
  byProcess.get(key).push(event);
}

for (const [key, list] of byProcess) {
  const lines = [];
  for (const event of list) {
    if (event.event !== "stderr") continue;
    for (const text of event.text.split("\n")) {
      if (text.trim().length > 0) lines.push({ ms: event.ms, text: text.trimEnd() });
    }
  }
  const at = (name) => list.find((e) => e.event === name)?.ms ?? "-";
  const exitText = list.find((e) => e.event === "exit")?.text ?? "-";
  if (mode === "full") {
    process.stdout.write(
      `  ffmpeg ${key}: exit ${exitText} at ${at("exit")} ms, close at ${at("close")} ms, stderr end at ${at("stderr-end")} ms\n`,
    );
    for (const line of lines) process.stdout.write(`    ${line.ms} ms  ${line.text}\n`);
    continue;
  }
  const pick = (pattern) =>
    lines
      .filter((line) => pattern.test(line.text))
      .map((line) => `${line.ms}ms:${line.text.replace(/^.*\] (\[\w+\] )?/u, "")}`);
  const video = lines.map((line) => /video:(\d+)kB/u.exec(line.text)?.[1]).find(Boolean) ?? "-";
  const partial = pick(/partial file/iu);
  const early = pick(/Stream ends prematurely/iu);
  const reconnect = pick(/Will reconnect at/iu);
  process.stdout.write(
    `  ffmpeg ${key}: video=${video}kB exit=${exitText}@${at("exit")}ms close@${at("close")}ms` +
      ` stderr-end@${at("stderr-end")}ms partial=[${partial.join(" | ")}]` +
      ` early=[${early.join(" | ")}] reconnect=[${reconnect.join(" | ")}]\n`,
  );
}
