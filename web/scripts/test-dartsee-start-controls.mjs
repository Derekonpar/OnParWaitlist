import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inspectDartseeEndSession } from "../src/lib/dartsee-session-safety.ts";
import {
  compareDartseeSnapshotVersions,
  dartseeSnapshotStorageObjectName,
  newerDartseeSnapshot,
} from "../src/lib/dartsee-snapshot-order.ts";
import {
  DARTSEE_OVERRIDE_MAX_MINUTES,
  DARTSEE_OVERRIDE_MIN_MINUTES,
  DARTSEE_START_BUFFER_MINUTES,
  dartseeCommandDurationMinutes,
  isDartseeOverrideDuration,
} from "../src/lib/dartsee-duration.ts";
import {
  DARTSEE_CONTROL_GUARD_MS,
  mergeDartseeControlGuards,
  snapshotWithConfirmedDartseeControl,
} from "../src/lib/dartsee-control-guard.ts";
import {
  dartseeExtensionConfirmationMatches,
  inspectDartseeOverrideLane,
  isDefinitiveDartseeOverrideRejection,
} from "../src/lib/dartsee-override-safety.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const component = source("../src/components/DartsPlanner.tsx");
const staffPage = source("../src/app/staff/page.tsx");
const route = source("../src/app/api/staff/dart-lanes/start/route.ts");
const overrideRoute = source(
  "../src/app/api/staff/dart-lanes/override/route.ts",
);
const endRoute = source("../src/app/api/staff/dart-lanes/end/route.ts");
const dartsee = source("../src/lib/dartsee-lanes.ts");
const dartseeDuration = source("../src/lib/dartsee-duration.ts");
const auth = source("../src/lib/auth.ts");
const endImplementation = dartsee.slice(
  dartsee.indexOf("export async function endDartseeLaneSession"),
  dartsee.indexOf("export async function getDartseeLaneSnapshot"),
);
const startImplementation = dartsee.slice(
  dartsee.indexOf("export async function startDartseeLaneSession"),
  dartsee.indexOf("export async function overrideDartseeLaneSession"),
);
const overrideImplementation = dartsee.slice(
  dartsee.indexOf("export async function overrideDartseeLaneSession"),
  dartsee.indexOf("export async function endDartseeLaneSession"),
);
const confirmedPublisher = dartsee.slice(
  dartsee.indexOf("async function publishConfirmedDartseeLaneStateWithToken"),
  dartsee.indexOf("export async function publishConfirmedDartseeStart"),
);
const controlTimingLogger = dartsee.slice(
  dartsee.indexOf("function logDartseeControlTiming"),
  dartsee.indexOf("let authCache"),
);

assert.match(
  component,
  /const startDuration = startDurations\[lane\.lane\] \?\? 60;/,
  "Every dart lane must default to a one-hour start",
);
for (const [minutes, label] of [
  [30, "30 minutes"],
  [60, "1 hour"],
  [120, "2 hours"],
]) {
  assert.match(
    component,
    new RegExp(`<option value=\\{${minutes}\\}>${label}</option>`),
    `Dart start controls must offer ${label}`,
  );
}
const dartsHeadingAt = component.indexOf(">Dart lanes</h2>");
const dartLaneGridAt = component.indexOf(
  'className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"',
  dartsHeadingAt,
);
const overrideTriggerAt = component.indexOf(
  "Override reservation",
  dartsHeadingAt,
);
assert.ok(
  dartsHeadingAt >= 0 &&
    overrideTriggerAt > dartsHeadingAt &&
    overrideTriggerAt < dartLaneGridAt,
  "The reservation override trigger must be in the Dart-tab header above the lane cards",
);
assert.match(
  component,
  /const \[reservationOverrideMinutes, setReservationOverrideMinutes\] =\s*useState\("60"\);/,
  "The reservation override must default to one hour",
);
assert.match(
  component,
  /function openReservationOverride\(\) \{[\s\S]*?setReservationOverrideLane\(""\);[\s\S]*?setReservationOverrideMinutes\("60"\);[\s\S]*?setReservationOverrideOpen\(true\);/,
  "Opening the override must require a lane choice and reset time to one hour",
);
assert.match(component, /role="dialog"/);
assert.match(component, /aria-label="Override dart lane"/);
assert.match(
  component,
  /import \{[\s\S]*?DARTSEE_OVERRIDE_MAX_MINUTES,[\s\S]*?DARTSEE_OVERRIDE_MIN_MINUTES,[\s\S]*?dartseeCommandDurationMinutes[\s\S]*?\} from "@\/lib\/dartsee-duration";/,
  "The browser and server must share one custom-duration range",
);
assert.match(component, /aria-label="Override dart minutes"/);
assert.match(component, /type="number"/);
assert.match(component, /min=\{DARTSEE_OVERRIDE_MIN_MINUTES\}/);
assert.match(component, /max=\{DARTSEE_OVERRIDE_MAX_MINUTES\}/);
assert.match(component, /step=\{1\}/);
assert.match(
  component,
  /\^\\d\+\$\/[.]test\(reservationOverrideMinutes\)[\s\S]*?Number[.]isInteger\(parsedOverrideMinutes\)[\s\S]*?parsedOverrideMinutes >= DARTSEE_OVERRIDE_MIN_MINUTES[\s\S]*?parsedOverrideMinutes <= DARTSEE_OVERRIDE_MAX_MINUTES/,
  "Custom minutes must be a whole number from 1 through 480",
);
assert.match(component, /<option value="">Select a lane<\/option>/);
assert.match(
  component,
  /plan\.lanes\.map\(\(lane\) => \{[\s\S]*?value=\{lane\.lane\}[\s\S]*?Dart \{lane\.lane\}/,
  "The override must select from the live mapped Dart lanes",
);
assert.match(
  component,
  /This bypasses only the reservation conflict\./,
  "Staff must be told exactly what the exceptional action bypasses",
);
assert.match(
  component,
  /const completed = await onOverrideLane\([\s\S]*?reservationOverrideLane,[\s\S]*?parsedOverrideMinutes/,
  "The browser must send one status-agnostic override request and let the server dispatch from fresh live state",
);
assert.match(
  component,
  /onStartLane\(lane\.lane, startDuration\)/,
  "Ordinary lane-card starts must stay on the protected callback",
);
assert.equal(
  (component.match(/await onOverrideLane\(/g) ?? []).length,
  1,
  "Open and occupied UI labels must not select different network mutations",
);
assert.doesNotMatch(
  component,
  /\/api\/staff\/dart-lanes\/(?:start|extend|override)/,
  "The planner must not choose a physical Dartsee action from its potentially stale snapshot",
);
assert.match(component, /selectedOverrideLane[?][.]status === "occupied"/);
assert.match(component, /selectedOverrideLane[.]status !== "open" &&[\s\S]*?selectedOverrideLane[.]status !== "occupied"/);
assert.match(component, /Boolean\(selectedOverrideFeed[?][.]safetyUnavailable\)/);
assert.match(component, /— in use · add time/);
assert.match(component, /— open · start/);
assert.match(component, /Start override/);
assert.match(component, /Add time/);
assert.match(component, /despite any reservation conflict\?/);
assert.match(component, /reservationConflictsWithSession\(/);
assert.match(
  component,
  /dartseeCommandDurationMinutes\(startDuration\)/,
  "The browser reservation preview must include the same one-minute buffer as Dartsee",
);
assert.match(component, /lane\.status !== "open"/);
assert.match(component, /!reservationProtectionReady/);
assert.match(component, /machineOffline/);
assert.match(component, /controllingLane !== null/);
assert.match(component, /pendingControls\.find\(/);
assert.match(component, /pendingThisLane/);
assert.match(component, /pendingControl\?\.timedOut/);
assert.match(
  component,
  /export type DartActiveControl = \{\s*action: "start" \| "end" \| "override";\s*lane: number;\s*durationMinutes\?: number;\s*\};/,
  "The planner must receive action and duration metadata instead of inferring the physical action from lane status",
);
assert.match(
  component,
  /const activeControlForLane =\s*activeControl\?\.lane === lane\.lane \? activeControl : null;/,
);
assert.match(
  component,
  /const activeStartInProgress =[\s\S]*?lane\.status === "open"[\s\S]*?activeControlForLane\?\.action === "start"[\s\S]*?activeControlForLane\?\.action === "override"/,
  "Only an explicit Start or an open-lane override may render optimistically occupied",
);
assert.match(
  component,
  /const optimisticStart =[\s\S]*?activeStartInProgress[\s\S]*?pendingControl\?\.action === "start"/,
  "A pending Add-time or End action must never masquerade as a Start",
);
assert.match(
  component,
  /const optimisticDurationMinutes =[\s\S]*?activeControlForLane\?\.durationMinutes !== undefined[\s\S]*?activeControlForLane\.durationMinutes[\s\S]*?: startDuration/,
  "A custom open-lane override must use its requested duration instead of the lane card dropdown",
);
assert.match(
  component,
  /const optimisticRemainingSeconds =[\s\S]*?pendingStartRemainingSeconds \?\?[\s\S]*?dartseeCommandDurationMinutes\(optimisticDurationMinutes\) \* 60/,
  "The immediate normal or custom Start countdown must include the one-minute Dartsee buffer",
);
assert.match(
  component,
  /pendingStartRemainingSeconds =[\s\S]*?pendingControl\?\.action === "start"[\s\S]*?Math\.ceil\(\(pendingExpectedSessionEndMs - nowMs\) \/ 1000\)/,
  "An unconfirmed Start with a server expected end must retain that exact countdown while polling catches up",
);
assert.match(component, /const displayedStatus = optimisticStart \? "occupied" : lane\.status/);
assert.match(component, /optimisticStart[\s\S]*?Starting session/);
assert.match(component, /aria-label=\{`Starting Dart \$\{lane\.lane\}`\}/);
assert.match(
  component,
  /const endingInProgress =\s*activeControlForLane\?\.action === "end";/,
  "Only an explicit End request may render Ending feedback",
);
assert.match(component, /endingInProgress[\s\S]*?"Ending…"/);
assert.match(
  component,
  /const addingTimeInProgress =[\s\S]*?activeControlForLane\?\.action === "override" &&[\s\S]*?lane\.status === "occupied"/,
  "An occupied override must render Add-time progress instead of Ending",
);
assert.match(component, /addingTimeInProgress[\s\S]*?"Adding time…"/);
assert.match(
  component,
  /const nonStartAwaitingConfirmation =[\s\S]*?pendingControl\?\.action === "end" \|\|[\s\S]*?pendingControl\?\.action === "extend" \|\|[\s\S]*?pendingControl\?\.action === "override"/,
  "Pending End, Add-time, and ambiguous override results must display verification instead of a false countdown",
);
assert.match(
  component,
  /nonStartAwaitingConfirmation[\s\S]*?pendingControl\?\.timedOut[\s\S]*?"Check unit"[\s\S]*?"Verifying…"/,
);
assert.match(
  component,
  /optimisticStart \? \([\s\S]*?<button[\s\S]*?disabled[\s\S]*?: lane\.status === "occupied" \? \(/,
  "An optimistic Start must not expose an End action before confirmation",
);
assert.match(component, /const DARTSEE_STALE_AFTER_MS = 60_000;/);
assert.match(component, /Dart status refreshing/);
assert.match(component, /role="status"/);
assert.doesNotMatch(
  component,
  /No fresh Dartsee snapshot has arrived for over 1 minute/,
  "A single delayed refresh must not produce the former red one-minute alarm",
);
assert.match(
  component,
  /: "Start";/,
  "An available lane must expose a Start action",
);
assert.match(component, /onEndLane\(lane\.lane\)/);
assert.match(component, /End session/);
assert.match(component, /aria-label=\{`End Dart \$\{lane\.lane\} session`\}/);

assert.match(staffPage, /postDartControl\(\s*"\/api\/staff\/dart-lanes\/start"/);
assert.match(staffPage, /postDartControl\(\s*"\/api\/staff\/dart-lanes\/end"/);
assert.match(
  staffPage,
  /setDartActiveControl\(\{ action: "start", lane, durationMinutes \}\)/,
);
assert.match(
  staffPage,
  /setDartActiveControl\(\{ action: "override", lane, durationMinutes \}\)/,
);
assert.match(staffPage, /setDartActiveControl\(\{ action: "end", lane \}\)/);
assert.match(staffPage, /activeControl=\{dartActiveControl\}/);
assert.match(
  staffPage,
  /import \{[\s\S]*?DARTSEE_EMPLOYEE_ALERT_AFTER_MS,[\s\S]*?DARTSEE_SUSTAINED_FAILURE_REFRESHES,[\s\S]*?\} from "@\/lib\/dartsee-feed-presentation"/,
  "Staff-wide and lane-card warning thresholds must share one definition",
);
assert.match(staffPage, /DART_CONTROL_CLIENT_TIMEOUT_MS = 25_000/);
assert.match(staffPage, /const controller = new AbortController\(\)/);
assert.match(staffPage, /signal: controller\.signal/);
assert.match(staffPage, /requestId: window\.crypto\.randomUUID\(\)/);
assert.match(staffPage, /lane,\s*durationMinutes,/);
assert.match(
  staffPage,
  /async function startDartLane\([\s\S]*?reservationOverride = false,[\s\S]*?\): Promise<boolean>/,
  "Ordinary Dart starts must default to reservation protection",
);
assert.match(
  staffPage,
  /requestId: window\.crypto\.randomUUID\(\),\s*lane,\s*durationMinutes,\s*reservationOverride,/,
  "The existing start request must carry the explicit reservation decision",
);
assert.match(
  staffPage,
  /onOverrideLane=\{overrideDartLane\}/,
  "The dedicated dialog must use the status-agnostic server override",
);
assert.match(
  staffPage,
  /postDartControl\(\s*"\/api\/staff\/dart-lanes\/override"/,
  "The browser must send overrides only through the dedicated server dispatcher",
);
assert.match(
  staffPage,
  /requestId: window\.crypto\.randomUUID\(\),\s*lane,\s*durationMinutes,\s*\}/,
  "The browser may send only the logical lane and duration, never a physical action or Dartsee identity",
);
assert.match(staffPage, /headers: headers\(\)/);
assert.doesNotMatch(
  staffPage.slice(staffPage.indexOf("async function startDartLane"), staffPage.indexOf("const selectedEntry")),
  /boardId|venueId|DARTSEE_ADMIN/,
  "The browser must never choose hardware IDs or receive Dartsee credentials",
);

for (const value of [30, 60, 120]) {
  assert.match(route, new RegExp(`z\\.literal\\(${value}\\)`));
}
for (const lane of [1, 2, 3, 4, 5]) {
  assert.match(route, new RegExp(`z\\.literal\\(${lane}\\)`));
}
assert.match(route, /\.strict\(\)/, "Unexpected client control fields must be rejected");
assert.match(
  route,
  /reservationOverride:\s*z\.boolean\(\)\.optional\(\)\.default\(false\)/,
  "Omitted and ordinary Start requests must retain reservation protection",
);
assert.match(route, /verifyStaffHeaderSecret/);
assert.match(route, /isSameOrigin/);
assert.match(route, /cache-control": "private, no-store"/);

for (const lane of [1, 2, 3, 4, 5]) {
  assert.match(overrideRoute, new RegExp(`z\\.literal\\(${lane}\\)`));
}
assert.match(overrideRoute, /\.strict\(\)/);
assert.match(overrideRoute, /verifyStaffHeaderSecret/);
assert.match(overrideRoute, /isSameOrigin/);
assert.match(overrideRoute, /cache-control": "private, no-store"/);
assert.match(
  overrideRoute,
  /durationMinutes:[\s\S]*?\.number\(\)[\s\S]*?\.int\(\)[\s\S]*?\.min\(DARTSEE_OVERRIDE_MIN_MINUTES\)[\s\S]*?\.max\(DARTSEE_OVERRIDE_MAX_MINUTES\)/,
  "The server must enforce the same custom whole-minute range as the dialog",
);
assert.doesNotMatch(
  overrideRoute.slice(
    overrideRoute.indexOf("const overrideSchema"),
    overrideRoute.indexOf("function privateJson"),
  ),
  /action|boardId|sessionId|maxPlayers|reservationOverride/,
  "A caller must not be able to choose the physical mutation or bypass any safety gate other than the dedicated reservation exception",
);
assert.match(overrideRoute, /overrideDartseeLaneSession\(parsed\.data\)/);
assert.match(overrideRoute, /function scheduleBackgroundWork/);
assert.match(overrideRoute, /scheduleBackgroundWork\(refreshDartseeLaneSnapshotAfterControl\)/);
assert.doesNotMatch(
  overrideRoute,
  /console\.error\([^\n]*,\s*error\)/,
  "The override route must not log raw caught errors",
);
assert.match(
  dartsee,
  /Promise\.all\(\[[\s\S]*?acquireStartLease\([\s\S]*?openDartseeControlObserverWithFreshAuth\(\[boardId\][\s\S]*?getStoredEntertainmentSchedule\(\)/,
  "Start must overlap the lease, live preflight, and bounded reservation read",
);
assert.match(dartsee, /START_SCHEDULE_READ_DEADLINE_MS = 1_800/);
assert.match(dartsee, /START_SCHEDULE_MAX_AGE_MS = 2 \* 60_000/);
assert.match(route, /function scheduleBackgroundWork/);
assert.match(route, /try \{\s*after\(task\);\s*\} catch/);
assert.match(route, /scheduleBackgroundWork\(\(\) =>\s*publishConfirmedDartseeStart/);
assert.match(route, /scheduleBackgroundWork\(refreshDartseeLaneSnapshotAfterControl\)/);

for (const lane of [1, 2, 3, 4, 5]) {
  assert.match(endRoute, new RegExp(`z\\.literal\\(${lane}\\)`));
}
assert.match(endRoute, /\.strict\(\)/);
assert.match(endRoute, /verifyStaffHeaderSecret/);
assert.match(endRoute, /isSameOrigin/);
assert.match(endRoute, /function scheduleBackgroundWork/);
assert.match(endRoute, /try \{\s*after\(task\);\s*\} catch/);
assert.match(endRoute, /scheduleBackgroundWork\(\(\) =>\s*publishConfirmedDartseeEnd/);
assert.match(endRoute, /scheduleBackgroundWork\(refreshDartseeLaneSnapshotAfterControl\)/);
assert.match(endRoute, /code === "shared-session"/);
assert.match(endRoute, /DARTSEE_SHARED_SESSION/);

assert.match(
  auth,
  /verifyStaffHeaderSecret[\s\S]*?request\.headers\.get\("x-staff-secret"\) === secret/,
  "The write action must require a staff header rather than a query-string secret",
);
assert.match(
  dartseeDuration,
  /DARTSEE_START_DURATIONS = \[30, 60, 120\] as const/,
);
assert.equal(DARTSEE_START_BUFFER_MINUTES, 1);
assert.deepEqual(
  [30, 60, 120].map((minutes) => dartseeCommandDurationMinutes(minutes)),
  [31, 61, 121],
  "Every staff-facing Dartsee duration must include the one-minute walking buffer",
);
assert.equal(DARTSEE_OVERRIDE_MIN_MINUTES, 1);
assert.equal(DARTSEE_OVERRIDE_MAX_MINUTES, 480);
for (const minutes of [1, 17, 59, 121, 480]) {
  assert.equal(
    isDartseeOverrideDuration(minutes),
    true,
    `Override must accept the whole-minute duration ${minutes}`,
  );
  assert.equal(
    dartseeCommandDurationMinutes(minutes),
    minutes + 1,
    "A custom open-lane Start must retain the one-minute walking buffer",
  );
}
for (const invalid of [0, 481, -1, 1.5, "60", Number.NaN, Infinity, null]) {
  assert.equal(
    isDartseeOverrideDuration(invalid),
    false,
    `Override must reject invalid minutes ${String(invalid)}`,
  );
}
assert.match(dartsee, /ids\.length !== 5 \|\| new Set\(ids\)\.size !== 5/);
assert.match(dartsee, /return ids\[lane - 1\] \?\? null/);
assert.match(
  dartsee,
  /openDartseeControlObserverWithFreshAuth\(\s*\[boardId\],\s*3_000/,
  "Start must use one live lane observer across preflight and confirmation",
);
assert.match(dartsee, /before\.status !== "open"/);
assert.match(dartsee, /reservationConflictsWithSession\(/);
assert.match(startImplementation, /reservationOverride:\s*boolean;/);
assert.match(
  startImplementation,
  /if \(conflict && !input\.reservationOverride\)/,
  "Only an explicit reservation override may pass a detected conflict",
);
assert.equal(
  (startImplementation.match(/input\.reservationOverride/g) ?? []).length,
  1,
  "Reservation override may affect only the reservation-conflict gate",
);
const initialOpenGuardAt = startImplementation.indexOf(
  'before.status !== "open"',
);
const scheduleUnavailableAt = startImplementation.indexOf(
  'code: "schedule-unavailable"',
);
const conflictReadAt = startImplementation.indexOf(
  "const conflict = schedule.reservations.find",
);
const conflictOverrideGateAt = startImplementation.indexOf(
  "if (conflict && !input.reservationOverride)",
);
const finalOpenGuardAt = startImplementation.indexOf(
  'immediatelyBeforeWrite?.status !== "open"',
);
const physicalStartAt = startImplementation.indexOf("response = await fetch(");
assert.ok(
  initialOpenGuardAt >= 0 &&
    initialOpenGuardAt < scheduleUnavailableAt &&
    scheduleUnavailableAt < conflictReadAt &&
    conflictReadAt < conflictOverrideGateAt &&
    conflictOverrideGateAt < finalOpenGuardAt &&
    finalOpenGuardAt < physicalStartAt,
  "Override must bypass only a known reservation conflict, never lane, feed, schedule freshness, or final pre-write safety",
);
assert.match(dartsee, /dartseeCommandDurationMinutes\(\s*input\.durationMinutes/);
assert.match(dartsee, /START_LOCK_PREFIX/);
assert.match(
  dartsee,
  /const START_LEASE_WINDOW_MS = 10_000;/,
  "Each of four durable lease buckets must be ten seconds",
);
assert.match(
  dartsee,
  /const CONTROL_CONFIRM_TIMEOUT_MS = 4_000;/,
  "A healthy but slightly delayed Dartsee event gets four seconds to confirm",
);
assert.match(
  dartsee,
  /const paths = \[bucket, bucket \+ 1, bucket \+ 2, bucket \+ 3\]/,
  "Four adjacent ten-second buckets must provide 30-40 seconds of durable coverage",
);
assert.match(
  dartsee,
  /localStartGuards\.set\(lane, now \+ START_LEASE_WINDOW_MS \* 3\)/,
  "The in-isolate guard must match the client's 30-second verification lock",
);
assert.match(dartsee, /upsert: false/);
assert.match(
  dartsee,
  /if \(!supabase\) \{[\s\S]*?return DARTSEE_CONTROL_LEASE_UNAVAILABLE;/,
  "Physical controls must fail closed without the durable cross-isolate lease",
);
assert.match(
  dartsee,
  /const acquisitionResults = await Promise\.all\(/,
  "Durable control locks must be acquired concurrently",
);
assert.match(dartsee, /STORAGE_SNAPSHOT_PREFIX = "dartsee-lanes\/snapshots"/);
assert.match(dartsee, /sortBy: \{ column: "name", order: "desc" \}/);
assert.match(dartsee, /snapshotStoragePath\(snapshot\)/);
assert.doesNotMatch(
  dartsee,
  /STORAGE_PUBLISH_LOCK_PREFIX|acquireSnapshotPublishLease/,
  "Immutable publication must not depend on timeout-prone storage lock objects",
);
const publisher = dartsee.slice(
  dartsee.indexOf("async function saveStoredSnapshot"),
  dartsee.indexOf("async function acquireRefreshLease"),
);
assert.match(
  publisher,
  /compareDartseeSnapshotVersions\(stored, snapshot\) >= 0[\s\S]*?return \{ winner: stored, settled: true \}/,
  "A losing publication must return the existing durable winner",
);
assert.match(
  dartsee,
  /publication\.settled[\s\S]*?LEASE_LOSER_RETRY_MS/,
  "An unsettled publication must force a near-term shared-cache reread",
);
assert.doesNotMatch(
  publisher,
  /STORAGE_PATH,[\s\S]*?upsert: true/,
  "A late fixed-path upload must not be able to replace newer shared state",
);
assert.match(dartsee, /\/v2\.0\/tournaments\/walk-in/);
assert.match(dartsee, /length: commandDurationMinutes/);
assert.match(dartsee, /boardIds: \[boardId\]/);
assert.match(dartsee, /maxPlayers: 8/);
assert.match(dartsee, /name: "walk-in"/);
assert.equal(
  (startImplementation.match(/redirect: "manual"/g) ?? []).length,
  1,
  "Start must expose redirects without replaying its physical POST",
);
assert.doesNotMatch(startImplementation, /redirect: "error"/);
assert.match(
  startImplementation,
  /response\.status >= 300 && response\.status < 500/,
  "Start must refuse redirect and client-error responses",
);
assert.match(
  dartsee,
  /A network error or timeout is ambiguous\. Never resend the POST/,
  "Ambiguous start requests must be verified and never retried",
);
assert.match(dartsee, /publishConfirmedDartseeStart\(/);
assert.match(dartsee, /refreshDartseeLaneSnapshotAfterControl\(/);
assert.doesNotMatch(
  dartsee,
  /setTimeout\(resolve, 600\)/,
  "Controls must not impose the former fixed confirmation delay",
);
assert.match(
  dartsee,
  /const reading = await observer\.waitForLane\(/,
  "The same live observer must confirm a control event",
);
assert.match(
  controlTimingLogger,
  /outcome: timing\.outcome/,
  "Control timing logs must include only the sanitized outcome category",
);
assert.match(
  controlTimingLogger,
  /postResult: timing\.postResult \?\? null/,
  "Control timing logs must distinguish a response from a failed subrequest",
);
assert.doesNotMatch(
  controlTimingLogger,
  /token|sessionId|response\.body|error\b/,
  "Control timing logs must not include secrets, session identifiers, bodies, or raw errors",
);
for (const outcome of [
  "confirmed",
  "unconfirmed",
  "control-rejected",
]) {
  assert.match(
    dartsee,
    new RegExp(`timing\\.outcome = "${outcome}"`),
    `Control paths must record the sanitized ${outcome} outcome`,
  );
}
assert.doesNotMatch(
  route,
  /console\.error\([^\n]*,\s*error\)/,
  "The Start route must not log raw caught errors",
);
assert.doesNotMatch(
  endRoute,
  /console\.error\([^\n]*,\s*error\)/,
  "The End route must not log raw caught errors",
);
assert.match(
  staffPage,
  /useRef<Map<number, DartLaneOverride>>\([\s\S]*?new Map\(\)/,
  "Confirmed lane guards must be tracked independently per dart lane",
);
assert.match(
  staffPage,
  /for \(const \[lane, override\] of dartLaneOverridesRef\.current\)/,
);
assert.match(staffPage, /incomingLaneVersionMs >= override\.confirmedAtMs/);
assert.match(staffPage, /DART_CONTROL_CONFIRMED_GUARD_MS = 60_000/);
assert.match(staffPage, /dartLaneMatchesConfirmedOverride\(/);
assert.match(
  staffPage,
  /type DartControlAction = "start" \| "extend" \| "end" \| "override";/,
  "The client must distinguish an Add-time confirmation from an ordinary Start and from an interrupted action with an unknown result",
);
assert.match(staffPage, /expectedSessionId\?: string;/);
assert.match(staffPage, /expectedSessionEnd\?: string;/);
assert.match(
  staffPage,
  /pending\.action === "extend"[\s\S]*?pendingReading\?\.status === "occupied"[\s\S]*?pendingReading\.sessionId === pending\.expectedSessionId[\s\S]*?pendingReadingEndMs >= expectedPendingEndMs/,
  "A stale occupied snapshot must not settle Add time until the exact session reaches the expected end",
);
assert.match(
  staffPage,
  /action: data\.action === "extend" \? "extend" : "start",[\s\S]*?expectedSessionId: data\.expectedSessionId,[\s\S]*?expectedSessionEnd: data\.expectedSessionEnd,/,
  "An unconfirmed override must retain the server-observed action and expected session evidence",
);
assert.match(
  staffPage,
  /action: "override",[\s\S]*?untilMs: verifyAfterMs \+ 30_000/,
  "An interrupted response with no server result must keep a generic verification lock",
);
assert.match(
  staffPage,
  /incoming\.sessionId === confirmed\.sessionId &&[\s\S]*?incomingEndMs >= confirmedEndMs/,
  "A confirmed Add-time reading must be retained until fresh live evidence reaches its new end",
);
assert.match(
  staffPage,
  /exactLaneEvidence &&[\s\S]*?confirmedStateReached \|\|[\s\S]*?incomingLaneVersionMs >= override\.releaseAfterMs/,
  "A newer local timestamp alone must not clear a confirmed lane override",
);
assert.doesNotMatch(
  staffPage,
  /now >= override\.untilMs/,
  "A confirmed lane guard must wait for fresh evidence from that exact lane",
);
assert.match(staffPage, /dartLaneOverridesRef\.current\.delete\(lane\)/);
assert.match(staffPage, /dartLaneOverridesRef\.current\.set\(lane, \{/);
assert.match(staffPage, /incomingLaneVersionMs >= pending\.verifyAfterMs/);
assert.match(staffPage, /reading\?\.observedAt/);
assert.match(dartsee, /observedAt: stateVersionAt/);
assert.match(
  staffPage,
  /updateDartPendingControl\(pending\.lane, \{[\s\S]*?timedOut: true/,
);
assert.match(
  staffPage,
  /remainingSeconds: Math\.max\([\s\S]*?reading\.remainingSeconds \+ captureBasisOffsetSeconds/,
);
assert.match(
  dartsee,
  /A post-control socket can briefly echo Dartsee's cached pre-control state\.[\s\S]*?const live = await retryMissingBoards/,
  "Post-control socket capture time must not outrank exact control evidence by itself",
);
assert.match(
  dartsee,
  /snapshotWithConfirmedDartseeControl\([\s\S]*?saveStoredSnapshot\(confirmedSnapshot\)/,
  "A confirmed lane must be published immediately on a complete rebased snapshot",
);
assert.match(dartsee, /mergeDartseeControlGuards\(snapshot, stored\)/);
assert.match(confirmedPublisher, /nextSnapshotRefreshAt\(/);
assert.doesNotMatch(
  confirmedPublisher,
  /nextRefreshAttemptAt = Date\.now\(\) \+ winnerCacheMs/,
  "Post-control publication must not recreate the former roughly 30-second refresh cadence",
);
assert.match(
  dartsee,
  /live\.healthStatus !== "ok" \|\|[\s\S]*?live\.knownLaneCount !== ids\.length/,
  "Only complete post-control venue snapshots may be durably published",
);
assert.match(dartsee, /endDartseeLaneSession\(/);
assert.match(
  dartsee,
  /\/v2\.0\/tournaments\/\$\{encodeURIComponent\(sessionId\)\}\/stop\?boardId=\$\{encodeURIComponent\(boardId\)\}/,
  "End must target the server-observed session and exact single board",
);
assert.match(dartsee, /const inspection = inspectDartseeEndSession\(/);
assert.match(
  dartsee,
  /const \[leaseAcquisition, fullPreflight\] = await Promise\.all\(\[[\s\S]*?openDartseeControlObserverWithFreshAuth\(ids, 5_000\)/,
  "End must preflight all five boards on the observer kept for confirmation",
);
assert.match(
  endImplementation,
  /await new Promise\(\(resolve\) => setTimeout\(resolve, 250\)\);[\s\S]*?if \(!observer\.isActive\(\)\)[\s\S]*?const inspection = inspectDartseeEndSession/,
  "End must settle and retain a live complete-venue observer before its final safety inspection",
);
assert.match(dartsee, /inspectDartseeEndSession\(/);
assert.equal(
  (startImplementation.match(/await fetch\(/g) ?? []).length,
  1,
  "Start must contain exactly one physical Dartsee POST call site",
);
assert.equal(
  (endImplementation.match(/await fetch\(/g) ?? []).length,
  1,
  "End must contain exactly one physical Dartsee POST call site",
);
assert.equal(
  (endImplementation.match(/redirect: "manual"/g) ?? []).length,
  1,
  "End must expose redirects without replaying its physical POST",
);
assert.doesNotMatch(endImplementation, /redirect: "error"/);
assert.match(
  endImplementation,
  /response\.status >= 300 && response\.status < 500/,
  "End must refuse redirect and client-error responses",
);
const finalVenueRead = endImplementation.indexOf(
  "const [leaseAcquisition, fullPreflight] = await Promise.all",
);
const endPost = endImplementation.indexOf(
  "response = await fetch(",
  finalVenueRead,
);
assert.ok(finalVenueRead >= 0 && endPost > finalVenueRead);
assert.doesNotMatch(
  endImplementation.slice(finalVenueRead, endPost),
  /probeDartseeLane/,
  "No weaker target-only read may follow the complete final End preflight",
);
assert.match(endImplementation, /const \{ token, observer \} = fullPreflight/);
assert.match(dartsee, /if \(attempt > 0\) authCache = null/);
assert.match(dartsee, /\(lane\) => lane\.status === "open"/);
assert.match(
  dartsee,
  /A network error or timeout is ambiguous\. Never send a second End/,
  "Ambiguous End requests must be verified and never retried",
);

assert.match(
  overrideImplementation,
  /Promise\.all\(\[[\s\S]*?acquireStartLease\(input\.lane, input\.requestId\)[\s\S]*?openDartseeControlObserverWithFreshAuth\(ids, 5_000\)[\s\S]*?getStoredEntertainmentSchedule\(\)/,
  "Override must overlap its durable lease, complete five-board observer, and bounded schedule read",
);
assert.equal(
  (overrideImplementation.match(/inspectDartseeOverrideLane\(/g) ?? []).length,
  2,
  "Override must classify the target once after a stable full-venue read and again immediately before its one write",
);
assert.match(
  overrideImplementation,
  /ids\.length !== 5 \|\|[\s\S]*?new Set\(ids\)\.size !== 5/,
  "Override must reject an incomplete or duplicate five-board mapping",
);
assert.match(
  overrideImplementation,
  /Date\.now\(\) - scheduleAt > START_SCHEDULE_MAX_AGE_MS/,
  "Reservation data must remain fresh even on the explicit conflict override path",
);
assert.match(
  overrideImplementation,
  /const conflict = schedule\.reservations\.find\([\s\S]*?if \(conflict\) \{[\s\S]*?reservation conflict overridden/,
  "A detected reservation conflict may be audited instead of rejected only inside the dedicated override",
);
assert.doesNotMatch(
  overrideImplementation,
  /reservationOverride|if \(conflict &&/,
  "The dedicated route must not turn a client boolean into a broader safety bypass",
);
assert.match(
  overrideImplementation,
  /unchangedStart[\s\S]*?unchangedExtension[\s\S]*?immediatelyBeforeWrite\.sessionId === inspection\.sessionId[\s\S]*?immediatelyBeforeWrite\.currentEndMs === inspection\.currentEndMs[\s\S]*?immediatelyBeforeWrite\.maxPlayers === inspection\.maxPlayers/,
  "The final pre-write reading must preserve the originally inspected action and exact session fields",
);
const overrideInitialInspectionAt = overrideImplementation.indexOf(
  "const inspection = inspectDartseeOverrideLane",
);
const overrideScheduleGateAt = overrideImplementation.indexOf(
  'code: "schedule-unavailable"',
);
const overrideConflictAt = overrideImplementation.indexOf(
  "const conflict = schedule.reservations.find",
);
const overrideFinalInspectionAt = overrideImplementation.indexOf(
  "const immediatelyBeforeWrite = inspectDartseeOverrideLane",
);
const overridePhysicalPostAt = overrideImplementation.indexOf(
  "response = await fetch(",
);
assert.ok(
  overrideInitialInspectionAt >= 0 &&
    overrideInitialInspectionAt < overrideScheduleGateAt &&
    overrideScheduleGateAt < overrideConflictAt &&
    overrideConflictAt < overrideFinalInspectionAt &&
    overrideFinalInspectionAt < overridePhysicalPostAt,
  "Override must preserve feed, schedule, and exact pre-write safety gates before either physical action",
);
assert.equal(
  (overrideImplementation.match(/dartseeCommandDurationMinutes\(/g) ?? [])
    .length,
  1,
  "Only a newly started override session receives the one-minute walking buffer",
);
assert.match(
  overrideImplementation,
  /\/v2\.0\/tournaments\/walk-in[\s\S]*?length: startCommandMinutes,[\s\S]*?boardIds: \[boardId\],[\s\S]*?maxPlayers: 8,[\s\S]*?venueId,[\s\S]*?name: "walk-in"/,
  "An open target must use the verified walk-in protocol",
);
assert.match(
  overrideImplementation,
  /\/v2\.0\/tournaments\/\$\{encodeURIComponent\(inspection\.sessionId\)\}\/extend\?boardId=\$\{encodeURIComponent\(boardId\)\}/,
  "An occupied target must extend the exact server-observed single-board session",
);
assert.match(
  overrideImplementation,
  /body: JSON\.stringify\(\{\s*length: input\.durationMinutes,\s*maxPlayers: inspection\.maxPlayers,\s*\}\)/,
  "Dartsee extension length must be the exact additional minutes with the observed player limit",
);
assert.equal(
  (overrideImplementation.match(/await fetch\(/g) ?? []).length,
  2,
  "Override must have one physical POST call site in each mutually exclusive action branch",
);
assert.equal(
  (overrideImplementation.match(/redirect: "manual"/g) ?? []).length,
  2,
  "Both physical override actions must expose redirects without replay",
);
assert.doesNotMatch(overrideImplementation, /redirect: "error"/);
assert.match(
  overrideImplementation,
  /A timeout is ambiguous after the one allowed POST\. Never resend it\./,
  "An ambiguous override must be verified and never retried",
);
assert.match(
  overrideImplementation,
  /dartseeExtensionConfirmationMatches\([\s\S]*?inspection\.sessionId,[\s\S]*?inspection\.currentEndMs,[\s\S]*?expectedEndMs/,
  "Add time confirmation must prove the same session advanced from its prior end to the requested end",
);

const targetBoard = "beavercreek01";
const overrideNowMs = Date.parse("2026-08-20T17:00:00.000Z");
const overrideSessionEnd = "2026-08-20T18:00:00.000Z";
const oneMinutePreviousEndMs = Date.parse("2026-08-20T18:00:00.000Z");
const oneMinuteExpectedEndMs = Date.parse("2026-08-20T18:01:00.000Z");
const extensionLane = {
  boardId: targetBoard,
  status: "occupied",
  sessionId: "target-session",
  sessionEnd: new Date(oneMinutePreviousEndMs).toISOString(),
  maxPlayers: 8,
};
assert.equal(
  dartseeExtensionConfirmationMatches(
    extensionLane,
    "target-session",
    oneMinutePreviousEndMs,
    oneMinuteExpectedEndMs,
  ),
  false,
  "The old same-session end must not confirm a one-minute extension",
);
assert.equal(
  dartseeExtensionConfirmationMatches(
    {
      ...extensionLane,
      sessionEnd: new Date(oneMinutePreviousEndMs + 1_000).toISOString(),
    },
    "target-session",
    oneMinutePreviousEndMs,
    oneMinuteExpectedEndMs,
  ),
  false,
  "A one-second clock drift after the old end must not confirm a one-minute extension",
);
assert.equal(
  dartseeExtensionConfirmationMatches(
    {
      ...extensionLane,
      sessionEnd: new Date(oneMinuteExpectedEndMs).toISOString(),
    },
    "target-session",
    oneMinutePreviousEndMs,
    oneMinuteExpectedEndMs,
  ),
  true,
  "The exact same-session requested end must confirm a one-minute extension",
);
assert.equal(
  dartseeExtensionConfirmationMatches(
    {
      ...extensionLane,
      sessionId: "different-session",
      sessionEnd: new Date(oneMinuteExpectedEndMs).toISOString(),
    },
    "target-session",
    oneMinutePreviousEndMs,
    oneMinuteExpectedEndMs,
  ),
  false,
  "The requested end on a different session must not confirm Add time",
);
for (const status of [400, 401, 403, 404, 409, 422]) {
  assert.equal(
    isDefinitiveDartseeOverrideRejection(status),
    true,
    `${status} must be treated as a definitive rejection`,
  );
}
for (const status of [200, 300, 301, 307, 308, 408, 429, 500, 502, 503, 504]) {
  assert.equal(
    isDefinitiveDartseeOverrideRejection(status),
    false,
    `${status} must remain non-rejection or ambiguous after the one allowed POST`,
  );
}
assert.deepEqual(
  inspectDartseeOverrideLane(
    [
      { boardId: targetBoard, status: "open" },
      { boardId: "beavercreek02", status: "occupied", sessionId: "other", sessionEnd: overrideSessionEnd, maxPlayers: 8 },
    ],
    targetBoard,
    overrideNowMs,
  ),
  { ok: true, action: "start" },
  "A fresh server-observed open lane must dispatch to the existing Start path",
);
assert.deepEqual(
  inspectDartseeOverrideLane(
    [
      {
        boardId: targetBoard,
        status: "occupied",
        sessionId: "target-session",
        sessionEnd: overrideSessionEnd,
        maxPlayers: 8,
      },
      {
        boardId: "beavercreek02",
        status: "occupied",
        sessionId: "other-session",
        sessionEnd: overrideSessionEnd,
        maxPlayers: 6,
      },
    ],
    targetBoard,
    overrideNowMs,
  ),
  {
    ok: true,
    action: "extend",
    sessionId: "target-session",
    currentEndMs: Date.parse(overrideSessionEnd),
    maxPlayers: 8,
  },
  "A uniquely identified occupied lane must dispatch to exact-session Add time",
);
assert.deepEqual(
  inspectDartseeOverrideLane(
    [
      {
        boardId: targetBoard,
        status: "occupied",
        sessionId: "shared",
        sessionEnd: overrideSessionEnd,
        maxPlayers: 8,
      },
      {
        boardId: "beavercreek02",
        status: "occupied",
        sessionId: "shared",
        sessionEnd: overrideSessionEnd,
        maxPlayers: 8,
      },
    ],
    targetBoard,
    overrideNowMs,
  ),
  { ok: false, reason: "shared-session" },
  "Add time must reject a session shared by multiple boards",
);
assert.deepEqual(
  inspectDartseeOverrideLane(
    [{ boardId: targetBoard, status: "unknown" }],
    targetBoard,
    overrideNowMs,
  ),
  { ok: false, reason: "feed-unavailable" },
  "An unknown target must never be treated as open or occupied",
);
assert.deepEqual(
  inspectDartseeOverrideLane(
    [
      {
        boardId: targetBoard,
        status: "occupied",
        sessionId: "target-session",
        sessionEnd: overrideSessionEnd,
        maxPlayers: 8,
      },
      { boardId: "beavercreek02", status: "unknown" },
    ],
    targetBoard,
    overrideNowMs,
  ),
  { ok: false, reason: "feed-unavailable" },
  "Add time must require a complete venue view before ruling out a shared session",
);
assert.deepEqual(
  inspectDartseeOverrideLane(
    [{ boardId: "beavercreek02", status: "open" }],
    targetBoard,
    overrideNowMs,
  ),
  { ok: false, reason: "target-missing" },
  "A missing target must fail closed",
);
for (const invalidTarget of [
  {
    boardId: targetBoard,
    status: "occupied",
    sessionEnd: overrideSessionEnd,
    maxPlayers: 8,
  },
  {
    boardId: targetBoard,
    status: "occupied",
    sessionId: "target-session",
    maxPlayers: 8,
  },
  {
    boardId: targetBoard,
    status: "occupied",
    sessionId: "target-session",
    sessionEnd: new Date(overrideNowMs).toISOString(),
    maxPlayers: 8,
  },
  {
    boardId: targetBoard,
    status: "occupied",
    sessionId: "target-session",
    sessionEnd: overrideSessionEnd,
  },
  {
    boardId: targetBoard,
    status: "occupied",
    sessionId: "target-session",
    sessionEnd: overrideSessionEnd,
    maxPlayers: 0,
  },
  {
    boardId: targetBoard,
    status: "occupied",
    sessionId: "target-session",
    sessionEnd: overrideSessionEnd,
    maxPlayers: 7.5,
  },
]) {
  assert.deepEqual(
    inspectDartseeOverrideLane([invalidTarget], targetBoard, overrideNowMs),
    { ok: false, reason: "session-unavailable" },
    "Add time must require a live session ID, future end, and integer player limit",
  );
}
assert.deepEqual(
  inspectDartseeOverrideLane(
    [
      {
        boardId: targetBoard,
        status: "occupied",
        sessionId: "target-session",
        sessionEnd: overrideSessionEnd,
        maxPlayers: 8,
      },
      { boardId: "beavercreek02", status: "occupied" },
    ],
    targetBoard,
    overrideNowMs,
  ),
  { ok: false, reason: "session-unavailable" },
  "Any occupied board with missing session identity makes single-board extension unprovable",
);
assert.deepEqual(
  inspectDartseeEndSession(
    [
      { boardId: targetBoard, status: "occupied", sessionId: "target-session" },
      { boardId: "beavercreek02", status: "occupied" },
    ],
    targetBoard,
  ),
  { ok: false, reason: "session-unavailable" },
  "End must fail closed when any occupied board omits its session identity",
);
assert.deepEqual(
  inspectDartseeEndSession(
    [
      { boardId: targetBoard, status: "occupied", sessionId: "shared" },
      { boardId: "beavercreek02", status: "occupied", sessionId: "shared" },
    ],
    targetBoard,
  ),
  { ok: false, reason: "shared-session" },
  "End must reject a session observed on more than one board",
);
assert.deepEqual(
  inspectDartseeEndSession(
    [
      { boardId: targetBoard, status: "occupied", sessionId: "target-session" },
      { boardId: "beavercreek02", status: "occupied", sessionId: "other-session" },
    ],
    targetBoard,
  ),
  { ok: true, sessionId: "target-session" },
  "A clearly identified single-board session must remain endable",
);

const olderSnapshot = {
  capturedAt: "2026-08-18T12:00:00.000Z",
  stateVersionAt: "2026-08-18T12:00:00.000Z",
  receivedAt: "2026-08-18T12:00:01.000Z",
  marker: "older",
};
const newerSnapshot = {
  capturedAt: "2026-08-18T12:00:02.000Z",
  stateVersionAt: "2026-08-18T12:00:02.000Z",
  receivedAt: "2026-08-18T12:00:03.000Z",
  marker: "newer",
};
assert.ok(compareDartseeSnapshotVersions(newerSnapshot, olderSnapshot) > 0);
assert.equal(
  newerDartseeSnapshot(newerSnapshot, olderSnapshot).marker,
  "newer",
  "A losing older publication must hand back the already-stored winner",
);
const newestObjectName = [newerSnapshot, olderSnapshot]
  .map((snapshot, index) =>
    dartseeSnapshotStorageObjectName(snapshot, `writer-${index}`),
  )
  .sort()
  .at(-1);
assert.equal(
  newestObjectName,
  dartseeSnapshotStorageObjectName(newerSnapshot, "writer-0"),
  "Immutable object names must select logical state order even when an old upload finishes last",
);

const baseVenueSnapshot = {
  capturedAt: "2026-08-18T16:42:30.000Z",
  stateVersionAt: "2026-08-18T16:42:30.000Z",
  receivedAt: "2026-08-18T16:42:31.000Z",
  lanes: [
    {
      boardId: "beavercreek05",
      status: "open",
      remainingSeconds: 0,
    },
    {
      boardId: "beavercreek01",
      status: "occupied",
      remainingSeconds: 1800,
      sessionId: "other-lane-session",
    },
  ],
};
const confirmedAtMs = new Date("2026-08-18T16:42:39.370Z").getTime();
const confirmedStartSnapshot = snapshotWithConfirmedDartseeControl(
  baseVenueSnapshot,
  {
    boardId: "beavercreek05",
    status: "occupied",
    remainingSeconds: 3659,
    sessionId: "lane-5-start",
    sessionEnd: "2026-08-18T17:43:39.000Z",
  },
  confirmedAtMs,
  new Date("2026-08-18T16:42:39.500Z").getTime(),
);
assert.equal(DARTSEE_CONTROL_GUARD_MS, 60_000);
assert.equal(confirmedStartSnapshot.lanes[0].status, "occupied");
assert.equal(
  confirmedStartSnapshot.lanes[0].controlGuard?.expectedSessionId,
  "lane-5-start",
);

const laggingPostStartSnapshot = {
  ...baseVenueSnapshot,
  capturedAt: "2026-08-18T16:42:39.899Z",
  stateVersionAt: "2026-08-18T16:42:39.899Z",
  receivedAt: "2026-08-18T16:42:40.500Z",
};
const protectedStart = mergeDartseeControlGuards(
  laggingPostStartSnapshot,
  confirmedStartSnapshot,
);
assert.equal(
  protectedStart.lanes[0].status,
  "occupied",
  "A later local capture that echoes pre-Start open state must retain the socket-confirmed Start",
);
assert.ok(protectedStart.lanes[0].controlGuard);

const convergedStart = mergeDartseeControlGuards(
  {
    ...laggingPostStartSnapshot,
    capturedAt: "2026-08-18T16:43:19.191Z",
    stateVersionAt: "2026-08-18T16:43:19.191Z",
    receivedAt: "2026-08-18T16:43:20.000Z",
    lanes: [
      {
        boardId: "beavercreek05",
        status: "occupied",
        remainingSeconds: 3618,
        sessionId: "lane-5-start",
        sessionEnd: "2026-08-18T17:43:39.000Z",
      },
      laggingPostStartSnapshot.lanes[1],
    ],
  },
  protectedStart,
);
assert.equal(convergedStart.lanes[0].status, "occupied");
assert.equal(
  convergedStart.lanes[0].controlGuard,
  undefined,
  "Matching live session evidence should release the Start guard immediately",
);

const beforeExtensionSnapshot = {
  ...baseVenueSnapshot,
  capturedAt: "2026-08-18T17:00:00.000Z",
  stateVersionAt: "2026-08-18T17:00:00.000Z",
  receivedAt: "2026-08-18T17:00:01.000Z",
  lanes: [
    {
      boardId: "beavercreek05",
      status: "occupied",
      remainingSeconds: 1800,
      sessionId: "extended-session",
      sessionEnd: "2026-08-18T17:30:00.000Z",
      maxPlayers: 8,
    },
    baseVenueSnapshot.lanes[1],
  ],
};
const extensionConfirmedAtMs = Date.parse("2026-08-18T17:00:02.000Z");
const confirmedExtensionSnapshot = snapshotWithConfirmedDartseeControl(
  beforeExtensionSnapshot,
  {
    boardId: "beavercreek05",
    status: "occupied",
    remainingSeconds: 2698,
    sessionId: "extended-session",
    sessionEnd: "2026-08-18T17:45:00.000Z",
    maxPlayers: 8,
  },
  extensionConfirmedAtMs,
  Date.parse("2026-08-18T17:00:02.100Z"),
);
const laggingPostExtension = mergeDartseeControlGuards(
  {
    ...beforeExtensionSnapshot,
    capturedAt: "2026-08-18T17:00:03.000Z",
    stateVersionAt: "2026-08-18T17:00:03.000Z",
    receivedAt: "2026-08-18T17:00:04.000Z",
    lanes: [
      {
        ...beforeExtensionSnapshot.lanes[0],
        remainingSeconds: 1797,
      },
      beforeExtensionSnapshot.lanes[1],
    ],
  },
  confirmedExtensionSnapshot,
);
assert.equal(
  laggingPostExtension.lanes[0].sessionEnd,
  "2026-08-18T17:45:00.000Z",
  "A stale same-session socket echo must not erase a confirmed extension",
);
assert.ok(
  laggingPostExtension.lanes[0].controlGuard,
  "Same status and session ID are insufficient evidence when the end time is stale",
);
const convergedExtension = mergeDartseeControlGuards(
  {
    ...beforeExtensionSnapshot,
    capturedAt: "2026-08-18T17:00:05.000Z",
    stateVersionAt: "2026-08-18T17:00:05.000Z",
    receivedAt: "2026-08-18T17:00:06.000Z",
    lanes: [
      {
        ...beforeExtensionSnapshot.lanes[0],
        remainingSeconds: 2695,
        sessionEnd: "2026-08-18T17:46:00.000Z",
      },
      beforeExtensionSnapshot.lanes[1],
    ],
  },
  laggingPostExtension,
);
assert.equal(
  convergedExtension.lanes[0].controlGuard,
  undefined,
  "The extension guard may release once the same live session reaches or exceeds the confirmed end",
);
assert.equal(
  convergedExtension.lanes[0].sessionEnd,
  "2026-08-18T17:46:00.000Z",
);

const oneMinuteExtension = snapshotWithConfirmedDartseeControl(
  beforeExtensionSnapshot,
  {
    ...beforeExtensionSnapshot.lanes[0],
    remainingSeconds: 1858,
    sessionEnd: "2026-08-18T17:31:00.000Z",
  },
  extensionConfirmedAtMs,
  Date.parse("2026-08-18T17:00:02.100Z"),
);
const laggingOneMinuteExtension = mergeDartseeControlGuards(
  {
    ...beforeExtensionSnapshot,
    capturedAt: "2026-08-18T17:00:03.000Z",
    stateVersionAt: "2026-08-18T17:00:03.000Z",
    receivedAt: "2026-08-18T17:00:04.000Z",
  },
  oneMinuteExtension,
);
assert.equal(
  laggingOneMinuteExtension.lanes[0].sessionEnd,
  "2026-08-18T17:31:00.000Z",
  "A one-minute Add-time guard must retain its confirmed end over the old same-session timer",
);
assert.ok(laggingOneMinuteExtension.lanes[0].controlGuard);
const convergedOneMinuteExtension = mergeDartseeControlGuards(
  {
    ...beforeExtensionSnapshot,
    capturedAt: "2026-08-18T17:00:05.000Z",
    stateVersionAt: "2026-08-18T17:00:05.000Z",
    receivedAt: "2026-08-18T17:00:06.000Z",
    lanes: [
      {
        ...beforeExtensionSnapshot.lanes[0],
        remainingSeconds: 1855,
        sessionEnd: "2026-08-18T17:31:00.000Z",
      },
      beforeExtensionSnapshot.lanes[1],
    ],
  },
  laggingOneMinuteExtension,
);
assert.equal(
  convergedOneMinuteExtension.lanes[0].controlGuard,
  undefined,
  "A one-minute Add-time guard may release only after the updated end arrives",
);

const expiredRebasedLaneSnapshot = snapshotWithConfirmedDartseeControl(
  {
    ...beforeExtensionSnapshot,
    lanes: [
      {
        ...beforeExtensionSnapshot.lanes[0],
        remainingSeconds: 1,
      },
      {
        boardId: "beavercreek01",
        status: "open",
        remainingSeconds: 0,
      },
    ],
  },
  {
    boardId: "beavercreek01",
    status: "occupied",
    remainingSeconds: 3600,
    sessionId: "new-start",
    sessionEnd: "2026-08-18T18:00:02.000Z",
    maxPlayers: 8,
  },
  Date.parse("2026-08-18T17:00:02.000Z"),
  Date.parse("2026-08-18T17:00:02.100Z"),
);
assert.equal(expiredRebasedLaneSnapshot.lanes[0].status, "open");
assert.equal(
  expiredRebasedLaneSnapshot.lanes[0].maxPlayers,
  undefined,
  "A lane rebased to open must clear the prior session player limit",
);

const distinctLaterSession = mergeDartseeControlGuards(
  {
    ...laggingPostStartSnapshot,
    capturedAt: "2026-08-18T16:42:45.000Z",
    stateVersionAt: "2026-08-18T16:42:45.000Z",
    receivedAt: "2026-08-18T16:42:46.000Z",
    lanes: [
      {
        boardId: "beavercreek05",
        status: "occupied",
        remainingSeconds: 1200,
        sessionId: "genuinely-new-session",
      },
      laggingPostStartSnapshot.lanes[1],
    ],
  },
  confirmedStartSnapshot,
);
assert.equal(distinctLaterSession.lanes[0].sessionId, "genuinely-new-session");
assert.equal(distinctLaterSession.lanes[0].controlGuard, undefined);

const expiredOppositeState = mergeDartseeControlGuards(
  {
    ...laggingPostStartSnapshot,
    capturedAt: "2026-08-18T16:43:40.000Z",
    stateVersionAt: "2026-08-18T16:43:40.000Z",
    receivedAt: "2026-08-18T16:43:41.000Z",
  },
  confirmedStartSnapshot,
);
assert.equal(
  expiredOppositeState.lanes[0].status,
  "open",
  "A contradictory state must be accepted after the bounded control guard expires",
);

const beforeEndSnapshot = {
  ...baseVenueSnapshot,
  capturedAt: "2026-08-18T17:00:00.000Z",
  stateVersionAt: "2026-08-18T17:00:00.000Z",
  receivedAt: "2026-08-18T17:00:01.000Z",
  lanes: [
    {
      boardId: "beavercreek05",
      status: "occupied",
      remainingSeconds: 1200,
      sessionId: "ending-session",
    },
    baseVenueSnapshot.lanes[1],
  ],
};
const confirmedEndSnapshot = snapshotWithConfirmedDartseeControl(
  beforeEndSnapshot,
  {
    boardId: "beavercreek05",
    status: "open",
    remainingSeconds: 0,
  },
  new Date("2026-08-18T17:00:02.000Z").getTime(),
  new Date("2026-08-18T17:00:02.100Z").getTime(),
);
assert.equal(
  confirmedEndSnapshot.lanes[0].controlGuard?.supersededSessionId,
  "ending-session",
);
const laggingPostEnd = mergeDartseeControlGuards(
  {
    ...beforeEndSnapshot,
    capturedAt: "2026-08-18T17:00:03.000Z",
    stateVersionAt: "2026-08-18T17:00:03.000Z",
    receivedAt: "2026-08-18T17:00:04.000Z",
  },
  confirmedEndSnapshot,
);
assert.equal(
  laggingPostEnd.lanes[0].status,
  "open",
  "A cached copy of the ended session must not undo a confirmed End",
);
const genuinelyRestarted = mergeDartseeControlGuards(
  {
    ...beforeEndSnapshot,
    capturedAt: "2026-08-18T17:00:05.000Z",
    stateVersionAt: "2026-08-18T17:00:05.000Z",
    receivedAt: "2026-08-18T17:00:06.000Z",
    lanes: [
      {
        boardId: "beavercreek05",
        status: "occupied",
        remainingSeconds: 1800,
        sessionId: "new-session-after-end",
      },
      beforeEndSnapshot.lanes[1],
    ],
  },
  confirmedEndSnapshot,
);
assert.equal(genuinelyRestarted.lanes[0].sessionId, "new-session-after-end");
assert.equal(genuinelyRestarted.lanes[0].controlGuard, undefined);

console.log("Protected Dartsee controls regression test passed.");
