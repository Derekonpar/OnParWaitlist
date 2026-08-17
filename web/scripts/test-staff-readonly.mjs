/**
 * Read-only authenticated waitlist smoke test. It logs aggregate status only;
 * guest names, IDs, phones, queue contents, and secrets are never printed.
 *
 * Run after exporting the STAFF_SECRET environment variable:
 *   node scripts/test-staff-readonly.mjs https://onparwaitlist.com
 */
import assert from "node:assert/strict";

const suppliedBase = process.argv[2];
const secret = process.env.STAFF_SECRET;
if (!suppliedBase || !secret) {
  console.error("Usage: export STAFF_SECRET, then run test-staff-readonly.mjs <base-url>");
  process.exit(2);
}

const base = suppliedBase.replace(/\/$/, "");
const headers = { "x-staff-secret": secret };
const MAX_ENDPOINT_MS = 3_000;

async function request(path, authenticated = true) {
  const startedAt = performance.now();
  const response = await fetch(`${base}${path}`, {
    cache: "no-store",
    ...(authenticated ? { headers } : {}),
    signal: AbortSignal.timeout(7_000),
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(response.status, 200, `${path} must return 200`);
  assert.ok(elapsedMs < MAX_ENDPOINT_MS, `${path} exceeded ${MAX_ENDPOINT_MS}ms`);
  return { body: await response.json(), elapsedMs };
}

const queueResult = await request("/api/staff/queue");
const queues = Array.isArray(queueResult.body.queues) ? queueResult.body.queues : [];
const activeEntries = queues
  .flatMap((activity) => (Array.isArray(activity.queue) ? activity.queue : []))
  .filter((entry) => entry.status === "waiting" || entry.status === "notified");
const archivedInQueue = queues
  .flatMap((activity) => (Array.isArray(activity.queue) ? activity.queue : []))
  .filter((entry) => entry.status === "archived");
assert.equal(
  archivedInQueue.length,
  0,
  "The hot staff queue must not contain archived history",
);

const archiveResult = await request("/api/staff/archive?page=1&pageSize=25");
const archiveEntries = Array.isArray(archiveResult.body.entries)
  ? archiveResult.body.entries
  : [];
assert.ok(archiveEntries.length <= 25, "Archive page must be bounded to 25 rows");
assert.ok(
  archiveEntries.every((entry) => entry.status === "archived"),
  "Archive search may return only archived rows",
);
for (const entry of archiveEntries) {
  assert.equal(entry.joinSmsSid, undefined, "Archive must not expose join SMS SIDs");
  assert.equal(entry.lastSmsSid, undefined, "Archive must not expose SMS SIDs");
  assert.equal(entry.customerId, undefined, "Archive must not expose customer IDs");
}

const integrationPaths = [
  "/api/staff/bowling-lanes",
  "/api/staff/dart-lanes",
  "/api/staff/resource-sessions",
  "/api/staff/entertainment-schedule",
];
const integrations = await Promise.all(integrationPaths.map((path) => request(path)));

let boardResult;
let board = [];
let queueBoardConsistent = false;
for (let attempt = 0; attempt < 3 && !queueBoardConsistent; attempt += 1) {
  const [freshQueueResult, freshBoardResult] = await Promise.all([
    request("/api/staff/queue"),
    request("/api/waitlist/board", false),
  ]);
  boardResult = freshBoardResult;
  assert.equal(boardResult.body.stale, false, "Board must be current during staff audit");
  board = Array.isArray(boardResult.body.board) ? boardResult.body.board : [];
  const freshQueues = Array.isArray(freshQueueResult.body.queues)
    ? freshQueueResult.body.queues
    : [];
  queueBoardConsistent = board.length === 4 && board.every((activityBoard) => {
    const activity = activityBoard.stats?.activity;
    const staffQueue = freshQueues.find((item) => item.activity === activity)?.queue ?? [];
    const waitingCount = staffQueue.filter((entry) => entry.status === "waiting").length;
    const publicQueueCount = staffQueue.filter(
      (entry) => entry.status === "waiting" || entry.status === "notified",
    ).length;
    return (
      activityBoard.stats?.waitingCount === waitingCount &&
      activityBoard.queue?.length === publicQueueCount
    );
  });
}
assert.ok(
  queueBoardConsistent,
  "Public board counts must match a concurrent staff queue snapshot",
);
for (const activityBoard of board) {
  const activity = activityBoard.stats?.activity;
  assert.ok(
    Number.isFinite(activityBoard.stats?.estimatedWaitMinutes) &&
      activityBoard.stats.estimatedWaitMinutes >= 0,
    `${activity} wait estimate must be a non-negative number`,
  );
}

const schedule = integrations[3].body.schedule;
if (schedule) {
  assert.ok(
    schedule.reservations.every(
      (reservation) => reservation.operatingDate === schedule.from,
    ),
    "Staff schedule must expose only the current operating day",
  );
}

let statusLatencyMs = null;
if (activeEntries[0]?.id) {
  const startedAt = performance.now();
  const response = await fetch(`${base}/api/waitlist/status/${activeEntries[0].id}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  });
  statusLatencyMs = performance.now() - startedAt;
  assert.equal(response.status, 200, "Active guest status must return 200");
  assert.ok(
    statusLatencyMs < MAX_ENDPOINT_MS,
    `Guest status exceeded ${MAX_ENDPOINT_MS}ms`,
  );
  const body = await response.json();
  assert.ok(
    body.availabilityStatus === "live" || body.availabilityStatus === "unknown",
    "Guest status must declare live availability",
  );
}

console.log(
  JSON.stringify({
    ok: true,
    activeEntryCount: activeEntries.length,
    queueLatencyMs: Math.round(queueResult.elapsedMs),
    archiveLatencyMs: Math.round(archiveResult.elapsedMs),
    archivePageCount: archiveEntries.length,
    integrationLatencyMs: integrations.map((result) => Math.round(result.elapsedMs)),
    boardLatencyMs: Math.round(boardResult.elapsedMs),
    activityWaits: board.map((activity) => ({
      activity: activity.stats.activity,
      waitingCount: activity.stats.waitingCount,
      estimatedWaitMinutes: activity.stats.estimatedWaitMinutes,
      availabilityStatus: activity.stats.availabilityStatus,
    })),
    statusLatencyMs: statusLatencyMs == null ? null : Math.round(statusLatencyMs),
  }),
);
