import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const store = read("src/lib/store.ts");
const queueRoute = read("src/app/api/staff/queue/route.ts");
const archiveRoute = read("src/app/api/staff/archive/route.ts");
const scheduleRoute = read("src/app/api/staff/entertainment-schedule/route.ts");
const staffPage = read("src/app/staff/page.tsx");

const staffQueueReader = store.slice(
  store.indexOf("async function readStaffQueueEntriesUnsafe"),
  store.indexOf("export interface StaffArchivePage"),
);
const staffQueueGetter = store.slice(
  store.indexOf("export async function getStaffQueues"),
  store.indexOf("export async function getEstimatedWaitMinutes"),
);
const staffRefresh = staffPage.slice(
  staffPage.indexOf("const loadStaffData"),
  staffPage.indexOf("const fetchQueues"),
);

assert.match(
  staffQueueReader,
  /\.in\("status", activeStatuses\)[\s\S]*?\.in\("status", historyStatuses\)[\s\S]*?\.limit\(STAFF_RECENT_HISTORY_LIMIT\)/,
  "Staff polling must fetch active rows plus a bounded recent recall strip",
);
assert.match(
  staffQueueGetter,
  /readStaffQueueEntriesUnsafe/,
  "The staff queue endpoint must use the bounded staff snapshot reader",
);
assert.doesNotMatch(
  staffQueueGetter,
  /readAllUnsafe/,
  "The staff queue endpoint must not read the full archive",
);
assert.match(
  queueRoute,
  /verifyStaffSecret[\s\S]*?getStaffQueues/,
  "The bounded staff queue must remain authenticated",
);
assert.match(
  store,
  /getStaffArchivePage[\s\S]*?STAFF_ARCHIVE_MAX_PAGE_SIZE[\s\S]*?\.range\(offset, offset \+ pageSize\)/,
  "Archive search must enforce a maximum page size and fetch at most one look-ahead row",
);
const archiveGetter = store.slice(
  store.indexOf("export async function getStaffArchivePage"),
  store.indexOf("async function hasActiveDuplicateUnsafe"),
);
assert.match(
  archiveGetter,
  /\.select\(STAFF_ARCHIVE_SELECT\)/,
  "Archive pages must return only the fields used by the staff archive UI",
);
assert.doesNotMatch(
  archiveGetter,
  /\.select\("\*"\)/,
  "Archive pages must not expose full historical rows",
);
assert.match(
  archiveRoute,
  /pageSize: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)/,
  "Archive search must reject oversized pages",
);
assert.match(
  archiveRoute,
  /export async function GET[\s\S]*?verifyStaffSecret[\s\S]*?getStaffArchivePage/,
  "Archive search must be authenticated",
);
assert.match(
  archiveRoute,
  /cache-control": "private, no-store"/,
  "Archive responses containing guest details must not be cached",
);
assert.doesNotMatch(
  staffRefresh,
  /\/api\/staff\/archive/,
  "The 15-second staff refresh must not load archived guests",
);
assert.match(
  staffPage,
  /if \(!authenticated \|\| !archiveOpen \|\| !secret\) return;[\s\S]*?loadArchive\(secret, archiveQuery, 1\)/,
  "Archive rows must load only after the archive section opens",
);
assert.doesNotMatch(
  staffPage,
  /allEntries\.filter\(\(e\) => e\.status === "archived"\)/,
  "The staff page must not expect archived rows in the hot queue payload",
);
assert.match(
  staffPage,
  /Reservation schedule needs attention/,
  "Every staff tab must show a prominent stale reservation warning",
);
assert.match(
  scheduleRoute,
  /SCHEDULE_SAFETY_STALE_AFTER_MS = 120_000[\s\S]*?Date\.now\(\) - fetchedAt > SCHEDULE_SAFETY_STALE_AFTER_MS/,
  "Normal 60-second schedule refreshes must have a 120-second safety grace period",
);
assert.match(
  staffPage,
  /if \(Array\.isArray\(data\.schedule\?\.reservations\)\)[\s\S]*?setEntertainmentReservations/,
  "Only a valid schedule snapshot may replace last-known reservations",
);
assert.match(
  staffPage,
  /loadResourceSessions[\s\S]*?if \(!Array\.isArray\(data\.sessions\)\)[\s\S]*?setResourceSessions\(data\.sessions\)[\s\S]*?setResourceSessionsRefreshError\(true\)/,
  "Timed-resource refresh failures must preserve last-known sessions",
);
assert.match(
  staffPage,
  /Pool \/ shuffleboard sessions need attention/,
  "Every staff tab must warn when pool or shuffleboard timers are unavailable",
);

console.log("staff queue bounds regression checks passed");
