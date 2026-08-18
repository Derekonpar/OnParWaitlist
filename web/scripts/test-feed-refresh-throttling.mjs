import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dartsee = source("../src/lib/dartsee-lanes.ts");
const liveAvailability = source("../src/lib/live-lane-availability.ts");
const boardRoute = source("../src/app/api/waitlist/board/route.ts");
const statusRoute = source("../src/app/api/waitlist/status/[id]/route.ts");

assert.doesNotMatch(
  dartsee,
  /let\s+snapshotRequest\s*:/,
  "Dartsee must not keep a request-bound Promise in module scope",
);
assert.match(
  dartsee,
  /let nextRefreshAttemptAt = 0;/,
  "Dartsee refreshes need a plain-data in-isolate gate",
);
assert.match(
  dartsee,
  /const STORAGE_LOCK_PREFIX = "dartsee-lanes\/refresh-lock-v2";/,
  "Immutable Dartsee snapshots need a lease namespace distinct from legacy current.json publishers",
);
assert.match(
  dartsee,
  /const REFRESH_LEASE_WINDOW_MS = 15_000;[\s\S]*?const REFRESH_TARGET_AGE_MS = 10_000;/,
  "Snapshot refreshes should become eligible before the 15-second durable fanout window ends",
);
assert.match(
  dartsee,
  /if \(now < nextStoredReadAt\) return lastKnown;[\s\S]*?nextStoredReadAt = now \+ STORED_SNAPSHOT_READ_CACHE_MS;[\s\S]*?getSupabaseAdmin\(\)/,
  "Concurrent public polls must be gated before shared storage I/O",
);

const refreshStart = dartsee.indexOf("export async function getDartseeLaneSnapshot");
const localClaim = dartsee.indexOf(
  "nextRefreshAttemptAt = startedAt + REFRESH_IN_FLIGHT_GUARD_MS",
  refreshStart,
);
const firstStoredRead = dartsee.indexOf("stored = await getStoredSnapshot()", refreshStart);
assert.ok(refreshStart >= 0 && localClaim >= 0 && firstStoredRead >= 0);
assert.ok(
  localClaim < firstStoredRead,
  "The local refresh window must be claimed before request-bound storage I/O",
);

const leaseLoserStart = dartsee.indexOf("if (!ownsRefresh)", refreshStart);
const leaseLoserEnd = dartsee.indexOf("const token = await getAccessToken()", leaseLoserStart);
const leaseLoser = dartsee.slice(leaseLoserStart, leaseLoserEnd);
assert.match(leaseLoser, /return stored;/, "Lease losers must retain the shared snapshot");
assert.doesNotMatch(leaseLoser, /setTimeout|getStoredSnapshot/, "Lease losers must return immediately");

const refreshBody = dartsee.slice(refreshStart);
assert.match(
  refreshBody,
  /const refreshAgeMs = refreshTargetAgeMs\(cacheMs\);/,
  "Refresh eligibility must be separate from the served snapshot cache TTL",
);
assert.match(
  refreshBody,
  /nextRefreshAttemptAt = nextSnapshotRefreshAt\([\s\S]*?startedAt,[\s\S]*?\);/,
  "Successful refresh scheduling must be anchored to snapshot/request time",
);
assert.doesNotMatch(
  refreshBody,
  /nextRefreshAttemptAt = Date\.now\(\) \+ (?:cacheMs|winnerCacheMs);/,
  "Successful refreshes must not add a full cache TTL after their I/O finishes",
);
assert.match(
  refreshBody,
  /nextRefreshAttemptAt = publication\.settled[\s\S]*?: Date\.now\(\) \+ LEASE_LOSER_RETRY_MS;/,
  "An unsettled publication must keep the minimum lease-loser retry delay even when its winner is old",
);
assert.match(
  dartsee,
  /function isDartseeAuthorizationError[\s\S]*?DARTSEE_HTTP_401[\s\S]*?DARTSEE_HTTP_403/,
  "Only explicit Dartsee authorization responses should be classified as auth failures",
);
assert.match(
  refreshBody,
  /healthStatus: authFailure \? "auth-error" : "connection-error"/,
  "Transient refresh failures must not be mislabeled as authentication errors",
);
assert.match(
  refreshBody,
  /consecutiveIncompleteRefreshes:[\s\S]*?previous\.consecutiveIncompleteRefreshes \?\? 0\) \+ 1/,
  "Refresh exceptions must advance the sustained-failure count while retaining last-known lanes",
);
assert.doesNotMatch(
  refreshBody,
  /console\.error\("\[dartsee lanes\]", err\)/,
  "Refresh diagnostics must not log raw upstream errors",
);

assert.match(
  dartsee,
  /if \(!token\) \{[\s\S]*?return stored;/,
  "Missing credentials must preserve last-known-good Dartsee data",
);
assert.match(
  dartsee,
  /if \(!liveSnapshot\) \{[\s\S]*?return stored;/,
  "An empty live refresh must preserve last-known-good Dartsee data",
);
assert.match(
  dartsee,
  /const lastKnown = snapshotCache\?\.snapshot \?\? null;[\s\S]*?catch \{[\s\S]*?rememberSnapshot\(lastKnown,[\s\S]*?return lastKnown;/,
  "A transient storage read error must preserve the in-isolate last-known snapshot",
);

const throttleClaim = liveAvailability.indexOf(
  "nextRemoteRefreshAt = now + REMOTE_REFRESH_THROTTLE_MS",
);
const upstreamWork = liveAvailability.indexOf("await Promise.allSettled([", throttleClaim);
assert.ok(throttleClaim >= 0 && upstreamWork >= 0 && throttleClaim < upstreamWork);
assert.match(
  liveAvailability,
  /if \(now < nextRemoteRefreshAt\) return;/,
  "Repeated after() callbacks must be throttled without sharing a Promise",
);
assert.match(boardRoute, /after\(refreshLiveLaneSources\)/);
assert.match(statusRoute, /after\(refreshLiveLaneSources\)/);

console.log("Feed refresh throttling regression test passed.");
