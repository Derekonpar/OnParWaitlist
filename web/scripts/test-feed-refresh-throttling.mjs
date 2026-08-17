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
  /const lastKnown = snapshotCache\?\.snapshot \?\? null;[\s\S]*?if \(error\) \{[\s\S]*?return lastKnown;/,
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
