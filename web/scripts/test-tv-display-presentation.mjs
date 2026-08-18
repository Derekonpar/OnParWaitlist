import assert from "node:assert/strict";

import {
  KARAOKE_DISPLAY_TIME_ZONE,
  KARAOKE_OPERATING_DAY_ROLLOVER_HOUR,
  karaokeInactiveDisplayStatus,
} from "../src/lib/karaoke-display-hours.ts";
import { formatTvWaitDuration } from "../src/lib/tv-wait-format.ts";

function at(iso) {
  return new Date(iso).getTime();
}

assert.equal(KARAOKE_DISPLAY_TIME_ZONE, "America/New_York");
assert.equal(KARAOKE_OPERATING_DAY_ROLLOVER_HOUR, 6);

const karaokeCases = [
  [
    "Thursday one second before the weekday close",
    "2026-08-21T02:29:59.000Z",
    "no-wait",
  ],
  [
    "Thursday exactly at the weekday close",
    "2026-08-21T02:30:00.000Z",
    "not-open",
  ],
  ["Friday at 11pm", "2026-08-22T03:00:00.000Z", "no-wait"],
  [
    "Friday night one second before 12:30am",
    "2026-08-22T04:29:59.000Z",
    "no-wait",
  ],
  [
    "Friday night exactly at 12:30am",
    "2026-08-22T04:30:00.000Z",
    "not-open",
  ],
  ["Saturday at 11pm", "2026-08-23T03:00:00.000Z", "no-wait"],
  [
    "Saturday night exactly at 12:30am",
    "2026-08-23T04:30:00.000Z",
    "not-open",
  ],
  [
    "Sunday exactly at the weekday close",
    "2026-08-24T02:30:00.000Z",
    "not-open",
  ],
  [
    "Sunday at 5:59am still belongs to Saturday night",
    "2026-08-23T09:59:00.000Z",
    "not-open",
  ],
  [
    "Sunday at 6am starts the Sunday operating day",
    "2026-08-23T10:00:00.000Z",
    "no-wait",
  ],
  ["spring DST before the skipped hour", "2026-03-08T06:59:00.000Z", "not-open"],
  ["spring DST after the skipped hour", "2026-03-08T07:00:00.000Z", "not-open"],
  ["fall DST first 1:30am", "2026-11-01T05:30:00.000Z", "not-open"],
  ["fall DST repeated 1:30am", "2026-11-01T06:30:00.000Z", "not-open"],
];

for (const [name, iso, expected] of karaokeCases) {
  assert.equal(karaokeInactiveDisplayStatus(at(iso)), expected, name);
}
assert.equal(
  karaokeInactiveDisplayStatus(Number.NaN),
  "not-open",
  "An invalid clock must fail closed",
);

const waitCases = [
  [0, { value: "0", unit: "min" }],
  [1, { value: "1", unit: "min" }],
  [59, { value: "59", unit: "min" }],
  [60, { value: "1.0", unit: "hr" }],
  [61, { value: "1.1", unit: "hr" }],
  [66, { value: "1.1", unit: "hr" }],
  [67, { value: "1.2", unit: "hr" }],
  [72, { value: "1.2", unit: "hr" }],
  [119, { value: "2.0", unit: "hr" }],
  [120, { value: "2.0", unit: "hr" }],
  [121, { value: "2.1", unit: "hr" }],
];

for (const [minutes, expected] of waitCases) {
  assert.deepEqual(formatTvWaitDuration(minutes), expected);
}
assert.deepEqual(formatTvWaitDuration(Number.NaN), { value: "0", unit: "min" });
assert.deepEqual(formatTvWaitDuration(-5), { value: "0", unit: "min" });

console.log("TV display presentation regression test passed.");
