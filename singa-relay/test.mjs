import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSingaPayload, singaWaitUrl } from "./api/wait.js";

const venueId = 8470;
const venueResourceId = "ven_01he2x75nmeey8m93b5madk9et";
const queueId = 8418;
const queueResourceId = "que_01he2x7e45esq8r2fve7vh3c88";
const checkedAt = "2026-08-18T17:30:00.000Z";

assert.equal(
  singaWaitUrl(0),
  "https://api.singa.com/v1.4/venues/8470/?onpar_wait_status=0",
);
assert.match(singaWaitUrl(29_999), /onpar_wait_status=0$/);
assert.match(singaWaitUrl(30_000), /onpar_wait_status=1$/);
assert.match(singaWaitUrl(59_999), /onpar_wait_status=1$/);
assert.match(singaWaitUrl(60_000), /onpar_wait_status=0$/);

function payload(queue) {
  return {
    id: venueId,
    resource_id: venueResourceId,
    queues: [queue],
  };
}

function queue(overrides = {}) {
  return {
    id: queueId,
    resource_id: queueResourceId,
    queue_size: 0,
    queue_duration: 0,
    accepts_requests: true,
    ...overrides,
  };
}

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
  parseSingaPayload(payload(queue({ accepts_requests: false })), checkedAt),
  { status: "inactive", waitMinutes: null, checkedAt },
);
assert.deepEqual(
  parseSingaPayload(payload(queue({ queue_size: 4, queue_duration: 17.2 })), checkedAt),
  { status: "active", waitMinutes: 18, checkedAt },
);

for (const malformedPayload of [
  null,
  {},
  { id: "wrong", resource_id: venueResourceId, queues: [] },
  { id: venueId, resource_id: "wrong", queues: [] },
  payload(queue({ id: 9999 })),
  payload(queue({ resource_id: "wrong" })),
  payload(queue({ accepts_requests: null })),
  payload(queue({ queue_size: -1 })),
  payload(queue({ queue_size: 1.5 })),
  payload(queue({ queue_duration: -1 })),
  payload(queue({ queue_duration: "5" })),
  payload(queue({ queue_duration: Number.POSITIVE_INFINITY })),
  {
    id: venueId,
    resource_id: venueResourceId,
    queues: [queue(), queue()],
  },
]) {
  assert.equal(parseSingaPayload(malformedPayload, checkedAt), null);
}

const source = readFileSync(new URL("./api/wait.js", import.meta.url), "utf8");
assert.match(source, /request\.method !== "GET"/);
assert.doesNotMatch(source, /request\.query|new URL\(request\.url/);
assert.match(source, /SINGA_PUBLIC_STAGE_RELAY_TOKEN/);
assert.match(source, /timingSafeEqual/);
assert.match(source, /UPSTREAM_TIMEOUT_MS = 5_000/);
assert.match(source, /CACHE_MS = 10_000/);
assert.match(source, /UPSTREAM_CACHE_BUCKET_MS = 30_000/);
assert.match(source, /Math\.floor\(nowMs \/ UPSTREAM_CACHE_BUCKET_MS\) % 2/);
assert.match(source, /headers\?\.get\?\.\("age"\)/);
assert.match(source, /headers\?\.get\?\.\("date"\)/);
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
      json: async () =>
        payload(
          queue({
            queue_size: 3,
            queue_duration: 12,
            session_public_code: "DO-NOT-EXPOSE",
            ignored: "DO-NOT-EXPOSE",
          }),
        ),
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
    json: async () => ({ id: "wrong", resource_id: venueResourceId, queues: [] }),
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
