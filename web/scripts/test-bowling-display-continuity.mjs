import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const continuityUrl = moduleUrl(source("../src/lib/bowling-display-continuity.ts"));
const continuity = await import(continuityUrl);
const turnoverUrl = moduleUrl(source("../src/lib/bowling-turnover.ts"));
const availabilitySource = source("../src/lib/live-lane-availability.ts");
const availabilityFn = availabilitySource.slice(
  availabilitySource.indexOf("function elapsedSeconds("),
  availabilitySource.indexOf("export async function getLiveLaneAvailability("),
);
const { bowlingSnapshotToAvailability } = await import(moduleUrl(`
  import { bowlingLaneDisplayStatus, bowlingLaneEvidenceFresh } from "${continuityUrl}";
  import { bowlingLaneAvailableAtSeconds } from "${turnoverUrl}";
  const BOWLING_MAX_STORED_AGE_MS = 120_000;
  ${availabilityFn}
`));
const schedulerUrl = moduleUrl(source("../src/lib/resource-scheduler.ts")
  .replace('import { defaultSessionMinutesFor } from "./booking";', 'const defaultSessionMinutesFor = () => 60;')
  .replace('from "./bowling-turnover"', `from "${turnoverUrl}"`));
const { activityQueueWait } = await import(schedulerUrl);
const plannerSource = source("../src/lib/bowling-planner.ts")
  .replace('import { addScheduleWindows } from "./entertainment-schedule";', 'const addScheduleWindows = (_activity, lanes) => lanes;')
  .replace('from "./resource-scheduler"', `from "${schedulerUrl}"`)
  .replace('from "./bowling-turnover"', `from "${turnoverUrl}"`)
  .replace('from "./bowling-display-continuity"', `from "${continuityUrl}"`);
const { planBowlingAssignments } = await import(moduleUrl(plannerSource));
const { normalizeBowlingLaneSnapshot } = await import(moduleUrl(source("../src/lib/bowling-lanes.ts")
  .replace('import { retainBowlingDisplayReadings, type BowlingDisplayReading } from "./bowling-wait-projection";', 'const retainBowlingDisplayReadings = (next) => next;')
  .replace('import { getSupabaseAdmin } from "./supabase";', 'const getSupabaseAdmin = () => null;')));

const now = Date.parse("2026-09-10T20:00:00.000Z");
const iso = (delta = 0) => new Date(now + delta).toISOString();
const occupied = { lane: 1, status: "occupied", remainingSeconds: 600, observedAt: iso(), estimated: false };
const snapshot = {
  lanes: [occupied], capturedAt: iso(), receivedAt: iso(), healthUpdatedAt: iso(),
  source: "brunswick-picokvm-hdmi-ocr", healthStatus: "ok",
};
const recovery = { ...snapshot, healthStatus: "recovering" };
const entry = { id: "synthetic-only", activity: "bowling", name: "Synthetic", phone: "", smsOptIn: false,
  laneCount: 1, sessionMinutes: 60, status: "waiting", createdAt: iso() };
const finite = (lanes) => lanes.some((lane) => Number.isFinite(lane.availableAtSeconds));

assert.equal(continuity.BOWLING_DISPLAY_GRACE_MS, 180_000);
assert.equal(bowlingSnapshotToAvailability(snapshot, now)[0].availableAtSeconds, 900);
for (const healthStatus of ["recovering", "login-required", "remote-offline", "error"]) {
  const outage = { ...snapshot, healthStatus };
  assert.equal(finite(bowlingSnapshotToAvailability(outage, now + 30_000)), false, "Real placement remains fail-closed immediately");
  assert.equal(continuity.bowlingLaneDisplayStatus(outage, occupied, now + 30_000), "occupied");
  assert.equal(bowlingSnapshotToAvailability(outage, now + 30_000, true)[0].availableAtSeconds, 870);
  assert.equal(continuity.bowlingDisplayMetadata(outage, now + 30_000).estimated, true);
}
for (const elapsed of [0, 119_999, 120_000, 120_001, 179_999]) {
  assert.equal(continuity.bowlingSnapshotDisplayState(recovery, now + elapsed).available, true);
  assert.equal(continuity.bowlingLaneDisplayStatus(recovery, occupied, now + elapsed), "occupied");
}
assert.equal(continuity.bowlingSnapshotDisplayState(recovery, now + 180_000).available, false);
assert.equal(finite(bowlingSnapshotToAvailability(recovery, now + 180_000, true)), false);
assert.equal(finite(bowlingSnapshotToAvailability(snapshot, now + 120_001)), false, "Strict snapshot TTL remains two minutes");
assert.equal(finite(bowlingSnapshotToAvailability(snapshot, now + 120_001, true)), true);
assert.equal(continuity.bowlingDisplayMetadata(snapshot, now + 120_001).estimated, true);

const carriedLane = { ...occupied, remainingSeconds: 450, estimated: true };
const carried = { ...snapshot, lanes: [carriedLane], capturedAt: iso(150_000), receivedAt: iso(150_000) };
assert.equal(finite(bowlingSnapshotToAvailability(carried, now + 150_000)), false, "Estimated OCR never becomes strict lane availability");
assert.equal(planBowlingAssignments(carried, [entry], now + 150_000).assignments.length, 0);
assert.equal(bowlingSnapshotToAvailability(carried, now + 170_000, true)[0].availableAtSeconds, 730, "Already-aged watcher time is aged only from the new snapshot capture");
assert.equal(continuity.bowlingDisplayMetadata(carried, now + 170_000).expiresAt, iso(180_000));
const republished = { ...carried, capturedAt: iso(180_001), receivedAt: iso(180_001), healthUpdatedAt: iso(180_001) };
assert.equal(finite(bowlingSnapshotToAvailability(republished, now + 180_001, true)), false, "Republishing cannot renew original lane evidence");
assert.equal(continuity.bowlingLaneDisplayStatus(republished, carriedLane, now + 180_001), "unknown");
assert.equal(continuity.bowlingSnapshotDisplayState({ ...recovery, healthUpdatedAt: iso(180_001) }, now + 180_001).available, false);

for (const patch of [
  { capturedAt: "invalid" }, { capturedAt: iso(1) },
  { lanes: [{ ...occupied, observedAt: "invalid" }] },
  { lanes: [{ ...occupied, observedAt: iso(1) }] },
  { lanes: [{ ...occupied, estimated: true, observedAt: undefined }] },
  { lanes: [{ ...occupied, estimated: true, status: "open", remainingSeconds: 0 }] },
]) {
  assert.equal(finite(bowlingSnapshotToAvailability({ ...snapshot, ...patch }, now)), false);
  assert.equal(finite(bowlingSnapshotToAvailability({ ...snapshot, ...patch }, now, true)), false, "Invalid/future evidence and estimated-open fail closed in display too");
}
const exhausted = { ...recovery, lanes: [{ ...occupied, remainingSeconds: 10 }] };
assert.equal(continuity.bowlingLaneDisplayStatus(exhausted, exhausted.lanes[0], now + 11_000), "occupied", "Zero projected time does not turn a lane open");
assert.equal(bowlingSnapshotToAvailability(exhausted, now + 11_000, true)[0].availableAtSeconds, 300, "Retained occupied zero keeps cleaning wait, not No Wait");
const estimatedZero = { ...snapshot, lanes: [{ ...carriedLane, remainingSeconds: 0 }] };
assert.equal(bowlingSnapshotToAvailability(estimatedZero, now, true)[0].availableAtSeconds, 300);
const realOpen = { ...snapshot, lanes: [{ ...occupied, status: "open", remainingSeconds: 0 }] };
assert.equal(bowlingSnapshotToAvailability(realOpen, now)[0].availableAtSeconds, 0, "Verified real open still clears the wait immediately");
assert.equal(finite(bowlingSnapshotToAvailability({ ...realOpen, healthStatus: "recovering" }, now)), false, "Retained open is never assignable");

const displayLanes = bowlingSnapshotToAvailability(recovery, now + 30_000, true);
assert.equal(activityQueueWait("bowling", [], displayLanes), 15);
assert.equal(activityQueueWait("bowling", [entry], displayLanes), 80, "Fresh queue durations are still added to the retained display timer");
const metadata = continuity.bowlingDisplayMetadata(recovery, now + 30_000);
const publicStats = { activity: "bowling", label: "Bowling", waitingCount: 0, estimatedWaitMinutes: 15,
  availabilityStatus: "estimated", availabilityExpiresAt: metadata.expiresAt, reservationScheduleStatus: "fresh" };
assert.equal(continuity.publicWaitDisplayStatus(publicStats, now + 179_999), "estimated");
assert.equal(continuity.publicWaitDisplayStatus(publicStats, now + 180_000), "unknown", "Browser expiry works even when API polls fail");
assert.equal(continuity.publicWaitDisplayStatus({ ...publicStats, availabilityStatus: "live" }, now + 180_001), "unknown");
assert.equal(continuity.publicWaitDisplayStatus({ ...publicStats, availabilityExpiresAt: "invalid" }, now), "unknown");
assert.equal(continuity.publicWaitDisplayStatus({ ...publicStats, availabilityExpiresAt: undefined }, now), "unknown");
assert.equal(continuity.publicWaitDisplayStatus({ ...publicStats, availabilityStatus: "live", availabilityExpiresAt: undefined }, now), "live", "Legacy healthy cards remain compatible");

const normalized = normalizeBowlingLaneSnapshot(carried);
assert.equal(normalized.lanes[0].observedAt, iso());
assert.equal(normalized.lanes[0].estimated, true);
assert.equal(normalized.lanes[0].remainingSeconds, 450);
assert.equal(normalized.capturedAt, iso(150_000));
const route = source("../src/app/api/staff/bowling-lanes/route.ts");
assert.match(route, /observedAt: z\.string\(\)\.datetime\(\)\.optional\(\)/);
assert.match(route, /estimated: z\.boolean\(\)\.optional\(\)/);
const store = source("../src/lib/store.ts");
assert.equal((store.match(/allowBowlingDisplayContinuity: true/g) ?? []).length, 1, "Only passive Board opts in");
assert.match(store, /getBoard\(\)[\s\S]*?allowBowlingDisplayContinuity: true/);
const getAvailabilityFn = availabilitySource.slice(
  availabilitySource.indexOf("export async function getLiveLaneAvailability("),
  availabilitySource.indexOf("/**\n * Refresh only slow remote sources."),
);
const boundaryModule = await import(moduleUrl(`
  import { bowlingLaneDisplayStatus, bowlingLaneEvidenceFresh, bowlingDisplayMetadata } from "${continuityUrl}";
  import { bowlingLaneAvailableAtSeconds } from "${turnoverUrl}";
  export class TestClock extends globalThis.Date {
    static reads = 0;
    static now() { return ${now + 179_999} + this.reads++; }
  }
  const Date = TestClock;
  const BOWLING_MAX_STORED_AGE_MS = 120_000;
  const DARTSEE_MAX_STORED_AGE_MS = 60_000;
  const ENTERTAINMENT_SCHEDULE_MAX_STORED_AGE_MS = 120_000;
  const getBowlingLaneSnapshot = async () => (${JSON.stringify(recovery)});
  const boundedStoredRead = (value) => value;
  const getStoredDartseeLaneSnapshot = async () => null;
  const getDartseeLaneSnapshot = getStoredDartseeLaneSnapshot;
  const dartseeSnapshotToAvailability = () => undefined;
  const getTimedResourceSessions = async () => [];
  const timedSessionsToAvailability = () => [];
  const getStoredEntertainmentSchedule = async () => ({ reservations: [], fetchedAt: ${JSON.stringify(iso())} });
  const getEntertainmentSchedule = getStoredEntertainmentSchedule;
  const addScheduleWindows = (_activity, lanes) => lanes;
  ${availabilityFn}
  ${getAvailabilityFn}
`));
const boundaryOptions = { allowBowlingDisplayContinuity: true, allowStaleScheduleForDisplay: true };
const justBeforeExpiry = await boundaryModule.getLiveLaneAvailability(boundaryOptions);
assert.equal(finite(justBeforeExpiry.bowling), true);
assert.equal(justBeforeExpiry.bowlingDisplay.expiresAt, iso(180_000), "Finite display estimate must retain its source expiry at the final millisecond");
assert.equal(boundaryModule.TestClock.reads, 1, "Availability and display metadata share one clock reading after source reads");
const atExpiry = await boundaryModule.getLiveLaneAvailability(boundaryOptions);
assert.equal(finite(atExpiry.bowling), false);
assert.equal(atExpiry.bowlingDisplay, undefined);
assert.equal(boundaryModule.TestClock.reads, 2);

const boardFunctions = store.slice(store.indexOf("function buildStats("), store.indexOf("export async function getStaffQueues("));
const boardModule = await import(moduleUrl(`
  const ACTIVITIES = ["bowling"];
  const ACTIVITY_LABELS = { bowling: "Bowling" };
  const readActiveEntriesUnsafe = async () => [];
  const withLocalFileFallbackLock = (fn) => fn();
  const activityQueueWait = () => 5;
  const hasCompleteActivityAvailability = () => true;
  let metadata;
  export const setMetadata = (value) => { metadata = value; };
  const getLiveLaneAvailability = async () => ({
    bowling: [{ id: "1", label: "Lane 1", availableAtSeconds: 300 }],
    reservationScheduleStatus: "fresh", bowlingDisplay: metadata,
  });
  ${boardFunctions}
`));
assert.equal((await boardModule.getBoard())[0].stats.availabilityStatus, "unknown", "Missing display metadata cannot promote even finite future bowling availability to Live");
boardModule.setMetadata(metadata);
assert.equal((await boardModule.getBoard())[0].stats.availabilityStatus, "estimated");
assert.equal((await boardModule.getBoard())[0].stats.availabilityExpiresAt, iso(180_000));
assert.match(source("../src/components/TvWaitBoard.tsx"), /publicWaitDisplayStatus\(stats, nowMs\)/);
assert.match(source("../src/components/ActivityCard.tsx"), /publicWaitDisplayStatus\(stats, nowMs\)/);
assert.match(source("../src/components/WaitlistDashboard.tsx"), /nowMs=\{nowMs\}/);
assert.match(source("../src/components/BowlingPlanner.tsx"), /bowlingLaneDisplayStatus\(snapshot, lane, nowMs\)/);
assert.match(source("../src/app/staff/page.tsx"), /bowlingSnapshotDisplayState\(bowlingSnapshot, nowMs\)/);
assert.doesNotMatch(source("../src/components/BowlingPlanner.tsx"), /BowlingLaneControls|controlRequest/, "Release must not accidentally include the unrelated undeployed control UI");

// Render the real passive components: estimated waits retain their number and
// guest names; expiry changes only availability, never the current queue.
const require = createRequire(import.meta.url);
const compiledComponents = new Map();
function componentUrl(file) {
  if (compiledComponents.has(file.href)) return compiledComponents.get(file.href);
  let text = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.pathname,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  text = text.replace(/from "([^"]+)"/g, (_, specifier) => {
    let resolved;
    if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      const base = specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}`, import.meta.url) : new URL(specifier, file);
      const child = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((candidate) => existsSync(candidate));
      assert.ok(child, `Component dependency exists: ${specifier}`);
      resolved = componentUrl(child);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    return `from "${resolved}"`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
  compiledComponents.set(file.href, url);
  return url;
}
const { ActivityCard } = await import(componentUrl(new URL("../src/components/ActivityCard.tsx", import.meta.url)));
const queue = [{ id: "synthetic-only", name: "Synthetic test guest", position: 1, status: "waiting", laneCount: 1, sessionMinutes: 60 }];
const card = (clock) => renderToStaticMarkup(React.createElement(ActivityCard, { board: { stats: publicStats, queue }, onJoin: () => {}, nowMs: clock }));
const retainedHtml = card(now + 179_999);
assert.match(retainedHtml, /Last confirmed estimate/);
assert.match(retainedHtml, /Reconnecting/);
assert.match(retainedHtml, /~15/);
assert.match(retainedHtml, /Synthetic test guest/);
assert.doesNotMatch(retainedHtml, /Updating/);
const expiredHtml = card(now + 180_000);
assert.match(expiredHtml, /Check with staff/);
assert.match(expiredHtml, /Synthetic test guest/, "Availability expiry must not erase the queue");
const { TvWaitBoard } = await import(componentUrl(new URL("../src/components/TvWaitBoard.tsx", import.meta.url)));
const tvStats = { ...publicStats, availabilityExpiresAt: new Date(Date.now() + 60_000).toISOString() };
const tvHtml = renderToStaticMarkup(React.createElement(TvWaitBoard, { initialBoard: [{ stats: tvStats, queue }] }));
const bowlingCard = tvHtml.slice(tvHtml.indexOf("<article"), tvHtml.indexOf("</article>") + 10);
assert.match(bowlingCard, /Last confirmed estimate/);
assert.match(bowlingCard, /Synthetic test guest/);
assert.doesNotMatch(bowlingCard, /Updating/);
// Render the real TV and guest cards with a fresh server response 600ms ahead
// of the browser clock. Only the server's exact zero may bypass rounding.
const originalDateNow = Date.now;
try {
  Date.now = () => now;
  for (const [estimate, expected] of [[0, /No Wait/], [1, />1<span/]]) {
    const current = { ...publicStats, estimatedWaitMinutes: estimate,
      waitReadyAt: iso(600), waitSourceAt: iso(-10_000), waitEstimateExpiresAt: iso(60_000) };
    const currentBoard = { stats: current, queue: [] };
    const renderedTv = renderToStaticMarkup(React.createElement(TvWaitBoard, { initialBoard: [currentBoard] }));
    const currentBowling = renderedTv.slice(renderedTv.indexOf("<article"), renderedTv.indexOf("</article>") + 10);
    assert.match(currentBowling, expected, "TV preserves zero without suppressing a genuine one-minute estimate");
    const renderedGuest = renderToStaticMarkup(React.createElement(ActivityCard, { board: currentBoard, onJoin: () => {}, nowMs: now }));
    assert.match(renderedGuest, estimate === 0 ? /No Wait/i : /~1/,
      "Guest card uses the same stable estimate policy");
  }
} finally {
  Date.now = originalDateNow;
}
console.log("Bowling display continuity passed: 180s source-anchored grace, strict placement, expiry, real-open confirmation, countdown/cleaning/queue math, and client wiring.");
