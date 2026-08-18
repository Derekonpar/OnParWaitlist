import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../src/components/TimedResourcePlanner.tsx", import.meta.url), "utf8");
const resources = readFileSync(new URL("../src/lib/resource-sessions.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/staff/resource-sessions/route.ts", import.meta.url), "utf8");
const staffPage = readFileSync(new URL("../src/app/staff/page.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../supabase/migrations/20260813000000_allow_30_minute_resource_sessions.sql", import.meta.url),
  "utf8",
);

for (const label of ["Red pool rack", "Green pool rack", "Blue pool rack"]) {
  assert.match(resources, new RegExp(`label: \\"${label}\\"`), `${label} must replace the old table wording`);
}
assert.doesNotMatch(resources, /pool table/, "Pool resource labels must not use table wording");
assert.doesNotMatch(component, /Guest name|datetime-local|Add session/, "The legacy Shuffleboard form must be removed");
assert.doesNotMatch(
  component,
  /useMemo|localDateTimeValue|setGuestName|setStartsAt|setDurationMinutes|startPoolRack/,
  "Legacy form state and helpers must be removed",
);
assert.match(component, /resources\.map\(\(resource\) => \[resource\.id, 60\]\)/, "Every resource duration must default to 1 hour");
assert.match(component, /aria-label=\{`\$\{resource\.label\} duration`\}/, "Every resource card must own its duration selector");
assert.match(component, /30 minutes/, "Timed-resource duration menus must offer 30 minutes");
assert.match(component, /1 hour/, "Timed-resource duration menus must offer 1 hour");
assert.match(component, /2 hours/, "Timed-resource duration menus must offer 2 hours");
assert.match(component, /Start rack/, "Each available Pool rack must have a direct start button");
assert.match(component, /Start shuffleboard/, "Each available Shuffleboard must have a direct start button");
assert.match(component, /onClick=\{\(\) => void startResourceSession\(resource\.id\)\}/, "Every available resource card must start itself directly");
assert.match(component, /guestName: "Walk-in"/, "Condensed timed-resource starts must supply a non-sensitive internal session label");
assert.match(
  component,
  /session\.guestName\.trim\(\)\.toLowerCase\(\) !== "walk-in"/,
  "Existing named sessions must remain visible while the internal Walk-in label stays hidden",
);
assert.doesNotMatch(component, /resourceType: "pool"/, "The shared starter must preserve the selected Pool or Shuffleboard resource type");
assert.match(
  component,
  /startsAt: new Date\(nowMs \+ WALK_TO_RESOURCE_BUFFER_MS\)\.toISOString\(\)/,
  "Condensed timed-resource starts must preserve the 3-minute walk-back buffer",
);
assert.match(
  component,
  /const resourceStartMs = nowMs \+ WALK_TO_RESOURCE_BUFFER_MS;/,
  "Timed-resource reservation conflict checks must include the 3-minute walk-back buffer",
);
assert.match(component, /reservationConflictsWithSession[\s\S]*resourceStartMs,[\s\S]*resourceEndMs/, "Pool and Shuffleboard starts must retain reservation overlap protection");
assert.match(route, /z\.literal\(30\)/, "The staff API must accept 30-minute sessions");
assert.match(resources, /30 \| 60 \| 120/, "Stored session types must support 30-minute sessions");
assert.match(staffPage, /durationMinutes: 30 \| 60 \| 120/, "The staff page request path must carry 30-minute sessions");
assert.match(
  staffPage,
  /<TimedResourcePlanner\s+key=\{staffTab\}/,
  "Switching between Pool and Shuffleboards must remount resource-specific planner state",
);
assert.match(schema, /duration_minutes in \(30, 60, 120\)/, "The canonical schema must allow 30-minute sessions");
assert.match(migration, /drop constraint if exists activity_resource_sessions_duration_minutes_check/, "The migration must replace the duration check safely");
assert.match(migration, /duration_minutes in \(30, 60, 120\)/, "The migration must allow 30-minute sessions");

console.log("Condensed Pool and Shuffleboard controls regression test passed.");
