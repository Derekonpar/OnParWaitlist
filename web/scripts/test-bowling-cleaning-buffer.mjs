import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function importTypeScript(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const turnoverSource = readFileSync(
  new URL("../src/lib/bowling-turnover.ts", import.meta.url),
  "utf8",
);
const turnover = await importTypeScript(turnoverSource);

assert.equal(turnover.BOWLING_CLEANING_BUFFER_MINUTES, 5);
assert.equal(turnover.bowlingLaneAvailableAtSeconds("occupied", 600), 900);
assert.equal(turnover.bowlingLaneAvailableAtSeconds("occupied", 0), 300);
assert.equal(
  turnover.bowlingLaneAvailableAtSeconds("occupied", 600, 120),
  780,
  "Elapsed countdown time must be removed before adding cleaning time",
);
assert.equal(turnover.bowlingLaneAvailableAtSeconds("open", 0), 0);
assert.equal(
  turnover.bowlingLaneAvailableAtSeconds("unknown", 0),
  Number.POSITIVE_INFINITY,
);

let schedulerSource = readFileSync(
  new URL("../src/lib/resource-scheduler.ts", import.meta.url),
  "utf8",
);
schedulerSource = schedulerSource
  .replace(
    'import { defaultSessionMinutesFor } from "./booking";',
    "const defaultSessionMinutesFor = () => 60;",
  )
  .replace(
    'import { BOWLING_CLEANING_BUFFER_SECONDS } from "./bowling-turnover";',
    "const BOWLING_CLEANING_BUFFER_SECONDS = 300;",
  );
const scheduler = await importTypeScript(schedulerSource);

function entry(
  activity,
  id,
  createdAt,
  sessionMinutes = 60,
  laneCount = 1,
) {
  return {
    id,
    activity,
    name: id,
    phone: "",
    smsOptIn: false,
    laneCount,
    sessionMinutes,
    status: "waiting",
    createdAt,
  };
}

const fullBowlingHouse = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  label: `Lane ${index + 1}`,
  availableAtSeconds: 15 * 60,
}));
assert.equal(
  scheduler.activityQueueWait("bowling", [], fullBowlingHouse),
  15,
  "Ten live minutes plus five cleaning minutes must display as a 15-minute wait",
);
assert.equal(
  scheduler.activityQueueWait("bowling", [], [
    { id: "1", label: "Lane 1", availableAtSeconds: 0 },
  ]),
  0,
  "An already-open Bowling lane must remain No Wait",
);

const firstBowler = entry(
  "bowling",
  "first-bowler",
  "2026-08-22T12:00:00.000Z",
);
assert.equal(
  scheduler.activityQueueWait("bowling", [firstBowler], [
    { id: "1", label: "Lane 1", availableAtSeconds: 0 },
  ]),
  65,
  "The guest behind a one-hour Bowling party must wait for play plus cleaning",
);
assert.equal(
  scheduler.activityQueueWait("bowling", [firstBowler], [
    { id: "1", label: "Lane 1", availableAtSeconds: 15 * 60 },
  ]),
  80,
  "Ten live minutes plus cleaning and one queued hour plus cleaning must total 80 minutes",
);
const firstDart = entry(
  "darts",
  "first-dart",
  "2026-08-22T12:00:00.000Z",
);
assert.equal(
  scheduler.activityQueueWait("darts", [firstDart], [
    { id: "1", label: "Dart 1", availableAtSeconds: 0 },
  ]),
  60,
  "The Bowling cleaning policy must not change Dart waits",
);

const reservationWindow = {
  startAtSeconds: 60 * 60,
  endAtSeconds: 2 * 60 * 60,
  reservationId: "event",
  label: "Event",
};
const bowlingBeforeReservation = scheduler.planResourceQueue(
  [firstBowler],
  [
    {
      id: "1",
      label: "Lane 1",
      availableAtSeconds: 0,
      unavailableWindows: [reservationWindow],
    },
  ],
);
assert.equal(
  bowlingBeforeReservation.assignments[0].startInSeconds,
  2 * 60 * 60,
  "A Bowling session must not leave its cleaning period inside a reservation window",
);
const dartsBeforeReservation = scheduler.planResourceQueue(
  [firstDart],
  [
    {
      id: "1",
      label: "Dart 1",
      availableAtSeconds: 0,
      unavailableWindows: [reservationWindow],
    },
  ],
);
assert.equal(
  dartsBeforeReservation.assignments[0].startInSeconds,
  0,
  "A non-Bowling session ending at the reservation boundary must still fit",
);

const twoLaneFirst = entry(
  "bowling",
  "two-lane-first",
  "2026-08-22T12:00:00.000Z",
  60,
  2,
);
const twoLaneSecond = entry(
  "bowling",
  "two-lane-second",
  "2026-08-22T12:01:00.000Z",
  60,
  2,
);
const pairPlan = scheduler.planResourceQueue(
  [twoLaneFirst, twoLaneSecond],
  [
    { id: "1", label: "Lane 1", availableAtSeconds: 0 },
    { id: "2", label: "Lane 2", availableAtSeconds: 0 },
  ],
);
assert.equal(pairPlan.assignments[0].endInSeconds, 60 * 60);
assert.equal(
  pairPlan.assignments[1].startInSeconds,
  65 * 60,
  "Adjacent lanes clean in parallel, so a two-lane party adds five minutes rather than ten",
);

const scheduleSource = readFileSync(
  new URL("../src/lib/entertainment-schedule.ts", import.meta.url),
  "utf8",
);
assert.match(
  scheduleSource,
  /const turnoverSeconds = activityTurnoverSeconds\(activity\)[\s\S]*?endAtSeconds:[\s\S]*?\+ turnoverSeconds/,
  "Confirmed Bowling reservations must retain the lane for cleaning after their scheduled end",
);

console.log("Bowling five-minute cleaning buffer regression test passed.");
