import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const boardRoute = source("../src/app/api/waitlist/board/route.ts");
const dashboard = source("../src/components/WaitlistDashboard.tsx");
const tvBoard = source("../src/components/TvWaitBoard.tsx");
const statusPage = source("../src/app/status/[id]/page.tsx");
const staffPage = source("../src/app/staff/page.tsx");
const joinModal = source("../src/components/JoinModal.tsx");
const liveAvailability = source("../src/lib/live-lane-availability.ts");
const defaults = source("../src/lib/defaults.ts");
const scheduler = source("../src/lib/resource-scheduler.ts");
const resourceSessionsRoute = source(
  "../src/app/api/staff/resource-sessions/route.ts",
);
const healthRoute = source("../src/app/api/health/route.ts");
const store = source("../src/lib/store.ts");
const normalizedJoinModal = joinModal.replace(/\s+/g, " ");

const staleGuard = dashboard.indexOf("if (data.stale)");
const boardReplacement = dashboard.indexOf("setBoard(data.board)");
assert.ok(staleGuard >= 0, "Guest board must detect stale API payloads");
assert.ok(
  staleGuard < boardReplacement,
  "Guest board must reject stale data before replacing last-known-good state",
);
assert.match(
  dashboard,
  /refreshControllerRef\.current[\s\S]*?controller\.abort\(\)/,
  "Guest board polling must be abortable and single-flight",
);
assert.match(
  tvBoard,
  /if \(data\.stale\)[\s\S]*?setConnected\(false\)[\s\S]*?return/,
  "TV board must retain last-known-good data on stale responses",
);
assert.match(
  boardRoute,
  /after\(refreshLiveLaneSources\)/,
  "Board requests must refresh slow upstream feeds after responding",
);
assert.match(
  boardRoute,
  /stale: true[\s\S]*?dataUpdatedAt\?: never/,
  "A timeout fallback must not claim a fresh data timestamp",
);
assert.match(
  boardRoute,
  /status: result\.stale \? 503 : 200/,
  "A timeout must be non-success so already-open clients retain their board",
);
assert.match(
  liveAvailability,
  /refreshRemote = options\.refreshRemote \?\? false/,
  "Live availability must default to stored, non-blocking sources",
);
assert.match(
  liveAvailability,
  /DARTSEE_MAX_STORED_AGE_MS = 60_000/,
  "Expired Dartsee data must not advertise open lanes",
);
assert.match(
  liveAvailability,
  /BOWLING_MAX_STORED_AGE_MS = 120_000/,
  "Expired Brunswick data must not advertise open lanes",
);
assert.match(
  liveAvailability,
  /ENTERTAINMENT_SCHEDULE_MAX_STORED_AGE_MS = 120_000/,
  "Expired reservation data must not advertise resources as safe to book",
);
assert.match(
  scheduler,
  /hasCompleteActivityAvailability[\s\S]*?plan\.unassigned\.length === 0/,
  "A partial lane feed must not label fallback wait math as live",
);
assert.match(
  defaults,
  /availabilityStatus: "unknown"/,
  "Cold-start fallback cards must say availability is unknown, not No Wait",
);
assert.match(
  statusPage,
  /res\.status === 404/,
  "Only a real 404 may mark a guest entry not found",
);
assert.match(
  statusPage,
  /setInterval\(\(\) => void load\(\), 15_000\)/,
  "Guest status polling must use the bounded 15-second cadence",
);
const statusRoute = source("../src/app/api/waitlist/status/[id]/route.ts");
assert.match(
  statusRoute,
  /STATUS_TIMEOUT_MS = 5_000[\s\S]*?status: 503/,
  "A slow guest status read must fail temporarily instead of hanging",
);
const queueCommit = staffPage.indexOf("setAuthenticated(true)");
const integrationWait = staffPage.indexOf("await Promise.allSettled([");
assert.ok(queueCommit >= 0 && integrationWait >= 0, "Staff load phases must exist");
assert.ok(
  queueCommit < integrationWait,
  "Staff authentication must complete before slow integrations settle",
);
assert.match(
  staffPage,
  /Queue refresh delayed — showing the last known guest list/,
  "Staff must be told when the visible queue is last-known data",
);
assert.doesNotMatch(
  joinModal,
  /name stays private/i,
  "Self-service consent copy must not contradict the public name display",
);
assert.match(
  joinModal,
  /max-h-\[calc\(100dvh-1rem\)\][^\n]*overflow-y-auto[^\n]*overscroll-contain/,
  "The mobile join dialog must stay within the visible viewport and scroll internally",
);
assert.match(
  joinModal,
  /<BookingOptions[\s\S]*?compact[\s\S]*?\/>/,
  "The public join form must use compact booking controls on phones",
);
for (const requiredConsentText of [
  "transactional waitlist texts",
  "Message frequency varies",
  "message and data rates may apply",
  "Reply STOP to opt out or HELP for help",
  "Consent is not a condition of purchase",
  "Self-service requires",
]) {
  assert.match(
    normalizedJoinModal,
    new RegExp(requiredConsentText, "i"),
    `Compact consent must retain: ${requiredConsentText}`,
  );
}
assert.match(
  joinModal,
  /href="\/sms"/,
  "Compact consent must retain the SMS terms and privacy link",
);
assert.match(
  resourceSessionsRoute,
  /SCHEDULE_PROTECTION_MAX_AGE_MS[\s\S]*?status: 503/,
  "Timed-resource bookings must fail closed when reservation protection is stale",
);
assert.match(
  healthRoute,
  /DARTSEE_FRESH_FOR_MS = 60_000[\s\S]*?isFresh\(darts\.capturedAt, DARTSEE_FRESH_FOR_MS, nowMs\)/,
  "Sanitized health must degrade when the Dartsee capture is old",
);
assert.match(
  healthRoute,
  /entertainmentSchedule:[\s\S]*?fetchedAt: schedule\?\.fetchedAt \?\? null/,
  "Sanitized health must expose schedule freshness without reservation data",
);
assert.match(
  store,
  /function withLocalFileFallbackLock[\s\S]*?if \(getSupabaseAdmin\(\) \|\| isServerlessHost\(\)\) return fn\(\);[\s\S]*?localFileStoreLock\.then/,
  "Supabase and storage-error serverless I/O must bypass the local-file lock",
);
assert.doesNotMatch(
  store,
  /withStoreLock/,
  "The legacy lock must not serialize unrelated Supabase requests",
);
assert.equal(
  (store.match(/withLocalFileFallbackLock\(readActiveEntriesUnsafe\)/g) ?? [])
    .length,
  5,
  "All high-frequency public queue reads must use the active-entry query",
);
assert.match(
  store,
  /\.select\(ACTIVE_ENTRY_SELECT\)[\s\S]*?\.in\("status", ACTIVE_WAITLIST_STATUSES\)/,
  "The public Supabase query must project only active waitlist rows",
);
assert.match(
  store,
  /function hasActiveDuplicateUnsafe[\s\S]*?\.select\("id"\)[\s\S]*?\.eq\("phone", phone\)[\s\S]*?\.in\("status", ACTIVE_WAITLIST_STATUSES\)/,
  "Join duplicate checks must use a targeted active-row Supabase query",
);
assert.match(
  store,
  /function recordSmsAttempt[\s\S]*?if \(supabase\) {[\s\S]*?\.select\("notification_count"\)[\s\S]*?\.eq\("id", id\)[\s\S]*?} else {[\s\S]*?readAllUnsafe\(\)/,
  "SMS tracking must read one Supabase row before using full-file fallback",
);
const localReadStart = store.indexOf("async function readAllUnsafe");
const activeReadStart = store.indexOf("async function readActiveEntriesUnsafe");
assert.ok(
  localReadStart >= 0 && activeReadStart > localReadStart,
  "Local and active store readers must exist",
);
assert.doesNotMatch(
  store.slice(localReadStart, activeReadStart),
  /getSupabaseAdmin|\.select\(/,
  "The full-history helper must be local-file-only",
);

console.log("Waitlist reliability regression test passed.");
