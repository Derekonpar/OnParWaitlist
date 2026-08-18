import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  isValidSingaZoneId,
  parseSingaPublicStagePayload,
  unavailableSingaPublicStageWait,
} from "../src/lib/singa-public-stage-contract.ts";

const zoneId = DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID;
const venueId = DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID;
const checkedAt = "2026-08-18T16:00:00.000Z";

assert.equal(isValidSingaZoneId(zoneId), true);
assert.equal(isValidSingaZoneId("zone_../private"), false);
assert.equal(isValidSingaZoneId("venue_01kagmx6mnf4ate09115a73cys"), false);
assert.equal(isValidSingaVenueId(venueId), true);
assert.equal(isValidSingaVenueId("ven_../private"), false);
assert.equal(isValidSingaVenueId(zoneId), false);
assert.equal(SINGA_PUBLIC_STAGE_TIMEOUT_MS, 5_000);
assert.equal(SINGA_PUBLIC_STAGE_CACHE_MS, 10_000);
assert.equal(SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS, 60_000);

const active = parseSingaPublicStagePayload(
  {
    id: zoneId,
    venue_id: venueId,
    session: { queue_length: 20, public_code: "DO-NOT-EXPOSE" },
  },
  zoneId,
  venueId,
  checkedAt,
);
assert.deepEqual(
  active,
  {
    status: "active",
    waitMinutes: 20,
    stale: false,
    checkedAt,
    dataUpdatedAt: checkedAt,
  },
  "An active stage must expose the estimated wait without retaining its join code",
);

assert.deepEqual(
  parseSingaPublicStagePayload(
    { id: zoneId, venue_id: venueId, session: { queue_length: 0 } },
    zoneId,
    venueId,
    checkedAt,
  ),
  {
    status: "active",
    waitMinutes: 0,
    stale: false,
    checkedAt,
    dataUpdatedAt: checkedAt,
  },
  "Zero is a valid active-stage wait",
);

const inactive = parseSingaPublicStagePayload(
  { id: zoneId, venue_id: venueId, session: null },
  zoneId,
  venueId,
  checkedAt,
);
assert.deepEqual(inactive, {
  status: "inactive",
  waitMinutes: null,
  stale: false,
  checkedAt,
  dataUpdatedAt: checkedAt,
});

for (const queueLength of [-1, 1.5, "5", null, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(
    parseSingaPublicStagePayload(
      {
        id: zoneId,
        venue_id: venueId,
        session: { queue_length: queueLength },
      },
      zoneId,
      venueId,
      checkedAt,
    ),
    null,
    `Invalid queue_length ${String(queueLength)} must be rejected`,
  );
}

for (const malformed of [
  null,
  {},
  {
    id: "zone_01aaaaaaaaaaaaaaaaaaaaaaaa",
    venue_id: venueId,
    session: null,
  },
  { id: zoneId, venue_id: "ven_01aaaaaaaaaaaaaaaaaaaaaaaa", session: null },
  { id: zoneId },
  { id: zoneId, venue_id: venueId, session: [] },
]) {
  assert.equal(
    parseSingaPublicStagePayload(malformed, zoneId, venueId, checkedAt),
    null,
    "Malformed or wrong-zone payloads must be unavailable",
  );
}

const failedAt = "2026-08-18T16:01:00.000Z";
const unavailableWithoutHistory = unavailableSingaPublicStageWait(failedAt, null);
assert.deepEqual(unavailableWithoutHistory, {
  status: "unavailable",
  waitMinutes: null,
  stale: false,
  checkedAt: failedAt,
  dataUpdatedAt: null,
  lastKnown: null,
});

assert.deepEqual(unavailableSingaPublicStageWait(failedAt, inactive), {
  status: "unavailable",
  waitMinutes: null,
  stale: true,
  checkedAt: failedAt,
  dataUpdatedAt: checkedAt,
  lastKnown: {
    status: "inactive",
    waitMinutes: null,
    dataUpdatedAt: checkedAt,
  },
});

const expiredAt = "2026-08-18T16:01:00.001Z";
assert.deepEqual(unavailableSingaPublicStageWait(expiredAt, active), {
  status: "unavailable",
  waitMinutes: null,
  stale: false,
  checkedAt: expiredAt,
  dataUpdatedAt: null,
  lastKnown: null,
});

assert.equal(
  parseSingaPublicStagePayload(
    { id: zoneId, venue_id: venueId, session: null },
    zoneId,
    "venue-not-valid",
    checkedAt,
  ),
  null,
  "An invalid configured venue ID must fail closed",
);

const route = readFileSync(
  new URL("../src/app/api/karaoke/public-stage/route.ts", import.meta.url),
  "utf8",
);
const client = readFileSync(
  new URL("../src/lib/singa-public-stage.ts", import.meta.url),
  "utf8",
);

assert.match(route, /export async function GET\(request: Request\)/);
assert.match(route, /getSingaPublicStageWait\(request\)/);
assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(route, /public_code|username|password|credential/i);
assert.match(route, /"cache-control": "private, no-store"/);
assert.match(client, /new Request\([\s\S]*?requestContext as unknown as RequestInit/);
assert.match(client, /inheritedHeaderNames/);
assert.match(client, /request\.headers\.delete\(name\)/);
assert.match(
  client,
  /request\.headers\.set\("user-agent", "OnPar-Waitlist\/1\.0"\)/,
  "The Worker request must identify itself because Singa rejects a missing User-Agent",
);
assert.match(client, /request\.headers\.delete\("cf-workers-preview-token"\)/);
assert.match(client, /SINGA_PUBLIC_STAGE_VENUE_ID/);
assert.match(client, /refreshInFlight/);
assert.doesNotMatch(client, /Authorization|SINGA_(USERNAME|PASSWORD)|console\./i);

console.log("Singa public-stage regression test passed.");
