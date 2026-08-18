import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSingaPayload } from "./api/wait.js";

const zoneId = "zone_01kagmx6mnf4ate09115a73cys";
const venueId = "ven_01he2x75nmeey8m93b5madk9et";
const checkedAt = "2026-08-18T17:30:00.000Z";

function request(method = "GET", authorization) {
  return {
    method,
    headers: authorization ? { authorization } : {},
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value;
    },
  };
}

async function freshHandler(name) {
  return (await import(`./api/wait.js?test=${name}`)).default;
}

assert.deepEqual(
  parseSingaPayload(
    { id: zoneId, venue_id: venueId, session: null },
    checkedAt,
  ),
  { status: "inactive", waitMinutes: null, checkedAt },
);
assert.deepEqual(
  parseSingaPayload(
    {
      id: zoneId,
      venue_id: venueId,
      session: { queue_length: 66, ignored_join_value: "never returned" },
    },
    checkedAt,
  ),
  { status: "active", waitMinutes: 66, checkedAt },
);

for (const payload of [
  null,
  {},
  { id: "wrong", venue_id: venueId, session: null },
  { id: zoneId, venue_id: "wrong", session: null },
  { id: zoneId, venue_id: venueId, session: {} },
  { id: zoneId, venue_id: venueId, session: { queue_length: -1 } },
  { id: zoneId, venue_id: venueId, session: { queue_length: 1.5 } },
  { id: zoneId, venue_id: venueId, session: { queue_length: "5" } },
]) {
  assert.equal(parseSingaPayload(payload, checkedAt), null);
}

const source = readFileSync(new URL("./api/wait.js", import.meta.url), "utf8");
assert.match(source, /request\.method !== "GET"/);
assert.doesNotMatch(source, /request\.query|new URL\(request\.url/);
assert.match(source, /SINGA_PUBLIC_STAGE_RELAY_TOKEN/);
assert.match(source, /timingSafeEqual/);
assert.match(source, /UPSTREAM_TIMEOUT_MS = 5_000/);
assert.match(source, /CACHE_MS = 10_000/);
assert.doesNotMatch(source, /SINGA_(USERNAME|PASSWORD)|console\.|response\.text\(/i);

const originalFetch = globalThis.fetch;
const originalToken = process.env.SINGA_PUBLIC_STAGE_RELAY_TOKEN;
try {
  process.env.SINGA_PUBLIC_STAGE_RELAY_TOKEN = "test-token";

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unauthorized requests must never reach the upstream.");
  };
  const unauthorizedHandler = await freshHandler("unauthorized");
  const unauthorizedResponse = response();
  await unauthorizedHandler(request(), unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.deepEqual(JSON.parse(unauthorizedResponse.body), {
    error: "Unauthorized.",
  });
  assert.equal(fetchCalls, 0);

  const methodResponse = response();
  await unauthorizedHandler(
    request("POST", "Bearer test-token"),
    methodResponse,
  );
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.allow, "GET");
  assert.equal(fetchCalls, 0);

  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        id: zoneId,
        venue_id: venueId,
        session: {
          queue_length: 12,
          public_code: "DO-NOT-EXPOSE",
          ignored: "DO-NOT-EXPOSE",
        },
      }),
    };
  };
  const activeHandler = await freshHandler("active");
  const activeResponses = [response(), response()];
  await Promise.all(
    activeResponses.map((value) =>
      activeHandler(request("GET", "Bearer test-token"), value),
    ),
  );
  assert.equal(fetchCalls, 1);
  for (const value of activeResponses) {
    assert.equal(value.statusCode, 200);
    const body = JSON.parse(value.body);
    assert.deepEqual(Object.keys(body).sort(), [
      "checkedAt",
      "status",
      "waitMinutes",
    ]);
    assert.equal(body.status, "active");
    assert.equal(body.waitMinutes, 12);
    assert.doesNotMatch(value.body, /public_code|DO-NOT-EXPOSE/i);
  }

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: "wrong", venue_id: venueId, session: null }),
  });
  const malformedHandler = await freshHandler("malformed");
  const malformedResponse = response();
  await malformedHandler(
    request("GET", "Bearer test-token"),
    malformedResponse,
  );
  assert.equal(malformedResponse.statusCode, 502);
  assert.deepEqual(Object.keys(JSON.parse(malformedResponse.body)).sort(), [
    "checkedAt",
    "status",
  ]);
} finally {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) {
    delete process.env.SINGA_PUBLIC_STAGE_RELAY_TOKEN;
  } else {
    process.env.SINGA_PUBLIC_STAGE_RELAY_TOKEN = originalToken;
  }
}

console.log("Singa relay regression test passed.");
