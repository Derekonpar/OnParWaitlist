/**
 * Read-only smoke/performance check for a deployed waitlist.
 * This script never creates guests, resource sessions, or SMS messages.
 *
 * Run: node scripts/test-production-readonly.mjs https://onparwaitlist.com
 */
import assert from "node:assert/strict";

const suppliedBase = process.argv[2];
if (!suppliedBase) {
  console.error("Usage: node scripts/test-production-readonly.mjs <base-url>");
  process.exit(2);
}

const base = suppliedBase.replace(/\/$/, "");
const BOARD_SAMPLES = 8;
const MAX_BOARD_MS = 3_000;
const MAX_PAGE_MS = 3_000;

async function timedRequest(path, timeoutMs = 10_000) {
  const startedAt = performance.now();
  const response = await fetch(`${base}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, elapsedMs: performance.now() - startedAt };
}

const health = await timedRequest("/api/health");
assert.equal(health.response.status, 200, "Health endpoint must return 200");
assert.ok(health.elapsedMs < MAX_PAGE_MS, "Health endpoint must be safe for 30-second polling");
const healthBody = await health.response.json();
assert.equal(typeof healthBody.service, "string", "Health response needs service");
assert.equal(typeof healthBody.checkedAt, "string", "Health response needs checkedAt");
assert.ok(
  Number.isFinite(new Date(healthBody.checkedAt).getTime()) &&
    /(Z|[+-]\d{2}:\d{2})$/.test(healthBody.checkedAt),
  "Health checkedAt must be a timezone-aware timestamp",
);
assert.equal(
  typeof healthBody.version?.build,
  "string",
  "Health response needs a sanitized build identifier",
);
const forbiddenHealthKeys = [];
function inspectHealthKeys(value, path = "") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/(guest|phone|queue|reservation|credential|secret|token|raw.?error)/i.test(key)) {
      forbiddenHealthKeys.push(childPath);
    }
    inspectHealthKeys(child, childPath);
  }
}
inspectHealthKeys(healthBody);
assert.deepEqual(
  forbiddenHealthKeys,
  [],
  "Health response must not expose guest, queue, reservation, credential, or raw-error data",
);

const boardLatencies = [];
let aggregateWaiting = null;
for (let sample = 0; sample < BOARD_SAMPLES; sample += 1) {
  const result = await timedRequest("/api/waitlist/board");
  assert.equal(result.response.status, 200, "Board endpoint must return 200");
  const body = await result.response.json();
  assert.equal(body.stale, false, "Board must not serve an empty timeout fallback");
  assert.equal(body.board?.length, 4, "Board must contain four live activities");
  assert.ok(result.elapsedMs < MAX_BOARD_MS, `Board exceeded ${MAX_BOARD_MS}ms`);
  for (const activity of body.board) {
    assert.ok(
      activity.stats?.availabilityStatus === "live" ||
        activity.stats?.availabilityStatus === "unknown",
      "Each wait must declare whether live availability is known",
    );
  }
  aggregateWaiting = body.board.reduce(
    (sum, activity) => sum + Number(activity.stats?.waitingCount ?? 0),
    0,
  );
  boardLatencies.push(result.elapsedMs);
}

for (const path of ["/", "/view", "/staff"]) {
  const result = await timedRequest(path);
  assert.equal(result.response.status, 200, `${path} must return 200`);
  assert.ok(result.elapsedMs < MAX_PAGE_MS, `${path} exceeded ${MAX_PAGE_MS}ms`);
  await result.response.arrayBuffer();
}

const sorted = [...boardLatencies].sort((left, right) => left - right);
const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
console.log(
  JSON.stringify({
    ok: true,
    boardSamples: BOARD_SAMPLES,
    boardP95Ms: Math.round(p95),
    aggregateWaiting,
    healthStatus: healthBody.status,
    build: healthBody.version.build,
  }),
);
