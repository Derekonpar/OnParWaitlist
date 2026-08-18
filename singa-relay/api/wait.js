import { createHash, timingSafeEqual } from "node:crypto";

const SINGA_VENUE_ID = 8470;
const SINGA_VENUE_RESOURCE_ID = "ven_01he2x75nmeey8m93b5madk9et";
const SINGA_QUEUE_ID = 8418;
const SINGA_QUEUE_RESOURCE_ID = "que_01he2x7e45esq8r2fve7vh3c88";
const SINGA_URL = `https://api.singa.com/v1.4/venues/${SINGA_VENUE_ID}/`;
const UPSTREAM_TIMEOUT_MS = 5_000;
const CACHE_MS = 10_000;
const UPSTREAM_CACHE_BUCKET_MS = 30_000;

let cached = null;
let refreshInFlight = null;

function safeSecretEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function authorized(request) {
  const configured = process.env.SINGA_PUBLIC_STAGE_RELAY_TOKEN?.trim() ?? "";
  const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() ?? "";
  return (
    configured.length > 0 &&
    supplied.length > 0 &&
    safeSecretEqual(configured, supplied)
  );
}

function upstreamCheckedAt(upstream) {
  const nowMs = Date.now();
  const candidates = [nowMs];
  const dateMs = Date.parse(upstream.headers?.get?.("date") ?? "");
  if (
    Number.isFinite(dateMs) &&
    dateMs >= nowMs - 5 * 60_000 &&
    dateMs <= nowMs + 5_000
  ) {
    candidates.push(dateMs);
  }

  const ageHeader = upstream.headers?.get?.("age") ?? "";
  if (/^\d+$/.test(ageHeader)) {
    const ageSeconds = Number(ageHeader);
    if (Number.isSafeInteger(ageSeconds) && ageSeconds <= 5 * 60) {
      candidates.push(nowMs - ageSeconds * 1_000);
    }
  }
  return new Date(Math.min(...candidates)).toISOString();
}

export function singaWaitUrl(nowMs = Date.now()) {
  const bucket = Math.floor(nowMs / UPSTREAM_CACHE_BUCKET_MS) % 2;
  return `${SINGA_URL}?onpar_wait_status=${bucket}`;
}

export function parseSingaPayload(payload, checkedAt) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (
    payload.id !== SINGA_VENUE_ID ||
    payload.resource_id !== SINGA_VENUE_RESOURCE_ID ||
    !Array.isArray(payload.queues)
  ) {
    return null;
  }

  const queues = payload.queues.filter(
    (queue) =>
      queue &&
      typeof queue === "object" &&
      !Array.isArray(queue) &&
      queue.id === SINGA_QUEUE_ID &&
      queue.resource_id === SINGA_QUEUE_RESOURCE_ID,
  );
  if (queues.length !== 1) return null;

  const [queue] = queues;
  if (queue.accepts_requests === false) {
    return { status: "inactive", waitMinutes: null, checkedAt };
  }
  if (
    queue.accepts_requests !== true ||
    !Number.isSafeInteger(queue.queue_size) ||
    queue.queue_size < 0 ||
    typeof queue.queue_duration !== "number" ||
    !Number.isFinite(queue.queue_duration) ||
    queue.queue_duration < 0
  ) {
    return null;
  }

  const waitMinutes = Math.ceil(queue.queue_duration);
  if (!Number.isSafeInteger(waitMinutes)) return null;
  return {
    status: "active",
    waitMinutes,
    checkedAt,
  };
}

async function refresh() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(singaWaitUrl(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "OnPar-Waitlist/1.0",
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!upstream.ok) return null;
    const value = parseSingaPayload(
      await upstream.json(),
      upstreamCheckedAt(upstream),
    );
    if (value) cached = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function currentWait() {
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refresh();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function send(response, status, body) {
  response.statusCode = status;
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    return send(response, 405, { error: "Method not allowed." });
  }
  if (!authorized(request)) {
    response.setHeader("www-authenticate", "Bearer");
    return send(response, 401, { error: "Unauthorized." });
  }

  const wait = await currentWait();
  if (!wait) {
    return send(response, 502, {
      status: "unavailable",
      checkedAt: new Date().toISOString(),
    });
  }
  return send(response, 200, wait);
}
