#!/usr/bin/env bash
# dl-125 probe. DO NOT MERGE.
#
# Runs tools/downloader/engine/test/stream.test.ts up to <count> times, each in
# a fresh vitest process, stopping early once <budget-seconds> have gone, and
# reads the 60% case's verdict off each run's verbose output. Every run is
# traced by trace.mjs; every run prints its engine ffmpegs' compact summary,
# and a run whose 60% case failed prints its whole trace.
#
# Usage: loop.sh <phase> <vitest -t filter, or "" for the whole file> <count> <budget-seconds>
set -u
phase="$1"
filter="$2"
count="$3"
budget="$4"
here="$(cd "$(dirname "$0")" && pwd)"
out="${RUNNER_TEMP:-/tmp}/dl125/${phase}"
mkdir -p "$out"
NODE_OPTIONS="--import $(node -p "require('node:url').pathToFileURL(process.argv[1]).href" "$here/trace.mjs")"
export NODE_OPTIONS

runs=0
pass60=0
fail60=0
missing60=0
other=0
started=$SECONDS
for i in $(seq 1 "$count"); do
  if ((SECONDS - started > budget)); then
    echo "phase ${phase}: time budget of ${budget}s reached before run ${i}"
    break
  fi
  export DL125_TRACE_FILE="${out}/trace-${i}.jsonl"
  args=(run tools/downloader/engine/test/stream.test.ts --reporter=verbose)
  if [ -n "$filter" ]; then args+=(-t "$filter"); fi
  t0=$SECONDS
  node node_modules/vitest/vitest.mjs "${args[@]}" >"${out}/out-${i}.log" 2>&1
  code=$?
  runs=$((runs + 1))
  verdict="missing"
  if grep -aqE "(×|✗|FAIL).*stored at 60% of itself" "${out}/out-${i}.log"; then
    verdict="FAIL"
    fail60=$((fail60 + 1))
  elif grep -aqE "✓.*stored at 60% of itself" "${out}/out-${i}.log"; then
    verdict="pass"
    pass60=$((pass60 + 1))
  else
    missing60=$((missing60 + 1))
  fi
  totals="$(grep -aE "^ *Tests " "${out}/out-${i}.log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | tr -s ' ')"
  echo "phase ${phase} run ${i}: exit=${code} 60%=${verdict} $((SECONDS - t0))s |${totals}"
  if [ "$code" -ne 0 ] && [ "$verdict" != "FAIL" ]; then
    other=$((other + 1))
    grep -aE "(×|✗|FAIL|Error)" "${out}/out-${i}.log" | sed 's/\x1b\[[0-9;]*m//g' | head -20
  fi
  if [ "$verdict" = "FAIL" ]; then
    echo "::warning::dl-125 ${phase} run ${i}: the 60% case failed"
    grep -aE "AssertionError" "${out}/out-${i}.log" | sed 's/\x1b\[[0-9;]*m//g' | head -5
    node "$here/summarize.mjs" "$DL125_TRACE_FILE" full
  else
    node "$here/summarize.mjs" "$DL125_TRACE_FILE" compact
  fi
done
echo "phase ${phase} result: ${fail60} failed of ${runs} runs (60% case: ${pass60} pass, ${fail60} fail, ${missing60} not found; ${other} runs failed on something else) in $((SECONDS - started))s"
echo "### dl-125 ${phase}: ${fail60} of ${runs} runs failed the 60% case" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
