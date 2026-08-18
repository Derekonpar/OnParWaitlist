import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inspectDartseeEndSession } from "../src/lib/dartsee-session-safety.ts";
import {
  compareDartseeSnapshotVersions,
  dartseeSnapshotStorageObjectName,
  newerDartseeSnapshot,
} from "../src/lib/dartsee-snapshot-order.ts";
import {
  DARTSEE_START_BUFFER_MINUTES,
  dartseeCommandDurationMinutes,
} from "../src/lib/dartsee-duration.ts";
import {
  DARTSEE_CONTROL_GUARD_MS,
  mergeDartseeControlGuards,
  snapshotWithConfirmedDartseeControl,
} from "../src/lib/dartsee-control-guard.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const component = source("../src/components/DartsPlanner.tsx");
const staffPage = source("../src/app/staff/page.tsx");
const route = source("../src/app/api/staff/dart-lanes/start/route.ts");
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
  /const optimisticStart =[\s\S]*?controlInProgress && lane\.status === "open"[\s\S]*?pendingControl\?\.action === "start"/,
  "Only the clicked or pending Start lane may render optimistically occupied",
);
assert.match(
  component,
  /const optimisticRemainingSeconds =[\s\S]*?dartseeCommandDurationMinutes\(startDuration\) \* 60/,
  "The immediate Start countdown must include the one-minute Dartsee buffer",
);
assert.match(component, /const displayedStatus = optimisticStart \? "occupied" : lane\.status/);
assert.match(component, /optimisticStart[\s\S]*?Starting session/);
assert.match(component, /aria-label=\{`Starting Dart \$\{lane\.lane\}`\}/);
assert.match(
  component,
  /const endingInProgress =[\s\S]*?controlInProgress && lane\.status === "occupied"/,
  "End feedback must remain tied to an occupied server-observed lane",
);
assert.match(component, /endingInProgress[\s\S]*?"Ending…"/);
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
  /import \{[\s\S]*?DARTSEE_EMPLOYEE_ALERT_AFTER_MS,[\s\S]*?DARTSEE_SUSTAINED_FAILURE_REFRESHES,[\s\S]*?\} from "@\/lib\/dartsee-feed-presentation"/,
  "Staff-wide and lane-card warning thresholds must share one definition",
);
assert.match(staffPage, /DART_CONTROL_CLIENT_TIMEOUT_MS = 25_000/);
assert.match(staffPage, /const controller = new AbortController\(\)/);
assert.match(staffPage, /signal: controller\.signal/);
assert.match(staffPage, /requestId: window\.crypto\.randomUUID\(\)/);
assert.match(staffPage, /lane,\s*durationMinutes,/);
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
assert.match(route, /verifyStaffHeaderSecret/);
assert.match(route, /isSameOrigin/);
assert.match(route, /cache-control": "private, no-store"/);
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
assert.match(dartsee, /ids\.length !== 5 \|\| new Set\(ids\)\.size !== 5/);
assert.match(dartsee, /return ids\[lane - 1\] \?\? null/);
assert.match(
  dartsee,
  /openDartseeControlObserverWithFreshAuth\(\s*\[boardId\],\s*3_000/,
  "Start must use one live lane observer across preflight and confirmation",
);
assert.match(dartsee, /before\.status !== "open"/);
assert.match(dartsee, /reservationConflictsWithSession\(/);
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

const targetBoard = "beavercreek01";
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

console.log("Protected Dartsee Start and End controls regression test passed.");
