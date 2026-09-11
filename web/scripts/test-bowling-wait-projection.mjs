import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const read = (name) => readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
const url = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const turnover = url(read("bowling-turnover"));
const scheduler = url(read("resource-scheduler").replace('import { defaultSessionMinutesFor } from "./booking";', "const defaultSessionMinutesFor = () => 60;")
  .replace('from "./bowling-turnover"', `from "${turnover}"`));
const policy = url(read("reservation-policy"));
const scheduleSource = read("entertainment-schedule");
const schedule = url(`import { activityTurnoverSeconds } from "${scheduler}";
  import { RESERVATION_PROTECTION_MS, reservationBlocksAvailability } from "${policy}";
  ${scheduleSource.slice(scheduleSource.indexOf("function canonicalResourceIds("))}`);
const projection = url(read("bowling-wait-projection").replace('from "./entertainment-schedule"', `from "${schedule}"`)
  .replace('from "./entertainment-schedule"', `from "${schedule}"`)
  .replace('from "./bowling-turnover"', `from "${turnover}"`)
  .replace('from "./resource-scheduler"', `from "${scheduler}"`));
const { projectBowlingWait: project, retainBowlingDisplayReadings: retain, BOWLING_ESTIMATE_MAX_AGE_MS } = await import(projection);
const { publicWaitMinutes, publicWaitDisplayStatus, retainPublicBowlingEstimate } = await import(url(read("bowling-display-continuity")));
const { addScheduleWindows } = await import(schedule);
const t = Date.parse("2026-09-11T20:00:00Z");
const iso = (minutes = 0) => new Date(t + minutes * 60000).toISOString();
const snapshot = (minutes = 10, at = 0, status = "occupied", count = 12) => ({
  capturedAt: iso(at), receivedAt: iso(at), healthUpdatedAt: iso(at), healthStatus: "ok", source: "synthetic-only",
  lanes: Array.from({ length: count }, (_, i) => ({ lane: i + 1, status, remainingSeconds: minutes * 60, observedAt: iso(at) })),
});
const entry = (id, created = 0, laneCount = 1, sessionMinutes = 60) => ({ id, name: "Synthetic", activity: "bowling", phone: "", smsOptIn: false,
  status: "waiting", laneCount, sessionMinutes, createdAt: iso(created) });
const full = snapshot();
assert.equal(project(full, [], [], t).estimatedWaitMinutes, 15, "Least timer plus cleaning when full");
const mixedFull = { ...full, lanes: full.lanes.map((lane, i) => ({ ...lane, remainingSeconds: (i === 8 ? 10 : 40) * 60 })) };
assert.equal(project(mixedFull, [], [], t).estimatedWaitMinutes, 15, "Choose shortest, not average");
assert.equal(project(full, [], [], t + 6 * 60000).estimatedWaitMinutes, 9, "Outage longer than old three-minute grace still counts down");
assert.equal(project(full, [], [], t + 16 * 60000).estimatedWaitMinutes, 0, "Cleaning buffer counts down too; no permanent five-minute floor");
assert.equal(full.lanes[0].status, "occupied", "Projection never changes actual lane truth");
const open = retain(snapshot(0, 0, "open"), null, t);
const openAgain = retain(snapshot(0, 30, "open"), open, t + 30 * 60000);
assert.equal(openAgain.lanes[0].displayReading.availableAt, iso(), "Unchanged open state keeps original availability anchor");
assert.equal(project(open, [], [], t + 60 * 60000).estimatedWaitMinutes, 0, "Mostly empty snapshot does not become Updating during outage");
const oneLane = retain(snapshot(10, 0, "occupied", 1), null, t);
const queued = [entry("a")];
assert.equal(project(oneLane, [], queued, t).estimatedWaitMinutes, 80, "Queue duration and turnover are added");
assert.equal(project(oneLane, [], queued, t + 20 * 60000).estimatedWaitMinutes, 60, "Full queued estimate counts down, not only source time");
assert.equal(project(oneLane, [], queued, t + 90 * 60000).estimatedWaitMinutes, 0, "Queue estimate does not restart on every poll");
assert.equal(queued[0].status, "waiting", "Zero estimate never removes guest");
const later = entry("b", 20, 1, 30);
assert.equal(project(oneLane, [], [...queued, later], t + 20 * 60000, later).estimatedWaitMinutes, 60, "New guest gets remaining complete estimate");
assert.equal(project(oneLane, [], [...queued, later], t + 25 * 60000, later).estimatedWaitMinutes, 55, "Personal countdown agrees five minutes later");
assert.equal(project(oneLane, [], [...queued, later], t + 20 * 60000).estimatedWaitMinutes, 95, "Second requested duration is included");
const twoLanes = { ...snapshot(10, 0, "occupied", 2), lanes: [full.lanes[0], { ...full.lanes[1], remainingSeconds: 40 * 60 }] };
assert.equal(project(twoLanes, [], [], t, entry("pair", 0, 2)).estimatedWaitMinutes, 45, "Multi-lane group waits for second adjacent lane");
const nonAdjacent = { ...twoLanes, lanes: [full.lanes[0], { ...full.lanes[1], lane: 3 }] };
assert.equal(project(nonAdjacent, [], [], t, entry("pair", 0, 2)), undefined);
const bad = { ...snapshot(0, 20, "unknown", 1), healthStatus: "recovering" };
const retained = retain(bad, oneLane, t + 20 * 60000);
assert.equal(retained.lanes[0].status, "unknown", "Unknown source remains unknown for staff");
assert.equal(retained.lanes[0].displayReading.observedAt, iso(), "Unknown does not refresh evidence");
assert.equal(project(retained, [], queued, t + 20 * 60000).estimatedWaitMinutes, 60);
assert.equal(project({ ...oneLane, healthStatus: "error", healthUpdatedAt: iso(100) }, [], [], t + 100 * 60000).estimatedWaitMinutes, 0);
assert.equal(project(retained, [], [], t + BOWLING_ESTIMATE_MAX_AGE_MS), undefined, "Never reuse yesterday's stale availability forever");
assert.equal(project(snapshot(10, 1), [], [], t), undefined, "Future evidence is invalid");
assert.equal(project(snapshot(0, 0, "unknown"), [], [], t), undefined, "Never observed is not assumed open");
const event = { id: "synthetic-event", operatingDate: "2026-09-11", eventId: "synthetic", eventName: "Synthetic only", resourceId: "bowling-1",
  resourceName: "Lane 1", resourceCategory: "bowling", startAt: iso(90), endAt: iso(150), source: "tripleseat", manualOverride: false, needsReview: false };
const singleOpen = { ...open, lanes: [open.lanes[0]] };
assert.equal(project(singleOpen, [event], [], t).estimatedWaitMinutes, 155, "Known reservation blocks a session that would overlap protection");
assert.equal(project(singleOpen, [event], [], t + 100 * 60000).estimatedWaitMinutes, 55, "Saved event remains blocked while feed is down");
assert.equal(project(singleOpen, [event], [], t + 156 * 60000).estimatedWaitMinutes, 0, "Event and cleaning expire by their actual time");
assert.equal(addScheduleWindows("bowling", [{ id: "1", label: "Lane 1", availableAtSeconds: 0 }], [event], t + 156 * 60000)[0].unavailableWindows.length, 0, "Ended event cannot create an endless five-minute hold");
const value = project(oneLane, [], queued, t);
const stats = { activity: "bowling", label: "Bowling", waitingCount: 1, reservationScheduleStatus: "stale", ...value };
assert.equal(publicWaitMinutes(stats, t + 20 * 60000), 60);
assert.equal(publicWaitDisplayStatus(stats, t + 20 * 60000), "estimated");
assert.equal(publicWaitDisplayStatus(stats, t + BOWLING_ESTIMATE_MAX_AGE_MS), "unknown");
const previous = [{ stats, queue: queued }];
const failed = [{ stats: { ...stats, availabilityStatus: "unknown", waitReadyAt: undefined }, queue: queued }];
assert.equal(retainPublicBowlingEstimate(previous, failed, t + 20 * 60000)[0].stats.waitReadyAt, value.waitReadyAt, "Transient read failure retains existing anchor");
assert.equal(retainPublicBowlingEstimate(previous, [{ ...failed[0], queue: [...queued, later] }], t + 20 * 60000)[0].stats.waitReadyAt, undefined, "Changed queue never uses an obsolete queue plan");
// Exercise the real store's board and personal-status wiring with isolated
// source and queue fixtures. Nothing below can access storage or send an SMS.
const storeSource = read("store");
const boardBody = storeSource.slice(storeSource.indexOf("function buildStats("), storeSource.indexOf("export async function getStaffQueues("));
const personalBody = storeSource.slice(storeSource.indexOf("function getPositionFromEntries("), storeSource.indexOf("export async function joinWaitlist("));
const { getBoard, getWaitlistStatus } = await import(url(`
  import { projectBowlingWait } from "${projection}";
  import { activityQueueWait, hasCompleteActivityAvailability, hasCompleteTargetAvailability, waitMinutesAhead } from "${scheduler}";
  const ACTIVITIES = ["bowling"], ACTIVITY_LABELS = { bowling: "Bowling" };
  const entries = ${JSON.stringify([...queued, later])};
  const readActiveEntriesUnsafe = async () => entries;
  const withLocalFileFallbackLock = (fn) => fn();
  const getLiveLaneAvailability = async () => ({
    reservationScheduleStatus: "stale",
    bowlingEstimateInput: { snapshot: ${JSON.stringify(retained)}, reservations: [], nowMs: ${t + 20 * 60000} },
  });
  ${boardBody}
  ${personalBody}
`));
const wiredBoard = (await getBoard())[0];
assert.equal(wiredBoard.stats.estimatedWaitMinutes, 95);
assert.equal(wiredBoard.stats.availabilityStatus, "estimated");
assert.equal(wiredBoard.stats.availabilityExpiresAt, undefined, "New countdown does not inherit old 180-second expiry");
assert.equal(wiredBoard.queue.length, 2);
assert.equal((await getWaitlistStatus("b")).estimatedWaitMinutes, 60);
assert.equal((await getWaitlistStatus("b")).waitReadyAt, iso(80));
console.log("Bowling projection passed: absolute countdown, full/empty/partial feed, queue durations, adjacent groups, reserved windows, expiry, source isolation, client continuity, and actual board/personal-status integration.");
