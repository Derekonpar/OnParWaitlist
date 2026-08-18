import { readEnv } from "./env";
import {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  isValidSingaZoneId,
  parseSingaPublicStagePayload,
  parseSingaPublicStageRelayPayload,
  unavailableSingaPublicStageWait,
  type SingaPublicStageFreshWait,
  type SingaPublicStageUnavailableWait,
  type SingaPublicStageWait,
} from "./singa-public-stage-contract";

export {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  isValidSingaZoneId,
  parseSingaPublicStagePayload,
  parseSingaPublicStageRelayPayload,
  unavailableSingaPublicStageWait,
  type SingaPublicStageFreshWait,
  type SingaPublicStageLastKnown,
  type SingaPublicStageUnavailableWait,
  type SingaPublicStageWait,
} from "./singa-public-stage-contract";

const SINGA_PUBLIC_ZONE_URL =
  "https://business-api.singa.com/v1/public/zones";

let responseCache:
  | { value: SingaPublicStageWait; expiresAt: number }
  | null = null;
let lastKnownGood: SingaPublicStageFreshWait | null = null;
let refreshInFlight: Promise<SingaPublicStageWait> | null = null;

function configuredZoneId(): string {
  return (
    readEnv("SINGA_PUBLIC_STAGE_ZONE_ID") ??
    DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID
  ).trim();
}

function configuredVenueId(): string {
  return (
    readEnv("SINGA_PUBLIC_STAGE_VENUE_ID") ??
    DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID
  ).trim();
}

function configuredRelayToken(): string | null {
  const value = readEnv("SINGA_PUBLIC_STAGE_RELAY_TOKEN")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function remember(value: SingaPublicStageWait): SingaPublicStageWait {
  const nowMs = Date.now();
  let expiresAt = nowMs + SINGA_PUBLIC_STAGE_CACHE_MS;
  if (value.status === "unavailable" && value.dataUpdatedAt) {
    const lastKnownExpiresAt =
      Date.parse(value.dataUpdatedAt) +
      SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS;
    if (Number.isFinite(lastKnownExpiresAt)) {
      expiresAt = Math.min(expiresAt, lastKnownExpiresAt);
    }
  }
  responseCache = {
    value,
    expiresAt,
  };
  return value;
}

function unavailableNow(): SingaPublicStageUnavailableWait {
  const value = unavailableSingaPublicStageWait(
    new Date().toISOString(),
    lastKnownGood,
  );
  if (!value.lastKnown) lastKnownGood = null;
  return value;
}

function singaPublicStageRequest(
  requestContext: Request,
  zoneId: string,
): Request {
  // Cloudflare can reject a cross-zone subrequest when it is created without
  // the incoming request context. Clone only that routing context, then remove
  // every browser-supplied header before the request leaves On Par.
  const request = new Request(
    `${SINGA_PUBLIC_ZONE_URL}/${encodeURIComponent(zoneId)}`,
    requestContext as unknown as RequestInit,
  );
  const inheritedHeaderNames: string[] = [];
  request.headers.forEach((_value, name) => inheritedHeaderNames.push(name));
  for (const name of inheritedHeaderNames) request.headers.delete(name);
  request.headers.set("accept", "application/json");
  request.headers.set("cache-control", "no-cache");
  request.headers.set("user-agent", "OnPar-Waitlist/1.0");
  // Wrangler remote preview adds this header automatically. Other Cloudflare
  // zones reject it, and production never needs it.
  request.headers.delete("cf-workers-preview-token");
  return request;
}

function singaPublicStageRelayRequest(token: string): Request {
  return new Request(DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "cache-control": "no-cache",
      "user-agent": "OnPar-Waitlist/1.0",
    },
    redirect: "error",
  });
}

async function refreshSingaPublicStageWait(
  requestContext: Request,
): Promise<SingaPublicStageWait> {
  const zoneId = configuredZoneId();
  const venueId = configuredVenueId();
  if (!isValidSingaZoneId(zoneId) || !isValidSingaVenueId(venueId)) {
    return remember(unavailableNow());
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  );

  try {
    const relayToken = configuredRelayToken();
    const response = await fetch(
      relayToken
        ? singaPublicStageRelayRequest(relayToken)
        : singaPublicStageRequest(requestContext, zoneId),
      { signal: controller.signal },
    );
    if (!response.ok) return remember(unavailableNow());

    const checkedAt = new Date().toISOString();
    const payload = (await response.json()) as unknown;
    const fresh = relayToken
      ? parseSingaPublicStageRelayPayload(payload, checkedAt)
      : parseSingaPublicStagePayload(
          payload,
          zoneId,
          venueId,
          checkedAt,
        );
    if (!fresh) return remember(unavailableNow());

    lastKnownGood = fresh;
    return remember(fresh);
  } catch {
    return remember(unavailableNow());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read the public Singa stage wait. This server-side call never authenticates
 * to a guest or staff Singa account, never mutates Singa, and never exposes or
 * logs upstream response details. Production uses a fixed, token-protected
 * read relay; local development can read Singa's public endpoint directly.
 */
export async function getSingaPublicStageWait(
  requestContext: Request,
): Promise<SingaPublicStageWait> {
  const nowMs = Date.now();
  if (responseCache && nowMs < responseCache.expiresAt) {
    return responseCache.value;
  }
  if (refreshInFlight) return refreshInFlight;

  const refresh = refreshSingaPublicStageWait(requestContext);
  refreshInFlight = refresh;
  try {
    return await refresh;
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = null;
  }
}
