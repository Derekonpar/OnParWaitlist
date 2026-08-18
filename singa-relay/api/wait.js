import { createHash, timingSafeEqual } from "node:crypto";

const SINGA_ZONE_ID = "zone_01kagmx6mnf4ate09115a73cys";
const SINGA_VENUE_ID = "ven_01he2x75nmeey8m93b5madk9et";
const SINGA_URL =
  `https://business-api.singa.com/v1/public/zones/${SINGA_ZONE_ID}`;
const UPSTREAM_TIMEOUT_MS = 5_000;
const CACHE_MS = 10_000;

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

export function parseSingaPayload(payload, checkedAt) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (payload.id !== SINGA_ZONE_ID || payload.venue_id !== SINGA_VENUE_ID) {
    return null;
  }
  if (payload.session === null) {
    return { status: "inactive", waitMinutes: null, checkedAt };
  }
  if (
    !payload.session ||
    typeof payload.session !== "object" ||
    Array.isArray(payload.session) ||
    !Number.isSafeInteger(payload.session.queue_length) ||
    payload.session.queue_length < 0
  ) {
    return null;
  }
  return {
    status: "active",
    waitMinutes: payload.session.queue_length,
    checkedAt,
  };
}

async function refresh() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(SINGA_URL, {
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
      new Date().toISOString(),
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
